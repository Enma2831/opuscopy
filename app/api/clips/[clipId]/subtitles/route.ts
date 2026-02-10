import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getDependencies } from "../../../../../src/infrastructure/container";
import { bucketOptions, rateLimitRequest, withRateLimitHeaders } from "../../../../../lib/rateLimit";
import { findLocalClipFiles } from "../../../../../lib/localClips";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { clipId: string } }) {
  const rate = await rateLimitRequest(request, bucketOptions("clips-subtitles", { max: 60 }));
  const rateInit = withRateLimitHeaders(undefined, rate, { retryAfter: !rate.ok });
  if (!rate.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { ...rateInit, status: 429 });
  }

  const deps = getDependencies();
  const clip = await deps.repo.getClip(params.clipId);
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "srt";
  let filePath = format === "vtt" ? clip?.vttPath ?? null : clip?.srtPath ?? null;
  if (!filePath && process.env.NODE_ENV === "development") {
    const local = await findLocalClipFiles(params.clipId);
    filePath = format === "vtt" ? local?.vttPath ?? null : local?.srtPath ?? null;
  }
  if (!filePath) {
    return NextResponse.json({ error: "Subtitles not available" }, { ...rateInit, status: 404 });
  }

  const buffer = await fs.readFile(filePath);
  const responseInit = withRateLimitHeaders(
    {
      headers: {
        "Content-Type": format === "vtt" ? "text/vtt" : "application/x-subrip",
        "Content-Disposition": `attachment; filename=clip-${params.clipId}.${format}`
      }
    },
    rate
  );
  return new NextResponse(buffer, responseInit);
}
