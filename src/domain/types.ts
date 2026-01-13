export type SourceType = "youtube" | "upload";
export type JobStage =
  | "queued"
  | "download"
  | "transcribe"
  | "highlights"
  | "render"
  | "ready"
  | "error";
export type JobStatus = "pending" | "processing" | "ready" | "error";

export interface VideoSource {
  type: SourceType;
  url?: string | null;
  filePath?: string | null;
  title?: string | null;
  durationSec?: number | null;
  provider?: string | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  language: string;
  segments: TranscriptSegment[];
}

export interface HighlightSegment {
  start: number;
  end: number;
  score: number;
  reason: string;
}

export interface ClipAsset {
  clipId: string;
  videoPath: string;
  srtPath?: string | null;
  vttPath?: string | null;
}

export interface JobOptions {
  language: string;
  clipCount: number;
  durationPreset: "short" | "normal" | "long";
  subtitles: "off" | "srt" | "burned";
  smartCrop: boolean;
}

export interface JobRecord {
  id: string;
  sourceType: SourceType;
  sourceUrl?: string | null;
  uploadId?: string | null;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  options: JobOptions;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClipRecord {
  id: string;
  jobId: string;
  start: number;
  end: number;
  score: number;
  reason: string;
  status: "pending" | "rendering" | "ready" | "error";
  videoPath?: string | null;
  srtPath?: string | null;
  vttPath?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
