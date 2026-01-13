import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getDependencies } from "../../../../../src/infrastructure/container";
import { rateLimit } from "../../../../../lib/rateLimit";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { clipId: string } }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const rate = rateLimit(ip);
  if (!rate.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const deps = getDependencies();
  const clip = await deps.repo.getClip(params.clipId);
  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "srt";
  const filePath = format === "vtt" ? clip.vttPath : clip.srtPath;
  if (!filePath) {
    return NextResponse.json({ error: "Subtitles not available" }, { status: 404 });
  }

  const buffer = await fs.readFile(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": format === "vtt" ? "text/vtt" : "application/x-subrip",
      "Content-Disposition": `attachment; filename=clip-${clip.id}.${format}`
    }
  });
}
