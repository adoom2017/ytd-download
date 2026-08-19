use std::{collections::HashMap, path::PathBuf, sync::Arc};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use chrono::Utc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};
use tokio::sync::{watch, Mutex, Semaphore};

use crate::{
    db::Database,
    models::{DownloadPreset, DownloadTask, TaskStatus},
    progress::{parse_output_line, ParsedLine},
    AppError, AppResult,
};

#[derive(Debug, Clone, Copy)]
pub enum ControlAction {
    Run,
    Pause,
    Cancel,
}

pub type Controls = Arc<Mutex<HashMap<String, watch::Sender<ControlAction>>>>;

#[derive(Clone)]
pub struct Scheduler {
    database: Database,
    controls: Controls,
    semaphore: Arc<Semaphore>,
    lock: Arc<Mutex<()>>,
}

impl Scheduler {
    pub fn new(database: Database) -> Self {
        Self {
            database,
            controls: Arc::new(Mutex::new(HashMap::new())),
            semaphore: Arc::new(Semaphore::new(2)),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn database(&self) -> &Database { &self.database }

    pub fn kick(&self, app: AppHandle) {
        let scheduler = self.clone();
        tauri::async_runtime::spawn(async move { scheduler.schedule(app).await; });
    }

    pub async fn schedule(&self, app: AppHandle) {
        let _guard = self.lock.lock().await;
        loop {
            let Ok(permit) = self.semaphore.clone().try_acquire_owned() else { break; };
            let task = match self.database.claim_next_queued() {
                Ok(Some(task)) => task,
                Ok(None) => { drop(permit); break; }
                Err(error) => {
                    eprintln!("failed to claim task: {error}");
                    drop(permit);
                    break;
                }
            };
            emit_task(&app, &task);
            let scheduler = self.clone();
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _permit = permit;
                scheduler.run_task(app_handle.clone(), task).await;
                scheduler.kick(app_handle);
            });
        }
    }

