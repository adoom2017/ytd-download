use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSummary {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub duration_seconds: Option<f64>,
    pub thumbnail_url: String,
    pub webpage_url: String,
    pub live_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDetails {
    #[serde(flatten)]
    pub summary: VideoSummary,
    pub description: String,
    pub upload_date: Option<String>,
    pub view_count: Option<u64>,
    pub is_embeddable: Option<bool>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadPreset {
    Video360,
    Video720,
    Video1080,
    VideoBest,
    AudioM4a,
    AudioMp3,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Queued,
    Resolving,
    Downloading,
    Processing,
    Paused,
    Completed,
    Failed,
    Canceled,
}

impl TaskStatus {
    pub fn as_db(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Resolving => "resolving",
            Self::Downloading => "downloading",
            Self::Processing => "processing",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub video: VideoSummary,
    pub preset: DownloadPreset,
    pub output_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub percent: f64,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub stage: String,
}

impl Default for TaskProgress {
    fn default() -> Self {
        Self {
            percent: 0.0,
            downloaded_bytes: None,
            total_bytes: None,
            speed_bytes_per_second: None,
            eta_seconds: None,
            stage: "等待开始".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub video_id: String,
    pub title: String,
    pub channel: String,
    pub thumbnail_url: String,
    pub webpage_url: String,
    pub preset: DownloadPreset,
    pub output_directory: String,
    pub output_path: Option<String>,
    pub status: TaskStatus,
    pub progress: TaskProgress,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub output_directory: String,
    pub proxy_url: String,
    pub theme: String,
    pub rights_acknowledged: bool,
    pub yt_dlp_version: String,
    pub ffmpeg_version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub output_directory: Option<String>,
    pub proxy_url: Option<String>,
    pub theme: Option<String>,
    pub rights_acknowledged: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct YtSearchEnvelope {
    #[serde(default)]
    pub entries: Vec<YtVideo>,
}

#[derive(Debug, Deserialize)]
pub struct YtVideo {
    pub id: Option<String>,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub webpage_url: Option<String>,
    pub original_url: Option<String>,
    pub live_status: Option<String>,
    pub description: Option<String>,
    pub upload_date: Option<String>,
    pub view_count: Option<u64>,
    pub playable_in_embed: Option<bool>,
}

impl YtVideo {
    pub fn into_summary(self) -> Option<VideoSummary> {
        let id = self.id?;
        Some(VideoSummary {
            webpage_url: self.webpage_url.or(self.original_url).unwrap_or_else(|| format!("https://www.youtube.com/watch?v={id}")),
            thumbnail_url: self.thumbnail.unwrap_or_else(|| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")),
            title: self.title.unwrap_or_else(|| "无标题视频".into()),
            channel: self.channel.or(self.uploader).unwrap_or_else(|| "未知频道".into()),
            duration_seconds: self.duration,
            live_status: self.live_status,
            id,
        })
    }
}
