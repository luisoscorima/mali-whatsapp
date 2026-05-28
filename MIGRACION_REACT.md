# Backlog de migración EJS → API + React (Vite)

**Objetivo:** escalar producto y código sin parar producción (`whatsapp.mali.pe`).  
**Stack objetivo:** Express (API) + React + Vite; **Tailwind en fase final** de pulido visual.  
**Estrategia:** strangler fig — EJS y React conviven; webhook, envío de campañas y mensajes en conversaciones se tocan al final y con mucho cuidado (alineado a `.cusorrules`).

Relacionado con: [Mejoras.md](Mejoras.md) (backlog de producto).

---

## Principios (no negociables)

| # | Regla |
|---|--------|
| 1 | **Producción siempre usable:** cada entrega deja una ruta EJS funcional hasta que la versión React esté validada. |
| 2 | **API-first para lo nuevo:** toda feature de `Mejoras.md` nace en React consumiendo JSON; no nuevas pantallas EJS grandes. |
| 3 | **Lógica en `services/`:** las rutas solo autentican, validan y responden JSON/HTML. |
| 4 | **No duplicar envíos:** campañas y chat reutilizan `campaignSender`, `persistAndSendOutbound`, webhook actual. |
| 5 | **Migración por feature flag** (`UI_REACT_CONTACTS=1`, etc.) o ruta paralela (`/app/contacts` → luego swap a `/contacts`). |
| 6 | **Tailwind al final:** primero componentes y flujos; diseño unificado cuando el 80 % del panel ya esté en React. |

---

## Arquitectura objetivo

```txt
mali-whatsapp-mvp/
  app/                    # Express (sin cambiar dominio)
    src/
      routes/
        api/              # NUEVO: routers JSON por dominio
      services/           # Se mantiene / crece
    public/
      app/                # Build de Vite (assets)
  web/                    # NUEVO: React + Vite
    src/
      app/                # Router, providers
      features/           # inbox, campaigns, contacts…
      shared/             # ui, api-client, hooks
```

### Convivencia en runtime

- `GET /webhook`, `POST /webhook` → sin cambios.
- Rutas legacy EJS siguen en `/campaigns`, `/conversations`, etc.
- React montado en `/app/*` al inicio; al validar, **misma URL** con flag o redirect 302 controlado.
- Sesión actual (`express-session` + cookie) → React usa `credentials: 'include'` en `fetch`.

---

## Inventario: API hoy vs falta

| Módulo | Rutas HTML (EJS) | API JSON existente | Gap principal |
|--------|------------------|-------------------|---------------|
| Auth / login | Sí | No formal | `GET /api/me`, login JSON |
| Campañas | Sí | Parcial (`/api/campaigns/*`) | Listado, detalle completo, crear (sin tocar send al inicio) |
| Conversaciones | Sí | `PATCH mode` | Lista, hilo, enviar mensaje, media |
| Contactos | Sí | Casi nada | CRUD + filtros + import |
| Segmentos | Sí | No | CRUD + contactos del segmento |
| Plantillas | Sí | `definition` | Listado, create, sync |
| Atributos | Sí | `options` | CRUD |
| Anuncios CTWA | Sí | No | List + detalle + rename |
| Exclusiones | Sí | No | CRUD listas |
| Ajustes / IA | Sí | Parcial AI | Leer config completa |
| Admin | Sí | `online-users` | Usuarios, meta, audit |
| Informes (nuevo) | — | — | **Solo React + API nueva** |

---

## Roadmap por épicas

Estimación orientativa con **1 dev** a tiempo completo. Ajustar si hay más gente.

---

### Épica 0 — Cimientos (2–3 semanas)

**Producto:** ningún cambio visible para usuarios.  
**Código:**

| ID | Tarea | DoD |
|----|--------|-----|
| 0.1 | Crear `web/` con Vite + React + TS (recomendado) | `npm run build` genera `app/public/app/` |
| 0.2 | Express sirve estáticos + `GET /app/*` → `index.html` | Login EJS sigue; `/app` carga shell vacío |
| 0.3 | Cliente API (`apiClient.ts`): basePath, cookies, errores 401 → login | Una llamada de prueba a `/health` |
| 0.4 | `GET /api/me` (usuario, área, master, permisos) | React muestra nombre en shell |
| 0.5 | Convención respuestas `{ ok, data?, error? }` | Documento interno 1 página |
| 0.6 | Carpeta `app/src/routes/api/` + primer router montado | Sin romper rutas actuales |
| 0.7 | CI/Docker: build frontend en imagen | Deploy actual sigue funcionando |

