import { ClipRendererPort } from "../../interfaces/ports";

export class FfmpegRenderer implements ClipRendererPort {
  async render(options: {
    inputPath: string;
    outputPath: string;
    start: number;
    end: number;
    burnSubtitles: boolean;
    subtitlesPath?: string | null;
    smartCrop: boolean;
  }): Promise<void> {
    const duration = Math.max(0.1, options.end - options.start);
    const { width, height } = await probeVideo(options.inputPath);
    const crop = buildCrop(width, height);
    const filters = [
      `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
      "scale=1080:1920",
      "fps=30",
      "setsar=1"
    ];

    if (options.burnSubtitles && options.subtitlesPath) {
      filters.push(buildSubtitleFilter(options.subtitlesPath));
    }

    const loudnorm = process.env.FFMPEG_LOUDNORM === "1";
    const audioFilter = loudnorm ? "loudnorm=I=-14:TP=-1.5:LRA=11" : "volume=1.0";

    const args = [
      "-y",
      "-ss",
      options.start.toFixed(2),
      "-i",
      options.inputPath,
      "-t",
      duration.toFixed(2),
      "-vf",
      filters.join(","),
      "-af",
      audioFilter,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      "4000k",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      options.outputPath
    ];

    await runFfmpeg(args);
  }
}

async function probeVideo(inputPath: string) {
  const { spawn } = await import("node:child_process");
  const args = ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", inputPath];
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    let output = "";
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (data) => (output += data.toString()));
    proc.stderr.on("data", (data) => (output += data.toString()));
    proc.on("error", (error) => reject(new Error(`ffprobe failed to start: ${error.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(buildFfprobeError(output, code)));
        return;
      }
      try {
        const json = JSON.parse(output);
        const stream = json.streams?.[0] ?? {};
        resolve({
          width: stream.width ?? 1920,
          height: stream.height ?? 1080
        });
      } catch {
        const summary = summarizeFfprobeOutput(output);
        const suffix = summary ? ` ${summary}` : "";
        reject(new Error(`ffprobe returned invalid JSON.${suffix}`));
      }
    });
  });
}

function buildCrop(width: number, height: number) {
  const targetWidth = Math.min(width, Math.floor((height * 9) / 16));
  const x = Math.max(0, Math.floor((width - targetWidth) / 2));
  return { width: targetWidth, height, x, y: 0 };
}

function buildSubtitleFilter(path: string) {
  const escaped = escapeForFfmpeg(path);
  const style = "Fontsize=48,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=3,Outline=2,Shadow=1,Alignment=2,MarginV=120";
  return `subtitles='${escaped}':force_style='${style}'`;
}

function escapeForFfmpeg(value: string) {
  return value.replaceAll("\\", String.raw`\\`).replaceAll(":", String.raw`\:`);
}

async function runFfmpeg(args: string[]) {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

function buildFfprobeError(output: string, code: number | null) {
  const summary = summarizeFfprobeOutput(output);
  const exitCode = code ?? "unknown";
  const suffix = summary ? ` ${summary}` : "";
  return `ffprobe failed (exit ${exitCode}).${suffix}`;
}

function summarizeFfprobeOutput(output: string) {
  return output.trim().replaceAll(/\s+/g, " ");
}
