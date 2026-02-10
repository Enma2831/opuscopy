import { promises as fs } from "fs";
import path from "path";
import { LoggerPort } from "../../interfaces/ports";
import { prisma } from "../repo/prismaClient";

type LogLevel = "info" | "warn" | "error";

type LogEntry = {
  timestamp: string;
  level: LogLevel;
  jobId: string;
  message: string;
  pid: number;
};

export class LocalLogger implements LoggerPort {
  constructor(private baseDir: string) {}

  async info(jobId: string, message: string) {
    await this.append(jobId, "info", message);
  }

  async warn(jobId: string, message: string) {
    await this.append(jobId, "warn", message);
  }

  async error(jobId: string, message: string) {
    await this.append(jobId, "error", message);
  }

  private async append(jobId: string, level: LogLevel, message: string) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      jobId,
      message,
      pid: process.pid
    };
    const filePath = path.join(this.baseDir, `${jobId}.log`);
    await fs.mkdir(this.baseDir, { recursive: true });

    const tasks: Promise<unknown>[] = [fs.appendFile(filePath, `${JSON.stringify(entry)}\n`)];
    if (process.env.LOG_TO_DB !== "false" && process.env.DATABASE_URL) {
      tasks.push(
        prisma.jobLog.create({
          data: {
            jobId,
            level,
            message
          }
        })
      );
    }

    const results = await Promise.allSettled(tasks);
    const failures = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    if (failures.length) {
      for (const failure of failures) {
        console.error("Logger write failed", failure.reason);
      }
    }
  }
}
