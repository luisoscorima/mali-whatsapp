# Plan de migración por etapas — MALI WhatsApp v2

**Objetivo:** escalar producto y código sin parar producción (`whatsapp.mali.pe`).  
**Stack objetivo:**

| Capa | Tecnología |
|------|------------|
| API | NestJS + Prisma + PostgreSQL |
| Colas / cache | Redis (BullMQ — fase tardía) |
| Web | React + Vite + TypeScript + Tailwind |
| Legacy (transitorio) | Express + EJS en `app/` |

**Estrategia:** strangler fig — el panel EJS sigue en producción mientras v2 crece en paralelo; webhook, envío de campañas y mensajes del inbox se migran **al final** y con mucho cuidado.

Relacionado con: [Mejoras.md](Mejoras.md) (backlog de producto).

---

## Cómo usar este documento

1. Elegir **rama** o **repo nuevo** (sección siguiente).
2. Trabajar **una semana = una fila** de la tabla de seguimiento.
3. Al cerrar la semana: marcar estado, anotar PR/commit, actualizar «Próxima semana».
4. No saltar semanas de módulos críticos (campañas, inbox) sin cumplir el DoD.

**Ritmo orientativo:** 1 dev a tiempo completo ≈ **50 semanas** (~12 meses). Con 2 devs (API + Web) ≈ **28–32 semanas**.

---

## Rama vs repo nuevo

| Criterio | Rama `migrate/v2` (mismo repo) | Repo nuevo `mali-whatsapp-v2` |
|----------|-------------------------------|-------------------------------|
| Historial git | Un solo repo, PRs contra `main` | Historial limpio; legacy como remoto/subtree |
| Deploy producción | Más simple al inicio (mismo Docker) | Requiere pipeline aparte hasta cutover |
| Aislamiento | Convive con `app/` legacy | Cero riesgo de tocar prod accidentalmente |
| Recomendado si… | Equipo pequeño, deploys frecuentes | Queréis reiniciar CI, monorepo npm/pnpm workspaces |

### Estructura objetivo (ambas opciones)

```txt
mali-whatsapp-mvp/          # o mali-whatsapp-v2/
  app/                      # Legacy Express + EJS (prod hasta cutover final)
  api/                      # NestJS + Prisma
    src/
      modules/              # auth, contacts, campaigns…
    prisma/
      schema.prisma
  web/                      # React + Vite + Tailwind
    src/
      app/                  # router, providers
      features/             # inbox, campaigns, contacts…
      shared/               # ui, api-client, hooks
  docker-compose.yml        # postgres (existente) + redis + api + web + legacy
  MIGRACION_REACT.md        # este archivo
```

### Convención de ramas (si mismo repo)

```txt
main              → producción (solo legacy hasta cutover por módulo)
migrate/v2        → rama larga de migración
migrate/w01-setup → PR semanal contra migrate/v2 (opcional)
```

### Arranque repo nuevo (Semana 1)

```bash
# Opción A — rama
git checkout -b migrate/v2

# Opción B — repo nuevo
git clone <url-actual> mali-whatsapp-v2 && cd mali-whatsapp-v2
git remote rename origin legacy
git checkout -b main   # primer commit solo con api/ + web/ scaffold
```

---

## Principios (no negociables)

| # | Regla |
|---|--------|
| 1 | **Producción siempre usable:** cada semana deja el legacy intacto hasta cutover validado del módulo. |
| 2 | **API-first:** toda feature nueva nace en Nest + React; no pantallas EJS grandes. |
| 3 | **Lógica en servicios:** portar desde `app/src/services/` a providers Nest; controllers delgados. |
| 4 | **No duplicar envíos:** campañas y chat reutilizan la misma lógica (portada, no reescrita desde cero). |
| 5 | **Cutover por módulo** con flag (`UI_V2_CONTACTS=1`) o ruta `/app/*` → swap a URL definitiva. |
| 6 | **Prisma progresivo:** introspect del esquema actual; `migrations.js` legacy sigue en prod hasta Etapa 9. |
| 7 | **Redis al final:** colas BullMQ solo cuando workers estén listos; hasta entonces polling como legacy. |
| 8 | **Tailwind en Etapa 10:** semanas 1–9 usan variables CSS del tema (`--ink`, `--muted`…); pulido visual al cierre. |

---

## Arquitectura en runtime (transición)

