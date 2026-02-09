import { NextResponse } from "next/server";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { rateLimit } from "../../../lib/rateLimit";

export const runtime = "nodejs";

async function streamUpload(request: Request, uploadsDir: string, maxBytes: number) {
  const contentType = request.headers.get("content-type");
  if (!contentType?.includes("multipart/form-data")) {
    throw new Error("Invalid content type");
  }
  if (!request.body) {
    throw new Error("Missing body");
  }

  await fs.mkdir(uploadsDir, { recursive: true });

  return new Promise<{ uploadId: string }>((resolve, reject) => {
    const busboy = Busboy({
      headers: { "content-type": contentType },
      limits: { files: 1, fileSize: maxBytes }
    });
    let uploadId: string | null = null;
    let filePath: string | null = null;
    let fileWrite: Promise<void> | null = null;
    let fileFound = false;
    let fileTooLarge = false;

    busboy.on("file", (fieldname, file, info) => {
      if (fieldname !== "file" || fileFound) {
        file.resume();
        return;
      }
      fileFound = true;
      const ext = path.extname(info.filename || "") || ".mp4";
      uploadId = `${randomUUID()}${ext}`;
      filePath = path.join(uploadsDir, uploadId);
      const writeStream = createWriteStream(filePath);
      file.on("limit", () => {
        fileTooLarge = true;
        writeStream.destroy();
        file.resume();
      });
      fileWrite = pipeline(file, writeStream);
    });

    busboy.on("filesLimit", () => {
      reject(new Error("Only one file allowed"));
    });

    busboy.on("error", (error) => {
      reject(error);
    });

    busboy.on("finish", async () => {
      try {
        if (!fileFound || !uploadId || !filePath || !fileWrite) {
          reject(new Error("Missing file"));
          return;
        }
        await fileWrite.catch((error) => {
          if (fileTooLarge) {
            return;
          }
          throw error;
        });
        if (fileTooLarge) {
          await fs.unlink(filePath).catch(() => undefined);
          reject(Object.assign(new Error("File too large"), { code: "LIMIT_FILE_SIZE" }));
          return;
        }
        resolve({ uploadId });
      } catch (error) {
        if (filePath) {
          await fs.unlink(filePath).catch(() => undefined);
        }
        reject(error);
      }
    });

    const stream = Readable.fromWeb(request.body as any);
    stream.on("error", reject);
    stream.pipe(busboy);
  });
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const rate = rateLimit(ip);
  if (!rate.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const maxBytes = Number.parseInt(process.env.MAX_UPLOAD_MB ?? "500", 10) * 1024 * 1024;
  const storageBase = process.env.STORAGE_PATH ?? path.join(process.cwd(), "storage");
  const uploadsDir = path.join(storageBase, "uploads");

  try {
    const { uploadId } = await streamUpload(request, uploadsDir, maxBytes);
    return NextResponse.json({ uploadId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    if (message === "File too large" || (error as { code?: string }).code === "LIMIT_FILE_SIZE") {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }
    if (message === "Missing file" || message === "Invalid content type" || message === "Only one file allowed") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}