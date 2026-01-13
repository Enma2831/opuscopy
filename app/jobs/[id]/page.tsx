"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import StageTimeline from "../../../components/StageTimeline";
import ClipCard from "../../../components/ClipCard";

export default function JobPage() {
  const params = useParams();
  const jobId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const [job, setJob] = useState<any>(null);
  const [clips, setClips] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let interval: NodeJS.Timeout | null = null;

    const fetchJob = async () => {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (active) {
          setError(payload.error ?? "Job not found");
        }
        return;
      }
      const data = await res.json();
      if (active) {
        setJob(data.job);
        setClips(data.clips ?? []);
        if (data.job?.status === "ready" || data.job?.status === "error") {
          if (interval) clearInterval(interval);
        }
      }
    };

    fetchJob();
    interval = setInterval(fetchJob, 3000);

    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [jobId]);

  const rerender = async (clipId: string, start: number, end: number) => {
    if (!jobId) return;
    await fetch(`/api/jobs/${jobId}/rerender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipId, start, end })
    });
  };

  if (error) {
    return <div className="text-ember">{error}</div>;
  }

  if (!job) {
    return <div className="text-white/60">Cargando...</div>;
  }

  return (
    <div className="space-y-10">
      <header className="rounded-[32px] border border-white/15 bg-white/5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/60">Job</p>
            <h1 className="mt-2 text-3xl uppercase text-white">{job.id}</h1>
            <p className="mt-2 text-sm text-white/60">Estado: {job.status}</p>
            {job.metadata?.title && (
              <p className="mt-2 text-sm text-white/50">Fuente: {job.metadata.title}</p>
            )}
          </div>
          <div className="w-full max-w-xs">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>Progreso</span>
              <span>{job.progress}%</span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-white/10">
              <div className="h-full rounded-full bg-neon" style={{ width: `${job.progress}%` }} />
            </div>
          </div>
        </div>
        <div className="mt-6">
          <StageTimeline stage={job.stage} />
        </div>
        {job.error && <p className="mt-4 text-sm text-ember">{job.error}</p>}
      </header>

      <section className="space-y-6">
        <h2 className="text-2xl uppercase text-white">Clips</h2>
        {clips.length === 0 && <p className="text-white/60">Aun no hay clips disponibles.</p>}
        <div className="grid gap-6 md:grid-cols-2">
          {clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onRerender={rerender} />
          ))}
        </div>
      </section>
    </div>
  );
}
