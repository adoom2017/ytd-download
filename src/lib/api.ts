import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppSettings, DownloadRequest, DownloadTask, VideoDetails, VideoSummary } from "../types";

const inTauri = () => "__TAURI_INTERNALS__" in window;

export function mediaSource(path: string): string {
  return inTauri() ? convertFileSrc(path) : path;
}
let demoSettings: AppSettings = {
  outputDirectory: "~/Downloads/YouTube Downloads",
  proxyUrl: "",
  theme: "system",
  rightsAcknowledged: false,
  ytDlpVersion: "浏览器预览",
  ffmpegVersion: "浏览器预览",
};

export async function searchVideos(query: string, music = false): Promise<VideoSummary[]> {
  if (!inTauri()) return demoSearch(query, music);
  return invoke("search_videos", { query, music });
}

export async function getVideoDetails(videoId: string, music = false): Promise<VideoDetails> {
  if (!inTauri()) {
    const video = (await demoSearch(videoId, music))[0];
    return { ...video, description: "浏览器预览模式使用示例数据。桌面应用中会显示真实视频详情。" };
  }
  return invoke("get_video_details", { videoId, music });
}

export async function enqueueDownloads(requests: DownloadRequest[]): Promise<DownloadTask[]> {
  return invoke("enqueue_downloads", { requests });
}

export async function listTasks(): Promise<DownloadTask[]> {
  if (!inTauri()) return [];
  return invoke("list_tasks");
}

export async function taskAction(action: "pause" | "resume" | "cancel" | "retry" | "delete", taskId: string): Promise<void> {
  return invoke(`${action}_task`, { taskId });
}

export async function deleteTask(taskId: string, deleteFile = false): Promise<void> {
  return invoke("delete_task", { taskId, deleteFile });
}

export async function openOutputPath(taskId: string, reveal: boolean): Promise<void> {
  return invoke("open_output_path", { taskId, reveal });
}

export async function clearCompletedTasks(): Promise<void> {
  return invoke("clear_completed_tasks");
}

export async function getSettings(): Promise<AppSettings> {
  if (!inTauri()) return { ...demoSettings };
  return invoke("get_settings");
}

export async function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  if (!inTauri()) {
    demoSettings = { ...demoSettings, ...settings };
    return { ...demoSettings };
  }
  return invoke("update_settings", { patch: settings });
}

export async function chooseDownloadDirectory(): Promise<string | null> {
  if (!inTauri()) return null;
  return invoke("choose_download_directory");
}

export async function openDownloadDirectory(): Promise<void> {
  if (!inTauri()) return;
  return invoke("open_download_directory");
}

export function onTaskUpdated(callback: (task: DownloadTask) => void): Promise<UnlistenFn> {
  if (!inTauri()) return Promise.resolve(() => undefined);
  return listen<DownloadTask>("download-task-updated", (event) => callback(event.payload));
}

async function demoSearch(query: string, music = false): Promise<VideoSummary[]> {
  await new Promise((resolve) => setTimeout(resolve, 420));
  if (!query.trim()) return [];
  return [
    {
      id: "M7lc1UVf-VE",
      title: `${query} · 桌面预览示例`,
      channel: "YouTube Developers",
      durationSeconds: 94,
      thumbnailUrl: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg",
      webpageUrl: `https://${music ? "music." : "www."}youtube.com/watch?v=M7lc1UVf-VE`,
    },
    {
      id: "aqz-KE-bpKQ",
      title: `${query} · Creative Commons 示例视频`,
      channel: "Blender Foundation",
      durationSeconds: 634,
      thumbnailUrl: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
      webpageUrl: `https://${music ? "music." : "www."}youtube.com/watch?v=aqz-KE-bpKQ`,
    },
  ];
}
