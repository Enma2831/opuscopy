import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { VideoSource } from "../../domain/types";
import { VideoSourcePort } from "../../interfaces/ports";

export class VideoSourceResolver implements VideoSourcePort {
  constructor(private readonly uploadsDir: string) {}

  async resolve(options: { url?: string | null; uploadId?: string | null }): Promise<VideoSource> {
    if (options.uploadId) {
      const filePath = path.join(this.uploadsDir, options.uploadId);
      const exists = await fileExists(filePath);
      if (!exists) {
        throw new Error("Uploaded file not found.");
      }
      const metadata = options.url ? await fetchYoutubeMetadata(options.url) : null;
      return {
        type: "upload",
        filePath,
        url: options.url ?? null,
        title: metadata?.title ?? path.basename(options.uploadId),
        provider: metadata?.provider_name ?? null
      };
    }

    if (options.url) {
      const metadata = await fetchYoutubeMetadata(options.url);
      let filePath: string | undefined;
      if (process.env.ALLOW_YOUTUBE_DOWNLOADS === "true") {
        const storageBase = process.env.STORAGE_PATH ?? path.join(process.cwd(), "storage");
        const jobsDir = path.join(storageBase, "jobs");
        await fs.mkdir(jobsDir, { recursive: true });
        const safeName = Buffer.from(options.url).toString("hex").slice(0, 16);
        filePath = await ensureYoutubeDownload(options.url, path.join(jobsDir, `yt-${safeName}.mp4`));
      }
      return {
        type: "youtube",
        filePath,
        url: options.url,
        title: metadata?.title ?? null,
        provider: metadata?.provider_name ?? "YouTube"
      };
    }

    throw new Error("Missing video source.");
  }
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchYoutubeMetadata(url: string) {
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembed);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as { title?: string; provider_name?: string };
  } catch {
    return null;
  }
}

async function downloadYoutubeWithYtdlp(url: string, outPath: string) {
  return new Promise<void>((resolve, reject) => {
    const format = "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/best";
    const args = [
      "-f",
      format,
      "--merge-output-format",
      "mp4",
      "--no-playlist",
      "--no-part",
      "--concurrent-fragments",
      "1",
      "--force-overwrites",
      "-o",
      outPath,
      url
    ];
    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    const tail = createTailBuffer(8192);
    const timeoutMs = parsePositiveInt(process.env.YT_DOWNLOAD_TIMEOUT_MS, 600000);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    proc.stdout.on("data", (data) => tail.append(data));
    proc.stderr.on("data", (data) => tail.append(data));
    proc.on("error", () => {
      clearTimeout(timeout);
      reject(new Error("yt-dlp not found or failed to start. Please install yt-dlp."));
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        const detail = tail.value();
        const suffix = detail ? `\n${detail}` : "";
        if (timedOut) {
          reject(new Error(`yt-dlp timed out after ${timeoutMs}ms.${suffix}`));
        } else {
          reject(new Error(`Failed to download YouTube video with yt-dlp (exit ${code}).${suffix}`));
        }
      }
    });
  });
}

async function ensureYoutubeDownload(url: string, filePath: string) {
  const exists = await fileExists(filePath);
  if (exists) {
    try {
      await probeVideo(filePath);
      return filePath;
    } catch {
      const deleted = await safeUnlink(filePath);
      if (!deleted) {
        const retryPath = buildRetryPath(filePath);
        await downloadYoutubeWithYtdlp(url, retryPath);
        await probeVideo(retryPath);
        return retryPath;
      }
    }
  }

  try {
    await downloadYoutubeWithYtdlp(url, filePath);
  } catch (error) {
    if (await fileExists(filePath)) {
      try {
        await probeVideo(filePath);
        return filePath;
      } catch {
        // Fall through to rethrow the original error if the file is still invalid.
      }
    }
    throw error;
  }
  await probeVideo(filePath);
  return filePath;
}

async function probeVideo(filePath: string) {
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ];
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (data) => (output += data.toString()));
    proc.stderr.on("data", (data) => (output += data.toString()));
    proc.on("error", (error) => reject(new Error(`ffprobe failed to start: ${error.message}`)));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(buildFfprobeError(output, code)));
      }
    });
  });
}

async function safeUnlink(filePath: string) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return true;
    }
    if (code === "EBUSY" || code === "EPERM") {
      return false;
    }
    if (code) {
      throw error;
    }
    throw error;
  }
}

function buildFfprobeError(output: string, code: number | null) {
  const summary = output.trim().replaceAll(/\s+/g, " ");
  const exitCode = code ?? "unknown";
  const suffix = summary ? ` ${summary}` : "";
  return `ffprobe failed (exit ${exitCode}).${suffix}`;
}

function buildRetryPath(filePath: string) {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  const stamp = Date.now();
  return `${base}-${stamp}${ext || ".mp4"}`;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createTailBuffer(limit: number) {
  let buffer = Buffer.alloc(0);
  return {
    append(chunk: Buffer) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > limit) {
        buffer = buffer.subarray(buffer.length - limit);
      }
    },
    value() {
      return buffer.toString("utf-8").trim();
    }
  };
}
