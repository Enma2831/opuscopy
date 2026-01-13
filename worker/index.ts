import { Worker } from "bullmq";
import IORedis from "ioredis";
import { getQueueName } from "../src/infrastructure/queue/redisQueue";
import { getDependencies } from "../src/infrastructure/container";
import { processJob, rerenderClip } from "../src/application/jobService";

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
  { connection, concurrency: 2 }
);

worker.on("failed", (job, err) => {
  console.error("Job failed", job?.id, err);
});

console.log("ClipForge worker running");
