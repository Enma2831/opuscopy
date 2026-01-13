import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob } from "../../../src/application/jobService";
import { getDependencies } from "../../../src/infrastructure/container";
import { rateLimit } from "../../../lib/rateLimit";
import { isYoutubeUrl } from "../../../lib/validateUrl";
import { JobOptions } from "../../../src/domain/types";

export const runtime = "nodejs";

const schema = z.object({
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

  const { url, uploadId, options } = parsed.data;

  if (!url && !uploadId) {
    return NextResponse.json({ error: "Provide a YouTube URL or upload a file." }, { status: 400 });
  }

  if (url && !isYoutubeUrl(url)) {
    return NextResponse.json({ error: "Only youtube.com or youtu.be links are allowed." }, { status: 400 });
  }

  if (url && !uploadId && process.env.ALLOW_YOUTUBE_DOWNLOADS !== "true") {
    return NextResponse.json(
      { error: "YouTube downloads are disabled. Upload a file you own or have rights to use." },
      { status: 400 }
    );
  }

  const jobOptions: JobOptions = { ...defaultOptions, ...(options ?? {}) };
  const sourceType = uploadId ? "upload" : "youtube";
  const deps = getDependencies();
  const job = await createJob(
    {
      sourceType,
      sourceUrl: url ?? null,
      uploadId: uploadId ?? null,
      options: jobOptions
    },
    deps
  );

  return NextResponse.json({ jobId: job.id });
}
