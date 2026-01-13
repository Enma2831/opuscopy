import { NextResponse } from "next/server";
import { z } from "zod";
import { getDependencies } from "../../../../../src/infrastructure/container";
import { rateLimit } from "../../../../../lib/rateLimit";

export const runtime = "nodejs";

const schema = z.object({
  clipId: z.string(),
  start: z.coerce.number().min(0),
  end: z.coerce.number().min(0),
  options: z
    .object({
      subtitles: z.enum(["off", "srt", "burned"]).optional(),
      smartCrop: z.boolean().optional()
    })
    .optional()
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
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
  if (parsed.data.end <= parsed.data.start) {
    return NextResponse.json({ error: "End must be greater than start" }, { status: 400 });
  }

  const deps = getDependencies();
  const job = await deps.repo.getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const burnSubtitles = parsed.data.options?.subtitles
    ? parsed.data.options.subtitles === "burned"
    : job.options.subtitles === "burned";
  const smartCrop = parsed.data.options?.smartCrop ?? job.options.smartCrop;

  await deps.queue.enqueueClipRerender({
    jobId: params.id,
    clipId: parsed.data.clipId,
    start: parsed.data.start,
    end: parsed.data.end,
    burnSubtitles,
    smartCrop
  });

  return NextResponse.json({ status: "queued" });
}
