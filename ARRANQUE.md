# Arranque local — MALI WhatsApp

Stack: NestJS + React + Prisma + PostgreSQL + Redis. Producto: [README.md](./README.md). Dominios: [docs/README.md](./docs/README.md). Producción: [DESPLIEGUE.md](./DESPLIEGUE.md).

## Requisitos

- Node.js 20+
- Docker y Docker Compose
- `.env` en la raíz (desde `.env.example`)

## Docker Compose (recomendado)

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

| Servicio | URL |
|----------|-----|
| API NestJS | http://localhost:4000 |
| Web React | http://localhost:5173 |
| Postgres | localhost:5435 |
| Redis | localhost:6379 |

```bash
curl http://localhost:4000/health
# → {"ok":true,"db":"up"}
```

## npm en el host

```bash
npm install
docker compose -f docker-compose.dev.yml up postgres redis -d

export DATABASE_URL="postgresql://mali_user:TU_CLAVE@localhost:5435/mali_whatsapp"
export API_PORT=4000
npm run prisma:generate
npm run dev:api   # terminal 1
npm run dev:web   # terminal 2
```

## Auth

- `POST /api/auth/login` → `{ ok, data: { accessToken, user } }`
- `GET /api/me` → `Authorization: Bearer <token>`
- `REQUIRE_AUTH=false` (dev): usuario simulado sin token

```env
JWT_SECRET=...       # obligatorio con REQUIRE_AUTH=true
JWT_EXPIRES_IN=7d
```

Cliente web: `web/src/shared/api/` (`apiClient`, `{ ok, data?, error? }`, proxy `/api` y `/health`).

## Redis (obligatorio)

| Cola | Trabajos |
|------|----------|
| `campaigns` | Envío y reintentos |
| `maintenance` | Programadas, purge bitácora, reanudar cola |

```env
REDIS_URL=redis://localhost:6379   # host
REDIS_URL=redis://redis:6379       # Compose
```

Sin Redis la API no procesa campañas ni mantenimiento.

## Prisma

Esquema: `api/prisma/schema.prisma`. Al arrancar la API: `prisma migrate deploy` y seed si aplica.

```bash
export DATABASE_URL="postgresql://mali_user:CLAVE@localhost:5435/mali_whatsapp"
npm run prisma:migrate
npm run prisma:seed
npm run prisma:generate
# desarrollo de esquema:
npm run prisma:migrate:dev
```

Si la BD ya existía antes de Prisma Migrate y `deploy` falla con «relation already exists»:

```bash
cd api
DATABASE_URL="postgresql://..." npx prisma migrate resolve --applied 20260702120000_init
```

## Plantillas (smoke)

Credenciales Meta en `.env` o Admin → Meta. En el panel: Plantillas → sincronizar → crear (queda `PENDING` hasta Meta).
