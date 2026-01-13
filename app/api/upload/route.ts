import { NextResponse } from "next/server";
import path from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { rateLimit } from "../../../lib/rateLimit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const rate = rateLimit(ip);
  if (!rate.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  const maxBytes = Number.parseInt(process.env.MAX_UPLOAD_MB ?? "500", 10) * 1024 * 1024;
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const ext = path.extname(file.name || "") || ".mp4";
  const uploadId = `${randomUUID()}${ext}`;

  const storageBase = process.env.STORAGE_PATH ?? path.join(process.cwd(), "storage");
  const uploadsDir = path.join(storageBase, "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(path.join(uploadsDir, uploadId), Buffer.from(arrayBuffer));

  return NextResponse.json({ uploadId });
}
