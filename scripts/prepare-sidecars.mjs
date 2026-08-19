import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(join(projectRoot, "sidecars.lock.json"), "utf8"));
const target = process.env.TAURI_ENV_TARGET_TRIPLE || execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const extension = target.includes("windows") ? ".exe" : "";
const binaryDir = join(projectRoot, "src-tauri", "binaries");
const ytDlpDestination = join(binaryDir, `yt-dlp-${target}${extension}`);
const ffmpegDestination = join(binaryDir, `ffmpeg-${target}${extension}`);
const targetLock = lock.ytDlp.targets[target];

if (!targetLock) {
  throw new Error(`Unsupported sidecar target: ${target}`);
}

await mkdir(binaryDir, { recursive: true });

if (process.env.USE_SYSTEM_SIDECARS === "1") {
  const ytDlpSource = process.env.YT_DLP_BINARY || locate(target.includes("windows") ? "yt-dlp.exe" : "yt-dlp");
  const ffmpegSource = process.env.FFMPEG_BINARY || locate(target.includes("windows") ? "ffmpeg.exe" : "ffmpeg");
  await copyExecutable(ytDlpSource, ytDlpDestination);
  await copyExecutable(ffmpegSource, ffmpegDestination);
} else {
  const cached = join(projectRoot, ".sidecar-cache", lock.ytDlp.version, basename(new URL(targetLock.url).pathname));
  await mkdir(dirname(cached), { recursive: true });
  let valid = await matchesChecksum(cached, targetLock.sha256);
  if (!valid) {
    const response = await fetch(targetLock.url, { redirect: "follow" });
    if (!response.ok) throw new Error(`Failed to download yt-dlp (${response.status})`);
    await writeFile(cached, Buffer.from(await response.arrayBuffer()));
    valid = await matchesChecksum(cached, targetLock.sha256);
  }
  if (!valid) throw new Error(`yt-dlp checksum mismatch for ${target}`);
  await copyExecutable(cached, ytDlpDestination);
  if (!ffmpegPath) throw new Error("ffmpeg-static did not provide a binary for this platform");
  await copyExecutable(ffmpegPath, ffmpegDestination);
}

process.stdout.write(`Prepared sidecars for ${target}\n`);

async function copyExecutable(source, destination) {
  if (!source) throw new Error(`Executable not found for ${destination}`);
  await copyFile(source, destination);
  if (!target.includes("windows")) await chmod(destination, 0o755);
}

async function matchesChecksum(path, expected) {
  try {
    const content = await readFile(path);
    return createHash("sha256").update(content).digest("hex") === expected;
  } catch {
    return false;
  }
}

function locate(name) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  return execFileSync(finder, [name], { encoding: "utf8" }).split(/\r?\n/).find(Boolean)?.trim();
}

