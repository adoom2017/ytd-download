use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use crate::{
    models::{DownloadTask, TaskStatus},
    output::{delete_downloaded_file, resolve_output_path},
    AppError, AppResult,
};

#[derive(Debug, Clone)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn open(app_data_dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(app_data_dir)?;
        let database = Self {
            path: app_data_dir.join("streamnest.sqlite3"),
        };
        database.migrate()?;
        database.recover_interrupted()?;
        database.repair_completed_output_paths()?;
        Ok(database)
    }

    fn connect(&self) -> AppResult<Connection> {
        let connection = Connection::open(&self.path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(connection)
    }

    fn migrate(&self) -> AppResult<()> {
        let connection = self.connect()?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at);
            INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, datetime('now'));"
        )?;
        Ok(())
    }

    fn recover_interrupted(&self) -> AppResult<()> {
        let mut tasks = self.list_tasks()?;
        for task in &mut tasks {
            if matches!(
                task.status,
                TaskStatus::Resolving | TaskStatus::Downloading | TaskStatus::Processing
            ) {
                task.status = TaskStatus::Paused;
                task.progress.stage = "上次运行被中断，可继续下载".into();
                task.error = None;
                task.updated_at = Utc::now().to_rfc3339();
                self.save_task(task)?;
            }
        }
        Ok(())
    }

    fn repair_completed_output_paths(&self) -> AppResult<()> {
        for mut task in self.list_tasks()? {
            if task.status != TaskStatus::Completed {
                continue;
            }
            let Some(path) = resolve_output_path(&task) else {
                continue;
            };
            let repaired = path.to_string_lossy().to_string();
            if task.output_path.as_deref() != Some(repaired.as_str()) {
                task.output_path = Some(repaired);
                task.updated_at = Utc::now().to_rfc3339();
                self.save_task(&task)?;
            }
        }
        Ok(())
    }

    pub fn insert_task(&self, task: &DownloadTask) -> AppResult<()> {
        let payload = serde_json::to_string(task)?;
        self.connect()?.execute(
            "INSERT INTO tasks(id, status, payload, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5)",
            params![task.id, task.status.as_db(), payload, task.created_at, task.updated_at],
        )?;
        Ok(())
    }

    pub fn save_task(&self, task: &DownloadTask) -> AppResult<()> {
        let payload = serde_json::to_string(task)?;
        self.connect()?.execute(
            "UPDATE tasks SET status=?2, payload=?3, updated_at=?4 WHERE id=?1",
            params![task.id, task.status.as_db(), payload, task.updated_at],
        )?;
        Ok(())
    }

    pub fn task(&self, id: &str) -> AppResult<DownloadTask> {
        let payload: Option<String> = self
            .connect()?
            .query_row("SELECT payload FROM tasks WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()?;
        payload
            .map(|json| serde_json::from_str(&json))
            .transpose()?
            .ok_or_else(|| AppError::Validation("任务不存在".into()))
    }

    pub fn list_tasks(&self) -> AppResult<Vec<DownloadTask>> {
        let connection = self.connect()?;
        let mut statement =
            connection.prepare("SELECT payload FROM tasks ORDER BY created_at DESC")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut tasks = Vec::new();
        for row in rows {
            let payload = row?;
            tasks.push(serde_json::from_str(&payload)?);
        }
        Ok(tasks)
    }

    pub fn claim_next_queued(&self) -> AppResult<Option<DownloadTask>> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let payload: Option<String> = transaction
            .query_row(
                "SELECT payload FROM tasks WHERE status='queued' ORDER BY created_at ASC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let Some(payload) = payload else {
            transaction.commit()?;
            return Ok(None);
        };
        let mut task: DownloadTask = serde_json::from_str(&payload)?;
        task.status = TaskStatus::Resolving;
        task.progress.stage = "正在解析视频信息".into();
        task.updated_at = Utc::now().to_rfc3339();
        let next_payload = serde_json::to_string(&task)?;
        transaction.execute(
            "UPDATE tasks SET status='resolving', payload=?2, updated_at=?3 WHERE id=?1 AND status='queued'",
            params![task.id, next_payload, task.updated_at],
        )?;
        transaction.commit()?;
        Ok(Some(task))
    }

    pub fn delete_completed(&self) -> AppResult<()> {
        self.connect()?
            .execute("DELETE FROM tasks WHERE status='completed'", [])?;
        Ok(())
    }

    pub fn delete_task(&self, id: &str, delete_file: bool) -> AppResult<()> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let task = self.task(id)?;
        if !matches!(
            task.status,
            TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Canceled
        ) {
            return Err(AppError::Validation(
                "只能删除已完成、失败或已取消的任务记录".into(),
            ));
        }
        if delete_file {
            delete_downloaded_file(&task, &self.list_tasks()?)?;
        }
        transaction.execute("DELETE FROM tasks WHERE id=?1", [id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn setting(&self, key: &str) -> AppResult<Option<String>> {
        Ok(self
            .connect()?
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        self.connect()?.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DownloadPreset, TaskProgress};

    fn sample_task(status: TaskStatus) -> DownloadTask {
        let now = Utc::now().to_rfc3339();
        DownloadTask {
            id: "task-1".into(),
            video_id: "M7lc1UVf-VE".into(),
            title: "示例".into(),
            channel: "频道".into(),
            thumbnail_url: "https://example.test/thumb.jpg".into(),
            webpage_url: "https://www.youtube.com/watch?v=M7lc1UVf-VE".into(),
            preset: DownloadPreset::Video720,
            output_directory: "downloads".into(),
            output_path: None,
            status,
            progress: TaskProgress::default(),
            error: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }

    #[test]
    fn persists_and_claims_queue_in_order() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(temp.path()).unwrap();
        db.insert_task(&sample_task(TaskStatus::Queued)).unwrap();
        let claimed = db.claim_next_queued().unwrap().unwrap();
        assert_eq!(claimed.status, TaskStatus::Resolving);
        assert!(db.claim_next_queued().unwrap().is_none());
    }

    #[test]
    fn optional_file_deletion_removes_only_the_recorded_file() {
        for delete_file in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let output = temp.path().join("downloads");
            fs::create_dir(&output).unwrap();
            let target = output.join("中文 视频.mp4");
            let neighbor = output.join("其他视频.mp4");
            fs::write(&target, b"download").unwrap();
            fs::write(&neighbor, b"keep").unwrap();
            let db = Database::open(&temp.path().join("data")).unwrap();
            let mut task = sample_task(TaskStatus::Completed);
            task.output_directory = output.to_string_lossy().into_owned();
            task.output_path = Some(target.to_string_lossy().into_owned());
            db.insert_task(&task).unwrap();
            db.delete_task(&task.id, delete_file).unwrap();
            assert!(db.task(&task.id).is_err());
            assert_eq!(target.exists(), !delete_file);
            assert!(neighbor.exists());
            assert!(output.exists());
        }
    }

    #[test]
    fn refuses_an_outside_file_and_keeps_the_task_record() {
        let temp = tempfile::tempdir().unwrap();
        let output = temp.path().join("downloads");
        fs::create_dir(&output).unwrap();
        let target = temp.path().join("unrelated.mp4");
        fs::write(&target, b"keep").unwrap();
        let db = Database::open(&temp.path().join("data")).unwrap();
        let mut task = sample_task(TaskStatus::Completed);
        task.output_directory = output.to_string_lossy().into_owned();
        task.output_path = Some(target.to_string_lossy().into_owned());
        db.insert_task(&task).unwrap();
        assert!(db.delete_task(&task.id, true).is_err());
        assert!(db.task(&task.id).is_ok());
        assert!(target.exists());
    }

    #[test]
    fn refuses_a_shared_file_but_allows_removing_a_missing_file_record() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("shared.mp4");
        fs::write(&target, b"keep").unwrap();
        let db = Database::open(&temp.path().join("data")).unwrap();
        let mut task = sample_task(TaskStatus::Completed);
        task.output_directory = temp.path().to_string_lossy().into_owned();
        task.output_path = Some(target.to_string_lossy().into_owned());
        db.insert_task(&task).unwrap();
        let mut other = task.clone();
        other.id = "task-2".into();
        db.insert_task(&other).unwrap();
        assert!(db.delete_task(&task.id, true).is_err());
        assert!(target.exists());
        assert!(db.task(&task.id).is_ok());
        fs::remove_file(&target).unwrap();
        db.delete_task(&task.id, true).unwrap();
        assert!(db.task(&task.id).is_err());
    }

    #[test]
    fn recovers_active_tasks_as_paused() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(temp.path()).unwrap();
        db.insert_task(&sample_task(TaskStatus::Downloading))
            .unwrap();
        db.recover_interrupted().unwrap();
        assert_eq!(db.task("task-1").unwrap().status, TaskStatus::Paused);
    }

    #[test]
    fn repairs_a_completed_task_with_a_misdecoded_output_path() {
        let temp = tempfile::tempdir().unwrap();
        let output = temp.path().join("downloads");
        fs::create_dir_all(&output).unwrap();
        let final_file = output.join("中文标题 [M7lc1UVf-VE].mp4");
        fs::write(&final_file, b"complete").unwrap();

        let db = Database::open(&temp.path().join("data")).unwrap();
        let mut task = sample_task(TaskStatus::Completed);
        task.output_directory = output.to_string_lossy().to_string();
        task.output_path = Some(output.join("乱码.mp4").to_string_lossy().to_string());
        db.insert_task(&task).unwrap();
        db.repair_completed_output_paths().unwrap();

        assert_eq!(
            db.task("task-1").unwrap().output_path,
            Some(final_file.to_string_lossy().to_string())
        );
    }

    #[test]
    fn deletes_only_terminal_task_records() {
        let completed_dir = tempfile::tempdir().unwrap();
        let completed_db = Database::open(completed_dir.path()).unwrap();
        completed_db
            .insert_task(&sample_task(TaskStatus::Completed))
            .unwrap();
        completed_db.delete_task("task-1", false).unwrap();
        assert!(completed_db.task("task-1").is_err());

        let active_dir = tempfile::tempdir().unwrap();
        let active_db = Database::open(active_dir.path()).unwrap();
        active_db
            .insert_task(&sample_task(TaskStatus::Queued))
            .unwrap();
        assert!(active_db.delete_task("task-1", true).is_err());
    }
}
