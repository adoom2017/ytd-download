import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { taskAction } from "../lib/api";
import type { DownloadTask } from "../types";
import { TasksView } from "./TasksView";

vi.mock("../lib/api", () => ({
  clearCompletedTasks: vi.fn().mockResolvedValue(undefined),
  openOutputPath: vi.fn().mockResolvedValue(undefined),
  taskAction: vi.fn().mockResolvedValue(undefined),
}));

const completedTask: DownloadTask = {
  id: "task-1",
  videoId: "M7lc1UVf-VE",
  title: "带 空格的中文视频",
  channel: "测试频道",
  thumbnailUrl: "https://example.test/thumb.jpg",
  webpageUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
  preset: "video1080",
  outputDirectory: "C:/Users/test/YouTube Downloads",
  outputPath: "C:/Users/test/YouTube Downloads/带 空格的中文视频 [M7lc1UVf-VE].mp4",
  status: "completed",
  progress: {
    percent: 100,
    downloadedBytes: null,
    totalBytes: null,
    speedBytesPerSecond: null,
    etaSeconds: null,
    stage: "下载完成",
  },
  error: null,
  createdAt: "2026-08-21T00:00:00Z",
  updatedAt: "2026-08-21T00:00:00Z",
};

describe("TasksView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a completed task record without deleting its file", async () => {
    const onChanged = vi.fn();
    render(<TasksView tasks={[completedTask]} onChanged={onChanged} onError={vi.fn()} />);

    const deleteButton = screen.getByRole("button", { name: `删除任务记录 ${completedTask.title}` });
    expect(deleteButton).toHaveAttribute("title", "仅删除任务记录，不删除已下载文件");
    fireEvent.click(deleteButton);

    await waitFor(() => expect(taskAction).toHaveBeenCalledWith("delete", "task-1"));
    expect(onChanged).toHaveBeenCalled();
  });
});
