import { useEffect, useRef, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, Clock3, Download, FolderOpen, Layers3, LoaderCircle, Pause, Play, RefreshCw, Trash2, X } from "lucide-react";
import { clearCompletedTasks, deleteTask, mediaSource, openOutputPath, taskAction } from "../lib/api";
import { formatBytes, formatEta, presetLabels, statusLabels } from "../lib/format";
import type { DownloadTask, TaskStatus } from "../types";

interface TasksViewProps {
  tasks: DownloadTask[];
  onChanged: () => void;
  onError: (message: string) => void;
}

const sections: Array<{ title: string; statuses: TaskStatus[]; icon: typeof Download }> = [
  { title: "正在进行", statuses: ["resolving", "downloading", "processing"], icon: Download },
  { title: "等待与暂停", statuses: ["queued", "paused"], icon: Pause },
  { title: "已完成", statuses: ["completed"], icon: CheckCircle2 },
  { title: "需要处理", statuses: ["failed", "canceled"], icon: AlertCircle },
];

export function TasksView({ tasks, onChanged, onError }: TasksViewProps) {
  const [deletingTask, setDeletingTask] = useState<DownloadTask | null>(null);
  const [playingTask, setPlayingTask] = useState<DownloadTask | null>(null);

  async function act(action: "pause" | "resume" | "cancel" | "retry", id: string) {
    try {
      await taskAction(action, id);
      onChanged();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function clearHistory() {
    try {
      await clearCompletedTasks();
      onChanged();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const activeCount = tasks.filter((task) => ["resolving", "downloading", "processing"].includes(task.status)).length;
  const queuedCount = tasks.filter((task) => task.status === "queued").length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;

  return (
    <section className="page-section" id="main-content">
      <header className="page-header tasks-header">
        <div>
          <span className="eyebrow">DOWNLOADS</span>
          <h1>下载任务</h1>
          <p>管理你的下载，精彩内容随时留存。</p>
        </div>
        {completedCount > 0 ? (
          <button type="button" className="secondary-button" onClick={() => void clearHistory()}>
            <Trash2 size={17} /> 清除已完成记录
          </button>
        ) : null}
      </header>

      <div className="stats-grid" aria-label="任务统计">
        <Stat label="下载中" value={activeCount} tone="accent" icon={Activity} />
        <Stat label="等待中" value={queuedCount} icon={Clock3} />
        <Stat label="已完成" value={completedCount} tone="success" icon={CheckCircle2} />
        <Stat label="全部任务" value={tasks.length} icon={Layers3} />
      </div>

      {tasks.length === 0 ? (
        <div className="state-card tasks-empty">
          <span className="state-icon"><Download size={25} /></span>
          <h2>还没有下载任务</h2>
          <p>从搜索页选择视频，下载进度会显示在这里。</p>
        </div>
      ) : (
        <div className="task-sections">
          {sections.map((section) => {
            const sectionTasks = tasks.filter((task) => section.statuses.includes(task.status));
            if (sectionTasks.length === 0) return null;
            const Icon = section.icon;
            return (
              <section className="task-group" key={section.title}>
                <h2><Icon size={17} /> {section.title}<span>{sectionTasks.length}</span></h2>
                <div className="task-list">
                  {sectionTasks.map((task) => <TaskRow key={task.id} task={task} onAction={act} onDelete={() => setDeletingTask(task)} onPlay={() => setPlayingTask(task)} onError={onError} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {deletingTask ? <DeleteTaskDialog task={deletingTask} onDismiss={() => setDeletingTask(null)} onDeleted={() => { setDeletingTask(null); onChanged(); }} /> : null}
      {playingTask ? <AudioPlayer task={playingTask} onDismiss={() => setPlayingTask(null)} onOpenFolder={() => { void openOutputPath(playingTask.id, true).catch((reason) => onError(reason instanceof Error ? reason.message : String(reason))); }} onError={onError} /> : null}
    </section>
  );
}

function Stat({ label, value, icon: Icon, tone = "default" }: { label: string; value: number; icon: typeof Download; tone?: "default" | "accent" | "success" }) {
  return <div className={`stat-card ${tone}`}><div className="stat-heading"><span>{label}</span><Icon size={19} /></div><strong>{value.toString().padStart(2, "0")}</strong></div>;
}

function TaskRow({ task, onAction, onDelete, onPlay, onError }: {
  task: DownloadTask;
  onAction: (action: "pause" | "resume" | "cancel" | "retry", id: string) => Promise<void>;
  onDelete: () => void;
  onPlay: () => void;
  onError: (message: string) => void;
}) {
  const canPause = ["resolving", "downloading", "processing"].includes(task.status);
  const canResume = task.status === "paused";
  const canRetry = ["failed", "canceled"].includes(task.status);
  const canDelete = ["completed", "failed", "canceled"].includes(task.status);
  const inProgress = ["resolving", "downloading", "processing"].includes(task.status);

  async function open(reveal: boolean) {
    try { await openOutputPath(task.id, reveal); } catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); }
  }

  return (
    <article className={`task-row ${inProgress ? "is-running" : ""}`}>
      <img src={task.thumbnailUrl} alt="" />
      <div className="task-main">
        <div className="task-title-line">
          <div><strong>{task.title}</strong><p>{task.channel} · {presetLabels[task.preset]}</p></div>
          <StatusPill status={task.status} />
        </div>
        {inProgress || task.status === "paused" ? (
          <TaskProgressDisplay task={task} />
        ) : null}
        {task.error ? <p className="task-error"><AlertCircle size={14} /> {task.error}</p> : null}
      </div>
      <div className="task-actions">
        {canPause ? <button className="icon-button" type="button" aria-label={`暂停 ${task.title}`} onClick={() => void onAction("pause", task.id)}><Pause size={18} /></button> : null}
        {canResume ? <button className="icon-button primary-icon" type="button" aria-label={`继续 ${task.title}`} onClick={() => void onAction("resume", task.id)}><Play size={18} /></button> : null}
        {canRetry ? <button className="icon-button" type="button" aria-label={`重试 ${task.title}`} onClick={() => void onAction("retry", task.id)}><RefreshCw size={18} /></button> : null}
        {task.status === "completed" ? <button className="icon-button" type="button" aria-label={`打开 ${task.title} 所在文件夹`} onClick={() => void open(true)}><FolderOpen size={18} /></button> : null}
        {!["completed", "failed", "canceled"].includes(task.status) ? <button className="icon-button danger" type="button" aria-label={`取消 ${task.title}`} onClick={() => void onAction("cancel", task.id)}><X size={18} /></button> : null}
        {task.status === "completed" ? <button className="icon-button" type="button" aria-label={`${isAudioPreset(task.preset) ? "播放" : "打开"} ${task.title}`} onClick={() => isAudioPreset(task.preset) ? onPlay() : void open(false)}><Play size={18} /></button> : null}
        {canDelete ? <button className="icon-button danger" type="button" title="删除任务，可选择同时删除文件" aria-label={`删除任务 ${task.title}`} onClick={onDelete}><Trash2 size={18} /></button> : null}
      </div>
    </article>
  );
}

function isAudioPreset(preset: DownloadTask["preset"]): boolean {
  return preset === "audioM4a" || preset === "audioMp3";
}

function AudioPlayer({ task, onDismiss, onOpenFolder, onError }: {
  task: DownloadTask;
  onDismiss: () => void;
  onOpenFolder: () => void;
  onError: (message: string) => void;
}) {
  const audioSource = task.outputPath ? mediaSource(task.outputPath) : null;
  return (
    <div className="modal-backdrop audio-player-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
      <section className="audio-player" role="dialog" aria-modal="true" aria-labelledby="audio-player-title">
        <div className="audio-player-header">
          <div><span className="eyebrow">NOW PLAYING</span><h2 id="audio-player-title">{task.title}</h2><p>{task.channel} · {presetLabels[task.preset]}</p></div>
          <button type="button" className="icon-button" aria-label="关闭播放器" onClick={onDismiss}><X size={19} /></button>
        </div>
        <div className="audio-player-art"><img src={task.thumbnailUrl} alt="" /><div><strong>{task.title}</strong><span>{task.channel}</span></div></div>
        {audioSource ? <audio className="audio-controls" src={audioSource} controls autoPlay preload="metadata" aria-label={`播放 ${task.title}`} onError={() => onError("内置播放器无法读取该音频文件，请检查文件是否仍存在") } /> : <p className="audio-player-error">找不到已下载的音频文件</p>}
        <div className="audio-player-actions"><button type="button" className="secondary-button" onClick={onOpenFolder}><FolderOpen size={16} /> 打开文件夹</button><button type="button" className="primary-button" onClick={onDismiss}>完成</button></div>
      </section>
    </div>
  );
}

function TaskProgressDisplay({ task }: { task: DownloadTask }) {
  const { progress, status } = task;
  const percent = Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, progress.percent)) : 0;
  const indeterminate = status === "resolving" || status === "processing" || (status === "downloading" && !progress.totalBytes && percent === 0);
  const stage = status === "processing" ? "正在合并与转换" : status === "resolving" ? "正在解析媒体信息" : progress.stage;
  return <div className="task-progress">
    <div className="progress-heading"><span>{stage}</span><strong>{indeterminate ? "请稍候" : `${percent.toFixed(1)}%`}</strong></div>
    <div className={`progress-track ${indeterminate ? "is-indeterminate" : ""} ${status === "paused" ? "is-paused" : ""}`} role="progressbar" aria-label={`${task.title} 当前文件下载进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : percent} aria-valuetext={indeterminate ? stage : `${percent.toFixed(1)}%`}>
      <span style={indeterminate ? undefined : { transform: `scaleX(${percent / 100})` }} />
    </div>
    <div className="progress-meta">
      <span>{status === "processing" ? "媒体已下载，正在生成最终文件" : status === "resolving" ? "连接资源并获取下载信息" : `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`}</span>
      {status === "downloading" ? <span>{progress.speedBytesPerSecond != null ? `${formatBytes(progress.speedBytesPerSecond)}/s` : "等待传输"}{progress.etaSeconds != null ? ` · 剩余 ${formatEta(progress.etaSeconds)}` : ""}</span> : null}
    </div>
  </div>;
}

function DeleteTaskDialog({ task, onDismiss, onDeleted }: { task: DownloadTask; onDismiss: () => void; onDeleted: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [deleteFile, setDeleteFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFile = Boolean(task.outputPath);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await deleteTask(task.id, deleteFile); onDeleted(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false); }
  }

  return <dialog ref={dialogRef} className="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-description" onCancel={(event) => { event.preventDefault(); if (!busy) onDismiss(); }}>
    <span className="delete-dialog-icon"><Trash2 size={24} /></span>
    <h2 id="delete-title">删除这个任务？</h2>
    <p id="delete-description">任务会从下载列表中移除。</p>
    <div className="delete-file-preview"><strong>{task.title}</strong><span>{task.outputPath || "此任务尚未生成最终文件"}</span></div>
    <label className={`delete-file-option ${deleteFile ? "is-checked" : ""}`}>
      <input type="checkbox" checked={deleteFile} disabled={busy || !hasFile} onChange={(event) => setDeleteFile(event.target.checked)} />
      <span><strong>同时删除已下载文件</strong><small>{hasFile ? "永久删除此任务的输出文件，无法撤销" : "没有已记录的输出文件，仅移除任务记录"}</small></span>
    </label>
    {error ? <p className="delete-error" role="alert">{error}</p> : null}
    <div className="dialog-actions"><button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onDismiss}>取消</button><button type="button" className="primary-button danger-button" disabled={busy} onClick={() => void confirm()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}{busy ? "正在删除" : deleteFile ? "删除任务和文件" : "仅删除记录"}</button></div>
  </dialog>;
}

function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`status-pill status-${status}`}><span />{statusLabels[status]}</span>;
}
