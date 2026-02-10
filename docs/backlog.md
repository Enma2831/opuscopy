# Backlog de gaps para producción (sin autenticación)

Este backlog prioriza lo que falta para que el proyecto sea “production‑ready”. Se basa en el estado actual del repo.

**P0 (bloqueadores de producción)**
1. Storage cloud real (S3/Blob).
Scope: implementar adapter real y configuración; dejar `StorageLocal` como fallback.
Evidence: `src/infrastructure/storage/s3Storage.ts` lanza `S3Storage not configured`.
Definition of done: subir/leer archivos en S3 con credenciales vía env vars y tests de integración.

2. CI/CD básico.
Scope: pipeline de lint/test/build + deploy artifacts (según hosting).
Evidence: no hay `.github/workflows`.
Definition of done: workflow en GitHub Actions que ejecute `npm test` y build de Next.js.

3. Observabilidad mínima.
Scope: health check, métricas básicas, error tracking.
Evidence: no hay endpoints de health ni APM/metrics.
Definition of done: `/api/health` y `/api/metrics` (o proveedor) y captura de errores en producción.

4. Logs estructurados y centralizados.
Scope: agregar logger estructurado (JSON) + envío a backend (Sentry/Datadog/ELK) y usar `JobLog`.
Evidence: `LocalLogger` a archivo y `JobLog` no se usa.
Definition of done: logs por job en DB/central; endpoint de logs protegido.

5. Rate limiting y protección de abuso global.
Scope: aplicar rate limit en todos los endpoints y/o gateway; persistente (Redis).
Evidence: solo existe limitador en `app/api/upload/route.ts` y es in‑memory.
Definition of done: límites configurables por IP/usuario con Redis.

6. Seguridad de uploads.
Scope: validaciones robustas + antivirus/malware scanning.
Evidence: solo límite de tamaño (`MAX_UPLOAD_MB`).
Definition of done: validación de tipos, size, y escaneo asíncrono antes de procesar.

7. Backups y DR para DB.
Scope: estrategia de backup, retención, restore y pruebas.
Evidence: no hay scripts ni docs.
Definition of done: job programado y runbook de recuperación.

8. HTTPS y headers de seguridad.
Scope: forzar HTTPS en prod y configurar CSP/CORS/HSTS.
Evidence: no hay config en `next.config.mjs` o middleware.
Definition of done: headers aplicados en todas las rutas y verificados.

**P1 (alto impacto, no bloqueante inmediato)**
1. Documentación de API (OpenAPI/Swagger).
Scope: spec de endpoints + ejemplos.
Evidence: no existe spec.
Definition of done: archivo OpenAPI publicado y actualizado.

2. Notificaciones (email/webhook).
Scope: hooks cuando un job termina o falla.
Evidence: no hay sistema de notificaciones.
Definition of done: webhook firmado + provider email (SendGrid/Resend).

3. Analytics/telemetría de negocio.
Scope: métricas de uso (clips procesados, tiempo promedio, errores).
Evidence: no hay tracking.
Definition of done: panel o export a BI.

4. i18n UI.
Scope: soporte multi‑idioma con traducciones.
Evidence: `app/layout.tsx` fija `lang="es"`.
Definition of done: selector de idioma y strings externalizados.

5. Caché avanzada.
Scope: usar Redis para cache de metadata/thumbnail/API.
Evidence: Redis solo para BullMQ.
Definition of done: estrategias de cache con invalidación.

6. Transcripción con proveedor SaaS.
Scope: integración OpenAI/GCP/AWS.
Evidence: solo CLI Whisper local o mock.
Definition of done: provider real con credenciales y fallback.

**P2 (mejoras y expansión)**
1. Detección de rostros (smart crop avanzado).
Scope: OpenCV/mediapipe para focalizar sujeto.
Evidence: crop actual es center crop.
Definition of done: modo smart crop configurable.

2. Escalabilidad horizontal avanzada.
Scope: LB, autoscaling, multi‑region.
Evidence: solo `WORKER_COUNT`/`WORKER_CONCURRENCY`.
Definition of done: despliegue con escalado automático.

3. Sistema de pagos.
Scope: Stripe/PayPal si se comercializa.
Evidence: no hay integración.
Definition of done: planes, billing y limits.

4. Tests E2E y performance.
Scope: suites E2E y stress/load.
Evidence: solo `tests/unit` y `tests/integration`.
Definition of done: pipelines con umbrales de performance.
