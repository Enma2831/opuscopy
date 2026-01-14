import JobForm from "../components/JobForm";

export default function Home() {
  return (
    <div className="space-y-12">
      <header className="grid gap-8 md:grid-cols-[1.1fr_0.9fr] md:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/60">ClipForge</p>
          <h1 className="mt-4 text-5xl uppercase leading-[0.9] text-white md:text-6xl">
            Highlights verticales
            <span className="block text-neon">listos para Shorts</span>
          </h1>
          <p className="mt-6 text-lg text-white/70">
            Pega un link o sube tu video. ClipForge detecta momentos clave, reencuadra a 9:16, normaliza audio y
            genera subtitulos listos para TikTok, Reels y YouTube Shorts.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-xs uppercase tracking-[0.3em] text-white/50">
            <span className="rounded-full border border-white/20 px-3 py-1">Smart crop</span>
            <span className="rounded-full border border-white/20 px-3 py-1">Whisper ready</span>
            <span className="rounded-full border border-white/20 px-3 py-1">Export MP4 + SRT</span>
          </div>
        </div>
        <div className="rounded-[32px] border border-white/15 bg-white/5 p-6 shadow-glow">
          <div className="rounded-3xl border border-white/15 bg-black/30 p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-white/60">Pipeline</p>
            <div className="mt-4 space-y-4 text-sm text-white/70">
              <div className="flex items-center justify-between">
                <span>Download / ingest</span>
                <span className="text-neon">01</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Transcribe + VAD</span>
                <span className="text-neon">02</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Highlights + scoring</span>
                <span className="text-neon">03</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Render vertical clips</span>
                <span className="text-neon">04</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-8 md:grid-cols-[1.2fr_0.8fr]">
        <JobForm allowYoutubeDownloads={process.env.ALLOW_YOUTUBE_DOWNLOADS === "true"} />
        <div className="space-y-6 rounded-[32px] border border-white/15 bg-white/5 p-6">
          <h2 className="text-2xl uppercase text-white">Uso responsable</h2>
          <p className="text-sm text-white/70">
            Solo usar contenido propio o con permisos/licencia. Si una fuente bloquea descargas o procesamiento, la app
            mostrara un error y recomendara subir un archivo propio.
          </p>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs uppercase tracking-[0.3em] text-white/60">
            Sin bypass de DRM, sin evasiones.
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs uppercase tracking-[0.3em] text-white/60">
            Proteccion de datos en almacenamiento local.
          </div>
        </div>
      </section>
    </div>
  );
}
