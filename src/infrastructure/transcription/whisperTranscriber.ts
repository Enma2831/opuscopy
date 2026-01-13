import path from "path";
import { promises as fs } from "fs";
import { TranscriptionPort } from "../../interfaces/ports";
import { Transcript } from "../../domain/types";
import { parseSrt } from "./srt";

export class WhisperTranscriber implements TranscriptionPort {
  constructor(private outputDir: string) {}

  async transcribe(inputPath: string, language: string, jobId: string): Promise<Transcript> {
    const provider = process.env.WHISPER_PROVIDER ?? "mock";
    if (provider === "mock") {
      return {
        language,
        segments: [
          { start: 0, end: 6, text: "ClipForge demo transcript." },
          { start: 6, end: 14, text: "Replace this with Whisper output." }
        ]
      };
    }

    const cmd = process.env.WHISPER_CMD ?? "whisper";
    const model = process.env.WHISPER_MODEL ?? "base";
    const device = process.env.WHISPER_DEVICE ?? "cpu";
    if (device === "cpu") {
      console.warn("Whisper running on CPU. Expect slower transcription.");
    }
    const jobDir = path.join(this.outputDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    const args = [
      inputPath,
      "--model",
      model,
      "--language",
      language,
      "--output_format",
      "srt",
      "--output_dir",
      jobDir
    ];
    if (process.env.WHISPER_DEVICE) {
      args.push("--device", device);
    }

    const { spawn } = await import("child_process");
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

    const srtPath = path.join(jobDir, path.basename(inputPath) + ".srt");
    const srt = await fs.readFile(srtPath, "utf-8");
    return parseSrt(srt, language);
  }
}
