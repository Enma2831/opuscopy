import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { bucketOptions, rateLimitRequest, withRateLimitHeaders } from "../../../../../lib/rateLimit";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const rate = await rateLimitRequest(request, bucketOptions("jobs-logs", { max: 30 }));
  const rateInit = withRateLimitHeaders(undefined, rate, { retryAfter: !rate.ok });
  if (!rate.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { ...rateInit, status: 429 });
  }
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Logs available only in dev" }, { ...rateInit, status: 403 });
  }

  const logsDir = process.env.LOGS_PATH ?? path.join(process.cwd(), "logs");
  const logPath = path.join(logsDir, `${params.id}.log`);
  try {
    const content = await fs.readFile(logPath, "utf-8");
    const responseInit = withRateLimitHeaders({ headers: { "Content-Type": "text/plain" } }, rate);
    return new NextResponse(content, responseInit);
  } catch {
    return NextResponse.json({ error: "Log not found" }, { ...rateInit, status: 404 });
  }
}
