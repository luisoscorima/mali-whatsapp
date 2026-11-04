# Contactos — changelog

Vigente: [CONTACTOS.md](./CONTACTOS.md).

## 2026-11-03 — Conciencia cross-área (inbox)

- Persona unificada; ficha por área (sin unificar `contacts`).
- Inbox: no mostrar segmentos/lead de otra área; aviso `other_area_fichas` (“También tiene ficha en …”).
- Webhook + detalle de chat aseguran ficha del área del hilo (`PersonResolver`); campaña vincula `contact_id` del área si el log venía solo con teléfono.

## 2026-11-03 — Cierre residuales educacion_ca / educacion_ep

- Job master `GET/POST /api/admin/conflicts/education-alias-contacts`: fusiona por phone/BSUID (o crea ficha `educacion`) y **DELETE** del residual.
- Lectura DB Educación solo `educacion`; escritura con `educationWriteArea` en create/import; líneas nuevas no escriben `legacy_area` ca/ep.
- Scripts `consolidate-education.cjs` / `relabel-education-aliases.cjs` bloqueados salvo `ALLOW_LEGACY_EDU_SCRIPT=1`.
- Prod: residuales ca/ep absorbidos a 0. Impacto UX documentado en CONTACTOS.md § “Impacto para el usuario”.

## 2026-11-03 — Clones person_id + phone NULL (P2002 import/webhook)

- **Síntoma:** import Excel Educación → 500; Prisma `P2002` en `contacts.update` unique `(area, phone)`. Mismo error en `WebhookService.persistInboundMessages`.
- **Causa:** tras consolidación Educación, donantes seguían en `contacts` con el **mismo `person_id`**, `phone NULL`. El trigger `sync_person_contacts` al tocar nombre/identidad intentaba ponerles el teléfono del canónico → choque con `contacts_area_phone_uq`.
- **Código:** `move-donor-contact.util.ts` (mover FKs + DELETE donor); Conflictos “Unir” ya no deja el donante; `GET/POST /api/admin/conflicts/null-phone-clones`; import captura P2002 por fila.
- **Prod:** dry-run ~5407 grupos / ~7320 donors; apply por lotes → `groups_mergeable: 0`. No re-ejecutar `consolidate-education.cjs --apply`.

## 2026-10-26 — Consolidación Educación

- Script `consolidate-education.cjs --apply` en prod: ~5.7k grupos; fusionados + revisión en Administración → Conflictos.
- Una ficha activa por persona en `educacion`; no volver a `--apply`.
- Botones Conflictos: Unir / Dejar separadas; identidad: Guardar en persona / Dejar como está.
- *Nota posterior (2026-11-03):* el `--apply` dejaba donantes con `person_id` del canónico y `phone NULL` (no los borraba); eso generó los clones del incidente de noviembre.
