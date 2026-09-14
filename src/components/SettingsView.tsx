import { useEffect, useState } from "react";
import { Check, ChevronRight, FolderOpen, Info, Monitor, Moon, Network, Save, ShieldCheck, Sun } from "lucide-react";
import { chooseDownloadDirectory, openDownloadDirectory } from "../lib/api";
import type { AppSettings, ThemeMode } from "../types";

interface SettingsViewProps {
  settings: AppSettings | null;
  onUpdate: (patch: Partial<AppSettings>) => Promise<void>;
  onError: (message: string) => void;
}

export function SettingsView({ settings, onUpdate, onError }: SettingsViewProps) {
  const [proxyUrl, setProxyUrl] = useState("");
  const [savingProxy, setSavingProxy] = useState(false);

  useEffect(() => {
    setProxyUrl(settings?.proxyUrl ?? "");
  }, [settings?.proxyUrl]);

  async function chooseFolder() {
    try {
      const directory = await chooseDownloadDirectory();
      if (directory) await onUpdate({ outputDirectory: directory });
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function openFolder() {
    try {
      await openDownloadDirectory();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function saveProxy(event: React.FormEvent) {
    event.preventDefault();
    setSavingProxy(true);
    try {
      await onUpdate({ proxyUrl: proxyUrl.trim() });
    } finally {
      setSavingProxy(false);
    }
  }

  if (!settings) return <section className="page-section"><div className="settings-skeleton" /></section>;

  return (
    <section className="page-section settings-page" id="main-content">
      <div className="settings-grid">
        <section className="settings-card proxy-settings">
          <div className="settings-card-title">
            <span><Network size={19} /></span>
            <div><h2>网络代理</h2><p>搜索、详情解析和下载任务统一使用此代理</p></div>
            <small className={`proxy-status ${settings.proxyUrl ? "is-enabled" : ""}`}>{settings.proxyUrl ? "已启用" : "未启用"}</small>
          </div>
          <form className="proxy-form" onSubmit={saveProxy}>
            <label htmlFor="proxy-url">代理地址</label>
            <div className="proxy-input-row">
              <input
                id="proxy-url"
                type="text"
                value={proxyUrl}
                onChange={(event) => setProxyUrl(event.target.value)}
                placeholder="http://127.0.0.1:7890"
                autoComplete="off"
                spellCheck={false}
              />
              <button className="primary-button" type="submit" disabled={savingProxy || proxyUrl.trim() === settings.proxyUrl}>
                <Save size={16} /> {savingProxy ? "正在保存" : "保存代理"}
              </button>
            </div>
            <p>支持 HTTP、HTTPS、SOCKS4、SOCKS5 和 SOCKS5H。留空并保存即可关闭；暂不保存代理账号或密码。</p>
          </form>
        </section>

        <section className="settings-card">
          <div className="settings-card-title"><span><FolderOpen size={19} /></span><div><h2>下载位置</h2><p>新任务会保存到此文件夹</p></div></div>
          <div className="path-actions">
            <button className="path-picker" type="button" aria-label="更改下载位置" onClick={() => void chooseFolder()}>
              <span>{settings.outputDirectory}</span><ChevronRight size={18} />
            </button>
            <button className="secondary-button directory-open-button" type="button" onClick={() => void openFolder()}>
              <FolderOpen size={16} /> 打开目录
            </button>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-title"><span><Sun size={19} /></span><div><h2>外观</h2><p>选择最适合当前环境的主题</p></div></div>
          <div className="theme-options" role="radiogroup" aria-label="外观主题">
            <ThemeOption id="system" current={settings.theme} label="跟随系统" icon={Monitor} onChoose={(theme) => void onUpdate({ theme })} />
            <ThemeOption id="light" current={settings.theme} label="浅色" icon={Sun} onChoose={(theme) => void onUpdate({ theme })} />
            <ThemeOption id="dark" current={settings.theme} label="深色" icon={Moon} onChoose={(theme) => void onUpdate({ theme })} />
          </div>
        </section>

        <section className="settings-card legal-settings">
          <div className="settings-card-title"><span><ShieldCheck size={19} /></span><div><h2>内容授权</h2><p>下载前必须确认你有权保存相关内容</p></div></div>
          <label className="rights-switch">
            <input type="checkbox" checked={settings.rightsAcknowledged} onChange={(event) => void onUpdate({ rightsAcknowledged: event.target.checked })} />
            <span className="switch-track"><i /></span>
            <span>我只下载自有或已获授权的内容</span>
          </label>
          <p className="legal-copy">Streamnest 不支持账号 Cookie、DRM、年龄或地区限制绕过。请遵守内容许可和所在地法律。</p>
        </section>

        <section className="settings-card about-card">
          <div className="settings-card-title"><span><Info size={19} /></span><div><h2>工具信息</h2><p>随应用打包的本地组件</p></div></div>
          <dl>
            <div><dt>Streamnest</dt><dd>0.1.0</dd></div>
            <div><dt>yt-dlp</dt><dd>{settings.ytDlpVersion}</dd></div>
            <div><dt>FFmpeg</dt><dd>{settings.ffmpegVersion}</dd></div>
            <div><dt>并发任务</dt><dd>最多 2 个</dd></div>
          </dl>
        </section>
      </div>
    </section>
  );
}

function ThemeOption({ id, current, label, icon: Icon, onChoose }: {
  id: ThemeMode; current: ThemeMode; label: string; icon: typeof Sun; onChoose: (theme: ThemeMode) => void;
}) {
  return (
    <button type="button" role="radio" aria-checked={id === current} className={id === current ? "is-active" : ""} onClick={() => onChoose(id)}>
      <Icon size={19} /><span>{label}</span>{id === current ? <Check size={16} /> : null}
    </button>
  );
}
