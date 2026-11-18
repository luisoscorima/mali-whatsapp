# Cutover de autoridad comercial (F4) — runbook

Mensajería WA **nunca** entra en mantenimiento. Solo se pausan escrituras comerciales al motor local.

## Prerrequisitos (gate)

- [ ] F1 operativo (vistas jefe: sin WA, stale 3d, historial).
- [ ] F2/F3: actividades y venta/aplicación en ONE en uso piloto.
- [ ] Ensayo de equivalencia con copia de datos e IDs mapeados.
- [ ] Outbox de hechos de canal listo (ver tabla `commercial_channel_outbox` cuando se active).
- [ ] Identidad asesores Google alineada ONE↔WA.

## Procedimiento

1. Congelar escrituras comerciales en WA (feature flag / frontier): inbox sigue recibiendo mensajes.
2. Reconciliar deltas finales ciclo/persona.
3. Activar ONE como escritor de oportunidades/personas.
4. Inbox WA: etapa/asignación comercial → API ONE (misma UI asesor).
5. Reproducir outbox pendiente con `event_id` idempotente.
6. Observación: un escritor por oportunidad; PAM identidad alineada.

## Rollback

- **Antes** de escrituras nuevas en ONE: abortar y conservar WA.
- **Después:** reconciliar/reproducir; no hay flag mágico.

## UX post-cutover

- Asesor: solo mali-whatsapp.
- Jefe/Caja: CRM Educación + Treasury.
