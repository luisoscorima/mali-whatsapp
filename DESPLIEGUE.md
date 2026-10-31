# Despliegue en producción — `whatsapp.mali.pe`

Stack actual: contenedores **web** (nginx :80) + **api** (Nest :4000) + PostgreSQL + Redis. Meta: [docs/META-WABA.md](./docs/META-WABA.md). Local: [ARRANQUE.md](./ARRANQUE.md).

## Arquitectura

```txt
Usuario / Meta
      │
      ▼
Nginx Proxy Manager (HTTPS :443)
      │
      ▼
mali-whatsapp-web:80
      ├── /           → SPA
      ├── /api/*      → mali-whatsapp-api:4000
      ├── /health     → api
      └── /webhook    → api
```

Webhook Meta (sin cambiar URL): `https://whatsapp.mali.pe/webhook`.

## Variables clave (`.env`)

```env
NODE_ENV=production
APP_BASE_URL=https://whatsapp.mali.pe
BASE_PATH=
REQUIRE_AUTH=true
JWT_SECRET=<≥32 caracteres>
JWT_EXPIRES_IN=7d
REDIS_URL=redis://redis:6379
API_PORT=4000
DATABASE_URL=postgresql://USER:PASS@postgres:5432/mali_whatsapp
REQUIRE_WEBHOOK_SIGNATURE=true
VERIFY_TOKEN=...
APP_SECRET=...
# S3 (adjuntos de chat)
ACCESS_KEY_S3=...
SECRET_KEY_S3=...
BUCKET_NAME=...
CARPETA=...
AWS_REGION=us-east-1
```

Tokens WhatsApp / WABA / Page: Admin → Meta o `WHATSAPP_TOKEN_*` / `PHONE_NUMBER_ID_*` / `WABA_ID_*` (prioridad BD). Detalle: [docs/META-WABA.md](./docs/META-WABA.md).

Quitar `MASTER_INITIAL_PASSWORD` del servidor tras el primer seed.

## Nginx Proxy Manager

| Campo | Valor |
|-------|--------|
| Forward Hostname | `mali-whatsapp-web` |
| Forward Port | `80` |
| Esquema | `http` |
| Red Docker | `nginx-proxy-manager_default` |

## Despliegue habitual

En el servidor (raíz del repo):

```bash
./scripts/backup-postgres.sh          # o --skip-backup en el deploy
./scripts/deploy-production.sh        # pull + build api/web + up + /health
# Solo recrear sin rebuild:
docker compose up -d --force-recreate api web
```

Variables: `BRANCH` (default `main`), `COMPOSE`. Flags: `--no-cache`, `--skip-backup`.

## Comprobaciones

```bash
curl -sS https://whatsapp.mali.pe/health
# → {"ok":true,"db":"up"}

curl -sS -o /dev/null -w "%{http_code}" https://whatsapp.mali.pe/
# → 200

curl -sS -o /dev/null -w "%{http_code}" https://whatsapp.mali.pe/api/me
# → 401 sin token
```

Login, sync plantillas, mensaje de prueba en Inbox, verificar webhook en Meta Developers.

## Base de datos

- Al arrancar, la API ejecuta `prisma migrate deploy` (solo deltas pendientes).
- No recrear el volumen `postgres_data` por error.
- Si Postgres está fuera de este compose: apuntar `DATABASE_URL` al host real.

## Evidencia (histórico breve)

- 2026: cutover Express/EJS → Nest+React en el mismo dominio y misma BD; el directorio legacy `app/` ya no está en el árbol.
- La migración Prisma `20260702120000_init` se marcó como aplicada una vez sobre el esquema ya existente (`migrate resolve --applied`); no volver a ejecutarla sobre prod.
