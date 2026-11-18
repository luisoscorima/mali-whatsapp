# Leads — changelog

Vigente: [LEADS.md](./LEADS.md).

## 2026-11-18 — Option A: cierre por pago + indicador

- `venta_exitosa` / `convertido` ya no cierran el ciclo al marcarse; cierre con pago positivo (`paid`), “cerrar sin pago” (`sold`) o perdido/no interesado.
- Associate: política Treasury (positivo cierra; **Autorizada** cierra + obs; Por pagar asocia+obs sin cerrar; negativo rechaza). Ver [PAYMENT-LOOKUP-WA.md](./PAYMENT-LOOKUP-WA.md).
- Identificador `payment_link` (ONE `EducacionSale`) en Oportunidades, Treasury y WA header/ficha.
- API: `GET /api/leads/payments/link`, `POST /api/leads/attention/close-without-payment`.
- Ventas históricas cerradas sin pago: CTA asociar (attention/current también devuelve el último ciclo cerrado).

## 2026-11-18 — Plan canónico F0–F1 (destino ONE, WA estable)

- Docs: destino vs transición; asesor ≠ chat; inventario [CRM-CONSUMERS.md](./CRM-CONSUMERS.md); runbook [CUTOVER-COMERCIAL.md](./CUTOVER-COMERCIAL.md).
- Ciclos: vistas `stale` (3 días) y `solo_contacto`; campos `promise_at` / `lost_reason`.
- Outbox `commercial_channel_outbox` (scaffolding F4).

## 2026-11-04 — SLA editable (horario + meta)

- Config en Ajustes (`/settings/sla` / `GET|PATCH /api/settings/education-sla`); defaults 10 min y horario RQ.
- Job y reportería leen `app_settings` (`educacion`/`education_sla`).

## 2026-11-04 — SLA primera respuesta (10 min hábiles)

- Reloj desde `started_at`; responde = `first_human_reply_at`; fuera de horario Lima no corre.
- Cumple ≤ meta (default 10); alerta solo si > meta. Job `education-sla-first-reply` prefiltra con `latestStartTimeForBreach` (no atasca el batch con overnight aún válidos).
- Centro de avisos del inbox: chats + leads (nuevo/SLA) + toggle de notificaciones del navegador; toast al incumplir (SPA, sin recargar).
- Reportería: promedio / % / por asesor (`/api/reports/education-sla`); pestaña solo si el usuario es Educación.

## 2026-10-30 — Canal Botones web (`web_button`)

- Card Hub y filtro aparte de Widget / Links / Orgánico.
- Match: `ref:web_*` o prefijo «Hola MALI Educación! Vengo desde la web».
- Backfill `POST /api/leads/web-buttons/backfill` y script `leads-backfill-web-buttons.cjs`.

## 2026-10-30 — Hub Meta y «Solo contacto»

- Card **Meta** unifica Instant Forms + CTWA; canal de fila sigue separado.
- `came_with_inbound` = ella inicia el hilo (no cuenta respuesta a campaña outbound).
- Área canónica `educacion` en identidad/captación; CA/EP solo categoría.
- Script `leads-cleanup-false-organic.cjs` para orgánicos falsos históricos.

## 2026-10-29 — Piloto atención v1

- Flag `leads.attention_v1=1` en producción; lifecycle, conflictos abiertos resueltos, índices únicos.
- Ensayo de migración lifecycle en copia; bases lead/contacto cerradas el mismo día.

## 2026-10-28 — Corte 0 / plan atención

- Inventario ligero Educación; plan de separación identidad / ciclo / reclamación (parte ya en lifecycle).
