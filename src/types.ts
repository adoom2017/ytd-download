export type AppView = "search" | "tasks" | "settings";
export type ThemeMode = "system" | "light" | "dark";
export type DownloadPreset = "video360" | "video720" | "video1080" | "videoBest" | "audioM4a" | "audioMp3";

export type TaskStatus =
  | "queued"
  | "resolving"
  | "downloading"
  | "processing"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export interface VideoSummary {
  id: string;
  title: string;
  channel: string;
  durationSeconds: number | null;
  thumbnailUrl: string;
  webpageUrl: string;
  liveStatus?: string | null;
}

export interface VideoDetails extends VideoSummary {
  description: string;
  uploadDate?: string | null;
  viewCount?: number | null;
  isEmbeddable?: boolean | null;
}

export interface DownloadRequest {
  video: VideoSummary;
  preset: DownloadPreset;
  outputDirectory?: string | null;
}

export interface TaskProgress {
  percent: number;
  downloadedBytes: number | null;
  totalBytes: number | null;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
  stage: string;
}

export interface DownloadTask {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  webpageUrl: string;
  preset: DownloadPreset;
  outputDirectory: string;
  outputPath: string | null;
  status: TaskStatus;
  progress: TaskProgress;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  outputDirectory: string;
  proxyUrl: string;
  theme: ThemeMode;
  rightsAcknowledged: boolean;
  ytDlpVersion: string;
  ffmpegVersion: string;
}