**Riesgo:** bajo.

---

### Épica 1 — Shell de aplicación (1–2 semanas)

**Producto:** layout tipo panel (rail + sidebar + main) sin recargas entre rutas React.  
**Código:**

| ID | Tarea | DoD |
|----|--------|-----|
| 1.1 | `AppShell`: navegación, área activa, enlace “volver a panel clásico” | Paridad visual básica con `wa-rail` |
| 1.2 | React Router: rutas hijas bajo `/app` | Navegación sin full reload |
| 1.3 | Componentes UI base **sin Tailwind** (CSS modules o variables CSS) | Button, Input, Table, Badge, Toast, Modal |
| 1.4 | Página placeholder `/app` (dashboard mínimo) | KPIs desde `GET /api/dashboard` |
| 1.5 | Enlace en EJS: “Panel nuevo (beta)” | Usuarios entran voluntariamente |

**Riesgo:** bajo.

---

### Épica 2 — Módulos de lectura / bajo riesgo (3–4 semanas)

Migrar primero lo que **no** toca envío de mensajes ni campañas.

#### 2A — Anuncios Meta (`/anuncios`)

| ID | Tarea | API nueva |
|----|--------|-----------|
| 2A.1 | `GET /api/meta-ads` | Lista con conteo leads |
| 2A.2 | `GET /api/meta-ads/:id` | Detalle + leads |
| 2A.3 | `PATCH /api/meta-ads/:id` | Nombre editable |
| 2A.4 | Pantallas React list + detail | Flag → sustituir EJS |

#### 2B — Atributos (`/attributes`)

| ID | Tarea | API |
|----|--------|-----|
| 2B.1 | CRUD JSON | `GET/POST/PATCH/DELETE /api/attribute-definitions` |
| 2B.2 | Formularios dinámicos React | Reutilizar reglas de segmento/área |

#### 2C — Listas de exclusión

| ID | Tarea | API |
|----|--------|-----|
| 2C.1 | CRUD + miembros | `/api/exclusion-lists` |

**Riesgo:** bajo.

---

### Épica 3 — Segmentos → futuras “Etiquetas” (2–3 semanas)

| ID | Tarea | Notas |
|----|--------|-------|
| 3.1 | `GET/POST/PATCH/DELETE /api/segments` | Unificar lo que hoy está en `/settings/segment-*` |
| 3.2 | UI React list + edit + color | Preparar rename producto “Etiquetas” solo en copy |
| 3.3 | Quitar contacto de segmento | `DELETE /api/segments/:id/contacts/:contactId` |
| 3.4 | Flag y cutover `/segments` | EJS deprecado |

**Backlog producto:** segmentos automáticos por reglas → **implementar solo en React** (épica 8).

**Riesgo:** bajo-medio.

---

### Épica 4 — Contactos (4–5 semanas)

| ID | Tarea | API / UI |
|----|--------|----------|
| 4.1 | `GET /api/contacts` con filtros, paginación, atributos | Lista |
| 4.2 | `GET/POST/PATCH /api/contacts/:id` | Alta/edición |
| 4.3 | Import CSV: `POST /api/contacts/import` (multipart) | Sustituye form EJS |
| 4.4 | `GET /api/contacts/sample.csv` | Descarga plantilla |
| 4.5 | Bulk add segment | `POST /api/contacts/bulk-add-segment` |
| 4.6 | React: lista, filtros chips, detalle | Paridad con `contacts-page.ejs` |
| 4.7 | Cutover `/contacts` | |

**Backlog producto en esta épica:**

- Fecha de creación de contacto → campo en API + columna UI.
- Filtro rango `fecha_pago` → API + UI (mejor que en EJS).
- Orden del backlog: **export → whitelist import → preview atributos → UI** (como en `Mejoras.md`).

**Riesgo:** medio (import masivo).

---

### Épica 5 — Plantillas (3–4 semanas)

| ID | Tarea | Notas |
|----|--------|-------|
| 5.1 | `GET /api/templates` | Estados PENDING/APPROVED/REJECTED |
| 5.2 | `POST /api/templates`, `POST /api/templates/sync` | Reutilizar `templateBuilder` / Meta |
| 5.3 | Builder React (wizard) | Portar lógica de `template-builder.js` por fases |
| 5.4 | Detalle plantilla | |
| 5.5 | Cutover `/templates` | |

**Riesgo:** medio (integración Meta).

---

### Épica 6 — Campañas (5–7 semanas) ⚠️

