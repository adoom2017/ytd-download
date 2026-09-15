import { ArrowDownToLine, Download, Search, Settings } from "lucide-react";
import { copy } from "../i18n";
import type { AppView } from "../types";

interface SidebarProps {
  active: AppView;
  activeTasks: number;
  onNavigate: (view: AppView) => void;
}

const entries: Array<{ id: AppView; label: string; icon: typeof Search }> = [
  { id: "search", label: copy.search, icon: Search },
  { id: "tasks", label: copy.tasks, icon: Download },
  { id: "settings", label: copy.settings, icon: Settings },
];

export function Sidebar({ active, activeTasks, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="主导航">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><ArrowDownToLine size={20} strokeWidth={2.1} /></span>
        <span>
          <strong>{copy.appName}</strong>
          <small>你的媒体收藏空间</small>
        </span>
      </div>

      <span className="nav-caption">工作空间</span>
      <nav className="nav-list">
        {entries.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`nav-item ${active === id ? "is-active" : ""}`}
            aria-current={active === id ? "page" : undefined}
            aria-label={label}
            onClick={() => onNavigate(id)}
          >
            <Icon size={19} strokeWidth={1.8} />
            <span>{label}</span>
            {id === "tasks" && activeTasks > 0 ? <span className="nav-badge">{activeTasks}</span> : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-note">
        <span className="status-dot" />
        <div>
          <strong>本地处理</strong>
          <p>任务与设置仅保存在此设备</p>
        </div>
      </div>
    </aside>
  );
}
