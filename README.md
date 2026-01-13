# ClipForge

ClipForge convierte videos en clips verticales con subtitulos listos para TikTok, Shorts y Reels.

## Aviso legal
Solo usar contenido propio o con permisos/licencia. No se implementa bypass de DRM ni descargas prohibidas. Si un proveedor bloquea descargas, ClipForge muestra un error y recomienda subir un archivo propio.

## Stack
- Next.js 14 + TypeScript + Tailwind (App Router)
- Node.js route handlers + BullMQ + Redis
- FFmpeg para render
- Whisper CLI (opcional) para transcripcion
- MySQL + Prisma
- Storage local en ./storage con adapter extensible

FFmpeg debe estar disponible en el PATH dentro del contenedor o en tu maquina local.

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
- `DATABASE_URL`: conexion MySQL
- `REDIS_URL`: conexion Redis
- `STORAGE_PATH`: carpeta de archivos
- `LOGS_PATH`: carpeta de logs
- `WHISPER_PROVIDER`: `mock` o `whisper`
- `WHISPER_CMD`: comando Whisper CLI
- `WHISPER_MODEL`: modelo Whisper
- `FFMPEG_LOUDNORM`: `1` para loudnorm
- `WHISPER_DEVICE`: `cpu` o `cuda`
- `MAX_UPLOAD_MB`: limite de upload en MB

## Pipeline
1. Ingesta / download (upload local o metadata de YouTube)
2. Transcripcion (Whisper o mock)
3. Deteccion de highlights (energia + transcript)
4. Render clips 9:16 con subtitulos

El smart crop actual usa center crop. Puedes extenderlo con deteccion de rostro (OpenCV) en `src/infrastructure/render`.

## Tests
```
npm test
```

## Notas
- La descarga directa de YouTube esta deshabilitada por defecto. Usa upload de archivo.
- `samples/sample.wav` es un archivo dummy para pruebas locales.
- En modo dev, `GET /api/jobs/:id/logs` devuelve el log del job.
- `ALLOW_YOUTUBE_DOWNLOADS` es un placeholder y no habilita descargas en este MVP.
