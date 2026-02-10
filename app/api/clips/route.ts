import { NextResponse } from "next/server";
import { z } from "zod";
import { getDependencies } from "../../../src/infrastructure/container";
import { generateClip } from "../../../src/application/jobService";
import { isYoutubeUrl } from "../../../lib/validateUrl";
import { bucketOptions, rateLimitRequest, withRateLimitHeaders } from "../../../lib/rateLimit";

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
  let rateInit: ResponseInit | undefined;
  try {
    const rate = await rateLimitRequest(request, bucketOptions("clips-create", { max: 20 }));
    rateInit = withRateLimitHeaders(undefined, rate, { retryAfter: !rate.ok });
    if (!rate.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { ...rateInit, status: 429 });
    }
    const payload = await request.json().catch(() => null);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { ...rateInit, status: 400 });
    }

    const { sourceUrl, uploadId, start, end, options } = parsed.data;

    if (!sourceUrl && !uploadId) {
      return NextResponse.json({ error: "Provide a YouTube URL or uploadId." }, { ...rateInit, status: 400 });
    }

    if (sourceUrl && !isYoutubeUrl(sourceUrl)) {
      return NextResponse.json({ error: "Only youtube.com or youtu.be links are allowed." }, { ...rateInit, status: 400 });
    }

    const youtubeAllowed =
      process.env.ALLOW_YOUTUBE_DOWNLOADS === "true" || process.env.ALLOW_YOUTUBE_STREAMING === "true";
    if (sourceUrl && !uploadId && !youtubeAllowed) {
      return NextResponse.json(
        { error: "YouTube access is disabled. Upload a file you own or have rights to use." },
        { ...rateInit, status: 400 }
      );
    }

    if (start >= end) {
      return NextResponse.json({ error: "Invalid start or end times" }, { ...rateInit, status: 400 });
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

    return NextResponse.json({ clip }, rateInit);
  } catch (error) {
    console.error("Error generating clips:", error);
    return NextResponse.json({ error: "Internal server error" }, { ...(rateInit ?? {}), status: 500 });
  }
}
