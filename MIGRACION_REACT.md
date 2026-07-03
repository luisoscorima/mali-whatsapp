# Plan de migración — MALI WhatsApp v2

**Objetivo:** plataforma nueva en stack moderno, desplegada **en entorno aislado** (sin convivir con `whatsapp.mali.pe` ni con el panel EJS legacy).

**Stack (único runtime v2):**

| Capa | Tecnología |
|------|------------|
| API | NestJS + Prisma + PostgreSQL |
| Colas / cache | Redis + BullMQ |
| Web | React + Vite + TypeScript + Tailwind |
| Auth | JWT (Bearer) |

Relacionado con: [Mejoras.md](Mejoras.md) (backlog de producto).

---

## Estrategia: despliegue aislado

| Antes (strangler fig) | Ahora |
|------------------------|--------|
| Legacy EJS en prod mientras v2 crece | **`app/` deprecado** — solo referencia al portar lógica |
| Mismo Docker / misma BD / cutover por módulo | **Entorno propio**: dominio, `.env`, Compose y BD de staging v2 |
| Cookies legacy + flags `UI_V2_*` | **JWT desde el inicio** (hecho, Semana 3) |
| Tailwind al final (sem. 47) | **Tailwind desde Semana 5** |
| Webhook/colas al apagar Express (sem. 43+) | **Webhook y BullMQ en Nest** cuando toque cada módulo |

La rama `main` sigue siendo el sistema en producción actual. La rama **`migrate/v2`** es el producto nuevo; al terminar, se despliega en URL/infra separadas (no se hace swap en caliente sobre prod).

---

## Cómo usar este documento

1. Trabajar en rama `migrate/v2` (o repo `mali-whatsapp-v2` si se bifurca).
2. **Una semana = una fila** de la tabla de seguimiento.
3. Al cerrar la semana: marcar estado, anotar commit, actualizar «Próxima semana».
4. Portar lógica desde `app/src/services/` → providers Nest; **no** reimplementar envíos/webhook desde cero sin leer legacy.

**Ritmo orientativo:** 1 dev ≈ **40 semanas** · 2 devs (API + Web) ≈ **22–26 semanas**.

---

## Estructura del repo (v2)

```txt
mali-whatsapp-mvp/          # rama migrate/v2
  app/                      # DEPRECADO — ver app/DEPRECATED.md
  api/                      # NestJS + Prisma
    src/modules/            # auth, dashboard, campaigns…
    prisma/schema.prisma
  web/                      # React + Vite + Tailwind
    src/
      app/                  # router, shell
      features/             # pantallas por dominio
      shared/               # api-client, ui
  docker-compose.yml        # api + web + postgres + redis
  ARRANQUE_V2.md
  MIGRACION_REACT.md
```

---

## Principios

| # | Regla |
|---|--------|
| 1 | **Solo stack objetivo** en runtime v2: Nest, React, Prisma, Redis. Sin Express/EJS en Compose ni en rutas de prod v2. |
| 2 | **API-first:** toda feature en módulos Nest + pantallas React. |
| 3 | **Portar, no adivinar:** leer `app/src/services/` al migrar campañas, webhook, plantillas Meta. |
| 4 | **Prisma Migrate** sustituye `migrations.js` en v2 (introspect ya hecho; migraciones oficiales en Etapa 1–2). |
| 5 | **JWT + área + permisos** en todos los endpoints de negocio. |
| 6 | **Tailwind + tokens MALI** (`--ink`, `--muted`, `--accent`…) desde el shell web. |
| 7 | **Validar en staging aislado** antes de go-live v2; no hay rollback a EJS. |

---

## Arquitectura runtime (v2)

```txt
Usuario ──► Nginx / NPM ──► web (React estático)
                    │
                    └──► api (NestJS :4000)
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              PostgreSQL              Redis
                    │
         webhook Meta, BullMQ workers
```

---

## Inventario de módulos (todo en Nest + React)

