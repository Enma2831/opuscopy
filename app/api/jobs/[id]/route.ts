import { NextResponse } from "next/server";
import { getDependencies } from "../../../../src/infrastructure/container";
import { rateLimit } from "../../../../lib/rateLimit";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const rate = rateLimit(ip);
  if (!rate.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const deps = getDependencies();
  const job = await deps.repo.getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const clips = await deps.repo.listClips(params.id);
  const safeClips = clips.map((clip) => ({
    id: clip.id,
    start: clip.start,
    end: clip.end,
    score: clip.score,
    reason: clip.reason,
    status: clip.status,
    hasSrt: Boolean(clip.srtPath),
    hasVtt: Boolean(clip.vttPath)
  }));
  return NextResponse.json({ job, clips: safeClips });
}