```txt
                    ┌─────────────────┐
  Usuario ─────────►│ Nginx / NPM     │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
   /webhook, /app/*    /api/* (v2)         /campaigns, /conversations…
   (legacy Express)   NestJS :4000        (legacy EJS)
         │                   │
         └─────────┬─────────┘
                   ▼
            PostgreSQL (compartido)
                   │
            Redis (desde Etapa 9)
```

- `GET/POST /webhook` → **legacy** hasta Semana 43.
- React en `/app/*` al inicio; cutover cambia a rutas canónicas.
- Sesión: fase 1 cookie legacy; fase 2 JWT o session store Redis en Nest.

---

## Inventario: API hoy vs falta

| Módulo | EJS legacy | API hoy (Express) | Nest v2 |
|--------|------------|-------------------|---------|
| Auth / login | Sí | — | `GET /api/me`, `POST /api/auth/login` |
| Campañas | Sí | Parcial | Lista, detalle, crear, exports |
| Conversaciones | Sí | `PATCH mode` | Lista, hilo, enviar, media |
| Contactos | Sí | — | CRUD, filtros, import |
| Segmentos | Sí | — | CRUD + contactos |
| Plantillas | Sí | `definition` | CRUD + sync |
| Atributos | Sí | `options` | CRUD |
| Anuncios CTWA | Sí | — | List + detalle + rename |
| Exclusiones | Sí | — | CRUD listas |
| Ajustes / IA | Sí | Parcial | Config completa |
| Admin | Sí | `online-users` | Usuarios, meta, audit |
| Informes | — | — | **Solo v2** |

---

## Etapas y calendario semanal

Cada **semana** tiene: entregable concreto, criterio de cierre y riesgo.

---

### Etapa 0 — Arranque (Semanas 1–2)

**Meta:** monorepo listo, CI local, sin impacto en usuarios.

| Sem | Entregable | DoD (cerrar semana) | Riesgo |
|-----|------------|---------------------|--------|
| **1** | Repo/rama + scaffold `api/` (NestJS) + `web/` (Vite+React+TS) | `npm run start:dev` en api responde `GET /health`; `npm run dev` en web abre página vacía | Bajo |
| **2** | Docker Compose: postgres + redis + api + web; Prisma introspect | `schema.prisma` refleja tablas actuales; api conecta a BD existente; README de arranque v2 | Bajo |

**Tareas detalladas S1:** `nest new api`, `npm create vite@latest web -- --template react-ts`, workspaces en root `package.json`, `.env.example` unificado.

**Tareas detalladas S2:** `npx prisma db pull`, servicio `PrismaModule`, Redis container (sin uso aún), script `docker compose up` documentado.

---

### Etapa 1 — Cimientos API + shell web (Semanas 3–5)

**Meta:** auth básica, cliente API, shell navegable.

| Sem | Entregable | DoD | Riesgo |
|-----|------------|-----|--------|
| **3** | Módulo `AuthModule`: guards, área, permisos; `GET /api/me` | React muestra usuario logueado vía cookie proxy o login dev | Medio |
| **4** | `apiClient` en web; convención `{ ok, data?, error? }`; proxy dev | 401 redirige a login; `/health` y `/api/me` desde web | Bajo |
| **5** | `AppShell` + React Router bajo `/app`; enlace «Panel clásico» en EJS legacy | Navegación SPA sin reload; dashboard placeholder consume `GET /api/dashboard` (proxy Nest → legacy o reimplementado) | Bajo |

**Nota S3:** Opción rápida — Nest proxy a Express para `/api/dashboard` mientras se portan queries. Opción limpia — reimplementar dashboard en Prisma.

---

### Etapa 2 — Módulos bajo riesgo (Semanas 6–9)

**Meta:** primer cutover end-to-end (Anuncios Meta).

| Sem | Entregable | DoD | Riesgo |
|-----|------------|-----|--------|
| **6** | `MetaAdsModule`: `GET /api/meta-ads`, `GET /api/meta-ads/:id` | Paridad datos con EJS `/anuncios` | Bajo |
| **7** | `PATCH /api/meta-ads/:id` + pantallas React list/detail | CRUD nombre editable; beta `/app/anuncios` | Bajo |
| **8** | `AttributeDefinitionsModule` CRUD + UI React | Cutover `/attributes` con flag | Bajo |
| **9** | `ExclusionListsModule` CRUD + UI React | Listas de exclusión operativas en v2 | Bajo |

**Cutover S7:** flag `UI_V2_META_ADS=1` → redirect EJS a React.

---

