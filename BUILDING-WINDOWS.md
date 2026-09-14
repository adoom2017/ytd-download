# Windows 一键编译打包

## 最简单的方式

在资源管理器中双击项目根目录的 `build-windows.cmd`。脚本成功后会自动打开安装包目录。

生成的主要文件：

- 安装包：`src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\Streamnest_*_x64-setup.exe`
- 应用程序：`src-tauri\target\x86_64-pc-windows-msvc\release\streamnest.exe`

## 首次构建前需要安装

1. Node.js 22 LTS。
2. Rust stable MSVC 工具链。
3. Visual Studio 2022 Build Tools，并勾选“使用 C++ 的桌面开发”和 Windows SDK。
4. Tauri 在 Windows 上需要的 Microsoft Edge WebView2 Runtime。Windows 10/11 通常已安装。

脚本会自动使用 pnpm（找不到全局 pnpm 时使用 Node.js 自带的 Corepack），并完成以下操作：

1. 安装锁定版本的前端依赖。
2. 下载并校验 yt-dlp 与 FFmpeg sidecar。
3. 安装 Windows x64 Rust target。
4. 编译前端、Rust 后端和 NSIS 安装包。

## PowerShell 用法

```powershell
cd E:\app_workspace\ytb-download
.\build-windows.ps1 -OpenOutput
```

依赖和 sidecar 已准备好时，可以缩短重复构建时间：

```powershell
.\build-windows.ps1 -SkipInstall -SkipSidecars -OpenOutput
```

构建的是未签名测试包，因此首次运行时 Windows SmartScreen 可能显示提示。
