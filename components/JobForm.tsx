"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const clipCounts = [3, 4, 5, 6, 7, 8, 9, 10];
const languages = [
  { value: "es", label: "Espanol" },
  { value: "en", label: "English" },
  { value: "pt", label: "Portugues" }
];

export default function JobForm({ allowYoutubeDownloads = true }: { allowYoutubeDownloads?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState({
    language: "es",
    clipCount: 5,
    durationPreset: "normal",
    subtitles: "srt",
    smartCrop: true
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let uploadId: string | null = null;
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (!uploadRes.ok) {
          throw new Error("Upload failed");
        }
        const uploadJson = await uploadRes.json();
        uploadId = uploadJson.uploadId;
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType: url ? "youtube" : "upload", sourceUrl: url || null, uploadId, options })
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to create job");
      }

      const data = await res.json();
      router.push(`/jobs/${data.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur">
        <label className="block text-sm uppercase tracking-[0.2em] text-white/60">YouTube URL</label>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://youtube.com/watch?v=..."
          className="mt-3 w-full rounded-2xl border border-white/20 bg-black/30 px-4 py-3 text-white placeholder:text-white/40"
        />
        {!allowYoutubeDownloads ? (
          <p className="mt-3 text-xs text-ember">Descarga de YouTube deshabilitada. Sube tu archivo propio o con licencia.</p>
        ) : (
          <p className="mt-3 text-xs text-white/50">Solo usar contenido propio o con permisos/licencia. Si no se puede descargar, sube tu archivo.</p>
        )}
      </div>

      <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur">
        <label className="block text-sm uppercase tracking-[0.2em] text-white/60">Upload video</label>
        <input
          type="file"
          accept="video/*,audio/*"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="mt-3 block w-full text-sm text-white/80 file:mr-4 file:rounded-full file:border-0 file:bg-ember file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black"
        />
        <p className="mt-3 text-xs text-white/50">Formatos recomendados: MP4, MOV, MP3, WAV.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur">
          <label className="text-sm uppercase tracking-[0.2em] text-white/60">Idioma</label>
          <select
            value={options.language}
            onChange={(event) => setOptions({ ...options, language: event.target.value })}
            className="mt-3 w-full rounded-2xl border border-white/20 bg-black/30 px-4 py-3 text-white"
          >
            {languages.map((lang) => (
              <option key={lang.value} value={lang.value} className="text-black">
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur">
          <label className="text-sm uppercase tracking-[0.2em] text-white/60">Cantidad de clips</label>
          <select
            value={options.clipCount}
            onChange={(event) => setOptions({ ...options, clipCount: Number(event.target.value) })}
            className="mt-3 w-full rounded-2xl border border-white/20 bg-black/30 px-4 py-3 text-white"
          >
            {clipCounts.map((count) => (
              <option key={count} value={count} className="text-black">
                {count}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur">
          <label className="text-sm uppercase tracking-[0.2em] text-white/60">Duracion</label>
          <div className="mt-3 flex gap-2">
            {["short", "normal", "long"].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setOptions({ ...options, durationPreset: preset })}
                className={`flex-1 rounded-2xl px-4 py-3 text-sm uppercase tracking-wide ${
                  options.durationPreset === preset
                    ? "bg-neon text-ink"
                    : "border border-white/20 bg-black/30 text-white/70"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur">
          <label className="text-sm uppercase tracking-[0.2em] text-white/60">Subtitulos</label>
          <select
            value={options.subtitles}
            onChange={(event) => setOptions({ ...options, subtitles: event.target.value })}
            className="mt-3 w-full rounded-2xl border border-white/20 bg-black/30 px-4 py-3 text-white"
          >
            <option value="off" className="text-black">Off</option>
            <option value="srt" className="text-black">SRT</option>
            <option value="burned" className="text-black">Burned-in</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Reencuadre 9:16</h3>
          <p className="text-sm text-white/60">Centro inteligente con crop seguro para Shorts.</p>
        </div>
        <button
          type="button"
          onClick={() => setOptions({ ...options, smartCrop: !options.smartCrop })}
          className={`rounded-full px-6 py-2 text-sm uppercase tracking-widest ${
            options.smartCrop ? "bg-ember text-ink shadow-ember" : "border border-white/30 text-white/70"
          }`}
        >
          {options.smartCrop ? "Smart ON" : "Smart OFF"}
        </button>
      </div>

      {error && <p className="text-sm text-ember">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-2xl bg-ember px-6 py-4 text-lg font-semibold uppercase tracking-wider text-ink shadow-ember transition hover:-translate-y-0.5 hover:shadow-glow disabled:opacity-60"
      >
        {loading ? "Procesando..." : "Generar clips"}
      </button>
    </form>
  );
}
