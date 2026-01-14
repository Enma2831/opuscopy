import cluster from "node:cluster";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { getQueueName } from "../src/infrastructure/queue/redisQueue";
import { getDependencies } from "../src/infrastructure/container";
import { processJob, rerenderClip } from "../src/application/jobService";

const workerCount = Math.max(1, parseIntEnv(process.env.WORKER_COUNT, 1));
const concurrency = Math.max(1, parseIntEnv(process.env.WORKER_CONCURRENCY, 1));
const maxRssMb = Math.max(0, parseIntEnv(process.env.WORKER_MAX_RSS_MB, 0));

if (cluster.isPrimary && workerCount > 1) {
  console.log(`Starting ${workerCount} worker processes with concurrency ${concurrency}.`);
  for (let i = 0; i < workerCount; i += 1) {
    cluster.fork();
  }
  cluster.on("exit", (worker, code, signal) => {
    const exitCode = code ?? "unknown";
    const exitSignal = signal ?? "unknown";
    console.error(`Worker ${worker.process.pid} exited (${exitCode}, ${exitSignal}).`);
  });
} else {
  startWorker();
}

function parseIntEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function startWorker() {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const deps = getDependencies();

  const worker = new Worker(
    getQueueName(),
    async (job) => {
      if (job.name === "processJob") {
        await processJob(job.data.jobId, deps);
        return;
      }
      if (job.name === "rerenderClip") {
        const existingJob = await deps.repo.getJob(job.data.jobId);
        if (!existingJob) {
          return;
        }
        await rerenderClip(
          {
            jobId: job.data.jobId,
            clipId: job.data.clipId,
            start: job.data.start,
            end: job.data.end,
            options: { ...existingJob.options, subtitles: job.data.burnSubtitles ? "burned" : existingJob.options.subtitles, smartCrop: job.data.smartCrop }
          },
          deps
        );
      }
    },
    { connection, concurrency }
  );

  worker.on("failed", (job, err) => {
    console.error("Job failed", job?.id, err);
  });

  worker.on("error", (err) => {
    console.error("Worker error", err);
  });

  setupMemoryGuard(worker, maxRssMb);

  const shutdown = async () => {
    await worker.close();
    await connection.quit();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log(`ClipForge worker running (pid=${process.pid}, concurrency=${concurrency}).`);
}

function setupMemoryGuard(worker: Worker, limitMb: number) {
  if (limitMb <= 0) {
    return;
  }
  const resumeThreshold = limitMb * 0.85;
  let paused = false;
  let checking = false;

  const interval = setInterval(async () => {
    if (checking) {
      return;
    }
    checking = true;
    try {
      const rssMb = process.memoryUsage().rss / 1024 / 1024;
      if (!paused && rssMb >= limitMb) {
        await worker.pause();
        paused = true;
        console.warn(`Paused new jobs (RSS ${rssMb.toFixed(1)}MB >= ${limitMb}MB).`);
      } else if (paused && rssMb <= resumeThreshold) {
        await worker.resume();
        paused = false;
        console.info(`Resumed new jobs (RSS ${rssMb.toFixed(1)}MB <= ${resumeThreshold.toFixed(1)}MB).`);
      }
    } finally {
      checking = false;
    }
  }, 5000);

  interval.unref();
}
