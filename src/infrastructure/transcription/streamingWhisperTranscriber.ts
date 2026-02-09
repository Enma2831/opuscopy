import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { StreamingTranscriptionPort } from "../../interfaces/ports";
import { Transcript } from "../../domain/types";
import { parseSrt } from "./srt";

type LogTail = ReturnType<typeof createLogTail>;

export class StreamingWhisperTranscriber implements StreamingTranscriptionPort {
  constructor(private outputDir: string) {}

  async transcribeStream(options: {
    url: string;
    language: string;
    jobId: string;
    start?: number;
    end?: number;
  }): Promise<Transcript> {
    const provider = process.env.WHISPER_PROVIDER ?? "mock";
    if (provider === "mock") {
      return {
        language: options.language,
        segments: [
          { start: 0, end: 6, text: "ClipForge demo transcript." },
          { start: 6, end: 14, text: "Replace this with Whisper output." }
        ]
      };
    }

    if (!isYoutubeUrl(options.url)) {
      throw new Error("Only youtube.com or youtu.be links are allowed.");
    }

    const cmd = process.env.WHISPER_CMD ?? "whisper";
    const model = process.env.WHISPER_MODEL ?? "base";
    const device = process.env.WHISPER_DEVICE ?? "cpu";
    if (device === "cpu") {
      console.warn("Whisper running on CPU. Expect slower transcription.");
    }

    const jobDir = path.join(this.outputDir, options.jobId);
    await fs.mkdir(jobDir, { recursive: true });

    const stamp = Date.now().toString(36);
    const wavPath = path.join(jobDir, `stream-${stamp}.wav`);
    const timeoutMs = parsePositiveInt(process.env.YT_CLIP_TIMEOUT_MS, 600000);

    const ytdlpArgs = buildYtdlpArgs(options.url, options.start, options.end);
    const ffmpegArgs = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-i",
      "pipe:0",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      wavPath
    ];

    const tail = createLogTail();
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
      await fs.unlink(wavPath).catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const args = [
      wavPath,
      "--model",
      model,
      "--language",
      options.language,
      "--output_format",
      "srt",
      "--output_dir",
      jobDir
    ];
    if (process.env.WHISPER_DEVICE) {
      args.push("--device", device);
    }

    let transcript: Transcript;
    const srtPath = path.join(jobDir, path.basename(wavPath) + ".srt");
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: "inherit" });
        proc.on("error", reject);
        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Whisper exited with code ${code}`));
          }
        });
      });

      const srt = await fs.readFile(srtPath, "utf-8");
      transcript = parseSrt(srt, options.language);
    } finally {
      await fs.unlink(wavPath).catch(() => undefined);
      await fs.unlink(srtPath).catch(() => undefined);
    }

    const offset = options.start ?? 0;
    if (!offset) {
      return transcript;
    }

    return {
      language: transcript.language,
      segments: transcript.segments.map((segment) => ({
        ...segment,
        start: segment.start + offset,
        end: segment.end + offset
      }))
    };
  }
}

function buildYtdlpArgs(url: string, start?: number, end?: number) {
  const args = [
    "-f",
    "bestaudio",
    "--no-playlist",
    "--no-part",
    "--newline",
    "--concurrent-fragments",
    "1",
    "-o",
    "-",
    url
  ];

  if (Number.isFinite(start) && Number.isFinite(end) && (end as number) > (start as number)) {
    const window = `${formatTime(start as number)}-${formatTime(end as number)}`;
    args.unshift("--download-sections", `*${window}`);
  }

  return args;
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
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

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