| Módulo | API v2 | UI React |
|--------|--------|----------|
| Auth | `POST /api/auth/login`, `GET /api/me` | Login, sesión |
| Dashboard | `GET /api/dashboard` | Inicio |
| Campañas | CRUD, envío, exports | Lista, detalle, wizard |
| Conversaciones | Lista, hilo, enviar, media | Inbox |
| Contactos | CRUD, filtros, import | Lista, formulario |
| Segmentos | CRUD | Etiquetas |
| Plantillas | CRUD, sync Meta | Builder |
| Atributos / exclusiones | CRUD | Ajustes audiencia |
| Anuncios CTWA | List, detalle, rename | `/anuncios` |
| Ajustes / IA | Config por área | Settings |
| Admin | Usuarios, Meta, audit | `/admin` |
| Informes | KPIs (nuevo) | `/informes` |
| Webhook | `GET/POST /webhook` | — |

---

## Etapas y calendario semanal

### Etapa 0 — Arranque (Semanas 1–2) ✓

| Sem | Entregable | DoD |
|-----|------------|-----|
| **1** | Scaffold `api/` + `web/` | `GET /health`; web placeholder |
| **2** | Docker + Prisma introspect | 18 modelos; `PrismaModule`; Redis en Compose |

---

### Etapa 1 — Cimientos (Semanas 3–6)

| Sem | Entregable | DoD |
|-----|------------|-----|
| **3** ✓ | `AuthModule` + JWT + `GET /api/me` | Login y sesión en React |
| **4** ✓ | `apiClient` + `{ ok, data?, error? }` | 401 → login; `/health` desde web |
| **5** | Tailwind + `AppShell` + React Router | Navegación SPA; rutas `/`, `/login` |
| **6** | `DashboardModule` + `GET /api/dashboard` | KPIs por área en Prisma; pantalla inicio |

---

### Etapa 2 — Módulos iniciales (Semanas 7–10)

| Sem | Entregable | DoD |
|-----|------------|-----|
| **7** | `MetaAdsModule` API | Paridad listado/detalle |
| **8** | UI anuncios + rename | Flujo completo en React |
| **9** | `AttributeDefinitionsModule` | CRUD API + UI |
| **10** | `ExclusionListsModule` | Listas operativas |

---

### Etapa 3 — Audiencia (Semanas 11–16)

| Sem | Entregable | DoD |
|-----|------------|-----|
| **11–12** | `SegmentsModule` | API + UI etiquetas |
| **13–14** | `ContactsModule` lista/filtros | Paginación por área |
| **15** | Contactos CRUD + atributos dinámicos | Alta/edición |
| **16** | Import CSV/XLSX | `POST /api/contacts/import` |

---

### Etapa 4 — Plantillas (Semanas 17–20)

| Sem | Entregable | DoD |
|-----|------------|-----|
| **17** | Templates list + sync lectura | Estados Meta |
| **18** | Create + sync Meta API | Portar `templateBuilder` |
| **19–20** | Builder React + envío revisión | Staging Meta OK |

---

### Etapa 5 — Campañas + colas (Semanas 21–28)

| Sem | Entregable | DoD |
|-----|------------|-----|
| **21–22** | Lista + detalle campañas | KPIs, fallidos, costo |
| **23–24** | UI lectura + exports/retry | Sin envío aún |
| **25–26** | Wizard crear + preview destinatarios | |
| **27** | Envío + confirmación pre-envío | Prueba staging aislado |
| **28** | BullMQ workers campañas | Sustituye jobs legacy |

---

### Etapa 6 — Ajustes e informes (Semanas 29–32)

| Sem | Entregable | DoD |
|-----|------------|-----|
| **29–30** | `SettingsModule` + UI | IA, horario, integración |
| **31–32** | `ReportsModule` | KPIs solo v2 |

---

### Etapa 7 — Inbox + webhook (Semanas 33–38)

| Sem | Entregable | DoD |
|-----|------------|-----|
| **33–34** | Conversaciones lista + hilo | Lectura |
| **35–36** | Enviar mensaje + media | Portar lógica chat |
| **37** | Polling / SSE | Tiempo casi real |
| **38** | `GET/POST /webhook` en Nest | Firma Meta; smoke 48 h |

