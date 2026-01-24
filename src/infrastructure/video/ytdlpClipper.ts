import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { YoutubeClipperPort } from "../../interfaces/ports";

type LogTail = ReturnType<typeof createLogTail>;

export class YtdlpClipper implements YoutubeClipperPort {
  async clip(options: {
    url: string;
    start: number;
    end: number;
    outputPath: string;
    maxHeight?: number;
    timeoutMs?: number;
    preferCopy?: boolean;
  }): Promise<void> {
    const {
      url,
      start,
      end,
      outputPath,
      maxHeight = 720,
      timeoutMs = 300000,
      preferCopy = true
    } = options;

    if (!isYoutubeUrl(url)) {
      throw new Error("Only youtube.com or youtu.be links are allowed.");
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error("Invalid start or end times.");
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const duration = Math.max(0.1, end - start);
    const format = `best[ext=mp4][height<=${maxHeight}]/best[height<=${maxHeight}]/best`;

    const ytdlpArgs = [
      "-f",
      format,
      "--no-playlist",
      "--no-part",
      "--newline",
      "--concurrent-fragments",
      "1",
      "-o",
      "-",
      url
    ];

    const run = async (copy: boolean) => {
      await fs.unlink(outputPath).catch(() => undefined);
      const tail = createLogTail();
      const ffmpegArgs = buildFfmpegArgs(start, duration, outputPath, copy);

      const ytdlp = spawn("yt-dlp", ytdlpArgs, { stdio: ["ignore", "pipe", "pipe"] });
      const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "ignore", "pipe"] });

      ytdlp.stdout.pipe(ffmpeg.stdin);
      ffmpeg.stdin.on("error", () => undefined);

      ytdlp.stderr.on("data", (data: Buffer) => tail.push(data, "yt-dlp"));
      ffmpeg.stderr.on("data", (data: Buffer) => tail.push(data, "ffmpeg"));

      const timer = setTimeout(() => {
        ytdlp.kill("SIGTERM");
        ffmpeg.kill("SIGTERM");
      }, timeoutMs);

      try {
        await Promise.all([waitForExit(ytdlp, "yt-dlp", tail), waitForExit(ffmpeg, "ffmpeg", tail)]);
      } catch (error) {
        ytdlp.kill("SIGTERM");
        ffmpeg.kill("SIGTERM");
        await fs.unlink(outputPath).catch(() => undefined);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };

    if (preferCopy) {
      try {
        await run(true);
        return;
      } catch {
        await run(false);
        return;
      }
    }

    await run(false);
  }
}

function buildFfmpegArgs(start: number, duration: number, outputPath: string, copy: boolean) {
  if (copy) {
    return [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-i",
      "pipe:0",
      "-ss",
      start.toFixed(3),
      "-t",
      duration.toFixed(3),
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      outputPath
    ];
  }

  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-i",
    "pipe:0",
    "-ss",
    start.toFixed(3),
    "-t",
    duration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outputPath
  ];
}

function waitForExit(proc: ReturnType<typeof spawn>, name: string, tail: LogTail) {
  return new Promise<void>((resolve, reject) => {
    proc.on("error", (error) => {
      reject(new Error(`${name} failed to start: ${error.message}`));
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${name} exited with code ${code}\n${tail.toString()}`));
    });
  });
}

function createLogTail(maxLines = 80) {
  const lines: string[] = [];
  return {
    push(chunk: Buffer, tag: string) {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        lines.push(`[${tag}] ${line}`);
        if (lines.length > maxLines) {
          lines.shift();
        }
      }
    },
    toString() {
      return lines.join("\n");
    }
  };
}

function isYoutubeUrl(input: string) {
  try {
    const url = new URL(input);
    const host = url.hostname.replace("www.", "");
    return host === "youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}
