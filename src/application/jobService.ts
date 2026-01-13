import { ClipRecord, JobOptions } from "../domain/types";
import { ClipRendererPort, HighlightDetectorPort, JobQueuePort, JobRepositoryPort, LoggerPort, StoragePort, SubtitlePort, TranscriptionPort, VideoSourcePort } from "../interfaces/ports";

export interface JobDependencies {
  repo: JobRepositoryPort;
  queue: JobQueuePort;
  source: VideoSourcePort;
  transcriber: TranscriptionPort;
  detector: HighlightDetectorPort;
  renderer: ClipRendererPort;
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
  await deps.queue.enqueueJob(job.id);
  await deps.logger.info(job.id, "Job queued.");
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
      await deps.repo.updateJob(jobId, {
        status: "error",
        stage: "error",
        progress: 0,
        error: "No highlights detected. Try a different input or duration preset."
      });
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
