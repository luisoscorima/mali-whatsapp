# Plantilla Meta: invitación cóctel Patronato (MALI)

WhatsApp **no permite** enviar un texto largo libre como el de un correo salvo que el usuario te haya escrito en las últimas 24 horas. Para campañas masivas necesitas una **plantilla aprobada** en WhatsApp Manager. El texto fijo va en la plantilla; lo que cambia (fecha, dirección, enlace, etc.) son **variables** `{{1}}`, `{{2}}`, … que rellena este sistema.

## Configuración en el panel (recomendado)

En **Configuración** del dashboard puedes definir cuántas variables tiene el cuerpo, las etiquetas de cada campo, si `{{1}}` es el nombre del contacto y la lista de plantillas sin variables (p. ej. `hello_world`). Se guarda en base de datos y **no hace falta rebuild**; tiene prioridad sobre las variables `TEMPLATE_BODY_*` del `.env`.

## Qué crear en WhatsApp Manager

1. **Categoría**: p. ej. *Marketing* o *Utility* (según políticas actuales de Meta).
2. **Header**: tipo **Imagen** (subes una imagen de muestra; en el envío real la URL la pones en el panel en **URL pública de imagen**).
3. **Body**: texto fijo + exactamente **N variables** en el orden que usarás siempre.

### Ejemplo de cuerpo (4 variables) alineado con `.env` por defecto

Configura en tu `.env`:

- `TEMPLATE_BODY_VARIABLE_COUNT=4`
- `TEMPLATE_BODY_VARIABLE_1_FROM_CONTACT=false`
- `TEMPLATE_BODY_VARIABLE_LABELS=Fecha y hora del evento,Dirección completa,Link RSVP,Nota o recordatorio`

En Meta, el **body** podría verse así (el texto fijo es tuyo; las partes entre `{{ }}` deben coincidir en número y orden):

```
Estimados miembros del Patronato de las Artes,

En nombre del Museo de Arte de Lima, nos complace invitarlos a un cóctel en casa de Alexandra Bryce, Vicepresidenta del museo, para celebrar el Patronato del MALI y compartir con ustedes nuestros proyectos para el 2026.

Será una ocasión especial para reencontrarnos y expresarles nuestro sincero agradecimiento por su constante apoyo al museo.

Los esperamos el {{1}}.

Alberto Rebaza
Presidente
Alexandra Bryce
Vicepresidenta

Dirección
{{2}}

RSVP {{3}}
{{4}}
```

**Valores típicos al enviar desde el panel**

| Variable | Ejemplo de contenido |
|----------|----------------------|
| `{{1}}` | `lunes 20 de abril de 2026, a las 7 p.m.` |
| `{{2}}` | `Av Pezet 561. Apt 302, San Isidro` |
| `{{3}}` | `https://www.addevent.com/event/clt2hdpl87jz` |
| `{{4}}` | `Confirmar si irá con acompañante` |

Ajusta el texto fijo en Meta si quieres más o menos líneas (siempre respetando el **límite de caracteres** del body que indique WhatsApp Manager).

## Imagen en el envío
https://mali.pe/es/wp-content/uploads/2026/03/Coctel_Patronato.jpeg
- **En Meta**: plantilla con header **Imagen**.
- **En el panel**: campo **URL pública de imagen** con una URL HTTPS accesible (misma lógica que ya usa la API Graph).
- Si la plantilla **no** tiene header imagen, deja ese campo vacío.

## Si más adelante cambias solo fecha, hora o enlace

- **No hace falta cambiar código**: cambias los valores en el formulario de cada campaña.
- Si cambias **cuántas variables** tiene la plantilla en Meta, actualiza en `.env`:
  - `TEMPLATE_BODY_VARIABLE_COUNT`
  - `TEMPLATE_BODY_VARIABLE_LABELS` (misma cantidad de etiquetas que de variables de formulario)

Si quieres que `{{1}}` sea el nombre del contacto (personalizado), pon:

`TEMPLATE_BODY_VARIABLE_1_FROM_CONTACT=true`

y en la plantilla de Meta el texto debe usar `{{1}}` donde iría el nombre.

## Errores frecuentes

- **132000**: número de parámetros distinto al de la plantilla → revisa `TEMPLATE_BODY_VARIABLE_COUNT` y el orden en Meta.
- **132001**: nombre o idioma de plantilla incorrecto.
- **131030**: número de teléfono no permitido en modo prueba.
