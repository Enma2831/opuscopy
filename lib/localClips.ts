import { promises as fs } from "node:fs";
import path from "node:path";
import { parseSrt } from "../src/infrastructure/transcription/srt";

export type LocalClipSummary = {
  id: string;
  start: number;
  end: number;
  score: number;
  reason: string;
  status: "ready";
  hasSrt: boolean;
  hasVtt: boolean;
  videoPath: string;
  srtPath: string | null;
  vttPath: string | null;
};

export async function findLocalJob(jobId: string) {
  const jobDir = await findJobDir(jobId);
  if (!jobDir) {
    return null;
  }
  const clips = await listClipsInDir(jobDir);
  return {
    job: buildLocalJob(jobId),
    clips
  };
}

export async function findLocalClipFiles(clipId: string) {
  const roots = await getStorageRoots();
  for (const root of roots) {
    const jobsDir = path.join(root, "jobs");
    const jobEntries = await readDirSafe(jobsDir);
    for (const entry of jobEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const base = path.join(jobsDir, entry.name, `clip-${clipId}`);
      const videoPath = `${base}.mp4`;
      if (!(await exists(videoPath))) {
        continue;
      }
      const srtPath = `${base}.srt`;
      const vttPath = `${base}.vtt`;
      return {
        videoPath,
        srtPath: (await exists(srtPath)) ? srtPath : null,
        vttPath: (await exists(vttPath)) ? vttPath : null
      };
    }
  }
  return null;
}

async function listClipsInDir(jobDir: string): Promise<LocalClipSummary[]> {
  const entries = await readDirSafe(jobDir);
  const clips: LocalClipSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.startsWith("clip-") || !entry.name.endsWith(".mp4")) {
      continue;
    }
    const clipId = entry.name.slice("clip-".length, -".mp4".length);
    const base = path.join(jobDir, `clip-${clipId}`);
    const videoPath = `${base}.mp4`;
    const srtPath = `${base}.srt`;
    const vttPath = `${base}.vtt`;
    const hasSrt = await exists(srtPath);
    const hasVtt = await exists(vttPath);
    const timing = hasSrt ? await readClipTiming(srtPath) : { start: 0, end: 0 };
    clips.push({
      id: clipId,
      start: timing.start,
      end: timing.end,
      score: 0,
      reason: "local",
      status: "ready",
      hasSrt,
      hasVtt,
      videoPath,
      srtPath: hasSrt ? srtPath : null,
      vttPath: hasVtt ? vttPath : null
    });
  }
  return clips.sort((a, b) => a.id.localeCompare(b.id));
}

async function readClipTiming(srtPath: string) {
  try {
    const srt = await fs.readFile(srtPath, "utf-8");
    const transcript = parseSrt(srt, "und");
    const start = transcript.segments[0]?.start ?? 0;
    const end = transcript.segments.at(-1)?.end ?? 0;
    return { start, end };
  } catch {
    return { start: 0, end: 0 };
  }
}

async function findJobDir(jobId: string) {
  const roots = await getStorageRoots();
  for (const root of roots) {
    const candidate = path.join(root, "jobs", jobId);
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildLocalJob(jobId: string) {
  const now = new Date().toISOString();
  return {
    id: jobId,
    sourceType: "local",
    sourceUrl: null,
    uploadId: null,
    status: "ready",
    stage: "ready",
    progress: 100,
    options: {},
    error: null,
    metadata: null,
    createdAt: now,
    updatedAt: now
  };
}

async function getStorageRoots() {
  const base = process.env.STORAGE_PATH ?? path.join(process.cwd(), "storage");
  const roots = [base];
  const entries = await readDirSafe(base);
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(base, entry.name);
    const jobsDir = path.join(candidate, "jobs");
    if (await exists(jobsDir)) {
      roots.push(candidate);
    }
  }
  return roots;
}

async function readDirSafe(dirPath: string) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
