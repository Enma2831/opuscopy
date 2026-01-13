import { describe, expect, it } from "vitest";
import path from "path";
import { promises as fs } from "fs";
import { createJob, processJob } from "../../src/application/jobService";
import { LocalStorage } from "../../src/infrastructure/storage/localStorage";
import { SubtitleService } from "../../src/infrastructure/transcription/subtitles";
import { HighlightSegment, JobOptions, Transcript, VideoSource } from "../../src/domain/types";
import { ClipRendererPort, HighlightDetectorPort, JobQueuePort, JobRepositoryPort, LoggerPort, TranscriptionPort, VideoSourcePort } from "../../src/interfaces/ports";

class MemoryRepo implements JobRepositoryPort {
  jobs = new Map<string, any>();
  clips = new Map<string, any>();

  async createJob(options: any) {
    const id = `job-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id,
      sourceType: options.sourceType,
      sourceUrl: options.sourceUrl ?? null,
      uploadId: options.uploadId ?? null,
      status: "pending",
      stage: "queued",
      progress: 0,
      options: options.options,
      error: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.jobs.set(id, record);
    return record;
  }

  async updateJob(jobId: string, patch: any) {
    const current = this.jobs.get(jobId);
    const updated = { ...current, ...patch, updatedAt: new Date() };
    this.jobs.set(jobId, updated);
    return updated;
  }

  async getJob(jobId: string) {
    return this.jobs.get(jobId) ?? null;
  }

  async createClip(jobId: string, segment: HighlightSegment) {
    const id = `clip-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id,
      jobId,
      start: segment.start,
      end: segment.end,
      score: segment.score,
      reason: segment.reason,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.clips.set(id, record);
    return record;
  }

  async updateClip(clipId: string, patch: any) {
    const current = this.clips.get(clipId);
    const updated = { ...current, ...patch, updatedAt: new Date() };
    this.clips.set(clipId, updated);
    return updated;
  }

  async listClips(jobId: string) {
    return Array.from(this.clips.values()).filter((clip) => clip.jobId === jobId);
  }

  async getClip(clipId: string) {
    return this.clips.get(clipId) ?? null;
  }
}

class MockQueue implements JobQueuePort {
  async enqueueJob(_: string) {}
  async enqueueClipRerender(_: { jobId: string; clipId: string; start: number; end: number; burnSubtitles: boolean; smartCrop: boolean }) {}
}

class MockSource implements VideoSourcePort {
  constructor(private inputPath: string) {}
  async resolve(_: { url?: string | null; uploadId?: string | null }): Promise<VideoSource> {
    return { type: "upload", filePath: this.inputPath };
  }
}

class MockTranscriber implements TranscriptionPort {
  async transcribe(_: string, __: string, ___: string): Promise<Transcript> {
    return {
      language: "es",
      segments: [
        { start: 0, end: 5, text: "hola clipforge" },
        { start: 5, end: 12, text: "momento clave" }
      ]
    };
  }
}

class MockDetector implements HighlightDetectorPort {
  async detect(_: {
    inputPath: string;
    transcript?: Transcript | null;
    clipCount: number;
    durationPreset: JobOptions["durationPreset"];
  }): Promise<HighlightSegment[]> {
    return [{ start: 0, end: 12, score: 0.8, reason: "audio peak" }];
  }
}

class MockRenderer implements ClipRendererPort {
  async render(options: {
    inputPath: string;
    outputPath: string;
    start: number;
    end: number;
    burnSubtitles: boolean;
    subtitlesPath?: string | null;
    smartCrop: boolean;
  }): Promise<void> {
    await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
    await fs.writeFile(options.outputPath, "mock");
  }
}

class MockLogger implements LoggerPort {
  async info(_: string, __: string) {}
  async warn(_: string, __: string) {}
  async error(_: string, __: string) {}
}

describe("job flow", () => {
  it("creates job and renders clips with mocks", async () => {
    const storage = new LocalStorage(path.join(process.cwd(), "storage", "test"));
    const deps = {
      repo: new MemoryRepo(),
      queue: new MockQueue(),
      source: new MockSource(path.join(process.cwd(), "samples", "sample.wav")),
      transcriber: new MockTranscriber(),
      detector: new MockDetector(),
      renderer: new MockRenderer(),
      storage,
      subtitles: new SubtitleService(),
      logger: new MockLogger()
    };

    const options: JobOptions = {
      language: "es",
      clipCount: 3,
      durationPreset: "short",
      subtitles: "srt",
      smartCrop: true
    };

    const job = await createJob({ sourceType: "upload", uploadId: "sample.wav", options }, deps);
    await processJob(job.id, deps);

    const updated = await deps.repo.getJob(job.id);
    const clips = await deps.repo.listClips(job.id);

    expect(updated?.status).toBe("ready");
    expect(clips.length).toBeGreaterThan(0);
    const clip = clips[0];
    expect(clip.videoPath).toBeTruthy();
    expect(await storage.exists(clip.videoPath)).toBe(true);
  });
});
