import { promises as fs } from "node:fs";
import { ClipRecord, HighlightSegment, JobOptions, Transcript, VideoSource } from "../domain/types";
import {
  ClipRendererPort,
  HighlightDetectorPort,
  JobQueuePort,
  JobRepositoryPort,
  LoggerPort,
  StoragePort,
  StreamingHighlightDetectorPort,
  StreamingTranscriptionPort,
  SubtitlePort,
  TranscriptionPort,
  VideoSourcePort,
  YoutubeClipperPort
} from "../interfaces/ports";

export interface JobDependencies {
  repo: JobRepositoryPort;
  queue: JobQueuePort;
  source: VideoSourcePort;
  transcriber: TranscriptionPort;
  streamingTranscriber: StreamingTranscriptionPort;
  detector: HighlightDetectorPort;
  streamingDetector: StreamingHighlightDetectorPort;
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
    void processJob(job.id, deps);
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

  try {
    const updateStage = createStageUpdater(jobId, job.status, deps);
    await deps.repo.updateJob(jobId, { status: "processing", stage: "download", progress: 5, error: null });
    const source = await deps.source.resolve({ url: job.sourceUrl, uploadId: job.uploadId });
    await updateJobMetadata(jobId, source, deps);

    const streamingEnabled = process.env.ALLOW_YOUTUBE_STREAMING === "true";
    const canStream = streamingEnabled && source.type === "youtube" && !source.filePath && Boolean(source.url);

    if (canStream) {
      const transcript = await transcribeStreamAndStore(jobId, source.url!, job.options.language, deps, updateStage);
      const segments = await detectHighlightsStream(jobId, source.url!, transcript, job.options, deps, updateStage);
      if (!segments.length) {
        await renderStreamingFallbackClip(jobId, source.url!, transcript, job.options, deps, updateStage);
        await finalizeJob(jobId, deps, true);
        return;
      }

      await renderStreamingSegments(jobId, source.url!, segments, job.options, deps, transcript, updateStage);
      await finalizeJob(jobId, deps, false);
      return;
    }

    const inputPath = await resolveInputPath(jobId, source, deps);
    if (!inputPath) {
      return;
    }

    const transcript = await transcribeAndStore(jobId, inputPath, job.options.language, deps, updateStage);
    const segments = await detectHighlights(jobId, inputPath, transcript, job.options, deps, updateStage);
    if (!segments.length) {
      await renderFallbackClip(jobId, inputPath, transcript, job.options, deps, updateStage);
      await finalizeJob(jobId, deps, true);
      return;
    }

    await renderSegments(jobId, inputPath, segments, job.options, deps, updateStage);
    await finalizeJob(jobId, deps, false);
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

  const segment = { start: input.start, end: input.end, score: 1, reason: "manual" } as any;
  const clip = await deps.repo.createClip(job.id, segment);
  const streamingEnabled = process.env.ALLOW_YOUTUBE_STREAMING === "true";
  const shouldStream = Boolean(input.sourceUrl && !input.uploadId && streamingEnabled);
  const resolved = shouldStream ? null : await deps.source.resolve({ url: input.sourceUrl ?? null, uploadId: input.uploadId ?? null });
  const inputPath = resolved?.filePath ?? null;

  if (inputPath) {
    await renderClip(job.id, clip, inputPath, options, deps);
    return clip;
  }

  if (!input.sourceUrl) {
    throw new Error("No input file available for processing.");
  }
  if (!streamingEnabled) {
    throw new Error("YouTube streaming is disabled. Upload a file you own or have rights to use.");
  }

  await renderStreamingClip(job.id, clip, input.sourceUrl, input.start, input.end, options, deps, null);
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
  return `WEBVTT\n\n${srt.replaceAll(",", ".")}`;
}

type StageUpdater = (stage: string, progress: number, status?: "processing" | "ready" | "error") => Promise<void>;

function createStageUpdater(jobId: string, currentStatus: "pending" | "processing" | "ready" | "error", deps: JobDependencies): StageUpdater {
  return async (stage, progress, status) => {
    await deps.repo.updateJob(jobId, {
      stage: stage as any,
      progress,
      status: status ?? currentStatus
    });
  };
}

async function updateJobMetadata(jobId: string, source: VideoSource, deps: JobDependencies) {
  await deps.repo.updateJob(jobId, {
    metadata: {
      title: source.title ?? null,
      provider: source.provider ?? null,
      url: source.url ?? null
    }
  });
}

async function resolveInputPath(jobId: string, source: VideoSource, deps: JobDependencies) {
  if (source.type === "youtube" && !source.filePath) {
    await deps.logger.warn(jobId, "YouTube downloads disabled. Ask user to upload a file.");
    await deps.repo.updateJob(jobId, {
      status: "error",
      stage: "error",
      progress: 0,
      error: "YouTube downloads are disabled. Upload a file you own or have rights to use."
    });
    return null;
  }

  if (!source.filePath) {
    await deps.repo.updateJob(jobId, {
      status: "error",
      stage: "error",
      progress: 0,
      error: "No input file available for processing."
    });
    return null;
  }

  return source.filePath;
}

async function transcribeAndStore(
  jobId: string,
  inputPath: string,
  language: string,
  deps: JobDependencies,
  updateStage: StageUpdater
) {
  await deps.logger.info(jobId, "Starting transcription.");
  await updateStage("transcribe", 20, "processing");
  const transcript = await deps.transcriber.transcribe(inputPath, language, jobId);
  const jobDir = await deps.storage.ensureJobDir(jobId);
  await deps.storage.writeFile(`${jobDir}/transcript.json`, Buffer.from(JSON.stringify(transcript, null, 2)));
  return transcript;
}

async function transcribeStreamAndStore(
  jobId: string,
  sourceUrl: string,
  language: string,
  deps: JobDependencies,
  updateStage: StageUpdater
) {
  await deps.logger.info(jobId, "Starting streaming transcription.");
  await updateStage("transcribe", 20, "processing");
  const transcript = await deps.streamingTranscriber.transcribeStream({ url: sourceUrl, language, jobId });
  const jobDir = await deps.storage.ensureJobDir(jobId);
  await deps.storage.writeFile(`${jobDir}/transcript.json`, Buffer.from(JSON.stringify(transcript, null, 2)));
  return transcript;
}

async function detectHighlights(
  jobId: string,
  inputPath: string,
  transcript: Transcript,
  options: JobOptions,
  deps: JobDependencies,
  updateStage: StageUpdater
) {
  await deps.logger.info(jobId, "Detecting highlights.");
  await updateStage("highlights", 40, "processing");
  return deps.detector.detect({
    inputPath,
    transcript,
    clipCount: options.clipCount,
    durationPreset: options.durationPreset
  });
}

async function detectHighlightsStream(
  jobId: string,
  sourceUrl: string,
  transcript: Transcript,
  options: JobOptions,
  deps: JobDependencies,
  updateStage: StageUpdater
) {
  await deps.logger.info(jobId, "Detecting highlights (streaming).");
  await updateStage("highlights", 40, "processing");
  return deps.streamingDetector.detectStream({
    url: sourceUrl,
    transcript,
    clipCount: options.clipCount,
    durationPreset: options.durationPreset
  });
}

async function renderFallbackClip(
  jobId: string,
  inputPath: string,
  transcript: Transcript,
  options: JobOptions,
  deps: JobDependencies,
  updateStage: StageUpdater
) {
  const totalDuration = transcript.segments.at(-1)?.end ?? 0;
  const { min, max } = getDurationBounds(options.durationPreset);
  const fallbackLength = Math.min(max, Math.max(min, totalDuration || min));
  const fallbackStart = 0;
  const fallbackEnd = Math.min(totalDuration || fallbackLength, fallbackLength);
  const fallbackSegment = { start: fallbackStart, end: fallbackEnd, score: 0.5, reason: "fallback" } as HighlightSegment;
  const clip = await deps.repo.createClip(jobId, fallbackSegment);
  await deps.logger.warn(jobId, "Detector returned no segments. Using fallback clip.");
  await deps.logger.info(jobId, "Rendering clips.");
  await updateStage("render", 70, "processing");
  await renderClip(jobId, clip, inputPath, options, deps);
}

async function renderStreamingFallbackClip(
  jobId: string,
  sourceUrl: string,
  transcript: Transcript,
  options: JobOptions,
  deps: JobDependencies,
  updateStage: StageUpdater
) {
  const totalDuration = transcript.segments.at(-1)?.end ?? 0;
  const { min, max } = getDurationBounds(options.durationPreset);
  const fallbackLength = Math.min(max, Math.max(min, totalDuration || min));
  const fallbackStart = 0;
  const fallbackEnd = Math.min(totalDuration || fallbackLength, fallbackLength);
  const fallbackSegment = { start: fallbackStart, end: fallbackEnd, score: 0.5, reason: "fallback" } as HighlightSegment;
  const clip = await deps.repo.createClip(jobId, fallbackSegment);
  await deps.logger.warn(jobId, "Detector returned no segments. Using fallback clip.");
  await deps.logger.info(jobId, "Rendering clips (streaming).");
  await updateStage("render", 70, "processing");
  await renderStreamingClip(jobId, clip, sourceUrl, fallbackStart, fallbackEnd, options, deps, transcript);
}

async function renderSegments(
  jobId: string,
  inputPath: string,
  segments: HighlightSegment[],
  options: JobOptions,
  deps: JobDependencies,
  updateStage: StageUpdater
) {
  const clips: ClipRecord[] = [];
  for (const segment of segments) {
    const clip = await deps.repo.createClip(jobId, segment);
    clips.push(clip);
  }

  await deps.logger.info(jobId, "Rendering clips.");
  await updateStage("render", 70, "processing");
  for (const [index, clip] of clips.entries()) {
    await renderClip(jobId, clip, inputPath, options, deps);
    const progress = Math.min(99, 70 + Math.round(((index + 1) / clips.length) * 29));
    await deps.repo.updateJob(jobId, { progress });
  }
}

async function renderStreamingSegments(
  jobId: string,
  sourceUrl: string,
  segments: HighlightSegment[],
  options: JobOptions,
  deps: JobDependencies,
  transcript: Transcript,
  updateStage: StageUpdater
) {
  const clips: ClipRecord[] = [];
  for (const segment of segments) {
    const clip = await deps.repo.createClip(jobId, segment);
    clips.push(clip);
  }

  await deps.logger.info(jobId, "Rendering clips (streaming).");
  await updateStage("render", 70, "processing");
  for (const [index, clip] of clips.entries()) {
    await renderStreamingClip(jobId, clip, sourceUrl, clip.start, clip.end, options, deps, transcript);
    const progress = Math.min(99, 70 + Math.round(((index + 1) / clips.length) * 29));
    await deps.repo.updateJob(jobId, { progress });
  }
}

async function finalizeJob(jobId: string, deps: JobDependencies, clearError: boolean) {
  await deps.repo.updateJob(jobId, {
    status: "ready",
    stage: "ready",
    progress: 100,
    error: clearError ? null : undefined
  });
  await deps.logger.info(jobId, "Job ready.");
}

function getDurationBounds(preset: JobOptions["durationPreset"]) {
  if (preset === "short") {
    return { min: 12, max: 22 };
  }
  if (preset === "long") {
    return { min: 30, max: 45 };
  }
  return { min: 18, max: 32 };
}

async function renderStreamingClip(
  jobId: string,
  clip: ClipRecord,
  sourceUrl: string,
  start: number,
  end: number,
  options: JobOptions,
  deps: JobDependencies,
  transcript: Transcript | null
) {
  const jobDir = await deps.storage.ensureJobDir(jobId);
  const rawPath = `${jobDir}/stream-${clip.id}.mp4`;
  const videoPath = `${jobDir}/clip-${clip.id}.mp4`;
  const srtPath = `${jobDir}/clip-${clip.id}.srt`;
  const vttPath = `${jobDir}/clip-${clip.id}.vtt`;
  const burnSubtitles = options.subtitles === "burned";
  let subtitleFile: string | null = null;

  await deps.repo.updateClip(clip.id, { status: "rendering" });
  await deps.logger.info(jobId, "Streaming YouTube clip with yt-dlp.");
  try {
    const maxHeight = parsePositiveInt(process.env.YT_MAX_HEIGHT, 720);
    const timeoutMs = parsePositiveInt(process.env.YT_CLIP_TIMEOUT_MS, 300000);
    await deps.youtubeClipper.clip({
      url: sourceUrl,
      start,
      end,
      outputPath: rawPath,
      maxHeight,
      timeoutMs,
      preferCopy: true
    });

    if (options.subtitles !== "off") {
      const subtitleTranscript =
        transcript ??
        (await deps.streamingTranscriber.transcribeStream({
          url: sourceUrl,
          start,
          end,
          language: options.language,
          jobId
        }));
      const sliced = deps.subtitles.sliceTranscript(subtitleTranscript, start, end);
      const srt = deps.subtitles.toSrt(sliced);
      await deps.storage.writeFile(srtPath, Buffer.from(srt));
      const vtt = srtToVtt(srt);
      await deps.storage.writeFile(vttPath, Buffer.from(vtt));
      subtitleFile = srtPath;
    }

    const duration = Math.max(0.1, end - start);
    await deps.renderer.render({
      inputPath: rawPath,
      outputPath: videoPath,
      start: 0,
      end: duration,
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
  } catch (error) {
    await deps.repo.updateClip(clip.id, { status: "error" });
    throw error;
  } finally {
    await fs.unlink(rawPath).catch(() => undefined);
  }
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
