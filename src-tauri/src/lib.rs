mod db;
mod downloader;
mod models;
mod output;
mod progress;

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use chrono::Utc;
use downloader::{ControlAction, Scheduler};
use models::{
    AppSettings, DownloadRequest, DownloadTask, SettingsPatch, TaskProgress, TaskStatus,
    VideoDetails, VideoSummary, YtSearchEnvelope, YtVideo,
};
use regex::Regex;
use serde::Serialize;
use tauri::{Manager, State};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Runtime(String),
    #[error("数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("数据格式错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("文件系统错误：{0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[tauri::command]
async fn search_videos(
    app: tauri::AppHandle,
    state: State<'_, Scheduler>,
    query: String,
) -> AppResult<Vec<VideoSummary>> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 200 {
        return Err(AppError::Validation(
            "请输入 1–200 个字符的搜索关键词".into(),
        ));
    }
    let mut args = vec![
        "--flat-playlist".to_string(),
        "--dump-single-json".to_string(),
        "--skip-download".to_string(),
        "--no-warnings".to_string(),
    ];
    append_proxy_args(&mut args, configured_proxy(state.database())?);
    args.push(format!("ytsearch30:{query}"));
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|error| AppError::Runtime(format!("无法加载 yt-dlp：{error}")))?
        .args(args)
        .output()
        .await
        .map_err(|error| AppError::Runtime(format!("搜索进程启动失败：{error}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Runtime(user_facing_tool_error(&stderr)));
    }
    let envelope: YtSearchEnvelope = serde_json::from_str(stdout.trim())?;
    Ok(envelope
        .entries
        .into_iter()
        .filter_map(YtVideo::into_summary)
        .take(30)
        .collect())
}

#[tauri::command]
async fn get_video_details(
    app: tauri::AppHandle,
    state: State<'_, Scheduler>,
    video_id: String,
) -> AppResult<VideoDetails> {
    validate_video_id(&video_id)?;
    let url = format!("https://www.youtube.com/watch?v={video_id}");
    let mut args = vec![
        "--dump-single-json".to_string(),
        "--skip-download".to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
    ];
    append_proxy_args(&mut args, configured_proxy(state.database())?);
    args.push(url);
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|error| AppError::Runtime(format!("无法加载 yt-dlp：{error}")))?
        .args(args)
        .output()
        .await
        .map_err(|error| AppError::Runtime(format!("视频详情加载失败：{error}")))?;
    let raw: YtVideo = serde_json::from_slice(&output.stdout).map_err(|_| {
        AppError::Runtime(user_facing_tool_error(&String::from_utf8_lossy(
            &output.stderr,
        )))
    })?;
    let description = raw.description.clone().unwrap_or_default();
    let upload_date = raw.upload_date.clone();
    let view_count = raw.view_count;
    let is_embeddable = raw.playable_in_embed;
    let summary = raw
        .into_summary()
        .ok_or_else(|| AppError::Runtime("无法识别该视频".into()))?;
    Ok(VideoDetails {
        summary,
        description,
        upload_date,
        view_count,
        is_embeddable,
    })
}

#[tauri::command]
async fn enqueue_downloads(
    app: tauri::AppHandle,
    state: State<'_, Scheduler>,
    requests: Vec<DownloadRequest>,
) -> AppResult<Vec<DownloadTask>> {
    if requests.is_empty() || requests.len() > 30 {
        return Err(AppError::Validation("一次可加入 1–30 个任务".into()));
    }
    if state.database().setting("rights_acknowledged")?.as_deref() != Some("1") {
        return Err(AppError::Validation("请先确认你有权下载所选内容".into()));
    }
    let default_output = output_directory(state.database())?;
    let now = Utc::now().to_rfc3339();
    let mut created = Vec::with_capacity(requests.len());
    for request in requests {
        validate_video_id(&request.video.id)?;
        if matches!(
            request.video.live_status.as_deref(),
            Some("is_live" | "is_upcoming")
        ) {
            return Err(AppError::Validation(format!(
                "“{}”是直播或预约内容，首版暂不支持下载",
                request.video.title
            )));
        }
        let directory = request
            .output_directory
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(&default_output));
        if !directory.is_absolute() {
            return Err(AppError::Validation("下载目录必须是绝对路径".into()));
        }
        fs::create_dir_all(&directory)?;
        let task = DownloadTask {
            id: Uuid::new_v4().to_string(),
            video_id: request.video.id,
            title: request.video.title,
            channel: request.video.channel,
            thumbnail_url: request.video.thumbnail_url,
            webpage_url: request.video.webpage_url,
            preset: request.preset,
            output_directory: directory.to_string_lossy().to_string(),
            output_path: None,
            status: TaskStatus::Queued,
            progress: TaskProgress::default(),
            error: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        state.database().insert_task(&task)?;
        downloader::emit_task(&app, &task);
        created.push(task);
    }
    state.kick(app);
    Ok(created)
}