### Etapa 3 — Segmentos y contactos (Semanas 10–15)

**Meta:** gestión de audiencia en v2.

| Sem | Entregable | DoD | Riesgo |
|-----|------------|-----|--------|
| **10** | `SegmentsModule`: list + create + edit + color | API completa | Bajo |
| **11** | UI segmentos + quitar contacto de segmento | Beta `/app/segments` | Bajo |
| **12** | `ContactsModule`: `GET /api/contacts` filtros + paginación | Paridad filtros EJS | Medio |
| **13** | Contacto CRUD + formulario atributos dinámicos | Alta/edición funcional | Medio |
| **14** | Import CSV/XLSX `POST /api/contacts/import` + sample | Import masivo probado en staging | Medio |
| **15** | Cutover `/contacts` + `/segments` | 1 semana beta área TI | Medio |

**Producto en S12–15:** fecha creación contacto, filtro `fecha_pago`, export (ver [Mejoras.md](Mejoras.md)).

---

### Etapa 4 — Plantillas (Semanas 16–19)

| Sem | Entregable | DoD | Riesgo |
|-----|------------|-----|--------|
| **16** | `TemplatesModule`: list + estados Meta | Sync lectura desde BD | Medio |
| **17** | `POST /api/templates`, `POST /api/templates/sync` | Portar `templateBuilder` / Meta | Medio |
| **18** | Builder React (wizard) fase 1 — cabecera y body | Crear borrador local | Medio |
| **19** | Detalle + cutover `/templates` | Envío a revisión Meta OK en staging | Medio |

---

### Etapa 5 — Campañas ⚠️ (Semanas 20–26)

**Regla:** no tocar envío real hasta **Semana 24** validada en staging.

| Sem | Entregable | DoD | Riesgo |
|-----|------------|-----|--------|
| **20** | `GET /api/campaigns` lista + KPIs | Solo lectura | Bajo |
| **21** | Ampliar detalle: fallidos, respondieron, costo, logs | Paridad con EJS detalle | Medio |
| **22** | React lista + detalle; retry, sync-cost, exports | Sin wizard crear aún | Medio |
| **23** | Wizard nueva campaña: pasos 1–2 (segmento, preview) | `recipients-preview` en Nest | Alto |
| **24** | Wizard paso 3 + envío; confirmación pre-envío | Mismo flujo que legacy; prueba TI | **Alto** |
| **25** | Beta `/app/campaigns` área TI | 1 semana sin incidentes | **Alto** |
| **26** | Cutover `/campaigns`, `/campaigns/new`, `/campaigns/:id` | Rollback documentado | **Alto** |

**No migrar aún:** jobs `setInterval` — siguen en legacy Express hasta Etapa 9.

---

### Etapa 6 — Ajustes + informes (Semanas 27–30)

| Sem | Entregable | DoD | Riesgo |
|-----|------------|-----|--------|
| **27** | `SettingsModule`: IA, horario, integración (lectura) | Paridad `/settings` | Bajo |
| **28** | UI Ajustes React + PATCH existentes | Cutover `/settings` | Bajo |
| **29** | `ReportsModule` — KPIs e informes (nuevo) | Solo v2; agregaciones SQL/Prisma | Medio |
| **30** | Pulir informes + permisos de vista | Área TI valida | Medio |

---

### Etapa 7 — Conversaciones / Inbox ⚠️⚠️ (Semanas 31–38)

**Último módulo core.** Beta obligatoria 2 semanas antes de cutover.

| Sem | Entregable | DoD | Riesgo |
|-----|------------|-----|--------|
| **31** | `GET /api/conversations` lista, filtros, búsqueda | Solo lectura | Medio |
| **32** | `GET /api/conversations/:id/messages` | Hilo completo | Medio |
| **33** | React inbox: lista + hilo **sin enviar** | Beta `/app/conversations` | Medio |
| **34** | `POST /api/conversations/:id/messages` | Delegar lógica portada de legacy | **Alto** |
| **35** | mark-unread, lead-score, media download, export | Paridad API | Alto |
| **36** | Polling o SSE mensajes nuevos | Sin full reload | Medio |
| **37–38** | Beta 2 semanas TI + cutover `/conversations` | Rollback instantáneo a EJS | **Muy alto** |

---

### Etapa 8 — Admin y auth React (Semanas 39–42)