    async fn run_task(&self, app: AppHandle, mut task: DownloadTask) {
        let (control_tx, mut control_rx) = watch::channel(ControlAction::Run);
        self.controls.lock().await.insert(task.id.clone(), control_tx);

        let proxy_url = match self.database.setting("proxy_url") {
            Ok(value) => value.filter(|proxy| !proxy.trim().is_empty()),
            Err(error) => {
                self.fail(&app, &mut task, format!("无法读取代理设置：{error}"));
                self.controls.lock().await.remove(&task.id);
                return;
            }
        };
        let args = download_arguments(&task, &ffmpeg_location(), proxy_url.as_deref());
        let command = match app.shell().sidecar("yt-dlp") {
            Ok(command) => command.args(args),
            Err(error) => {
                self.fail(&app, &mut task, format!("无法启动 yt-dlp：{error}"));
                self.controls.lock().await.remove(&task.id);
                return;
            }
        };

        let (mut events, child) = match command.spawn() {
            Ok(value) => value,
            Err(error) => {
                self.fail(&app, &mut task, format!("无法启动下载进程：{error}"));
                self.controls.lock().await.remove(&task.id);
                return;
            }
        };
        let mut child = Some(child);

        task.status = TaskStatus::Downloading;
        task.progress.stage = "正在下载".into();
        task.updated_at = Utc::now().to_rfc3339();
        let _ = self.persist_emit(&app, &task);

        let mut finished = false;
        while !finished {
            tokio::select! {
                changed = control_rx.changed() => {
                    if changed.is_err() { continue; }
                    match *control_rx.borrow() {
                        ControlAction::Run => {}
                        ControlAction::Pause => {
                            terminate_process_tree(&mut child);
                            task.status = TaskStatus::Paused;
                            task.progress.stage = "已暂停，可断点继续".into();
                            task.updated_at = Utc::now().to_rfc3339();
                            let _ = self.persist_emit(&app, &task);
                            finished = true;
                        }
                        ControlAction::Cancel => {
                            terminate_process_tree(&mut child);
                            task.status = TaskStatus::Canceled;
                            task.progress.stage = "已取消".into();
                            task.updated_at = Utc::now().to_rfc3339();
                            let _ = self.persist_emit(&app, &task);
                            finished = true;
                        }
                    }
                }
                event = events.recv() => {
                    let Some(event) = event else {
                        if !finished { self.fail(&app, &mut task, "下载进程意外结束".into()); }
                        break;
                    };
                    match event {
                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                            let text = String::from_utf8_lossy(&bytes);
                            for line in text.lines() {
                                match parse_output_line(line) {
                                    ParsedLine::Progress(progress) => {
                                        task.status = TaskStatus::Downloading;
                                        task.progress = progress;
                                        task.updated_at = Utc::now().to_rfc3339();
                                        let _ = self.persist_emit(&app, &task);
                                    }
                                    ParsedLine::Processing(stage) => {
                                        task.status = TaskStatus::Processing;
                                        task.progress.percent = 100.0;
                                        task.progress.stage = stage;
                                        task.updated_at = Utc::now().to_rfc3339();
                                        let _ = self.persist_emit(&app, &task);
                                    }
                                    ParsedLine::File(path) => {
                                        task.output_path = Some(path);
                                    }
                                    ParsedLine::Ignore => {}
                                }
                            }
                        }
                        CommandEvent::Terminated(payload) => {
                            if payload.code == Some(0) {
                                task.status = TaskStatus::Completed;
                                task.progress.percent = 100.0;
                                task.progress.stage = "下载完成".into();
                                task.error = None;
                                task.updated_at = Utc::now().to_rfc3339();
                                let _ = self.persist_emit(&app, &task);
                            } else {
                                self.fail(&app, &mut task, format!("下载进程退出，代码：{}", payload.code.map(|code| code.to_string()).unwrap_or_else(|| "未知".into())));
                            }
                            finished = true;
                        }
                        _ => {}
                    }
                }
            }
        }
        self.controls.lock().await.remove(&task.id);
    }

    pub async fn control(&self, app: &AppHandle, task_id: &str, action: ControlAction) -> AppResult<()> {
        let mut task = self.database.task(task_id)?;
        match action {
            ControlAction::Pause => {
                if let Some(sender) = self.controls.lock().await.get(task_id) {
                    sender.send(ControlAction::Pause).map_err(|_| AppError::Runtime("任务已经停止".into()))?;
                } else if task.status == TaskStatus::Queued {
                    task.status = TaskStatus::Paused;
                    task.progress.stage = "已暂停".into();
                    task.updated_at = Utc::now().to_rfc3339();
                    self.persist_emit(app, &task)?;
                } else {
                    return Err(AppError::Validation("当前任务不能暂停".into()));
                }
            }
            ControlAction::Cancel => {
                if let Some(sender) = self.controls.lock().await.get(task_id) {
                    sender.send(ControlAction::Cancel).map_err(|_| AppError::Runtime("任务已经停止".into()))?;
                } else if matches!(task.status, TaskStatus::Queued | TaskStatus::Paused) {
                    task.status = TaskStatus::Canceled;
                    task.progress.stage = "已取消".into();
                    task.updated_at = Utc::now().to_rfc3339();
                    self.persist_emit(app, &task)?;
                } else {
                    return Err(AppError::Validation("当前任务不能取消".into()));
                }
            }
            ControlAction::Run => return Err(AppError::Validation("无效控制操作".into())),
        }
        Ok(())
    }

    pub fn requeue(&self, app: &AppHandle, task_id: &str, allowed: &[TaskStatus]) -> AppResult<()> {
        let mut task = self.database.task(task_id)?;
        if !allowed.contains(&task.status) {
            return Err(AppError::Validation("当前任务不能继续或重试".into()));
        }
        task.status = TaskStatus::Queued;
        task.error = None;
        task.progress.stage = "等待开始".into();
        task.updated_at = Utc::now().to_rfc3339();
        self.persist_emit(app, &task)
    }

    fn fail(&self, app: &AppHandle, task: &mut DownloadTask, message: String) {
        task.status = TaskStatus::Failed;
        task.error = Some(message);
        task.progress.stage = "下载失败".into();
        task.updated_at = Utc::now().to_rfc3339();
        let _ = self.persist_emit(app, task);
    }

    fn persist_emit(&self, app: &AppHandle, task: &DownloadTask) -> AppResult<()> {
        self.database.save_task(task)?;
        emit_task(app, task);
        Ok(())
    }
}

pub fn emit_task(app: &AppHandle, task: &DownloadTask) {
    let _ = app.emit("download-task-updated", task);
}

