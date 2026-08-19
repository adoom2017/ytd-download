# Streamnest

Streamnest 是一个面向 Windows 与 macOS 的私人视频搜索、预览和下载管理器。它使用 Tauri 2、React、Rust、SQLite、yt-dlp 与 FFmpeg，并将任务和设置保存在本机。

> 仅下载你自己拥有或已明确获准保存的内容。本项目不会绕过 DRM、账号登录、年龄或地区限制。使用者应遵守内容许可、YouTube 条款及所在地法律。

## 已实现能力

- 关键词搜索最多 30 个 YouTube 视频，按需加载详情
- `youtube-nocookie.com` 应用内播放预览与浏览器回退链接
- 单个和批量下载，支持 MP4 360p/720p/1080p/最佳画质、M4A、MP3 192k
- SQLite 持久化双并发队列，支持暂停、继续、取消和失败重试
- 进度、速度、ETA、合并/转换阶段和本地文件操作
- 可选 HTTP/HTTPS/SOCKS 代理，统一用于搜索、详情解析和 yt-dlp 下载
- 简体中文、系统/浅色/深色主题、键盘操作与 reduced-motion
- Windows NSIS 与 macOS Intel/Apple Silicon DMG 构建矩阵

## 本地开发

需要 Node.js 20+、pnpm 9+、Rust 1.84+。常规开发会下载锁定版本的 yt-dlp，并从 `ffmpeg-static` 准备 FFmpeg：

```powershell
pnpm install
pnpm sidecars
pnpm tauri:dev
```

如本机已有 `yt-dlp` 和 `ffmpeg`，可在离线开发时复制系统工具：

```powershell
$env:USE_SYSTEM_SIDECARS='1'
pnpm sidecars
pnpm tauri:dev
```

浏览器 UI 预览不要求 Rust 或 Sidecar：

```powershell
pnpm dev
```

浏览器模式会使用两个明确标注的演示结果，不会执行下载。

## 检查与构建

```powershell
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri:build
```

macOS 安装包必须在对应 macOS runner 上生成。未签名测试包会触发 Windows SmartScreen 或 macOS Gatekeeper 警告。

## 数据与进程模型

- 数据库位于操作系统应用数据目录下的 `streamnest.sqlite3`。
- 默认下载目录为系统“下载/YouTube Downloads”。
- 前端只能调用固定、类型化的 Tauri commands；不能传入任意 Shell 参数或二进制路径。
- 运行中的任务通过 Tauri 事件 `download-task-updated` 更新。异常退出后的活动任务会在下次启动时恢复为“已暂停”。
- yt-dlp 输出模板以私有前缀传输进度和最终文件路径，Rust 层解析后才发送给 UI。
- 代理地址保存在本地设置中，只接受受支持的 URL scheme；当前不保存代理账号或密码。

## Sidecar 锁定

yt-dlp 的版本、下载地址和官方 SHA-256 位于 `sidecars.lock.json`。FFmpeg 来自精确锁定的 `ffmpeg-static@5.2.0`，包与平台二进制校验由 pnpm 完整性校验和其安装脚本共同完成。

更新 Sidecar 时必须同时更新版本、URL、校验和、第三方许可说明，并在三个目标平台执行真实下载冒烟测试。
