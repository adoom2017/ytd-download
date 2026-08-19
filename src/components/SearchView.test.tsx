import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PresetSelect, SearchView } from "./SearchView";

const settings = {
  outputDirectory: "C:/Downloads",
  proxyUrl: "",
  theme: "system" as const,
  rightsAcknowledged: true,
  ytDlpVersion: "test",
  ffmpegVersion: "test",
};

describe("SearchView", () => {
  it("loads browser-preview search results on explicit submit", async () => {
    render(<SearchView settings={settings} onQueued={vi.fn()} onNeedRights={vi.fn()} onError={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("输入视频关键词"), { target: { value: "开源动画" } });
    fireEvent.click(screen.getByRole("button", { name: "开始搜索" }));
    const loadingButton = screen.getByRole("button", { name: "正在搜索" });
    expect(loadingButton).toHaveAttribute("aria-busy", "true");
    expect(loadingButton.querySelector(".search-spinner")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("2 个结果")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /预览/ })).not.toHaveLength(0);
  });

  it("shows the useful initial empty state", () => {
    render(<SearchView settings={settings} onQueued={vi.fn()} onNeedRights={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText("搜索你想保存的视频")).toBeInTheDocument();
    expect(screen.getByText("下载前预览")).toBeInTheDocument();
  });

  it("switches to a dedicated music download mode", () => {
    render(<SearchView settings={settings} onQueued={vi.fn()} onNeedRights={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "音乐" }));

    expect(screen.getByRole("heading", { name: "找到想收藏的音乐" })).toBeInTheDocument();
    expect(screen.getByLabelText("输入歌曲、歌手或音乐关键词")).toBeInTheDocument();
    expect(screen.getByText("仅保存音轨，支持 MP3 与 M4A")).toBeInTheDocument();
  });

  it("shows only music formats for an audio preset", () => {
    render(<PresetSelect value="audioMp3" onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "MP3 · 192 kbps" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "MP4 · 1080p" })).not.toBeInTheDocument();
  });
});
