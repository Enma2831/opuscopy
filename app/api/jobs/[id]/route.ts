import { NextResponse } from "next/server";
import { getDependencies } from "../../../../src/infrastructure/container";
import { rateLimit } from "../../../../lib/rateLimit";
import { findLocalJob } from "../../../../lib/localClips";

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
    if (process.env.NODE_ENV === "development") {
      const local = await findLocalJob(params.id);
      if (local) {
        return NextResponse.json(local);
      }
    }
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const clips = await deps.repo.listClips(params.id);
  let safeClips = clips.map((clip) => ({
    id: clip.id,
    start: clip.start,
    end: clip.end,
    score: clip.score,
    reason: clip.reason,
    status: clip.status,
    hasSrt: Boolean(clip.srtPath),
    hasVtt: Boolean(clip.vttPath)
  }));
  if (process.env.NODE_ENV === "development" && safeClips.length === 0) {
    const local = await findLocalJob(params.id);
    if (local?.clips?.length) {
      safeClips = local.clips;
    }
  }
  return NextResponse.json({ job, clips: safeClips });
}