| Sem | Entregable | DoD | Riesgo |
|-----|------------|-----|--------|
| **39** | `AdminUsersModule` CRUD + import CSV | Solo master | Medio |
| **40** | Meta credenciales + audit logs + export | Paridad admin | Medio |
| **41** | Login React + cambio contraseña | `POST /api/auth/login` | Medio |
| **42** | Cutover `/admin/*`; redirect `/` → React | EJS admin deprecado | Medio |

---

### Etapa 9 — Backend: Redis, webhook, apagar legacy (Semanas 43–46)

| Sem | Entregable | DoD | Riesgo |
|-----|------------|-----|--------|
| **43** | BullMQ: cola campañas; worker Nest | Sustituye `resumeQueuedCampaigns` en legacy | **Alto** |
| **44** | Jobs: scheduled, auto-retry, audit purge en workers | Sin `setInterval` en Express | Alto |
| **45** | Webhook `GET/POST /webhook` en Nest | Firma Meta validada; smoke 48 h | **Muy alto** |
| **46** | Apagar rutas Express excepto fallback; Prisma Migrate oficial | `migrations.js` solo histórico | Alto |

---

### Etapa 10 — Tailwind y cierre (Semanas 47–50)

| Sem | Entregable | DoD | Riesgo |
|-----|------------|-----|--------|
| **47** | Tailwind en `web/` + tokens MALI | Build OK | Bajo |
| **48** | Refactor `shared/ui` a utilidades Tailwind | Componentes base migrados | Bajo |
| **49** | Responsive audit (inbox, campañas, móvil) | QA manual | Bajo |
| **50** | Eliminar EJS no usados; archivar `styles.css` legacy | Repo limpio; doc final | Bajo |

---

## Seguimiento semanal

_Actualizar al cierre de cada semana._

| Sem | Etapa | Tema | Estado | PR / commit | Notas |
|-----|-------|------|--------|-------------|-------|
| 1 | 0 | Scaffold api + web | Completada | e1412fa | Rama `migrate/v2` |
| 2 | 0 | Docker + Prisma introspect | Pendiente | | |
| 3 | 1 | Auth + `/api/me` | Pendiente | | |
| 4 | 1 | apiClient + convenciones | Pendiente | | |
| 5 | 1 | AppShell + dashboard | Pendiente | | |
| 6 | 2 | Meta ads API | Pendiente | | |
| 7 | 2 | Meta ads UI + cutover | Pendiente | | |
| 8 | 2 | Atributos | Pendiente | | |
| 9 | 2 | Exclusiones | Pendiente | | |
| 10 | 3 | Segmentos API | Pendiente | | |
| 11 | 3 | Segmentos UI | Pendiente | | |
| 12 | 3 | Contactos lista | Pendiente | | |
| 13 | 3 | Contactos CRUD | Pendiente | | |
| 14 | 3 | Import contactos | Pendiente | | |
| 15 | 3 | Cutover contactos/segmentos | Pendiente | | |
| 16 | 4 | Plantillas list | Pendiente | | |
| 17 | 4 | Plantillas sync/create | Pendiente | | |
| 18 | 4 | Builder wizard 1 | Pendiente | | |
| 19 | 4 | Cutover plantillas | Pendiente | | |
| 20 | 5 | Campañas lista | Pendiente | | |
| 21 | 5 | Campañas detalle | Pendiente | | |
| 22 | 5 | Campañas UI lectura | Pendiente | | |
| 23 | 5 | Wizard campaña 1–2 | Pendiente | | |
| 24 | 5 | Wizard envío | Pendiente | | |
| 25 | 5 | Beta campañas TI | Pendiente | | |
| 26 | 5 | Cutover campañas | Pendiente | | |
| 27 | 6 | Settings API | Pendiente | | |
| 28 | 6 | Settings UI | Pendiente | | |
| 29 | 6 | Informes KPIs | Pendiente | | |
| 30 | 6 | Informes pulido | Pendiente | | |
| 31 | 7 | Conversaciones lista | Pendiente | | |
| 32 | 7 | Hilo mensajes | Pendiente | | |
| 33 | 7 | Inbox UI lectura | Pendiente | | |
| 34 | 7 | Enviar mensaje | Pendiente | | |
| 35 | 7 | Media + export | Pendiente | | |
| 36 | 7 | Polling/SSE | Pendiente | | |
| 37 | 7 | Beta inbox TI | Pendiente | | |
| 38 | 7 | Cutover inbox | Pendiente | | |
| 39 | 8 | Admin usuarios | Pendiente | | |
| 40 | 8 | Admin meta + audit | Pendiente | | |
| 41 | 8 | Login React | Pendiente | | |
| 42 | 8 | Cutover admin | Pendiente | | |
| 43 | 9 | BullMQ campañas | Pendiente | | |
| 44 | 9 | Workers jobs | Pendiente | | |
| 45 | 9 | Webhook Nest | Pendiente | | |
| 46 | 9 | Apagar legacy API | Pendiente | | |
| 47 | 10 | Tailwind setup | Pendiente | | |
| 48 | 10 | UI refactor | Pendiente | | |
| 49 | 10 | Responsive QA | Pendiente | | |
| 50 | 10 | Cierre EJS/CSS | Pendiente | | |