#[tauri::command]
fn list_tasks(state: State<'_, Scheduler>) -> AppResult<Vec<DownloadTask>> {
    state.database().list_tasks()
}

#[tauri::command]
async fn pause_task(
    app: tauri::AppHandle,
    state: State<'_, Scheduler>,
    task_id: String,
) -> AppResult<()> {
    state.control(&app, &task_id, ControlAction::Pause).await
}

#[tauri::command]
async fn cancel_task(
    app: tauri::AppHandle,
    state: State<'_, Scheduler>,
    task_id: String,
) -> AppResult<()> {
    state.control(&app, &task_id, ControlAction::Cancel).await
}

#[tauri::command]
fn resume_task(
    app: tauri::AppHandle,
    state: State<'_, Scheduler>,
    task_id: String,
) -> AppResult<()> {
    state.requeue(&app, &task_id, &[TaskStatus::Paused])?;
    state.kick(app);
    Ok(())
}

#[tauri::command]
fn retry_task(
    app: tauri::AppHandle,
    state: State<'_, Scheduler>,
    task_id: String,
) -> AppResult<()> {
    state.requeue(&app, &task_id, &[TaskStatus::Failed, TaskStatus::Canceled])?;
    state.kick(app);
    Ok(())
}

#[tauri::command]
fn clear_completed_tasks(state: State<'_, Scheduler>) -> AppResult<()> {
    state.database().delete_completed()
}

#[tauri::command]
fn delete_task(state: State<'_, Scheduler>, task_id: String) -> AppResult<()> {
    state.database().delete_task(&task_id)
}

