import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ShieldCheck, X } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { SearchView } from "./components/SearchView";
import { SettingsView } from "./components/SettingsView";
import { TasksView } from "./components/TasksView";
import { copy } from "./i18n";
import { getSettings, listTasks, onTaskUpdated, updateSettings } from "./lib/api";
import { useAppStore } from "./store";
import type { AppSettings, DownloadTask } from "./types";

export default function App() {
  const { view, setView, theme, setTheme } = useAppStore();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [rightsOpen, setRightsOpen] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const rightsDialogRef = useRef<HTMLElement>(null);
  const rightsActionRef = useRef<HTMLButtonElement>(null);

  const refreshTasks = useCallback(async () => {
    try { setTasks(await listTasks()); } catch (reason) { showError(reason); }
  }, []);

  useEffect(() => {
    void Promise.all([getSettings(), listTasks()]).then(([nextSettings, nextTasks]) => {
      setSettings(nextSettings);
      setTheme(nextSettings.theme);
      setTasks(nextTasks);
      if (!nextSettings.rightsAcknowledged) setRightsOpen(true);
    }).catch(showError);

    let unsubscribe: () => void = () => {};
    void onTaskUpdated((updated) => {
      setTasks((current) => {
        const exists = current.some((task) => task.id === updated.id);
        return exists ? current.map((task) => task.id === updated.id ? updated : task) : [updated, ...current];
      });
    }).then((fn) => { unsubscribe = fn; });
    return () => unsubscribe();
  }, [setTheme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (rightsOpen) rightsActionRef.current?.focus();
  }, [rightsOpen]);

  async function saveSettings(patch: Partial<AppSettings>) {
    try {
      const next = await updateSettings(patch);
      setSettings(next);
      setTheme(next.theme);
      setToast({ type: "success", message: "设置已保存" });
    } catch (reason) { showError(reason); }
  }

  async function acknowledgeRights() {
    await saveSettings({ rightsAcknowledged: true });
    setRightsOpen(false);
  }

  function showError(reason: unknown) {
    setToast({ type: "error", message: reason instanceof Error ? reason.message : String(reason) });
  }

  function trapRightsFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && settings?.rightsAcknowledged) {
      setRightsOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const controls = rightsDialogRef.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const activeTasks = useMemo(() => tasks.filter((task) => ["queued", "resolving", "downloading", "processing"].includes(task.status)).length, [tasks]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <Sidebar active={view} activeTasks={activeTasks} onNavigate={setView} />
      <main className="app-main">
        {view === "search" ? <SearchView settings={settings} onQueued={() => { void refreshTasks(); setView("tasks"); setToast({ type: "success", message: "任务已加入下载队列" }); }} onNeedRights={() => setRightsOpen(true)} onError={(message) => showError(message)} /> : null}
        {view === "tasks" ? <TasksView tasks={tasks} onChanged={() => void refreshTasks()} onError={(message) => showError(message)} /> : null}
        {view === "settings" ? <SettingsView settings={settings} onUpdate={saveSettings} onError={(message) => showError(message)} /> : null}
      </main>

      {rightsOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section ref={rightsDialogRef} className="rights-modal" role="dialog" aria-modal="true" aria-labelledby="rights-title" aria-describedby="rights-description" onKeyDown={trapRightsFocus}>
            {settings?.rightsAcknowledged ? <button type="button" className="icon-button modal-close" aria-label="关闭" onClick={() => setRightsOpen(false)}><X size={19} /></button> : null}
            <span className="modal-icon"><ShieldCheck size={27} /></span>
            <span className="eyebrow">RESPONSIBLE USE</span>
            <h2 id="rights-title">{copy.legalTitle}</h2>
            <p id="rights-description">{copy.legalBody}</p>
            <ul>
              <li><Check size={16} /> 自己创作或拥有的视频</li>
              <li><Check size={16} /> 明确允许下载的授权内容</li>
              <li><Check size={16} /> 不绕过平台访问限制</li>
            </ul>
            <button ref={rightsActionRef} className="primary-button modal-action" type="button" onClick={() => void acknowledgeRights()}>我理解并同意</button>
          </section>
        </div>
      ) : null}

      {toast ? (
        <div className={`toast toast-${toast.type}`} role={toast.type === "error" ? "alert" : "status"}>
          {toast.type === "error" ? <AlertCircle size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button type="button" aria-label="关闭通知" onClick={() => setToast(null)}><X size={16} /></button>
        </div>
      ) : null}
    </div>
  );
}
