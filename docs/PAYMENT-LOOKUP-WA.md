# Lookup de código Treasury desde mali-whatsapp (F3 → destino)

El asesor **no** entra a Treasury. Valida/asocia código desde WA (o desde CRM Educación → Pagos en transición).

## Contrato

Asesor (JWT) → mali-whatsapp → MALI ONE (service token):

| Acción | WA | ONE |
|--------|----|-----|
| Lookup | `GET /api/leads/payments/lookup?code=` | `GET /api/crm-educacion/internal/payments/lookup?code=` |
| Asociar | `POST /api/leads/payments/associate` | `POST /api/crm-educacion/internal/payments/associate` |
| Vínculo ciclo | `GET /api/leads/payments/link?waCycleId=` | `GET /api/crm-educacion/internal/sales/by-cycle/:waCycleId` |
| Cerrar sin pago | `POST /api/leads/attention/close-without-payment` | (ciclo WA; motivo en audit) |

```env
# mali-whatsapp
MALI_ONE_API_URL=https://one.mali.pe
MALI_ONE_CRM_EDUCACION_SERVICE_TOKEN=

# MALI ONE (mismo valor)
CRM_EDUCACION_SERVICE_TOKEN=
```

Header ONE: `x-crm-educacion-service-token`.

## Cierre del ciclo (Option A)

`venta_exitosa` / `convertido` **no** cierran el ciclo. El cierre comercial ocurre así:

| Evento | `close_reason` | Ciclo | Obs Caja |
|--------|----------------|-------|----------|
| Associate **positivo** (Liquidada, Pagado, approved…) | `paid` | Cierra | No |
| Associate **autorizada** (Autorizada, authorized, processing) | `paid` | Cierra | Sí (`billingNote`) |
| Associate **en proceso** (Por pagar, pending, mediation…) | — | **Sigue abierto** | Sí (`billingNote`) |
| Associate **negativo** (Anulada, Denegada, Expirado, rejected…) | — | **Rechazado** (no asociar) | — |
| `POST .../close-without-payment` (crédito / fuera Treasury / otro) | `sold` | Cierra | — |
| Estado `perdido` / `no_interesado` / `vencido` | `lost` / terminal | Cierra al marcar | — |

Respuesta de associate WA: `{ payment, cycle, closesCycle, settlementKind }`. Solo si `closesCycle === true` se llama a `closeCycleAfterPayment`.

Clasificación de estados: `treasury-settlement.util.ts` en MALI ONE (`positive` | `authorized` | `in_progress` | `negative` | `unknown`). `unknown` se trata como en proceso (asocia + obs, no cierra). Política suavizada: solo `authorized` cierra con obs.

## Identificador pago ↔ ciclo

Fuente de verdad: **`EducacionSale`** en ONE (no un flag suelto en tres lados).

Derivado expuesto como `payment_link`:

| Campo | Valores |
|-------|---------|
| `status` | `reportado` \| `parcial` \| `pagado` \| `revertido` |
| `code` | código Treasury asociado |
| `waCycleId` / `saleId` | ancla |

- **CRM Educación → Oportunidades:** columna **Pago** (ícono + tooltip).
- **Treasury (Ventas Niubiz):** columna **Edu** + detalle “CRM Educación · ciclo #…”.
- **WA inbox:** texto en header/ficha (`Pago Asociado · {código}`); CTA “pendiente de pago” si venta exitosa (abierta o histórica cerrada) **y** aún no hay `payment_link`.

## UX

- Modal inbox: ficha / ⋮ / picker post-venta → **Asociar pago** (`InboxAssociatePaymentDialog`).
- También en **ventas históricas ya cerradas** (`closed_at` por la regla vieja) sin `payment_link`: CTA de asociar; no “iniciar ciclo” hasta tener vínculo o otro motivo.
- Lookup muestra hits; **negativos deshabilitados**; `authorized` avisa que cierra con obs; `in_progress`/`unknown` avisa “se asocia sin cerrar”.
- Si ONE/Treasury cae, el chat sigue; el endpoint responde 503.

## Estado

- API proxy WA: lookup / associate / link / close-without-payment.
- UI WA + UI ONE (Oportunidades → Pagos + columna Pago; Treasury Edu).
