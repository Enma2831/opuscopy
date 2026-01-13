import path from "path";
import { LocalStorage } from "./storage/localStorage";
import { RedisQueue } from "./queue/redisQueue";
import { PrismaJobRepository } from "./repo/jobRepository";
import { LocalLogger } from "./logger/localLogger";
import { WhisperTranscriber } from "./transcription/whisperTranscriber";
import { HybridHighlightDetector } from "./highlights/hybridHighlightDetector";
import { FfmpegRenderer } from "./render/ffmpegRenderer";
import { VideoSourceResolver } from "./video/videoSource";
import { SubtitleService } from "./transcription/subtitles";
import { JobDependencies } from "../application/jobService";

let cached: JobDependencies | null = null;

export function getDependencies(): JobDependencies {
  if (cached) {
    return cached;
  }

  const storageBase = process.env.STORAGE_PATH ?? path.join(process.cwd(), "storage");
  const uploadsDir = path.join(storageBase, "uploads");
  const logsDir = process.env.LOGS_PATH ?? path.join(process.cwd(), "logs");
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  cached = {
    repo: new PrismaJobRepository(),
    queue: new RedisQueue(redisUrl),
    source: new VideoSourceResolver(uploadsDir),
    transcriber: new WhisperTranscriber(path.join(storageBase, "jobs")),
    detector: new HybridHighlightDetector(),
    renderer: new FfmpegRenderer(),
    storage: new LocalStorage(storageBase),
    subtitles: new SubtitleService(),
    logger: new LocalLogger(logsDir)
  };

  return cached;
}
