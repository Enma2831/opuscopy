import IORedis from "ioredis";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 30;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  max?: number;
  windowMs?: number;
  prefix?: string;
  bucket?: string;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
};

let redisClient: IORedis | null = null;
let redisConnecting: Promise<void> | null = null;
let warnedRedisFailure = false;

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDefaults() {
  return {
    windowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    max: parseNumber(process.env.RATE_LIMIT_MAX, DEFAULT_MAX_REQUESTS),
    prefix: process.env.RATE_LIMIT_PREFIX ?? "clipforge:rate"
  };
}

function toEnvKey(bucket: string) {
  return bucket.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export function bucketOptions(bucket: string, defaults?: { max?: number; windowMs?: number }): RateLimitOptions {
  const globalDefaults = getDefaults();
  const key = toEnvKey(bucket);
  const max = parseNumber(process.env[`RATE_LIMIT_${key}_MAX`], defaults?.max ?? globalDefaults.max);
  const windowMs = parseNumber(process.env[`RATE_LIMIT_${key}_WINDOW_MS`], defaults?.windowMs ?? globalDefaults.windowMs);
  return { bucket, max, windowMs };
}

async function getRedis(): Promise<IORedis | null> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }
  if (!redisClient) {
    redisClient = new IORedis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  }
  if (!redisConnecting) {
    redisConnecting = redisClient.connect().catch((error) => {
      redisConnecting = null;
      throw error;
    });
  }
  await redisConnecting;
  return redisClient;
}

function buildKey(key: string, options?: RateLimitOptions) {
  const defaults = getDefaults();
  const prefix = options?.prefix ?? defaults.prefix;
  const bucket = options?.bucket ?? "api";
  return `${prefix}:${bucket}:${key}`;
}

function inMemoryLimit(key: string, options?: RateLimitOptions): RateLimitResult {
  const defaults = getDefaults();
  const max = options?.max ?? defaults.max;
  const windowMs = options?.windowMs ?? defaults.windowMs;

  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, max - 1), resetAt: now + windowMs, limit: max };
  }
  if (bucket.count >= max) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt, limit: max };
  }
  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, max - bucket.count), resetAt: bucket.resetAt, limit: max };
}

export async function rateLimit(key: string, options?: RateLimitOptions): Promise<RateLimitResult> {
  const defaults = getDefaults();
  const max = options?.max ?? defaults.max;
  const windowMs = options?.windowMs ?? defaults.windowMs;
  const rateKey = buildKey(key, options);

  try {
    const redis = await getRedis();
    if (!redis) {
      return inMemoryLimit(rateKey, { ...options, max, windowMs });
    }
    const started = Date.now();
    const result = (await redis.eval(RATE_LIMIT_SCRIPT, 1, rateKey, max.toString(), windowMs.toString())) as [
      number,
      number
    ];
    const current = result?.[0] ?? max + 1;
    const ttl = result?.[1] ?? windowMs;
    const remaining = Math.max(0, max - current);
    const resetAt = started + Math.max(0, ttl);
    return { ok: current <= max, remaining, resetAt, limit: max };
  } catch (error) {
    if (!warnedRedisFailure) {
      warnedRedisFailure = true;
      console.warn("Rate limiter falling back to in-memory:", error);
    }
    return inMemoryLimit(rateKey, { ...options, max, windowMs });
  }
}

export async function rateLimitRequest(request: Request, options?: RateLimitOptions): Promise<RateLimitResult> {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return rateLimit(ip, options);
}

export function withRateLimitHeaders(
  init: ResponseInit | undefined,
  rate: RateLimitResult,
  options?: { retryAfter?: boolean }
): ResponseInit {
  const headers = new Headers(init?.headers ?? {});
  headers.set("X-RateLimit-Limit", rate.limit.toString());
  headers.set("X-RateLimit-Remaining", rate.remaining.toString());
  headers.set("X-RateLimit-Reset", Math.ceil(rate.resetAt / 1000).toString());
  if (options?.retryAfter) {
    const retryAfter = Math.max(0, Math.ceil((rate.resetAt - Date.now()) / 1000));
    headers.set("Retry-After", retryAfter.toString());
  }
  return { ...init, headers };
}
