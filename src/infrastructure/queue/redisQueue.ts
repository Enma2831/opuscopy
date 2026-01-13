import { Queue } from "bullmq";
import IORedis from "ioredis";
import { JobQueuePort } from "../../interfaces/ports";

const QUEUE_NAME = "clipforge";

export class RedisQueue implements JobQueuePort {
  private queue: Queue;

  constructor(redisUrl: string) {
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE_NAME, { connection });
  }

  async enqueueJob(jobId: string) {
    await this.queue.add("processJob", { jobId }, { removeOnComplete: 50, removeOnFail: 50 });
  }

  async enqueueClipRerender(options: {
    jobId: string;
    clipId: string;
    start: number;
    end: number;
    burnSubtitles: boolean;
    smartCrop: boolean;
  }) {
    await this.queue.add("rerenderClip", options, { removeOnComplete: 50, removeOnFail: 50 });
  }
}

export function getQueueName() {
  return QUEUE_NAME;
}
