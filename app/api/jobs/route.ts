import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob } from "../../../src/application/jobService";
import { getDependencies } from "../../../src/infrastructure/container";
import { bucketOptions, rateLimitRequest, withRateLimitHeaders } from "../../../lib/rateLimit";
import { isYoutubeUrl } from "../../../lib/validateUrl";
import { JobOptions } from "../../../src/domain/types";

export const runtime = "nodejs";

const schema = z.object({
  sourceType: z.enum(["youtube", "upload"]).optional(),
  sourceUrl: z.string().url().optional().nullable(),
  url: z.string().url().optional().nullable(),
  uploadId: z.string().optional().nullable(),
  options: z
    .object({
      language: z.string().min(2).default("es"),
      clipCount: z.coerce.number().min(3).max(10).default(5),
      durationPreset: z.enum(["short", "normal", "long"]).default("normal"),
      subtitles: z.enum(["off", "srt", "burned"]).default("srt"),
      smartCrop: z.coerce.boolean().default(true)
    })
    .optional()
});

const defaultOptions: JobOptions = {
  language: "es",
  clipCount: 5,
  durationPreset: "normal",
  subtitles: "srt",
  smartCrop: true
};

export async function POST(request: Request) {
  const rate = await rateLimitRequest(request, bucketOptions("jobs-create", { max: 20 }));
  const rateInit = withRateLimitHeaders(undefined, rate, { retryAfter: !rate.ok });
  if (!rate.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { ...rateInit, status: 429 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { ...rateInit, status: 400 });
  }

  const { sourceType: inputSourceType, sourceUrl, url, uploadId, options } = parsed.data;
  const finalUrl = sourceUrl ?? url ?? null;
  let sourceType = inputSourceType ?? (uploadId ? "upload" : finalUrl ? "youtube" : null);

  if (!sourceType || (!finalUrl && !uploadId)) {
    return NextResponse.json({ error: "Provide a YouTube URL or upload a file." }, { ...rateInit, status: 400 });
  }

  if (sourceType === "youtube" && finalUrl && !isYoutubeUrl(finalUrl)) {
    return NextResponse.json({ error: "Only youtube.com or youtu.be links are allowed." }, { ...rateInit, status: 400 });
  }

  const youtubeAllowed =
    process.env.ALLOW_YOUTUBE_DOWNLOADS === "true" || process.env.ALLOW_YOUTUBE_STREAMING === "true";
  if (sourceType === "youtube" && !uploadId && !youtubeAllowed) {
    return NextResponse.json(
      { error: "YouTube downloads are disabled. Upload a file you own or have rights to use." },
      { ...rateInit, status: 400 }
    );
  }

  const jobOptions: JobOptions = { ...defaultOptions, ...(options ?? {}) };
  const deps = getDependencies();
  const job = await createJob(
    {
      sourceType,
      sourceUrl: finalUrl,
      uploadId: uploadId ?? null,
      options: jobOptions
    },
    deps
  );

  return NextResponse.json({ jobId: job.id }, rateInit);
}
