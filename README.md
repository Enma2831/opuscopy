# ClipForge

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
- Motion: barras de progreso, waveforms y estados con transiciones suaves (200-280ms).

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
| ALLOW_YOUTUBE_DOWNLOADS | Placeholder (no habilita descargas) | true |
| FFMPEG_LOUDNORM | 1 para loudnorm | 1 |
| MAX_UPLOAD_MB | Limite de upload en MB | 500 |
| WORKER_COUNT | Procesos worker para balanceo | 1 |
| WORKER_CONCURRENCY | Jobs concurrentes por proceso | 1 |
| WORKER_MAX_RSS_MB | Pausa nuevos jobs si supera RSS (0 desactiva) | 0 |

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