**Regla:** no tocar `POST /campaigns/send` ni el flujo de `campaigns/new` hasta sub-épica 6.4 validada en staging.

| ID | Tarea | Fase |
|----|--------|------|
| 6.1 | `GET /api/campaigns` (lista + KPIs globales) | Solo lectura |
| 6.2 | Ampliar `GET /api/campaigns/:id` (fallidos, respondieron, costo, logs) | Ya existe parcial; completar |
| 6.3 | React: lista + detalle (acciones: retry, sync-cost, exports vía API existente) | Sin crear campaña aún |
| 6.4 | Wizard nueva campaña en React | Reutilizar `recipients-preview`, **mismo** `POST /campaigns/send` al final |
| 6.5 | Confirmación pre-envío (“¿Está seguro…?”) | **Solo en React** — ítem `Mejoras.md` |
| 6.6 | Cutover `/campaigns`, `/campaigns/new`, `/campaigns/:id` | Tras prueba real en TI |

**No migrar aún:** jobs `setInterval`, `resumeQueuedCampaigns` — siguen en Node.

**Riesgo:** alto en 6.4–6.6. Mitigación: feature flag por área `ti` primero.

---

### Épica 7 — Ajustes (1–2 semanas)

| ID | Tarea |
|----|--------|
| 7.1 | `GET /api/settings/ai/:area` |
| 7.2 | React settings (ya hay PATCH/enable en API) |
| 7.3 | Cutover `/settings` |

**Incluye:** respuestas predefinidas (cuando se defina) → **nace en React**.

**Riesgo:** bajo.

---

### Épica 8 — Features nuevas solo en React (continuo, 4+ semanas)

Construir aquí lo pendiente de `Mejoras.md` que **no** tiene sentido en EJS:

| Feature | Dependencias API |
|---------|------------------|
| Informes / KPIs | Nuevo módulo `reportsService`, agregaciones SQL |
| Permisos, roles, equipos | Extender `users` + middleware auth |
| Vista previa campaña (resumen) | Épica 6.5 |
| Segmentos automáticos (etiquetas) | Épica 3 + motor de reglas |
| SIGE (v2) | Integración externa |
| Mensajes reintento por inactividad | Jobs + conversaciones API |
| Inversión pauta Ads | Integración Meta Ads API |
| Llamadas WhatsApp | Cloud API (fase posterior) |
| Mejor integración Cloud API | Transversal en `services/` |

**Riesgo:** variable; no bloquea migración del legacy.

---

### Épica 9 — Conversaciones / Inbox (6–8 semanas) ⚠️⚠️

**Último módulo core** — máximo uso diario y `.cusorrules` protege envío/recepción.

| ID | Tarea | Orden |
|----|--------|-------|
| 9.1 | `GET /api/conversations` (lista, filtros, búsqueda) | Lectura |
| 9.2 | `GET /api/conversations/:id/messages` | Hilo |
| 9.3 | React inbox (lista + hilo, sin enviar) | Beta `/app/conversations` |
| 9.4 | `POST /api/conversations/:id/messages` | Delegar a lógica existente, **no** nuevo axios suelto |
| 9.5 | mark-unread, lead-score, download media, export | Paridad API |
| 9.6 | Polling o SSE para mensajes nuevos | Evitar reload; evaluar WebSocket después |
| 9.7 | Cutover `/conversations` | Solo tras 2 semanas en beta |

**Riesgo:** muy alto. Mitigación: beta obligatoria en área TI; rollback instantáneo a EJS.

---

### Épica 10 — Admin (3–4 semanas)

| ID | Módulo |
|----|--------|
| 10.1 | Usuarios CRUD + import CSV |
| 10.2 | Meta credenciales por área |
| 10.3 | Audit logs + export |
| 10.4 | Usuarios en línea (ya hay API) |
| 10.5 | Cutover `/admin/*` |

**Riesgo:** medio (solo master).

---

### Épica 11 — Auth y cierre EJS (2 semanas)

| ID | Tarea |
|----|--------|
| 11.1 | Login React + `POST /api/auth/login` |
| 11.2 | Cambio contraseña |
| 11.3 | Redirect `/` → React |
| 11.4 | Eliminar vistas EJS no usadas |
| 11.5 | CSS legacy (`styles.css` monolito) archivado |

---

### Épica 12 — Pulido Tailwind (2–3 semanas)

