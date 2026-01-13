import { NextResponse } from "next/server";
import { z } from "zod";
import { getDependencies } from "../../../src/infrastructure/container";
import { generateClip } from "../../../src/application/jobService";
import { isYoutubeUrl } from "../../../lib/validateUrl";
import { rateLimit } from "../../../lib/rateLimit";

export const runtime = "nodejs";

const schema = z.object({
  sourceUrl: z.string().url().optional().nullable(),
  uploadId: z.string().optional().nullable(),
  start: z.coerce.number().min(0),
  end: z.coerce.number().min(0),
  options: z
    .object({
      language: z.string().min(2).optional(),
      durationPreset: z.enum(["short", "normal", "long"]).optional(),
      subtitles: z.enum(["off", "srt", "burned"]).optional(),
      smartCrop: z.coerce.boolean().optional()
    })
    .optional()
});

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
    const rate = rateLimit(ip);
    if (!rate.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
    const payload = await request.json().catch(() => null);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { sourceUrl, uploadId, start, end, options } = parsed.data;

    if (!sourceUrl && !uploadId) {
      return NextResponse.json({ error: "Provide a YouTube URL or uploadId." }, { status: 400 });
    }

    if (sourceUrl && !isYoutubeUrl(sourceUrl)) {
      return NextResponse.json({ error: "Only youtube.com or youtu.be links are allowed." }, { status: 400 });
    }

    if (sourceUrl && !uploadId && process.env.ALLOW_YOUTUBE_DOWNLOADS !== "true") {
      return NextResponse.json(
        { error: "YouTube downloads are disabled. Upload a file you own or have rights to use." },
        { status: 400 }
      );
    }

    if (start >= end) {
      return NextResponse.json({ error: "Invalid start or end times" }, { status: 400 });
    }

    const deps = getDependencies();
    const clip = await generateClip(
      {
        sourceUrl: sourceUrl || null,
        uploadId: uploadId || null,
        start,
        end,
        options: options || {}
      },
      deps
    );

    return NextResponse.json({ clip });
  } catch (error) {
    console.error("Error generating clips:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}