# Leads — changelog

Vigente: [LEADS.md](./LEADS.md).

## 2026-11-04 — SLA primera respuesta (10 min hábiles)

- Reloj desde `started_at`; responde = `first_human_reply_at`; fuera de horario Lima no corre.
- Cumple ≤ 10 min; alerta solo si > 10. Job `education-sla-first-reply` prefiltra con `latestStartTimeForBreach` (no atasca el batch con overnight aún válidos).
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