---

### Etapa 8 — Admin (Semanas 39–42)

| Sem | Entregable | DoD |
|-----|------------|-----|
| **39–40** | Usuarios + Meta credenciales | Solo master |
| **41–42** | Audit logs + cambio contraseña | Paridad admin legacy |

---

### Etapa 9 — Cierre producción v2 (Semanas 43–46)

| Sem | Entregable | DoD |
|-----|------------|-----|
| **43** | Prisma Migrate oficial + seed | Sin `migrations.js` en v2 |
| **44** | Workers: retry, scheduled, audit purge | Todo en BullMQ |
| **45** | QA integral staging | TI valida por área |
| **46** | Go-live entorno aislado + runbook | Doc en `DESPLIEGUE_V2.md` |

---

## Seguimiento semanal

| Sem | Etapa | Tema | Estado | PR / commit | Notas |
|-----|-------|------|--------|-------------|-------|
| 1 | 0 | Scaffold api + web | Completada | e1412fa | |
| 2 | 0 | Docker + Prisma | Completada | 9a5d5ad | |
| 3 | 1 | Auth JWT + `/api/me` | Completada | 99f4524 | |
| 4 | 1 | apiClient | Completada | eeb8c9e | |
| 5 | 1 | Tailwind + AppShell + Router | Completada | ea5cdce | Rutas `/`, `/login` |
| 6 | 1 | Dashboard API + UI | Completada | ea5cdce | `GET /api/dashboard` |
| 7 | 2 | Meta ads API | Completada | bc560dc | `GET /api/meta-ads`, `GET /api/meta-ads/:id` |
| 8 | 2 | Meta ads UI | Pendiente | | |
| 9 | 2 | Atributos | Pendiente | | |
| 10 | 2 | Exclusiones | Pendiente | | |
| 11–46 | … | Ver etapas arriba | Pendiente | | Plan recortado sin cutover EJS |

**Próxima semana:** Semana 8 — UI anuncios Meta + `PATCH` rename.

---

## Definition of Done (cada semana)

- [ ] Código en `migrate/v2` con commit/PR.
- [ ] Endpoints probados (curl o Postman).
- [ ] Paridad funcional vs comportamiento legacy de referencia (`app/`).
- [ ] Filtro por `area` y permisos.
- [ ] UI en React + Tailwind (desde Semana 5).
- [ ] Tabla «Seguimiento semanal» actualizada.

---

## Referencia legacy (`app/`)

Solo lectura para portar:

| Código legacy | Uso al portar |
|---------------|----------------|
| `app/src/services/campaignSender.js` | Envío campañas (Etapa 5) |
| `app/src/services/webhookInbound.js` | Webhook (Etapa 7) |
| `app/src/services/metaCtwaAds.js` | Anuncios CTWA (Etapa 2) |
| `app/src/services/templateBuilder.js` | Plantillas Meta |
| `app/src/db/migrations.js` | Esquema ya introspectado en Prisma |

No ejecutar `app/` en Docker ni en despliegue v2.

---

## Resumen de etapas

| Etapa | Semanas | Foco |
|-------|---------|------|
| 0 Arranque | 1–2 | Monorepo, Prisma, Docker v2 |
| 1 Cimientos | 3–6 | Auth, shell, dashboard, Tailwind |
| 2 Inicial | 7–10 | Anuncios, atributos, exclusiones |
| 3 Audiencia | 11–16 | Segmentos, contactos |
| 4 Plantillas | 17–20 | Builder, sync Meta |
| 5 Campañas | 21–28 | Wizard, envío, BullMQ |
| 6 Ajustes | 29–32 | Settings, informes |
| 7 Inbox | 33–38 | Chat, webhook Nest |
| 8 Admin | 39–42 | Usuarios, Meta, audit |
| 9 Cierre | 43–46 | Migrate, QA, go-live aislado |

**Total:** ~46 semanas (1 dev) · ~24 semanas (2 devs).
