import { promises as fs } from "fs";
import path from "path";
import { LoggerPort } from "../../interfaces/ports";

export class LocalLogger implements LoggerPort {
  constructor(private baseDir: string) {}

  async info(jobId: string, message: string) {
    await this.append(jobId, "INFO", message);
  }

  async warn(jobId: string, message: string) {
    await this.append(jobId, "WARN", message);
  }

  async error(jobId: string, message: string) {
    await this.append(jobId, "ERROR", message);
  }

  private async append(jobId: string, level: string, message: string) {
    const line = `[${new Date().toISOString()}] ${level} ${message}\n`;
    const filePath = path.join(this.baseDir, `${jobId}.log`);
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.appendFile(filePath, line);
  }
}
