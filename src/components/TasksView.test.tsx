import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteTask, openOutputPath } from "../lib/api";
import type { DownloadTask } from "../types";
import { TasksView } from "./TasksView";

vi.mock("../lib/api", () => ({
  clearCompletedTasks: vi.fn().mockResolvedValue(undefined),
  mediaSource: vi.fn((path: string) => path),
  openOutputPath: vi.fn().mockResolvedValue(undefined),
  taskAction: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
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
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  });

  it("deletes a completed task record without deleting its file", async () => {
    const onChanged = vi.fn();
    render(<TasksView tasks={[completedTask]} onChanged={onChanged} onError={vi.fn()} />);

    const deleteButton = screen.getByRole("button", { name: `删除任务 ${completedTask.title}` });
    fireEvent.click(deleteButton);
    expect(screen.getByRole("checkbox", { name: /同时删除已下载文件/ })).not.toBeChecked();
    expect(deleteTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "仅删除记录" }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("task-1", false));
    expect(onChanged).toHaveBeenCalled();
  });

  it("deletes the file only after the user opts in", async () => {
    render(<TasksView tasks={[completedTask]} onChanged={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: `删除任务 ${completedTask.title}` }));
    fireEvent.click(screen.getByRole("checkbox", { name: /同时删除已下载文件/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除任务和文件" }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("task-1", true));
  });

  it("cancels without deleting anything", () => {
    render(<TasksView tasks={[completedTask]} onChanged={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: `删除任务 ${completedTask.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(deleteTask).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and displays a file deletion error", async () => {
    vi.mocked(deleteTask).mockRejectedValueOnce(new Error("文件正在使用中"));
    const onChanged = vi.fn();
    render(<TasksView tasks={[completedTask]} onChanged={onChanged} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: `删除任务 ${completedTask.title}` }));
    fireEvent.click(screen.getByRole("checkbox", { name: /同时删除已下载文件/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除任务和文件" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("文件正在使用中");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("updates intermediate progress as task events arrive", () => {
    const downloading = { ...completedTask, status: "downloading" as const, progress: { ...completedTask.progress, percent: 24.5, downloadedBytes: 245, totalBytes: 1000, speedBytesPerSecond: 100, etaSeconds: 8, stage: "正在下载" } };
    const { rerender } = render(<TasksView tasks={[downloading]} onChanged={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "24.5");
    rerender(<TasksView tasks={[{ ...downloading, progress: { ...downloading.progress, percent: 67.2 } }]} onChanged={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67.2");
  });

  it("plays completed audio inside the app", () => {
    const audioTask = { ...completedTask, preset: "audioMp3" as const, outputPath: "C:/Downloads/song.mp3" };
    render(<TasksView tasks={[audioTask]} onChanged={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: `播放 ${audioTask.title}` }));
    expect(screen.getByRole("dialog", { name: audioTask.title })).toBeInTheDocument();
    expect(document.querySelector("audio")).toHaveAttribute("src", audioTask.outputPath);
    expect(openOutputPath).not.toHaveBeenCalled();
  });

  it.each(["resolving", "processing", "downloading"] as const)("shows an indeterminate indicator for %s without a known total", (status) => {
    render(<TasksView tasks={[{ ...completedTask, status, progress: { ...completedTask.progress, percent: 0 } }]} onChanged={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("请稍候")).toBeInTheDocument();
  });
});
