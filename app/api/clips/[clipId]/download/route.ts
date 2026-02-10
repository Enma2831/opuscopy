import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getDependencies } from "../../../../../src/infrastructure/container";
import { bucketOptions, rateLimitRequest, withRateLimitHeaders } from "../../../../../lib/rateLimit";
import { findLocalClipFiles } from "../../../../../lib/localClips";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { clipId: string } }) {
  const rate = await rateLimitRequest(request, bucketOptions("clips-download", { max: 60 }));
  const rateInit = withRateLimitHeaders(undefined, rate, { retryAfter: !rate.ok });
  if (!rate.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { ...rateInit, status: 429 });
  }

  const deps = getDependencies();
  const clip = await deps.repo.getClip(params.clipId);
  let videoPath = clip?.videoPath ?? null;
  if (!videoPath && process.env.NODE_ENV === "development") {
    const local = await findLocalClipFiles(params.clipId);
    videoPath = local?.videoPath ?? null;
  }
  if (!videoPath) {
    return NextResponse.json({ error: "Clip not found" }, { ...rateInit, status: 404 });
  }

  const buffer = await fs.readFile(videoPath);
  const responseInit = withRateLimitHeaders(
    {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename=clip-${params.clipId}.mp4`
      }
    },
    rate
  );
  return new NextResponse(buffer, responseInit);
}
