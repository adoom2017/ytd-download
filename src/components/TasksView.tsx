import { AlertCircle, CheckCircle2, Download, FolderOpen, MoreHorizontal, Pause, Play, RefreshCw, Trash2, X } from "lucide-react";
import { clearCompletedTasks, openOutputPath, taskAction } from "../lib/api";
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
          <p>关闭应用后，未完成任务仍会保留。</p>
        </div>
        {completedCount > 0 ? (
          <button type="button" className="secondary-button" onClick={() => void clearHistory()}>
            <Trash2 size={17} /> 清除已完成记录
          </button>
        ) : null}
      </header>

      <div className="stats-grid" aria-label="任务统计">
        <Stat label="下载中" value={activeCount} tone="accent" />
        <Stat label="等待中" value={queuedCount} />
        <Stat label="已完成" value={completedCount} tone="success" />
        <Stat label="全部任务" value={tasks.length} />
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
                  {sectionTasks.map((task) => <TaskRow key={task.id} task={task} onAction={act} onError={onError} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "accent" | "success" }) {
  return <div className={`stat-card ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function TaskRow({ task, onAction, onError }: {
  task: DownloadTask;
  onAction: (action: "pause" | "resume" | "cancel" | "retry", id: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const canPause = ["resolving", "downloading", "processing"].includes(task.status);
  const canResume = task.status === "paused";
  const canRetry = ["failed", "canceled"].includes(task.status);
  const inProgress = ["resolving", "downloading", "processing"].includes(task.status);

  async function open(reveal: boolean) {
    try { await openOutputPath(task.id, reveal); } catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); }
  }

  return (
    <article className="task-row">
      <img src={task.thumbnailUrl} alt="" />
      <div className="task-main">
        <div className="task-title-line">
          <div><strong>{task.title}</strong><p>{task.channel} · {presetLabels[task.preset]}</p></div>
          <StatusPill status={task.status} />
        </div>
        {inProgress || task.status === "paused" ? (
          <>
            <div className="progress-track" aria-label={`下载进度 ${Math.round(task.progress.percent)}%`}>
              <span style={{ width: `${Math.min(100, Math.max(0, task.progress.percent))}%` }} />
            </div>
            <div className="progress-meta">
              <span>{Math.round(task.progress.percent)}% · {task.progress.stage}</span>
              <span>{formatBytes(task.progress.speedBytesPerSecond)}/s · 剩余 {formatEta(task.progress.etaSeconds)}</span>
            </div>
          </>
        ) : null}
        {task.error ? <p className="task-error"><AlertCircle size={14} /> {task.error}</p> : null}
      </div>
      <div className="task-actions">
        {canPause ? <button className="icon-button" type="button" aria-label={`暂停 ${task.title}`} onClick={() => void onAction("pause", task.id)}><Pause size={18} /></button> : null}
        {canResume ? <button className="icon-button primary-icon" type="button" aria-label={`继续 ${task.title}`} onClick={() => void onAction("resume", task.id)}><Play size={18} /></button> : null}
        {canRetry ? <button className="icon-button" type="button" aria-label={`重试 ${task.title}`} onClick={() => void onAction("retry", task.id)}><RefreshCw size={18} /></button> : null}
        {task.status === "completed" ? <button className="icon-button" type="button" aria-label={`打开 ${task.title} 所在文件夹`} onClick={() => void open(true)}><FolderOpen size={18} /></button> : null}
        {!["completed", "failed", "canceled"].includes(task.status) ? <button className="icon-button danger" type="button" aria-label={`取消 ${task.title}`} onClick={() => void onAction("cancel", task.id)}><X size={18} /></button> : null}
        {task.status === "completed" ? <button className="icon-button" type="button" aria-label={`打开 ${task.title}`} onClick={() => void open(false)}><MoreHorizontal size={18} /></button> : null}
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`status-pill status-${status}`}><span />{statusLabels[status]}</span>;
}

