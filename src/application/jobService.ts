import { ClipRecord, JobOptions } from "../domain/types";
import { ClipRendererPort, HighlightDetectorPort, JobQueuePort, JobRepositoryPort, LoggerPort, StoragePort, SubtitlePort, TranscriptionPort, VideoSourcePort, YoutubeClipperPort } from "../interfaces/ports";

export interface JobDependencies {
  repo: JobRepositoryPort;
  queue: JobQueuePort;
  source: VideoSourcePort;
  transcriber: TranscriptionPort;
  detector: HighlightDetectorPort;
  renderer: ClipRendererPort;
  youtubeClipper: YoutubeClipperPort;
  storage: StoragePort;
  subtitles: SubtitlePort;
  logger: LoggerPort;
}

export async function createJob(
  input: {
    sourceType: "youtube" | "upload";
    sourceUrl?: string | null;
    uploadId?: string | null;
    options: JobOptions;
  },
  deps: JobDependencies
) {
  const job = await deps.repo.createJob({
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl ?? null,
    uploadId: input.uploadId ?? null,
    options: input.options
  });
  if (process.env.RUN_INLINE === "true" || process.env.NODE_ENV === "development") {
    await deps.logger.info(job.id, "Inline processing enabled. Starting immediately.");
    await processJob(job.id, deps);
  } else {
    await deps.queue.enqueueJob(job.id);
    await deps.logger.info(job.id, "Job queued.");
  }
  return job;
}

