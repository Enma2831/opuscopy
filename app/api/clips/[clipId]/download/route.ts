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
  if (!clip || !clip.videoPath) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const buffer = await fs.readFile(clip.videoPath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename=clip-${clip.id}.mp4`
    }
  });
}
