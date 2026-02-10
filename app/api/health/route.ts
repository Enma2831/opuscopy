import { NextResponse } from "next/server";
import IORedis from "ioredis";
import { prisma } from "@/infrastructure/repo/prismaClient";
import { bucketOptions, rateLimitRequest, withRateLimitHeaders } from "../../../lib/rateLimit";

export const runtime = "nodejs";

type CheckStatus = "ok" | "error" | "skipped";

type CheckResult = {
  status: CheckStatus;
  latency_ms?: number;
  error?: string;
  reason?: string;
};

const DEFAULT_TIMEOUT_MS = 1500;

function parseTimeout(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function checkDatabase(timeoutMs: number): Promise<CheckResult> {
  if (!process.env.DATABASE_URL) {
    return { status: "skipped", reason: "DATABASE_URL not set" };
  }
  const started = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, timeoutMs, "Database check");
    return { status: "ok", latency_ms: Date.now() - started };
  } catch (error) {
    return {
      status: "error",
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message : "Unknown database error"
    };
  }
}

async function checkRedis(timeoutMs: number): Promise<CheckResult> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return { status: "skipped", reason: "REDIS_URL not set" };
  }
  const started = Date.now();
  const client = new IORedis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0
  });
  try {
    await withTimeout(client.connect(), timeoutMs, "Redis connect");
    await withTimeout(client.ping(), timeoutMs, "Redis ping");
    return { status: "ok", latency_ms: Date.now() - started };
  } catch (error) {
    return {
      status: "error",
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message : "Unknown redis error"
    };
  } finally {
    client.disconnect();
  }
}

export async function GET(request: Request) {
  const rate = await rateLimitRequest(request, bucketOptions("health", { max: 120 }));
  const rateInit = withRateLimitHeaders(undefined, rate, { retryAfter: !rate.ok });
  if (!rate.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { ...rateInit, status: 429 });
  }
  const timeoutMs = parseTimeout(process.env.HEALTHCHECK_TIMEOUT_MS);
  const start = Date.now();

  const [database, redis] = await Promise.all([checkDatabase(timeoutMs), checkRedis(timeoutMs)]);
  const checks = { database, redis };

  const hasError = Object.values(checks).some((check) => check.status === "error");
  const status = hasError ? "error" : "ok";

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      uptime_s: Math.floor(process.uptime()),
      duration_ms: Date.now() - start,
      checks
    },
    { ...rateInit, status: hasError ? 503 : 200 }
  );
}
