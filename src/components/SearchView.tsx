import { useEffect, useRef, useState } from "react";
import { Check, Clapperboard, Download, ExternalLink, LoaderCircle, Music2, Play, Search, X } from "lucide-react";
import { copy } from "../i18n";
import { enqueueDownloads, getVideoDetails, searchVideos } from "../lib/api";
import { formatDuration, presetLabels } from "../lib/format";
import { useAppStore } from "../store";
import type { AppSettings, DownloadPreset, VideoDetails, VideoSummary } from "../types";

interface SearchViewProps {
  settings: AppSettings | null;
  onQueued: () => void;
  onNeedRights: () => void;
  onError: (message: string) => void;
}

export function SearchView({ settings, onQueued, onNeedRights, onError }: SearchViewProps) {
  const { searchSession, updateSearchSession } = useAppStore();
  const { query, results, selected, loading, error, hasSearched, preset } = searchSession;
  const [preview, setPreview] = useState<VideoDetails | VideoSummary | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const musicMode = preset === "audioM4a" || preset === "audioMp3";

  const setQuery = (value: string) => updateSearchSession({ query: value });
  const setPreset = (value: DownloadPreset) => updateSearchSession({ preset: value });
  const setSelected = (value: Set<string>) => updateSearchSession({ selected: value });

  function chooseMediaMode(mode: "video" | "music") {
    setPreset(mode === "music" ? "audioMp3" : "video1080");
  }

  async function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value || loading) return;
    updateSearchSession({ loading: true, error: null, hasSearched: true });
    setPreview(null);
    setSelected(new Set());
    try {
      // Let React commit and WebView paint the busy state before starting the
      // comparatively expensive desktop IPC/sidecar request.
      await waitForLoadingPaint();
      updateSearchSession({ results: await searchVideos(value) });
    } catch (reason) {
      updateSearchSession({
        results: [],
        error: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      updateSearchSession({ loading: false });
    }
  }

  function toggle(videoId: string) {
    updateSearchSession((current) => {
      const next = new Set(current.selected);
      next.has(videoId) ? next.delete(videoId) : next.add(videoId);
      return { selected: next };
    });
  }

  async function openPreview(video: VideoSummary) {
    setPreview(video);
    setDetailLoading(true);
    try {
      setPreview(await getVideoDetails(video.id));
    } catch {
      setPreview(video);
    } finally {
      setDetailLoading(false);
    }
  }

  async function queue(videos: VideoSummary[]) {
    if (!settings?.rightsAcknowledged) {
      onNeedRights();
      return;
    }
    try {
      await enqueueDownloads(videos.map((video) => ({ video, preset, outputDirectory: settings.outputDirectory })));
      setSelected(new Set());
      onQueued();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    if (preview) previewCloseRef.current?.focus();
  }, [preview?.id]);

  const selectedVideos = results.filter((video) => selected.has(video.id));

  return (
    <div className={`search-layout ${preview ? "has-preview" : ""}`}>
      <section className="search-content" id="main-content">
        <header className="page-header search-header">
          <div>
            <span className="eyebrow">{musicMode ? "MUSIC" : "DISCOVER"}</span>
            <h1>{musicMode ? "找到想收藏的音乐" : "找到值得留下的内容"}</h1>
            <p>{musicMode ? "搜索歌曲或歌手，预览后提取并保存音频。" : "输入关键词，预览后保存你拥有授权的视频。"}</p>
          </div>
        </header>

        <div className="media-mode-row">
          <div className="media-mode-switch" role="radiogroup" aria-label="下载类型">
            <button type="button" role="radio" aria-checked={!musicMode} className={!musicMode ? "is-active" : ""} onClick={() => chooseMediaMode("video")}>
              <Clapperboard size={16} /> 视频
            </button>
            <button type="button" role="radio" aria-checked={musicMode} className={musicMode ? "is-active" : ""} onClick={() => chooseMediaMode("music")}>
              <Music2 size={16} /> 音乐
            </button>
          </div>
          <p>{musicMode ? "仅保存音轨，支持 MP3 与 M4A" : "保存画面与声音，最高可选最佳画质"}</p>
        </div>

        <form className="search-box" onSubmit={submitSearch} role="search">
          <Search aria-hidden="true" size={21} />
          <label className="sr-only" htmlFor="video-search">{musicMode ? "输入歌曲、歌手或音乐关键词" : copy.searchPlaceholder}</label>
          <input
            id="video-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={musicMode ? "输入歌曲、歌手或音乐关键词" : copy.searchPlaceholder}
            autoComplete="off"
          />
          {query ? (
            <button className="icon-button subtle" type="button" aria-label="清空搜索" onClick={() => setQuery("")}>
              <X size={18} />
            </button>
          ) : null}
          <button className="primary-button search-submit" type="submit" disabled={!query.trim() || loading} aria-busy={loading}>
            {loading ? <span className="search-spinner" aria-hidden="true" /> : null}
            {loading ? "正在搜索" : copy.searchAction}
          </button>
        </form>

        {loading ? <SearchSkeleton /> : null}

        {!loading && error ? (
          <div className="state-card error-state" role="alert">
            <h2>搜索暂时不可用</h2>
            <p>{error}</p>
            <button type="button" className="secondary-button" onClick={() => void submitSearch({ preventDefault() {} } as React.FormEvent)}>重新搜索</button>
          </div>
        ) : null}

        {!loading && !error && !hasSearched ? <EmptySearch musicMode={musicMode} /> : null}

        {!loading && !error && hasSearched && results.length === 0 ? (
          <div className="state-card empty-results">
            <Search size={28} />
            <h2>{copy.noResults}</h2>
            <p>{copy.noResultsHint}</p>
          </div>
        ) : null}

        {!loading && results.length > 0 ? (
          <>
            <div className="results-toolbar">
              <div>
                <strong>{results.length} 个结果</strong>
                <span>来自 YouTube</span>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={selected.size === results.length}
                  ref={(node) => { if (node) node.indeterminate = selected.size > 0 && selected.size < results.length; }}
                  onChange={() => setSelected(selected.size === results.length ? new Set() : new Set(results.map((video) => video.id)))}
                />
                {copy.selectAll}
              </label>
            </div>

            <div className="video-list" aria-live="polite">
              {results.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  selected={selected.has(video.id)}
                  musicMode={musicMode}
                  onToggle={() => toggle(video.id)}
                  onPreview={() => void openPreview(video)}
                  onDownload={() => void queue([video])}
                />
              ))}
            </div>
          </>
        ) : null}
      </section>

      {preview ? (
        <aside className="preview-panel" role="dialog" aria-modal="false" aria-label={`预览 ${preview.title}`}>
          <div className="preview-topbar">
            <span>视频预览</span>
            <button ref={previewCloseRef} type="button" className="icon-button" aria-label="关闭预览" onClick={() => setPreview(null)}>
              <X size={19} />
            </button>
          </div>
          <div className="player-shell">
            <iframe
              title={`YouTube 播放器：${preview.title}`}
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(preview.id)}?rel=0&playsinline=1`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <div className="preview-body">
            {detailLoading ? <div className="inline-loading"><LoaderCircle className="spin" size={16} /> 正在加载详情</div> : null}
            <span className="source-pill">YouTube</span>
            <h2>{preview.title}</h2>
            <p className="preview-channel">{preview.channel} · {formatDuration(preview.durationSeconds)}</p>
            {"description" in preview && preview.description ? <p className="preview-description">{preview.description}</p> : null}
            <a className="external-link" href={preview.webpageUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> 在 YouTube 中打开
            </a>
          </div>
          <div className="preview-actions">
            <PresetSelect value={preset} onChange={setPreset} />
            <button className="primary-button" type="button" onClick={() => void queue([preview])}>
              {musicMode ? <Music2 size={18} /> : <Download size={18} />}
              {musicMode ? "下载此音乐" : "下载此视频"}
            </button>
          </div>
        </aside>
      ) : null}

      {selectedVideos.length > 0 ? (
        <div className="batch-bar" role="region" aria-label="批量下载操作">
          <div className="selection-count"><span>{selectedVideos.length}</span><p>{copy.selected}</p></div>
          <div className="batch-thumbs" aria-hidden="true">
            {selectedVideos.slice(0, 3).map((video) => <img key={video.id} src={video.thumbnailUrl} alt="" />)}
          </div>
          <PresetSelect value={preset} onChange={setPreset} />
          <button className="text-button" type="button" onClick={() => setSelected(new Set())}>{copy.clearSelection}</button>
          <button className="primary-button" type="button" onClick={() => void queue(selectedVideos)}>
            {musicMode ? <Music2 size={18} /> : <Download size={18} />}
            下载 {selectedVideos.length} 项{musicMode ? "音乐" : ""}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function waitForLoadingPaint(): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallback);
      resolve();
    };
    const fallback = window.setTimeout(finish, 80);
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
    }
  });
}

function VideoCard({ video, selected, musicMode, onToggle, onPreview, onDownload }: {
  video: VideoSummary; selected: boolean; musicMode: boolean; onToggle: () => void; onPreview: () => void; onDownload: () => void;
}) {
  return (
    <article className={`video-card ${selected ? "is-selected" : ""}`}>
      <label className="card-checkbox">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`选择 ${video.title}`} />
        <span><Check size={14} /></span>
      </label>
      <button type="button" className="thumbnail-button" onClick={onPreview} aria-label={`预览 ${video.title}`}>
        <img src={video.thumbnailUrl} alt="" loading="lazy" />
        <span className="play-badge"><Play size={18} fill="currentColor" /></span>
        <span className="duration-badge">{formatDuration(video.durationSeconds)}</span>
      </button>
      <div className="video-meta">
        <button className="video-title" type="button" onClick={onPreview}>{video.title}</button>
        <p>{video.channel}</p>
        <span className="video-source"><span /> YouTube</span>
      </div>
      <div className="card-actions">
        <button type="button" className="secondary-button compact" onClick={onPreview}><Play size={16} /> {copy.preview}</button>
        <button type="button" className="icon-button" onClick={onDownload} aria-label={`${musicMode ? "下载音乐" : "下载视频"} ${video.title}`}>
          {musicMode ? <Music2 size={18} /> : <Download size={18} />}
        </button>
      </div>
    </article>
  );
}

export function PresetSelect({ value, onChange }: { value: DownloadPreset; onChange: (value: DownloadPreset) => void }) {
  const musicMode = value === "audioM4a" || value === "audioMp3";
  const entries = (Object.entries(presetLabels) as Array<[DownloadPreset, string]>).filter(([id]) =>
    musicMode ? id.startsWith("audio") : id.startsWith("video")
  );
  return (
    <label className="preset-field">
      <span className="sr-only">下载格式</span>
      <select value={value} onChange={(event) => onChange(event.target.value as DownloadPreset)}>
        {entries.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
  );
}

function EmptySearch({ musicMode }: { musicMode: boolean }) {
  return (
    <div className="empty-hero">
      <div className="empty-art" aria-hidden="true">
        <div className="art-card art-card-one"><Play size={20} fill="currentColor" /></div>
        <div className="art-card art-card-two"><Download size={20} /></div>
        <div className="art-orbit" />
      </div>
      <h2>{musicMode ? "搜索想收藏的音乐" : copy.emptyTitle}</h2>
      <p>{musicMode ? "输入歌曲、歌手或专辑关键词，试听确认后可保存为 MP3 或 M4A 音频。" : copy.emptyBody}</p>
      <div className="feature-row">
        <span><Check size={15} /> 下载前预览</span>
        <span><Check size={15} /> {musicMode ? "MP3 / M4A" : "批量任务队列"}</span>
        <span><Check size={15} /> 本地持久化</span>
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return <div className="skeleton-list" aria-label="正在加载搜索结果">{[1, 2, 3].map((item) => <div className="skeleton-card" key={item}><span /><div><i /><i /><i /></div></div>)}</div>;
}
