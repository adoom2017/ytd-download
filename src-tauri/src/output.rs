use std::{fs, path::PathBuf, time::SystemTime};

use crate::models::DownloadTask;

pub fn resolve_output_path(task: &DownloadTask) -> Option<PathBuf> {
    if let Some(path) = task.output_path.as_deref().map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }

    let marker = format!("[{}]", task.video_id);
    fs::read_dir(&task.output_directory)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_ascii_lowercase();
            if !name.contains(&marker)
                || lower.ends_with(".part")
                || lower.ends_with(".ytdl")
                || lower.contains(".temp.")
            {
                return None;
            }
            let modified = entry
                .metadata()
                .ok()?
                .modified()
                .unwrap_or(SystemTime::UNIX_EPOCH);
            Some((modified, entry.path()))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DownloadPreset, TaskProgress, TaskStatus};

    fn task(directory: &str) -> DownloadTask {
        DownloadTask {
            id: "1".into(),
            video_id: "M7lc1UVf-VE".into(),
            title: "中文标题".into(),
            channel: "频道".into(),
            thumbnail_url: String::new(),
            webpage_url: "https://www.youtube.com/watch?v=M7lc1UVf-VE".into(),
            preset: DownloadPreset::Video1080,
            output_directory: directory.into(),
            output_path: Some("C:/乱码/不存在.mp4".into()),
            status: TaskStatus::Completed,
            progress: TaskProgress::default(),
            error: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn repairs_a_missing_or_misdecoded_path_from_the_video_id() {
        let temp = tempfile::tempdir().unwrap();
        let final_file = temp.path().join("中文标题 [M7lc1UVf-VE].mp4");
        let partial_file = temp.path().join("中文标题 [M7lc1UVf-VE].f137.mp4.part");
        fs::write(&partial_file, b"partial").unwrap();
        fs::write(&final_file, b"complete").unwrap();

        assert_eq!(
            resolve_output_path(&task(&temp.path().to_string_lossy())).unwrap(),
            final_file
        );
    }
}
