import type { DownloadPreset, TaskStatus } from "../types";

export const presetLabels: Record<DownloadPreset, string> = {
  video360: "MP4 · 360p",
  video720: "MP4 · 720p",
  video1080: "MP4 · 1080p",
  videoBest: "最佳画质",
  audioM4a: "M4A · 高质量",
  audioMp3: "MP3 · 192 kbps",
};

export const statusLabels: Record<TaskStatus, string> = {
  queued: "等待中",
  resolving: "正在解析",
  downloading: "正在下载",
  processing: "正在处理",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
};

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "时长未知";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatEta(seconds: number | null): string {
  if (seconds == null || seconds < 0) return "计算中";
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}
