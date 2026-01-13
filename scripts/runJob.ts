import path from "node:path";import { fileURLToPath } from "node:url";import { getDependencies } from "../src/infrastructure/container";import { createJob, processJob } from "../src/application/jobService";import { JobOptions } from "../src/domain/types";

// Usage examples:
//  - npx tsx scripts/runJob.ts --uploadId=sample-upload-id
//  - npx tsx scripts/runJob.ts --url=https://www.youtube.com/watch?v=XXXXX (requires YouTube enabled)
//  - npx tsx scripts/runJob.ts --file=./samples/sample.wav (will simulate an upload by copying to storage/uploads)

function parseArgs() {  const args = process.argv.slice(2);  const opts: Record<string, string | boolean> = {};  for (const arg of args) {    const m = arg.match(/^--([^=]+)(=(.*))?$/);    if (m) {      const key = m[1];      const val = m[3] ?? true;      opts[key] = val;    }  }  return opts;}

async function ensureUploadFromFile(localPath: string, uploadsDir: string) {  const fs = await import("node:fs/promises");  const crypto = await import("node:crypto");  const id = crypto.randomUUID();  const dest = path.join(uploadsDir, id);  await fs.mkdir(uploadsDir, { recursive: true });  const data = await fs.readFile(localPath);  await fs.writeFile(dest, data);  return id;}

async function main() {  const deps = getDependencies();
  const args = parseArgs();
  const hasUrl = typeof args.url === "string";  const hasUploadId = typeof args.uploadId === "string";  const hasFile = typeof args.file === "string";

  let sourceType: "youtube" | "upload" = "upload";  let sourceUrl: string | null = null;  let uploadId: string | null = null;

  if (hasUrl) {    sourceType = "youtube";    sourceUrl = String(args.url);  } else if (hasUploadId) {    sourceType = "upload";    uploadId = String(args.uploadId);  } else if (hasFile) {    // Copy local file into storage/uploads and use the generated uploadId
    const storageBase = process.env.STORAGE_PATH ?? path.join(process.cwd(), "storage");    const uploadsDir = path.join(storageBase, "uploads");    const localPath = path.isAbsolute(String(args.file)) ? String(args.file) : path.join(process.cwd(), String(args.file));    uploadId = await ensureUploadFromFile(localPath, uploadsDir);    sourceType = "upload";  } else {    console.error("Provide one of: --url=<youtubeUrl> | --uploadId=<id> | --file=<path>");    process.exit(1);  }

  const options: JobOptions = {    language: "en",    clipCount: 3,    durationPreset: "short",    subtitles: "srt",    smartCrop: true  };

  const job = await createJob({    sourceType,    sourceUrl,    uploadId,    options  }, deps);

  console.log(`Created job ${job.id} with sourceType=${sourceType}`);
  await processJob(job.id, deps);
  console.log("Job processing complete.");}

main().catch((err) => {  console.error(err);  process.exit(1);});