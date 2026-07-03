# Arranque v2 — MALI WhatsApp

Guía para desarrollar la migración NestJS + React en la rama `migrate/v2`. El panel legacy (`app/`) sigue en producción sin cambios.

## Requisitos

- Node.js 20+
- Docker y Docker Compose (recomendado para Postgres y Redis)
- Archivo `.env` en la raíz (copiar desde `.env.example`)

## Opción A — Docker Compose (recomendado)

Levanta legacy, API v2, web v2, Postgres y Redis:

```bash
cp .env.example .env   # si aún no existe
docker compose -f docker-compose.dev.yml up --build
```

| Servicio | URL |
|----------|-----|
| Panel legacy | http://localhost:3000 |
| API NestJS | http://localhost:4000 |
| Web React | http://localhost:5173 |
| Postgres | localhost:5435 |
| Redis | localhost:6379 |

Comprobación rápida:

```bash
curl http://localhost:4000/health
# → {"ok":true,"db":"up"}
```

Si cambias dependencias en `package.json`, reconstruye:

```bash
docker compose -f docker-compose.dev.yml build --no-cache api web
docker compose -f docker-compose.dev.yml up
```

## Opción B — npm en el host

Instala dependencias del monorepo:

```bash
npm install
```

### Postgres y Redis

Asegúrate de que Postgres y Redis estén corriendo (p. ej. solo esos servicios de Compose):

```bash
docker compose -f docker-compose.dev.yml up postgres redis -d
```

Para la API desde el host, `DATABASE_URL` debe apuntar a `localhost:5435` (no `postgres`):

```bash
export DATABASE_URL="postgresql://mali_user:TU_CLAVE@localhost:5435/mali_whatsapp"
export API_PORT=4000
npm run prisma:generate
npm run dev:api
```

En otra terminal:

```bash
npm run dev:web
```

## Prisma

El esquema se introspecta desde la BD legacy (`app/src/db/migrations.js` sigue siendo la fuente de verdad en producción).

```bash
# Con Postgres accesible (ajusta DATABASE_URL si corres desde el host)
DATABASE_URL="postgresql://mali_user:TU_CLAVE@localhost:5435/mali_whatsapp" npm run prisma:pull
npm run prisma:generate
```

Archivos relevantes:

- [`api/prisma/schema.prisma`](api/prisma/schema.prisma) — modelos introspectados
- [`api/src/prisma/prisma.module.ts`](api/src/prisma/prisma.module.ts) — módulo global NestJS

## Producción

`docker-compose.yml` incluye Redis desde Semana 2. Los servicios `api` y `web` en producción se añadirán en etapas posteriores; el contenedor `app` (legacy) no cambia.

## Autenticación JWT (Semana 3)

- `POST /api/auth/login` — email `@mali.pe` + contraseña → `{ ok, data: { accessToken, user } }`
- `GET /api/me` — cabecera `Authorization: Bearer <token>`
- Con `REQUIRE_AUTH=false` (dev): la API devuelve usuario simulado (`DEV_AREA`) sin token

Variables en `.env`:

```env
JWT_SECRET=...          # obligatorio si REQUIRE_AUTH=true
JWT_EXPIRES_IN=7d
```

Prueba rápida:

```bash
curl -s http://localhost:4000/api/me
curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"tu@mali.pe","password":"..."}'
```

## Siguiente etapa

Semana 4: `apiClient` en React, proxy dev y convención `{ ok, data?, error? }`. Ver [`MIGRACION_REACT.md`](MIGRACION_REACT.md).
