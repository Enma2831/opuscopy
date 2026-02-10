# ClipForge
[![CI](https://github.com/Enma2831/opuscopy/actions/workflows/ci.yml/badge.svg)](https://github.com/Enma2831/opuscopy/actions/workflows/ci.yml)

<p align="center">
  <img src="docs/clipforge-hero.svg" alt="ClipForge hero banner" width="100%" />
</p>

<p align="center">
  <strong>Convierte videos largos en clips verticales listos para TikTok, Shorts y Reels.</strong><br/>
  Subtitulos, highlights y render rapido con un pipeline reproducible y escalable.
</p>

## Que ofrece
- Pipeline end-to-end: ingesta, transcripcion, deteccion de highlights y render 9:16.
- Subtitulos como archivo SRT/VTT o quemados en video.
- Render con FFmpeg y cortes precisos por segmentos.
- Arquitectura hexagonal para cambiar storage, transcripcion y render sin romper el core.
- Cola con BullMQ + Redis para jobs pesados y procesamiento paralelo.

## Sistema visual (direccion UI)
- Tipografia sugerida: Space Grotesk + Sora para un look tecnico y moderno.
- Paleta base: #0b1f2a (midnight), #ff6f61 (ember), #ffb347 (sun), #2dd4bf (aqua), #f8fafc (mist).
- Layout: panel central con progreso claro, previews en grid y control de re-render por clip.
- Motion: barras de progreso, pulsos de estado y reveals escalonados (200-280ms).

## Motion preview
<p align="center">
  <img src="docs/clipforge-motion.svg" alt="ClipForge motion preview" width="100%" />
</p>

## Arquitectura (hexagonal)
```
[UI Next.js]
     |
[API routes] --> [Use cases] --> [Ports] <-- [Infra adapters]
                               |-- StorageLocal/S3
                               |-- WhisperTranscriber
                               |-- HybridHighlightDetector
                               |-- FfmpegRenderer
                               |-- PrismaRepo
                               |-- RedisQueue
```

## Pipeline
1. Ingesta / download (upload local o metadata de YouTube)
2. Transcripcion (Whisper o mock)
3. Deteccion de highlights (energia + transcript)
4. Render clips 9:16 con subtitulos

El smart crop actual usa center crop. Puedes extenderlo con deteccion de rostro (OpenCV) en `src/infrastructure/render`.

## Rendimiento y balanceo
- `WORKER_COUNT`: cantidad de procesos worker para distribuir jobs.
- `WORKER_CONCURRENCY`: jobs concurrentes por proceso.
- `WORKER_MAX_RSS_MB`: pausa nuevos jobs si el RSS supera el limite (0 desactiva).

FFmpeg debe estar disponible en el PATH dentro del contenedor o en tu maquina local.

## Docker Compose
Requisitos: Docker y Docker Compose.

```
docker compose up --build
```

Servicios:
- app: Next.js
- worker: BullMQ worker
- redis: cola

Para usar MySQL local desde Docker, la URL usa `host.docker.internal` en `docker-compose.yml`.

## Local dev (sin Docker)
1. Copiar `.env.example` a `.env`
2. Instalar dependencias y generar Prisma:
```
npm install
npx prisma generate
```
3. Levantar DB y Redis
   - MySQL local: crea la DB `clipforge` y ajusta `DATABASE_URL` en `.env`.
4. Ejecutar:
```
npm run dev
npm run worker
```

## Variables de entorno
| Variable | Descripcion | Ejemplo |
| --- | --- | --- |
| DATABASE_URL | Conexion MySQL | mysql://USER:PASSWORD@localhost:3306/clipforge |
| REDIS_URL | Conexion Redis | redis://localhost:6379 |
| STORAGE_PATH | Carpeta de archivos | ./storage |
| LOGS_PATH | Carpeta de logs | ./logs |
| WHISPER_PROVIDER | mock o whisper | mock |
| WHISPER_CMD | Comando Whisper CLI | whisper |
| WHISPER_MODEL | Modelo Whisper | base |
| WHISPER_DEVICE | cpu o cuda | cpu |
| ALLOW_YOUTUBE_DOWNLOADS | Permite descargar videos completos desde YouTube | false |
| ALLOW_YOUTUBE_STREAMING | Permite streaming con yt-dlp sin descargar el video completo | false |
| YT_MAX_HEIGHT | Altura maxima para clips streaming | 720 |
| YT_CLIP_TIMEOUT_MS | Timeout para clipping/streaming en ms | 300000 |
| YT_DOWNLOAD_TIMEOUT_MS | Timeout para descargas completas en ms | 600000 |
| FFMPEG_LOUDNORM | 1 para loudnorm | 1 |
| MAX_UPLOAD_MB | Limite de upload en MB | 500 |
| WORKER_COUNT | Procesos worker para balanceo | 1 |
| WORKER_CONCURRENCY | Jobs concurrentes por proceso | 1 |
| WORKER_MAX_RSS_MB | Pausa nuevos jobs si supera RSS (0 desactiva) | 0 |
| RATE_LIMIT_MAX | Max requests por ventana (default global) | 30 |
| RATE_LIMIT_WINDOW_MS | Ventana global en ms | 60000 |
| RATE_LIMIT_PREFIX | Prefijo Redis para rate limit | clipforge:rate |

## Rate limiting
Se aplica por IP a todos los endpoints. Si Redis no esta disponible, hace fallback en memoria (por instancia).

Headers en respuesta:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset` (epoch seconds)
- `Retry-After` (solo cuando responde 429)

Buckets y limites por defecto (por ventana):
- `jobs-create`: 20
- `jobs-read`: 60
- `jobs-rerender`: 20
- `jobs-logs`: 30
- `clips-create`: 20
- `clips-download`: 60
- `clips-subtitles`: 60
- `upload`: 10
- `health`: 120
- `metrics`: 120

Overrides por bucket:
- `RATE_LIMIT_<BUCKET>_MAX`
- `RATE_LIMIT_<BUCKET>_WINDOW_MS`

Ejemplo: para `jobs-create` usar `RATE_LIMIT_JOBS_CREATE_MAX` y `RATE_LIMIT_JOBS_CREATE_WINDOW_MS`.

## Tests
```
npm test
```

## Aviso legal
Solo usar contenido propio o con permisos/licencia. No se implementa bypass de DRM ni descargas prohibidas. Si un proveedor bloquea descargas, ClipForge muestra un error y recomienda subir un archivo propio.

## Notas
- La descarga directa de YouTube esta deshabilitada por defecto. Usa upload de archivo.
- `samples/sample.wav` es un archivo dummy para pruebas locales.
- En modo dev, `GET /api/jobs/:id/logs` devuelve el log del job.
