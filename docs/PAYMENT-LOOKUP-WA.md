# Lookup de código Treasury desde mali-whatsapp (F3 → destino)

El asesor **no** entra a Treasury. Valida/asocia código desde WA.

## Contrato

Asesor (JWT) → mali-whatsapp → MALI ONE (service token):

| Acción | WA | ONE |
|--------|----|-----|
| Lookup | `GET /api/leads/payments/lookup?code=` | `GET /api/crm-educacion/internal/payments/lookup?code=` |
| Asociar | `POST /api/leads/payments/associate` | `POST /api/crm-educacion/internal/payments/associate` |

```env
# mali-whatsapp
MALI_ONE_API_URL=https://one.mali.pe
MALI_ONE_CRM_EDUCACION_SERVICE_TOKEN=

# MALI ONE (mismo valor)
CRM_EDUCACION_SERVICE_TOKEN=
```

Header ONE: `x-crm-educacion-service-token`.

## UX

Modal en ficha/ciclo del inbox: código → validar → asociar. Si ONE/Treasury cae, el chat sigue; el endpoint responde 503.

## Estado

- API proxy WA: implementada (aditiva); query `provider` opcional.
- UI modal inbox: ficha contacto → **Asociar pago** (`InboxAssociatePaymentDialog`).
- UI ONE: CRM Educación → Pagos (fuente + búsqueda + asociar) y botón en Oportunidades.