**Próxima semana:** Semana 2 — Docker Compose (postgres + redis + api + web) y Prisma introspect.

---

## Definition of Done (cada semana con entrega de módulo)

- [ ] Código en rama `migrate/v2` (o repo v2) con PR revisado.
- [ ] Endpoint(s) probados con curl o colección Postman.
- [ ] Paridad funcional vs EJS del módulo (si aplica).
- [ ] Filtro por `area` y permisos respetados.
- [ ] Feature flag documentado en `.env.example` para cutover.
- [ ] Smoke test: webhook + envío campaña sin regresión (desde Semana 20).
- [ ] Tabla «Seguimiento semanal» actualizada.

---

## Qué no migrar / no reescribir (hasta la semana indicada)

| Componente | Acción | Semana earliest |
|------------|--------|-----------------|
| `POST /webhook` | Mantener en legacy | 45 |
| `migrations.js` | Intocable en prod; Prisma introspect paralelo | 46 (Migrate oficial) |
| `campaignSender`, `webhookInbound` | Portar a Nest providers, no reescribir lógica | 24 / 45 |
| Jobs `setInterval` | Legacy hasta BullMQ | 43–44 |
| Envío conversaciones | Legacy hasta inbox API | 34 |

---

## Matriz: `Mejoras.md` → semana

| Pendiente | Semanas | Solo v2 |
|-----------|---------|---------|
| Confirmación pre-envío campaña | 24 | Sí |
| Export / whitelist import / preview atributos | 12–15 | Sí |
| Fecha creación contacto | 12 | Sí |
| Filtro rango `fecha_pago` | 12 | Sí |
| Renombrar segmentos → Etiquetas | 10–11 (copy) | Sí |
| Respuestas predefinidas | 27–28 | Sí |
| Informes KPIs | 29–30 | Sí |
| Permisos / equipos | 39–40 | Sí |
| SIGE | post-30 | Sí |
| Inversión pauta Ads | post-30 | Sí |
| Reintento por inactividad | 35+ | Sí |
| Mejor integración Cloud API | transversal | N/A |

---

## Resumen de etapas

| Etapa | Semanas | Foco | Riesgo global |
|-------|---------|------|---------------|
| 0 Arranque | 1–2 | Monorepo, Prisma, Docker | Bajo |
| 1 Cimientos | 3–5 | Auth, shell, apiClient | Bajo |
| 2 Bajo riesgo | 6–9 | Anuncios, atributos, exclusiones | Bajo |
| 3 Datos | 10–15 | Segmentos, contactos | Medio |
| 4 Plantillas | 16–19 | Builder, sync Meta | Medio |
| 5 Campañas | 20–26 | Wizard + envío | **Alto** |
| 6 Ajustes | 27–30 | Settings, informes | Bajo–medio |
| 7 Inbox | 31–38 | Chat completo | **Muy alto** |
| 8 Admin | 39–42 | Usuarios, login React | Medio |
| 9 Backend | 43–46 | Redis, webhook, apagar legacy | **Alto** |
| 10 Cierre | 47–50 | Tailwind, limpieza | Bajo |

**Total:** 50 semanas (1 dev) · 28–32 semanas (2 devs en paralelo API/Web).

---

## Checklist Semana 1 (empezar ya)

- [x] Crear rama `migrate/v2` o repo `mali-whatsapp-v2`.
- [x] `nest new api` + `npm create vite@latest web -- --template react-ts`.
- [x] Root `package.json` con workspaces (`api`, `web`).
- [x] `GET /health` en Nest responde `{ ok: true }`.
- [x] `web` muestra «MALI WhatsApp v2» en dev.
- [x] Commit inicial: `chore: scaffold api (NestJS) + web (Vite React TS)`.
- [x] Actualizar fila Semana 1 en «Seguimiento semanal».