#[tauri::command]
async fn choose_download_directory(state: State<'_, Scheduler>) -> AppResult<Option<String>> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择下载文件夹")
            .pick_folder()
    })
    .await
    .map_err(|error| AppError::Runtime(format!("文件夹选择器失败：{error}")))?;
    if let Some(path) = picked {
        let value = path.to_string_lossy().to_string();
        state.database().set_setting("output_directory", &value)?;
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn open_download_directory(state: State<'_, Scheduler>) -> AppResult<()> {
    let directory = PathBuf::from(output_directory(state.database())?);
    if !directory.is_absolute() {
        return Err(AppError::Validation("下载目录必须是绝对路径".into()));
    }
    fs::create_dir_all(&directory)?;
    open_path(&directory, false)
}

#[tauri::command]
fn open_output_path(state: State<'_, Scheduler>, task_id: String, reveal: bool) -> AppResult<()> {
    let task = state.database().task(&task_id)?;
    let output = task.output_path.as_ref().map(PathBuf::from);
    let target = output
        .clone()
        .unwrap_or_else(|| PathBuf::from(&task.output_directory));
    if !target.exists() {
        return Err(AppError::Validation("下载文件或目录不存在".into()));
    }
    open_path(&target, reveal && output.is_some())
}

#[tauri::command]
async fn get_settings(
    app: tauri::AppHandle,
    state: State<'_, Scheduler>,
) -> AppResult<AppSettings> {
    load_settings(&app, state.database()).await
}

#[tauri::command]
async fn update_settings(
    app: tauri::AppHandle,
    state: State<'_, Scheduler>,
    patch: SettingsPatch,
) -> AppResult<AppSettings> {
    if let Some(directory) = patch.output_directory {
        let path = PathBuf::from(&directory);
        if !path.is_absolute() {
            return Err(AppError::Validation("下载目录必须是绝对路径".into()));
        }
        fs::create_dir_all(&path)?;
        state
            .database()
            .set_setting("output_directory", &directory)?;
    }
    if let Some(proxy_url) = patch.proxy_url {
        let normalized = normalize_proxy_url(&proxy_url)?;
        state.database().set_setting("proxy_url", &normalized)?;
    }
    if let Some(theme) = patch.theme {
        if !matches!(theme.as_str(), "system" | "light" | "dark") {
            return Err(AppError::Validation("无效主题".into()));
        }
        state.database().set_setting("theme", &theme)?;
    }
    if let Some(acknowledged) = patch.rights_acknowledged {
        state
            .database()
            .set_setting("rights_acknowledged", if acknowledged { "1" } else { "0" })?;
    }
    load_settings(&app, state.database()).await
}

async fn load_settings(app: &tauri::AppHandle, database: &db::Database) -> AppResult<AppSettings> {
    Ok(AppSettings {
        output_directory: output_directory(database)?,
        proxy_url: configured_proxy(database)?.unwrap_or_default(),
        theme: database
            .setting("theme")?
            .unwrap_or_else(|| "system".into()),
        rights_acknowledged: database.setting("rights_acknowledged")?.as_deref() == Some("1"),
        yt_dlp_version: tool_version(app, "yt-dlp", &["--version"]).await,
        ffmpeg_version: tool_version(app, "ffmpeg", &["-version"]).await,
    })
}

async fn tool_version(app: &tauri::AppHandle, name: &str, args: &[&str]) -> String {
    let Ok(command) = app.shell().sidecar(name) else {
        return "未安装".into();
    };
    let Ok(output) = command.args(args).output().await else {
        return "不可用".into();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("未知版本")
        .trim()
        .to_string()
}

fn output_directory(database: &db::Database) -> AppResult<String> {
    if let Some(directory) = database.setting("output_directory")? {
        return Ok(directory);
    }
    let directory = dirs::download_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("YouTube Downloads");
    fs::create_dir_all(&directory)?;
    let value = directory.to_string_lossy().to_string();
    database.set_setting("output_directory", &value)?;
    Ok(value)
}

fn configured_proxy(database: &db::Database) -> AppResult<Option<String>> {
    Ok(database
        .setting("proxy_url")?
        .filter(|value| !value.trim().is_empty()))
}

fn append_proxy_args(args: &mut Vec<String>, proxy_url: Option<String>) {
    if let Some(proxy_url) = proxy_url {
        args.extend(["--proxy".into(), proxy_url]);
    }
}

fn normalize_proxy_url(value: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    if value.len() > 2048 {
        return Err(AppError::Validation("代理地址过长".into()));
    }
    let parsed = url::Url::parse(value).map_err(|_| {
        AppError::Validation("代理地址格式无效，例如：http://127.0.0.1:7890".into())
    })?;
    if !matches!(
        parsed.scheme(),
        "http" | "https" | "socks4" | "socks5" | "socks5h"
    ) {
        return Err(AppError::Validation(
            "代理仅支持 HTTP、HTTPS、SOCKS4、SOCKS5 或 SOCKS5H".into(),
        ));
    }
    if parsed.host_str().is_none() {
        return Err(AppError::Validation("代理地址缺少主机名或 IP 地址".into()));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::Validation(
            "暂不支持在代理地址中保存账号或密码".into(),
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() || !matches!(parsed.path(), "" | "/")
    {
        return Err(AppError::Validation(
            "代理地址不能包含路径、查询参数或片段".into(),
        ));
    }
    Ok(value.to_string())
}

fn validate_video_id(video_id: &str) -> AppResult<()> {
    let pattern = Regex::new(r"^[A-Za-z0-9_-]{11}$").expect("valid video id regex");
    if pattern.is_match(video_id) {
        Ok(())
    } else {
        Err(AppError::Validation("无效的 YouTube 视频 ID".into()))
    }
}

fn user_facing_tool_error(stderr: &str) -> String {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("network")
        || lower.contains("timed out")
        || lower.contains("unable to download")
    {
        "无法连接 YouTube，请检查网络后重试".into()
    } else if lower.contains("sign in") || lower.contains("age-restricted") {
        "该视频需要登录或存在年龄限制，Streamnest 不会绕过此限制".into()
    } else if lower.contains("private video") || lower.contains("video unavailable") {
        "该视频不可用、已设为私有或受地区限制".into()
    } else {
        stderr
            .lines()
            .find(|line| line.contains("ERROR:"))
            .unwrap_or("yt-dlp 未返回可用结果")
            .trim()
            .to_string()
    }
}

fn open_path(path: &Path, reveal: bool) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        let directory = if path.is_dir() {
            Some(path)
        } else if reveal {
            path.parent()
        } else {
            None
        };
        if let Some(directory) = directory {
            // Pass the directory as its own process argument. Command performs
            // the required quoting for spaces and non-ASCII text.
            Command::new("explorer.exe")
                .arg(directory)
                .spawn()
                .map_err(|error| AppError::Runtime(format!("系统无法打开下载目录：{error}")))?;
            return Ok(());
        }
        open::that(path)
            .map_err(|error| AppError::Runtime(format!("系统无法打开该文件：{error}")))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let status = if reveal {
            Command::new("open").arg("-R").arg(path).status()?
        } else {
            Command::new("open").arg(path).status()?
        };
        #[cfg(not(target_os = "macos"))]
        let status = Command::new("xdg-open")
            .arg(if path.is_dir() {
                path
            } else {
                path.parent().unwrap_or(path)
            })
            .status()?;
        if status.success() {
            Ok(())
        } else {
            Err(AppError::Runtime("系统无法打开该路径".into()))
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            let database =
                db::Database::open(&data_dir).map_err(Box::<dyn std::error::Error>::from)?;
            app.manage(Scheduler::new(database));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            search_videos,
            get_video_details,
            enqueue_downloads,
            list_tasks,
            pause_task,
            resume_task,
            cancel_task,
            retry_task,
            clear_completed_tasks,
            delete_task,
            choose_download_directory,
            open_download_directory,
            open_output_path,
            get_settings,
            update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Streamnest");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn resolves_the_parent_directory_for_a_revealed_file() {
        let path = Path::new(r"C:\Users\测试\YouTube Downloads\中文 视频.mp4");
        assert_eq!(
            path.parent(),
            Some(Path::new(r"C:\Users\测试\YouTube Downloads"))
        );
    }

    #[test]
    fn validates_only_youtube_video_id_shape() {
        assert!(validate_video_id("M7lc1UVf-VE").is_ok());
        assert!(validate_video_id("https://youtube.com/watch?v=x").is_err());
        assert!(validate_video_id("short").is_err());
    }

    #[test]
    fn translates_common_restriction_errors() {
        assert!(user_facing_tool_error("ERROR: Sign in to confirm your age").contains("登录"));
        assert!(user_facing_tool_error("ERROR: Private video").contains("不可用"));
    }

    #[test]
    fn validates_supported_proxy_urls_without_credentials() {
        for proxy in [
            "http://127.0.0.1:7890",
            "https://proxy.example.com:443",
            "socks4://localhost:1080",
            "socks5://127.0.0.1:1080",
            "socks5h://proxy.example.com:1080",
        ] {
            assert_eq!(normalize_proxy_url(proxy).unwrap(), proxy);
        }
        assert_eq!(normalize_proxy_url("  ").unwrap(), "");
        assert!(normalize_proxy_url("ftp://127.0.0.1:21").is_err());
        assert!(normalize_proxy_url("http://user:secret@127.0.0.1:7890").is_err());
        assert!(normalize_proxy_url("http://:7890").is_err());
    }
}
