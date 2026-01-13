import { prisma } from "./prismaClient";
import { ClipRecord, HighlightSegment, JobOptions, JobRecord } from "../../domain/types";
import { JobRepositoryPort } from "../../interfaces/ports";

const toJobRecord = (job: any): JobRecord => ({
  id: job.id,
  sourceType: job.sourceType,
  sourceUrl: job.sourceUrl,
  uploadId: job.uploadId,
  status: job.status,
  stage: job.stage,
  progress: job.progress,
  options: job.options as JobOptions,
  error: job.error,
  metadata: job.metadata,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt
});

const toClipRecord = (clip: any): ClipRecord => ({
  id: clip.id,
  jobId: clip.jobId,
  start: clip.start,
  end: clip.end,
  score: clip.score,
  reason: clip.reason,
  status: clip.status,
  videoPath: clip.videoPath,
  srtPath: clip.srtPath,
  vttPath: clip.vttPath,
  createdAt: clip.createdAt,
  updatedAt: clip.updatedAt
});

export class PrismaJobRepository implements JobRepositoryPort {
  async createJob(options: {
    sourceType: string;
    sourceUrl?: string | null;
    uploadId?: string | null;
    options: JobOptions;
  }): Promise<JobRecord> {
    const job = await prisma.job.create({
      data: {
        sourceType: options.sourceType,
        sourceUrl: options.sourceUrl ?? null,
        uploadId: options.uploadId ?? null,
        status: "pending",
        stage: "queued",
        progress: 0,
        options: options.options,
        error: null
      }
    });
    return toJobRecord(job);
  }

  async updateJob(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord> {
    const job = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: patch.status,
        stage: patch.stage,
        progress: patch.progress,
        error: patch.error,
        metadata: patch.metadata,
        options: patch.options
      }
    });
    return toJobRecord(job);
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    return job ? toJobRecord(job) : null;
  }

  async createClip(jobId: string, segment: HighlightSegment): Promise<ClipRecord> {
    const clip = await prisma.clip.create({
      data: {
        jobId,
        start: segment.start,
        end: segment.end,
        score: segment.score,
        reason: segment.reason,
        status: "pending"
      }
    });
    return toClipRecord(clip);
  }

  async updateClip(clipId: string, patch: Partial<ClipRecord>): Promise<ClipRecord> {
    const clip = await prisma.clip.update({
      where: { id: clipId },
      data: {
        start: patch.start,
        end: patch.end,
        score: patch.score,
        reason: patch.reason,
        status: patch.status,
        videoPath: patch.videoPath,
        srtPath: patch.srtPath,
        vttPath: patch.vttPath
      }
    });
    return toClipRecord(clip);
  }

  async listClips(jobId: string): Promise<ClipRecord[]> {
    const clips = await prisma.clip.findMany({ where: { jobId }, orderBy: { score: "desc" } });
    return clips.map(toClipRecord);
  }

  async getClip(clipId: string): Promise<ClipRecord | null> {
    const clip = await prisma.clip.findUnique({ where: { id: clipId } });
    return clip ? toClipRecord(clip) : null;
  }
}
