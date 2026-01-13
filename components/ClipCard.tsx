"use client";

import { useState } from "react";
import { formatDuration } from "../lib/format";

export default function ClipCard({
  clip,
  onRerender
}: {
  clip: any;
  onRerender: (clipId: string, start: number, end: number) => Promise<void>;
}) {
  const [start, setStart] = useState(clip.start);
  const [end, setEnd] = useState(clip.end);
  const [loading, setLoading] = useState(false);
  const minRange = Math.max(0, clip.start - 5);
  const maxRange = clip.end + 5;

  const handleRerender = async () => {
    setLoading(true);
    await onRerender(clip.id, start, end);
    setLoading(false);
  };

  return (
    <div className="rounded-3xl border border-white/15 bg-white/5 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-semibold text-white">Clip #{clip.id.slice(0, 6)}</h4>
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">{clip.reason || "highlight"}</p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">{clip.status}</span>
      </div>

      <div className="mt-4 aspect-[9/16] overflow-hidden rounded-2xl bg-black/50">
        {clip.status === "ready" ? (
          <video className="h-full w-full object-cover" controls src={`/api/clips/${clip.id}/download`} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/40">Render pending</div>
        )}
      </div>

      <div className="mt-4 grid gap-3 text-sm text-white/70">
        <div className="flex items-center justify-between">
          <span>Inicio</span>
          <input
            type="number"
            value={start}
            step={0.1}
            min={0}
            onChange={(event) => setStart(Number(event.target.value))}
            className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-right"
          />
        </div>
        <input
          type="range"
          min={minRange}
          max={Math.max(minRange + 1, end - 0.5)}
          step={0.1}
          value={start}
          onChange={(event) => setStart(Number(event.target.value))}
          className="accent-neon"
        />
        <div className="flex items-center justify-between">
          <span>Fin</span>
          <input
            type="number"
            value={end}
            step={0.1}
            min={start + 0.5}
            onChange={(event) => setEnd(Number(event.target.value))}
            className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-right"
          />
        </div>
        <input
          type="range"
          min={Math.min(maxRange - 1, start + 0.5)}
          max={maxRange}
          step={0.1}
          value={end}
          onChange={(event) => setEnd(Number(event.target.value))}
          className="accent-ember"
        />
        <div className="flex items-center justify-between text-xs text-white/40">
          <span>Duracion</span>
          <span>{formatDuration(Math.max(0, end - start))}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={handleRerender}
          className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/70 hover:border-neon"
          disabled={loading}
        >
          {loading ? "Rendering" : "Re-render"}
        </button>
        <a
          href={`/api/clips/${clip.id}/download`}
          className="rounded-full bg-neon px-4 py-2 text-xs uppercase tracking-[0.2em] text-ink"
        >
          Download MP4
        </a>
        {clip.hasSrt && (
          <a
            href={`/api/clips/${clip.id}/subtitles?format=srt`}
            className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/70"
          >
            SRT
          </a>
        )}
        {clip.hasVtt && (
          <a
            href={`/api/clips/${clip.id}/subtitles?format=vtt`}
            className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/70"
          >
            VTT
          </a>
        )}
      </div>
    </div>
  );
}
