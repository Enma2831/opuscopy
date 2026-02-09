import { ClipRecord, HighlightSegment, JobOptions, JobRecord, Transcript, VideoSource } from "../domain/types";

export interface VideoSourcePort {
  resolve(options: { url?: string | null; uploadId?: string | null }): Promise<VideoSource>;
}

export interface TranscriptionPort {
  transcribe(inputPath: string, language: string, jobId: string): Promise<Transcript>;
}

export interface StreamingTranscriptionPort {
  transcribeStream(options: {
    url: string;
    language: string;
    jobId: string;
    start?: number;
    end?: number;
  }): Promise<Transcript>;
}

export interface HighlightDetectorPort {
  detect(options: {
    inputPath: string;
    transcript?: Transcript | null;
    clipCount: number;
    durationPreset: JobOptions["durationPreset"];
  }): Promise<HighlightSegment[]>;
}

export interface StreamingHighlightDetectorPort {
  detectStream(options: {
    url: string;
    transcript?: Transcript | null;
    clipCount: number;
    durationPreset: JobOptions["durationPreset"];
  }): Promise<HighlightSegment[]>;
}

export interface ClipRendererPort {
  render(options: {
    inputPath: string;
    outputPath: string;
    start: number;
    end: number;
    burnSubtitles: boolean;
    subtitlesPath?: string | null;
    smartCrop: boolean;
  }): Promise<void>;
}

export interface YoutubeClipperPort {
  clip(options: {
    url: string;
    start: number;
    end: number;
    outputPath: string;
    maxHeight?: number;
    timeoutMs?: number;
    preferCopy?: boolean;
  }): Promise<void>;
}

export interface StoragePort {
  ensureJobDir(jobId: string): Promise<string>;
  writeFile(path: string, data: Buffer): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  resolvePath(path: string): string;
}

export interface JobQueuePort {
  enqueueJob(jobId: string): Promise<void>;
  enqueueClipRerender(options: {
    jobId: string;
    clipId: string;
    start: number;
    end: number;
    burnSubtitles: boolean;
    smartCrop: boolean;
  }): Promise<void>;
}

export interface JobRepositoryPort {
  createJob(options: {
    sourceType: string;
    sourceUrl?: string | null;
    uploadId?: string | null;
    options: JobOptions;
  }): Promise<JobRecord>;
  updateJob(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord>;
  getJob(jobId: string): Promise<JobRecord | null>;
  createClip(jobId: string, segment: HighlightSegment): Promise<ClipRecord>;
  updateClip(clipId: string, patch: Partial<ClipRecord>): Promise<ClipRecord>;
  listClips(jobId: string): Promise<ClipRecord[]>;
  getClip(clipId: string): Promise<ClipRecord | null>;
}

export interface LoggerPort {
  info(jobId: string, message: string): Promise<void>;
  warn(jobId: string, message: string): Promise<void>;
  error(jobId: string, message: string): Promise<void>;
}

export interface SubtitlePort {
  toSrt(transcript: Transcript): string;
  sliceTranscript(transcript: Transcript, start: number, end: number): Transcript;
}
