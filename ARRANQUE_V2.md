# Arranque v2 — MALI WhatsApp

Plataforma **aislada** (NestJS + React + Prisma). No usa el panel legacy `app/` en runtime.

Ver [`app/DEPRECATED.md`](app/DEPRECATED.md) y [`MIGRACION_REACT.md`](MIGRACION_REACT.md).

## Requisitos

- Node.js 20+
- Docker y Docker Compose
- `.env` en la raíz (copiar desde `.env.example`)

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

## Auth JWT

- `POST /api/auth/login` → `{ ok, data: { accessToken, user } }`
- `GET /api/me` → `Authorization: Bearer <token>`
- `REQUIRE_AUTH=false` (dev): usuario simulado sin token

```env
JWT_SECRET=...       # obligatorio con REQUIRE_AUTH=true
JWT_EXPIRES_IN=7d
```

## Cliente API (web)

[`web/src/shared/api/`](web/src/shared/api/) — `apiClient`, convención `{ ok, data?, error? }`, proxy `/api` y `/health`.

## Producción v2

`docker-compose.yml` levanta **api + web + postgres + redis** (sin contenedor legacy).

Nginx Proxy Manager apunta al servicio `web` (React) y/o `api` según rutas.

## Prisma

Esquema en [`api/prisma/schema.prisma`](api/prisma/schema.prisma). En v2 la fuente de verdad pasará a **Prisma Migrate** (no `app/src/db/migrations.js`).

```bash
DATABASE_URL="postgresql://..." npm run prisma:pull
npm run prisma:generate
```

## Siguiente etapa

Etapa 5 — campañas (`CampaignsModule`). Ver [`MIGRACION_REACT.md`](MIGRACION_REACT.md).

## Plantillas WhatsApp (staging)

Requiere credenciales Meta en `.env` (`WHATSAPP_TOKEN_*`, `PHONE_NUMBER_ID_*`, opcional `WABA_ID_*`, `META_APP_ID` para cabeceras media).

1. Inicia sesión en la web v2 y abre **Plantillas**.
2. **Sincronizar todo** — trae plantillas existentes desde Meta.
3. **Nueva plantilla** — completa el builder, revisa la vista previa y confirma el envío a Meta.
4. Tras crear o editar, el estado queda `PENDING` hasta que Meta apruebe o rechace.
5. Vuelve a sincronizar para actualizar estados y motivos de rechazo.

Validación previa al envío: el formulario valida en cliente y llama `POST /api/templates/validate` antes de crear en Meta.

Definición para campañas (futuro): `GET /api/templates/:id/definition`.
