import { EnergySample } from "../../application/highlightScoring";

export async function analyzeAudioEnergy(inputPath: string): Promise<EnergySample[]> {
  const duration = await probeDuration(inputPath);
  const silences = await detectSilence(inputPath);
  const samples: EnergySample[] = [];
  const total = Math.ceil(duration);
  for (let t = 0; t <= total; t += 1) {
    const silent = silences.some((interval) => t >= interval.start && t <= interval.end);
    samples.push({ t, value: silent ? 0.12 : 0.72 });
  }
  return samples;
}

async function probeDuration(inputPath: string) {
  const { spawn } = await import("node:child_process");
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath
  ];
  return new Promise<number>((resolve, reject) => {
    let output = "";
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (data) => (output += data.toString()));
    proc.stderr.on("data", (data) => (output += data.toString()));
    proc.on("error", (error) => reject(new Error(`ffprobe failed to start: ${error.message}`)));
    proc.on("close", (code) => {
      if (code === 0) {
        const value = Number.parseFloat(output.trim());
        resolve(Number.isFinite(value) ? value : 0);
      } else {
        reject(new Error(buildFfprobeError(output, code)));
      }
    });
  });
}

async function detectSilence(inputPath: string) {
  const { spawn } = await import("node:child_process");
  const args = [
    "-i",
    inputPath,
    "-af",
    "silencedetect=n=-30dB:d=0.35",
    "-f",
    "null",
    "-"
  ];

  return new Promise<{ start: number; end: number }[]>((resolve, reject) => {
    const silences: { start: number; end: number }[] = [];
    let currentStart: number | null = null;
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      const startMatch = text.match(/silence_start: ([0-9.]+)/);
      if (startMatch) {
        currentStart = Number.parseFloat(startMatch[1]);
      }
      const endMatch = text.match(/silence_end: ([0-9.]+)/);
      if (endMatch && currentStart !== null) {
        const end = Number.parseFloat(endMatch[1]);
        silences.push({ start: currentStart, end });
        currentStart = null;
      }
    });
    proc.on("error", reject);
    proc.on("close", () => resolve(silences));
  });
}

function buildFfprobeError(output: string, code: number | null) {
  const summary = output.trim().replaceAll(/\s+/g, " ");
  const exitCode = code ?? "unknown";
  const suffix = summary ? ` ${summary}` : "";
  return `ffprobe failed (exit ${exitCode}).${suffix}`;
}