| ID | Tarea |
|----|--------|
| 12.1 | Instalar Tailwind en `web/` |
| 12.2 | Tokens (colores MALI, spacing, tipografía) |
| 12.3 | Refactor componentes `shared/ui` |
| 12.4 | Responsive audit (móvil/tablet en inbox y campañas) |
| 12.5 | Dark mode opcional |

**Por qué al final:** evita rehacer clases en cada pantalla mientras los flujos aún cambian.

---

## Cronograma sugerido (sin parar producción)

Orientativo con 1 dev:

| Fase | Épicas | Semanas aprox. |
|------|--------|----------------|
| Base | 0–1 | 4–5 |
| Bajo riesgo | 2 | 3–4 |
| Datos | 3–4 | 6–8 |
| Medio | 5–6 (lectura + wizard) | 8–11 |
| Ajustes + nuevas features | 7–8 | continuo |
| Alto | 9 | 6–8 |
| Admin + cierre | 10–11 | 5–6 |
| Diseño | 12 | 2–3 |

**Total:** ~12–14 meses (1 dev). Con 2 devs (API + React): ~7–9 meses.

---

## Matriz: ítems `Mejoras.md` → dónde implementar

| Pendiente | Épica | Solo React |
|-----------|-------|------------|
| Confirmación pre-envío campaña | 6.5 | Sí |
| Export / whitelist import / preview atributos | 4 | Sí |
| Fecha creación contacto | 4 | Sí |
| Filtro rango `fecha_pago` | 4 | Sí |
| Renombrar segmentos → Etiquetas | 3 (copy) + 8 (reglas auto) | Sí |
| Respuestas predefinidas | 7 u 8 | Sí |
| Informes KPIs | 8 | Sí |
| Permisos / equipos | 8 + 10 | Sí |
| SIGE | 8 | Sí |
| Inversión pauta Ads | 8 | Sí |
| Reintento por inactividad | 8 + 9 | Sí |
| Mejor integración Cloud API | Transversal servicios | N/A |

---

## Definition of Done por módulo migrado

- [ ] API documentada y probada con curl/Postman.
- [ ] Pantalla React con paridad funcional vs EJS.
- [ ] Auth por sesión; filtro por `area` del usuario respetado.
- [ ] Feature flag + rollback en 1 variable de entorno.
- [ ] 1 semana mínimo en beta (área TI) antes del cutover.
- [ ] EJS de ese módulo marcado `@deprecated` (comentario), no borrado hasta cutover.
- [ ] Sin regresión en webhook ni envíos masivos en smoke test.

---

## Qué no migrar / no reescribir

| Componente | Acción |
|------------|--------|
| `POST /webhook` | Intocable |
| `migrations.js` / PostgreSQL | Intocable (solo nuevas migraciones) |
| `campaignSender`, `webhookInbound`, `persistAndSendOutbound` | Reutilizar desde API nueva |
| Jobs `setInterval` | Mantener en Node; más adelante worker + Redis |
| Docker / Nginx producción | Solo añadir paso build Vite |

---

## Orden de prioridad (atajos)

**Mínimo viable escalable (MVS):** 0 → 1 → 4 (contactos) → 6.1–6.3 (campañas lectura) → 8 (informes) → 9 (inbox al final).

**Máximo impacto UX pronto:** 0 → 1 → 9.1–9.3 (inbox solo lectura en beta) — contradice `.cusorrules` de no tocar conversaciones hasta estar listos; **recomendado:** inbox completo al final (épica 9).

---

## Próximo paso (Sprint 1 — Épica 0)

1. Crear `web/` con Vite + React + TypeScript.
2. Implementar `GET /api/me` + shell con navegación.
3. Deploy: build frontend en Docker sin cambiar URL pública.
4. Primera pantalla real: **Anuncios** (épica 2A) — validar patrón end-to-end con riesgo mínimo.

---

## Seguimiento de estado

| Épica | Estado | Notas |
|-------|--------|-------|
| 0 Cimientos | Pendiente | |
| 1 Shell | Pendiente | |
| 2 Bajo riesgo | Pendiente | |
| 3 Segmentos | Pendiente | |
| 4 Contactos | Pendiente | |
| 5 Plantillas | Pendiente | |
| 6 Campañas | Pendiente | |
| 7 Ajustes | Pendiente | |
| 8 Features nuevas | Pendiente | |
| 9 Conversaciones | Pendiente | |
| 10 Admin | Pendiente | |
| 11 Cierre EJS | Pendiente | |
| 12 Tailwind | Pendiente | |

_Actualizar la tabla «Seguimiento de estado» al cerrar cada épica._