export async function processJob(jobId: string, deps: JobDependencies) {
  const job = await deps.repo.getJob(jobId);
  if (!job) {
    return;
  }

  const updateStage = async (stage: string, progress: number, status?: "processing" | "ready" | "error") => {
    await deps.repo.updateJob(jobId, {
      stage: stage as any,
      progress,
      status: status ?? job.status
    });
  };

  try {
    await deps.repo.updateJob(jobId, { status: "processing", stage: "download", progress: 5, error: null });
    const source = await deps.source.resolve({ url: job.sourceUrl, uploadId: job.uploadId });

    await deps.repo.updateJob(jobId, {
      metadata: {
        title: source.title ?? null,
        provider: source.provider ?? null,
        url: source.url ?? null
      }
    });

    if (source.type === "youtube" && !source.filePath) {
      await deps.logger.warn(jobId, "YouTube downloads disabled. Ask user to upload a file.");
      await deps.repo.updateJob(jobId, {
        status: "error",
        stage: "error",
        progress: 0,
        error: "YouTube downloads are disabled. Upload a file you own or have rights to use."
      });
      return;
    }

    if (!source.filePath) {
      await deps.repo.updateJob(jobId, {
        status: "error",
        stage: "error",
        progress: 0,
        error: "No input file available for processing."
      });
      return;
    }

    await deps.logger.info(jobId, "Starting transcription.");
    await updateStage("transcribe", 20, "processing");
    const transcript = await deps.transcriber.transcribe(source.filePath, job.options.language, jobId);
    const jobDir = await deps.storage.ensureJobDir(jobId);
    await deps.storage.writeFile(`${jobDir}/transcript.json`, Buffer.from(JSON.stringify(transcript, null, 2)));

    await deps.logger.info(jobId, "Detecting highlights.");
    await updateStage("highlights", 40, "processing");
    const segments = await deps.detector.detect({
      inputPath: source.filePath,
      transcript,
      clipCount: job.options.clipCount,
      durationPreset: job.options.durationPreset
    });

    if (!segments.length) {
      const totalDuration = transcript.segments[transcript.segments.length - 1]?.end ?? 0;
      const { min, max } = { min: job.options.durationPreset === "short" ? 12 : job.options.durationPreset === "long" ? 30 : 18, max: job.options.durationPreset === "short" ? 22 : job.options.durationPreset === "long" ? 45 : 32 };
      const fallbackLength = Math.min(max, Math.max(min, totalDuration || min));
      const fallbackStart = 0;
      const fallbackEnd = Math.min(totalDuration || fallbackLength, fallbackLength);
      const fallbackSegment = { start: fallbackStart, end: fallbackEnd, score: 0.5, reason: "fallback" } as any;
      const clip = await deps.repo.createClip(job.id, fallbackSegment);
      await deps.logger.warn(job.id, "Detector returned no segments. Using fallback clip.");
      await deps.logger.info(job.id, "Rendering clips.");
      await updateStage("render", 70, "processing");
      await renderClip(job.id, clip, source.filePath, job.options, deps);
      await deps.repo.updateJob(job.id, { status: "ready", stage: "ready", progress: 100, error: null });
      await deps.logger.info(job.id, "Job ready.");
      return;
    }

    const clips: ClipRecord[] = [];
    for (const segment of segments) {
      const clip = await deps.repo.createClip(jobId, segment);
      clips.push(clip);
    }

    await deps.logger.info(jobId, "Rendering clips.");
    await updateStage("render", 70, "processing");
    for (const [index, clip] of clips.entries()) {
      await renderClip(jobId, clip, source.filePath, job.options, deps);
      const progress = Math.min(99, 70 + Math.round(((index + 1) / clips.length) * 29));
      await deps.repo.updateJob(jobId, { progress });
    }

    await deps.repo.updateJob(jobId, { status: "ready", stage: "ready", progress: 100 });
    await deps.logger.info(jobId, "Job ready.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await deps.logger.error(jobId, message);
    await deps.repo.updateJob(jobId, { status: "error", stage: "error", progress: 0, error: message });
  }
}

export async function renderClip(
  jobId: string,
  clip: ClipRecord,
  inputPath: string,
  options: JobOptions,
  deps: JobDependencies
) {
  const jobDir = await deps.storage.ensureJobDir(jobId);
  const videoPath = `${jobDir}/clip-${clip.id}.mp4`;
  const srtPath = `${jobDir}/clip-${clip.id}.srt`;
  const vttPath = `${jobDir}/clip-${clip.id}.vtt`;
  const burnSubtitles = options.subtitles === "burned";
  let subtitleFile: string | null = null;

  await deps.repo.updateClip(clip.id, { status: "rendering" });

  if (options.subtitles !== "off") {
    const transcriptBuffer = await deps.storage.readFile(`${jobDir}/transcript.json`);
    const transcript = JSON.parse(transcriptBuffer.toString("utf-8"));
    const sliced = deps.subtitles.sliceTranscript(transcript, clip.start, clip.end);
    const srt = deps.subtitles.toSrt(sliced);
    await deps.storage.writeFile(srtPath, Buffer.from(srt));
    const vtt = srtToVtt(srt);
    await deps.storage.writeFile(vttPath, Buffer.from(vtt));
    subtitleFile = srtPath;
  }

  await deps.renderer.render({
    inputPath,
    outputPath: videoPath,
    start: clip.start,
    end: clip.end,
    burnSubtitles,
    subtitlesPath: subtitleFile,
    smartCrop: options.smartCrop
  });

  await deps.repo.updateClip(clip.id, {
    status: "ready",
    videoPath,
    srtPath: options.subtitles === "off" ? null : srtPath,
    vttPath: options.subtitles === "off" ? null : vttPath
  });
}

export async function rerenderClip(
  input: {
    jobId: string;
    clipId: string;
    start: number;
    end: number;
    options: JobOptions;
  },
  deps: JobDependencies
) {
  const job = await deps.repo.getJob(input.jobId);
  if (!job) {
    return;
  }
  const clip = await deps.repo.getClip(input.clipId);
  if (!clip) {
    return;
  }
  await deps.repo.updateClip(input.clipId, { start: input.start, end: input.end });
  await deps.logger.info(input.jobId, `Re-render clip ${input.clipId}.`);
  await renderClip(input.jobId, { ...clip, start: input.start, end: input.end }, getInputPath(job), input.options, deps);
}

export async function generateClip(
  input: {
    sourceUrl?: string | null;
    uploadId?: string | null;
    start: number;
    end: number;
    options: Partial<JobOptions>;
  },
  deps: JobDependencies
) {
  const options: JobOptions = {
    language: input.options.language ?? "en",
    clipCount: 1,
    durationPreset: input.options.durationPreset ?? "normal",
    subtitles: input.options.subtitles ?? "off",
    smartCrop: input.options.smartCrop ?? false
  };

  const sourceType = input.uploadId ? "upload" : "youtube";
  const job = await deps.repo.createJob({
    sourceType,
    sourceUrl: input.sourceUrl ?? null,
    uploadId: input.uploadId ?? null,
    options
  });

  const streamingEnabled = process.env.ALLOW_YOUTUBE_STREAMING === "true";
  const shouldStream = Boolean(input.sourceUrl && !input.uploadId && streamingEnabled);
  const resolved = shouldStream ? null : await deps.source.resolve({ url: input.sourceUrl ?? null, uploadId: input.uploadId ?? null });
  const inputPath = resolved?.filePath ?? null;

  const segment = { start: input.start, end: input.end, score: 1, reason: "manual" } as any;
  const clip = await deps.repo.createClip(job.id, segment);
  if (!inputPath) {
    if (!input.sourceUrl) {
      throw new Error("No input file available for processing.");
    }
    if (!streamingEnabled) {
      throw new Error("YouTube streaming is disabled. Upload a file you own or have rights to use.");
    }

    const jobDir = await deps.storage.ensureJobDir(job.id);
    const videoPath = `${jobDir}/clip-${clip.id}.mp4`;
    await deps.repo.updateClip(clip.id, { status: "rendering" });
    await deps.logger.info(job.id, "Streaming YouTube clip with yt-dlp.");
    try {
      const maxHeight = Number.parseInt(process.env.YT_MAX_HEIGHT ?? "720", 10);
      const timeoutMs = Number.parseInt(process.env.YT_CLIP_TIMEOUT_MS ?? "300000", 10);
      const safeHeight = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : 720;
      const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300000;
      await deps.youtubeClipper.clip({
        url: input.sourceUrl,
        start: input.start,
        end: input.end,
        outputPath: videoPath,
        maxHeight: safeHeight,
        timeoutMs: safeTimeout,
        preferCopy: true
      });
      await deps.repo.updateClip(clip.id, {
        status: "ready",
        videoPath,
        srtPath: null,
        vttPath: null
      });
    } catch (error) {
      await deps.repo.updateClip(clip.id, { status: "error" });
      throw error;
    }
    return clip;
  }

  await renderClip(job.id, clip, inputPath, options, deps);
  return clip;
}

export async function generateClipsFromVideo(
  input: {
    sourceUrl?: string | null;
    uploadId?: string | null;
    options: JobOptions;
  },
  deps: JobDependencies
) {
  const sourceType = input.uploadId ? "upload" : "youtube";
  const job = await deps.repo.createJob({
    sourceType,
    sourceUrl: input.sourceUrl ?? null,
    uploadId: input.uploadId ?? null,
    options: input.options
  });

  const resolved = await deps.source.resolve({ url: input.sourceUrl ?? null, uploadId: input.uploadId ?? null });
  if (!resolved.filePath) {
    throw new Error("No input file available for processing.");
  }

  const transcript = await deps.transcriber.transcribe(resolved.filePath, input.options.language, job.id);
  const jobDir = await deps.storage.ensureJobDir(job.id);
  await deps.storage.writeFile(`${jobDir}/transcript.json`, Buffer.from(JSON.stringify(transcript, null, 2)));

  const segments = await deps.detector.detect({
    inputPath: resolved.filePath,
    transcript,
    clipCount: input.options.clipCount,
    durationPreset: input.options.durationPreset
  });

  const clips: ClipRecord[] = [];
  for (const segment of segments) {
    const clip = await deps.repo.createClip(job.id, segment);
    await renderClip(job.id, clip, resolved.filePath, input.options, deps);
    clips.push(clip);
  }

  await deps.repo.updateJob(job.id, { status: "ready", stage: "ready", progress: 100 });
  return { jobId: job.id, clips };
}

function getInputPath(job: { uploadId?: string | null }) {
  if (!job.uploadId) {
    throw new Error("Missing uploadId for re-render.");
  }
  const base = process.env.STORAGE_PATH ?? `${process.cwd()}/storage`;
  return `${base}/uploads/${job.uploadId}`;
}

function srtToVtt(srt: string) {
  return `WEBVTT\n\n${srt.replace(/,/g, ".")}`;
}
