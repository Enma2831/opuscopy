import { NextResponse } from "next/server";
import { bucketOptions, rateLimitRequest, withRateLimitHeaders } from "../../../lib/rateLimit";

export const runtime = "nodejs";

function formatMetricLine(name: string, value: number, labels?: Record<string, string>) {
  if (!labels || Object.keys(labels).length === 0) {
    return `${name} ${value}`;
  }
  const serialized = Object.entries(labels)
    .map(([key, val]) => `${key}="${val.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`)
    .join(",");
  return `${name}{${serialized}} ${value}`;
}

export async function GET(request: Request) {
  const rate = await rateLimitRequest(request, bucketOptions("metrics", { max: 120 }));
  const rateInit = withRateLimitHeaders(undefined, rate, { retryAfter: !rate.ok });
  if (!rate.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { ...rateInit, status: 429 });
  }
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const startTimeSeconds = Math.floor(Date.now() / 1000 - uptime);
  const cpu = process.cpuUsage();

  const lines: string[] = [];

  lines.push("# HELP process_uptime_seconds Process uptime in seconds.");
  lines.push("# TYPE process_uptime_seconds gauge");
  lines.push(formatMetricLine("process_uptime_seconds", uptime));

  lines.push("# HELP process_start_time_seconds Process start time in seconds since epoch.");
  lines.push("# TYPE process_start_time_seconds gauge");
  lines.push(formatMetricLine("process_start_time_seconds", startTimeSeconds));

  lines.push("# HELP process_resident_memory_bytes Resident memory size in bytes.");
  lines.push("# TYPE process_resident_memory_bytes gauge");
  lines.push(formatMetricLine("process_resident_memory_bytes", mem.rss));

  lines.push("# HELP process_heap_used_bytes Process heap used in bytes.");
  lines.push("# TYPE process_heap_used_bytes gauge");
  lines.push(formatMetricLine("process_heap_used_bytes", mem.heapUsed));

  lines.push("# HELP process_heap_total_bytes Process heap total in bytes.");
  lines.push("# TYPE process_heap_total_bytes gauge");
  lines.push(formatMetricLine("process_heap_total_bytes", mem.heapTotal));

  lines.push("# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.");
  lines.push("# TYPE process_cpu_user_seconds_total counter");
  lines.push(formatMetricLine("process_cpu_user_seconds_total", cpu.user / 1e6));

  lines.push("# HELP process_cpu_system_seconds_total Total system CPU time spent in seconds.");
  lines.push("# TYPE process_cpu_system_seconds_total counter");
  lines.push(formatMetricLine("process_cpu_system_seconds_total", cpu.system / 1e6));

  lines.push("# HELP clipforge_build_info Build metadata for ClipForge.");
  lines.push("# TYPE clipforge_build_info gauge");
  lines.push(formatMetricLine("clipforge_build_info", 1, { node: process.version }));

  const body = `${lines.join("\n")}\n`;
  const responseInit = withRateLimitHeaders(
    {
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store"
      }
    },
    rate
  );
  return new NextResponse(body, responseInit);
}
