import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { VideoSource } from "../../domain/types";
import { VideoSourcePort } from "../../interfaces/ports";

export class VideoSourceResolver implements VideoSourcePort {
  constructor(private uploadsDir: string) {}

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
        filePath = path.join(jobsDir, `yt-${safeName}.mp4`);
        const exists = await fileExists(filePath);
        if (!exists) {
          await downloadYoutubeWithYtdlp(options.url, filePath);
        }
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
    const args = ["-o", outPath, "--recode-video", "mp4", url];
    const proc = spawn("yt-dlp", args, { stdio: "ignore" });
    proc.on("error", () => reject(new Error("yt-dlp not found or failed to start. Please install yt-dlp.")));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("Failed to download YouTube video with yt-dlp."));
      }
    });
  });
}