pub fn download_arguments(task: &DownloadTask, ffmpeg: &PathBuf, proxy_url: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "--newline".into(),
        "--continue".into(),
        "--no-overwrites".into(),
        "--no-playlist".into(),
        "--progress-template".into(),
        "__STREAMNEST_PROGRESS__%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s".into(),
        "--print".into(),
        "after_move:__STREAMNEST_FILE__%(filepath)s".into(),
        "--paths".into(),
        task.output_directory.clone(),
        "--output".into(),
        "%(title).180B [%(id)s].%(ext)s".into(),
        "--ffmpeg-location".into(),
        ffmpeg.to_string_lossy().to_string(),
    ];

    match task.preset {
        DownloadPreset::Video360 => add_video_preset(&mut args, 360),
        DownloadPreset::Video720 => add_video_preset(&mut args, 720),
        DownloadPreset::Video1080 => add_video_preset(&mut args, 1080),
        DownloadPreset::VideoBest => {
            args.extend(["--format".into(), "bestvideo+bestaudio/best".into(), "--merge-output-format".into(), "mkv".into()]);
        }
        DownloadPreset::AudioM4a => {
            args.extend(["--format".into(), "bestaudio[ext=m4a]/bestaudio".into(), "--extract-audio".into(), "--audio-format".into(), "m4a".into()]);
        }
        DownloadPreset::AudioMp3 => {
            args.extend(["--format".into(), "bestaudio".into(), "--extract-audio".into(), "--audio-format".into(), "mp3".into(), "--audio-quality".into(), "192K".into()]);
        }
    }
    if let Some(proxy_url) = proxy_url.filter(|value| !value.trim().is_empty()) {
        args.extend(["--proxy".into(), proxy_url.into()]);
    }
    args.push(task.webpage_url.clone());
    args
}

fn add_video_preset(args: &mut Vec<String>, height: u16) {
    args.extend([
        "--format".into(),
        format!("bestvideo[height<={height}][vcodec^=avc1]+bestaudio[ext=m4a]/best[height<={height}][ext=mp4]/best[height<={height}]"),
        "--merge-output-format".into(),
        "mp4".into(),
    ]);
}

fn ffmpeg_location() -> PathBuf {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("ffmpeg-{}{extension}", env!("TARGET_TRIPLE")))
    } else {
        std::env::current_exe().ok().and_then(|path| path.parent().map(PathBuf::from)).unwrap_or_default().join(format!("ffmpeg{extension}"))
    }
}

fn terminate_process_tree(child: &mut Option<CommandChild>) {
    let Some(pid) = child.as_ref().map(CommandChild::pid) else { return; };
    #[cfg(target_os = "windows")]
    {
        // yt-dlp can own an FFmpeg child. `/T` ensures pause/cancel does not leave it running.
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(target_os = "macos")]
    {
        // Kill direct descendants first; FFmpeg is spawned directly by yt-dlp.
        let _ = std::process::Command::new("pkill").args(["-TERM", "-P", &pid.to_string()]).status();
    }
    if let Some(child) = child.take() { let _ = child.kill(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TaskProgress;

    fn task(preset: DownloadPreset) -> DownloadTask {
        DownloadTask {
            id: "1".into(), video_id: "M7lc1UVf-VE".into(), title: "test".into(), channel: "test".into(),
            thumbnail_url: String::new(), webpage_url: "https://www.youtube.com/watch?v=M7lc1UVf-VE".into(), preset,
            output_directory: "/tmp/downloads".into(), output_path: None, status: TaskStatus::Queued,
            progress: TaskProgress::default(), error: None, created_at: String::new(), updated_at: String::new(),
        }
    }

    #[test]
    fn video_preset_limits_height_and_mp4() {
        let args = download_arguments(&task(DownloadPreset::Video1080), &PathBuf::from("ffmpeg"), None);
        assert!(args.iter().any(|arg| arg.contains("height<=1080")));
        assert!(args.windows(2).any(|pair| pair == ["--merge-output-format", "mp4"]));
    }

    #[test]
    fn frontend_cannot_supply_arbitrary_arguments() {
        let args = download_arguments(&task(DownloadPreset::AudioMp3), &PathBuf::from("ffmpeg"), None);
        assert!(args.windows(2).any(|pair| pair == ["--audio-format", "mp3"]));
        assert_eq!(args.last().unwrap(), "https://www.youtube.com/watch?v=M7lc1UVf-VE");
    }

    #[test]
    fn applies_configured_proxy_before_the_video_url() {
        let args = download_arguments(
            &task(DownloadPreset::Video720),
            &PathBuf::from("ffmpeg"),
            Some("socks5://127.0.0.1:1080"),
        );
        assert!(args.windows(2).any(|pair| pair == ["--proxy", "socks5://127.0.0.1:1080"]));
        assert_eq!(args.last().unwrap(), "https://www.youtube.com/watch?v=M7lc1UVf-VE");
    }
}
