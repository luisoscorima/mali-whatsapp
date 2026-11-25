# Inventario de WhatsApp de MALI

Actualizado el 23 de noviembre de 2026 (tarde). El estado en Meta proviene del
panel y de Graph API según lo reportado por el equipo. El estado en Mali
corresponde a una consulta de solo lectura de las líneas registradas en
producción.

## Portfolios comerciales

| Portfolio | ID de portfolio |
| --- | --- |
| MALI Educación | `161605214895250` |
| MALI Museo de Arte de Lima | `100437827534895` |

Museo es propietario de las líneas del portfolio Museo. Educación las opera
desde Mali con los permisos de Meta y de la aplicación.

## Cuentas de mensajes (WABA) en Mali

| WABA interna | Etiqueta | Meta WABA ID | Estado |
| --- | --- | --- | --- |
| 2 | WABA PAM | `983584127989245` | Inactiva · baja en Meta pendiente por facturación |
| 3 | WABA Patronato | `1307846317978092` | Activa |
| 4 | WABA Educación | `958313150113818` | Activa |
| 25 | PAM Museo | `3141752249499039` | Activa |
| 26 | Educación Museo | `963348813298716` | Activa · app suscrita · sincronizada |

## MALI Educación (WABA Educación)

| Línea | Número | Phone Number ID | Categoría | Estado en Meta o acción | Mali producción |
| --- | --- | --- | --- | --- | --- |
| Educación (General) | +51 934 595 514 | `1178134562043416` | — | Mantener | Activa · ID 4 |
| MALI Educación CA | +51 902 043 388 | `1208809468991252` | Cursos de Arte | Mantener | Activa · ID 5 |
| MALI Educación EP | +51 922 172 157 | `1223653300823578` | Extensión Profesional | Mantener | Activa · ID 6 |
| MALI Educación 1 | +51 924 339 640 | `1396962876834754` | Cursos de Arte | Mantener | Activa · ID 26 |
| MALI Educación 2 | +51 902 125 355 | `1396556256873688` | Cursos de Arte | Mantener | Inactiva · ID 27 |
| MALI Educación 3 | +51 912 096 501 | `1469521102900812` | Cursos de Arte | Mantener | Inactiva · ID 25 |
| MALI Educación 5 | +51 924 970 373 | `1499275936592310` | Extensión Profesional | Mantener | Activa · ID 28 |
| MALI Educación 6 | +51 902 357 788 | `1451786684675678` | — | Mantener | Inactiva · ID 30 |
| Bertello | +51 923 909 130 | `1419158587955278` | Norte y Callao | En Educación | Activa · ID 35 |
| Callao - Bellavista | +51 907 982 747 | `1499874849868449` | Norte y Callao | En Educación | Activa · ID 32 |
| Callao - Lemos | +51 924 478 571 | `1379405358599886` | Norte y Callao | En Educación | Activa · ID 38 |
| Callao - Santa Rosa | +51 924 752 678 | `1403596569511901` | Norte y Callao | En Educación | Activa · ID 36 |
| Carabayllo | +51 905 432 885 | `1437166326150153` | Norte y Callao | En Educación | Activa · ID 33 |
| Comas - El Retablo | +51 902 064 970 | `1381406955066415` | Norte y Callao | En Educación | Activa · ID 37 |
| Los Olivos - Santa Ana | +51 905 432 257 | `1501663809698786` | Norte y Callao | En Educación | Activa · ID 31 |
| Los Olivos - Villa Sol | +51 981 137 746 | `1432110013319872` | Norte y Callao | En Educación | Activa · ID 34 |

General, EP, CA y Educación 1–3 / 5–6 conservan su configuración. La antigua
**MALI Educación 4** (+51 937 008 339) se trasladó a Educación Museo: ver
SJL - Campoy más abajo.

## MALI Museo de Arte de Lima

### PAM

PAM opera en Museo con el **+51 907 825 846**, línea interna `2`, cuenta de
mensajes `3141752249499039` y nombre visible **MALI Museo de Arte de Lima PAM**.
Recepción y respuesta verificadas. Meta aprobó las cinco plantillas de utilidad.

El 25 de noviembre de 2026 se reunieron en producción **16 pares de chats de
PAM** que Meta asoció al mismo teléfono con identificadores distintos tras
el traslado a Museo. Se movieron **89 mensajes** a sus chats históricos, se
conservaron las fichas de esos chats y se copió un campo que faltaba. Las
fichas duplicadas se desactivaron. El respaldo de las filas afectadas y de
los IDs de mensajes está en `pam_repair_20261125.bsuid_reconciliation`.

El chat `84133` sigue pendiente de identificación porque su
evento entrante no incluye teléfono.

Se preparó un ajuste para el webhook de PAM, pendiente de desplegar. Ante
un cambio de identificador por este traslado, conserva el chat histórico
si Meta confirma el mismo teléfono en ambos números, o si confirma el mismo
nombre de usuario y el contacto responde a un mensaje de ese chat. El
ajuste registra el vínculo en PAM sin modificar la identidad compartida
de la persona.

**Pendiente en Meta.** Eliminar en Educación la cuenta de mensajes anterior
`983584127989245`. El número +51 923 998 190 ya fue eliminado según lo
reportado. Meta bloquea el cierre por un saldo de S/ 0.01 y el pago devuelve
error.

### Educación Museo (sedes)

La cuenta **Educación Museo** (`963348813298716`, ID interno `26`) está activa,
con la app suscrita y las líneas sincronizadas. Museo es propietario; Educación
opera desde Mali. Área: **Educación**.

| Línea operativa | Número | Phone Number ID | Categoría | Nombre en Mali / Meta | Mali producción |
| --- | --- | --- | --- | --- | --- |
| Ate - Mayorazgo | +51 977 337 940 | `1461751663686125` | Centro y Este | MALI Educación Ate Mayorazgo | Activa · validada · ID 39 |
| Cercado - Sánchez Pinillos | +51 981 296 930 | `1440945485769734` | Centro y Este | MALI Educación Cercado Sánchez Pinillos | Activa · validada · ID 48 |
| Pueblo Libre | +51 905 432 362 | `1460975343764373` | Centro y Este | MALI Educación Pueblo Libre | Activa · validada · ID 46 |
| San Miguel | +51 905 432 279 | `1493363973856116` | Centro y Este | MALI Educación San Miguel | Activa · validada · ID 45 |
| SJL - Arabiscos | +51 905 432 923 | `1372116212662054` | Centro y Este | MALI Educación SJL Arabiscos | Activa · validada · ID 51 |
| SJL - Campoy | +51 937 008 339 | `1409193072285837` | Centro y Este | Ver nota Campoy | Inactiva · validada · ID 29 |
| SJL - El Sol | +51 924 205 793 | `1452768571254534` | Centro y Este | MALI Educación SJL el Sol | Activa · validada · ID 47 |
| Chorrillos - Horizontes | +51 905 433 170 | `1537206232806528` | Sur | MALI Educación Chorrillos Horizontes | Activa · validada · ID 43 |
| Chorrillos - Universo | +51 905 432 803 | `1551881801337543` | Sur | MALI Educación Chorrillos Universo | Activa · validada · ID 41 |
| Miraflores | +51 970 870 283 | `1527056620487119` | Sur | MALI Educación Miraflores | Activa · validada · ID 44 |
| San Juan de Miraflores | +51 936 904 892 | `1557316744122338` | Sur | MALI Educación San Juan de Miraflores | Activa · validada · ID 40 |
| SMP - Perú | +51 926 913 277 | `1407002665838650` | Sur | MALI Educación SMP Perú | Activa · validada · ID 50 |
| Surco | +51 936 703 903 | `1436056449598270` | Sur | MALI Educación Surco | Activa · validada · ID 49 |
| Villa El Salvador | +51 905 432 950 | `1540790319114345` | Sur | MALI Educación Villa El Salvador | Activa · validada · ID 42 |

**Patronato** (+51 969 126 956, ID 3) sigue en WABA Patronato; el traslado a
Museo queda para una etapa posterior.

#### SJL - Campoy (línea 29)

El número previsto originalmente para Campoy (+51 977 651 371) quedó fuera por
conflicto en Meta. Lo reemplaza la línea existente **MALI Educación 4**,
trasladada de WABA Educación a Educación Museo:

| Campo | Valor |
| --- | --- |
| Línea interna | 29 |
| Número | +51 937 008 339 |
| Phone Number ID | `1409193072285837` (nuevo tras el traslado) |
| WABA | 26 — Educación Museo |
| Categoría | Centro y Este |
| Estado en Mali | Validada · desactivada (pendiente de activar y probar) |
| Nombre actual en Meta | MALI - Museo De Arte De Lima |
| Nombre solicitado | **MALI Educación SJL Campoy** (`PENDING_REVIEW` en Graph) |

Cuando Meta apruebe el nombre, re-registrar con el PIN y pulsar **Revalidar**
en Mali para que copie la etiqueta.

## Distribución por categorías

Aplicada en Mali WhatsApp sobre las líneas de sedes.

### Norte y Callao (WABA Educación)

- Bertello · +51 923 909 130 · ID 35
- Callao - Bellavista · +51 907 982 747 · ID 32
- Callao - Lemos · +51 924 478 571 · ID 38
- Callao - Santa Rosa · +51 924 752 678 · ID 36
- Carabayllo · +51 905 432 885 · ID 33
- Comas - El Retablo · +51 902 064 970 · ID 37
- Los Olivos - Santa Ana · +51 905 432 257 · ID 31
- Los Olivos - Villa Sol · +51 981 137 746 · ID 34

### Centro y Este (WABA Educación Museo)

- Ate - Mayorazgo · +51 977 337 940 · ID 39
- Cercado - Sánchez Pinillos · +51 981 296 930 · ID 48
- Pueblo Libre · +51 905 432 362 · ID 46
- San Miguel · +51 905 432 279 · ID 45
- SJL - Arabiscos · +51 905 432 923 · ID 51
- SJL - Campoy · +51 937 008 339 · ID 29
- SJL - El Sol · +51 924 205 793 · ID 47

### Sur (WABA Educación Museo)

- Chorrillos - Horizontes · +51 905 433 170 · ID 43
- Chorrillos - Universo · +51 905 432 803 · ID 41
- Miraflores · +51 970 870 283 · ID 44
- San Juan de Miraflores · +51 936 904 892 · ID 40
- SMP - Perú · +51 926 913 277 · ID 50
- Surco · +51 936 703 903 · ID 49
- Villa El Salvador · +51 905 432 950 · ID 42

## Líneas que salen de servicio

| Línea | Número | Estado en Meta o acción | Mali producción |
| --- | --- | --- | --- |
| PAM (anterior) | +51 923 998 190 | Número eliminado en Educación · baja de la cuenta de mensajes bloqueada por facturación | Histórico en la línea ID 2 / WABA 2 inactiva |
| Callao - Bellavista (anterior) | +51 977 543 993 | Baja definitiva ejecutada | Sin fila |
| SJL - Campoy (número original) | +51 977 651 371 | No usable por conflicto en Meta · reemplazado por +51 937 008 339 | Sin fila |

## Orden de ejecución

1. **PAM.** Transición operativa completada. Queda pendiente la baja de la cuenta anterior en Meta.
2. **Educación Museo.** Completado: WABA 26 activa, app suscrita, 13 sedes
   nuevas (IDs 39–51) activas y validadas, más Campoy (ID 29) vinculada tras
   migración. Norte y Callao quedaron en WABA Educación (IDs 31–38).
3. **SJL - Campoy.** Migración de WABA hecha. Pendiente: activar la línea 29,
   probar recepción/respuesta, aprobación del nombre en Meta y revalidar.
4. **TI y Cercado - Sánchez Pinillos.** Completado en Mali; Cercado opera como
   ID 48 en Educación Museo.
5. **Patronato.** Mover la conexión a Museo después de estabilizar Campoy.
   Preservar las conversaciones y campañas registradas.

## Mejoras pendientes en Mali WhatsApp

- Permitir que un administrador edite desde Mali WhatsApp el perfil de cada
  número a través de Meta Graph API, incluidos el nombre visible, la foto de
  perfil y la descripción.
- Para cambios de nombre visible, mostrar el estado de revisión de Meta y
  permitir completar el registro del número tras la aprobación. Verificar
  en Graph que se haya aplicado el cambio.
- Mostrar el diagnóstico de cada línea en un solo lugar, con cuenta de
  mensajes, Phone Number ID, estado de conexión, calidad, suscripción de la
  app y última verificación. Mostrar los errores devueltos por Meta.
- Completar el alta de números desde la interfaz de administración de Mali
  con Graph. Seleccionar la cuenta de mensajes, crear el número con su nombre
  visible, solicitar y confirmar el código por SMS o llamada, retomar altas
  pendientes y mostrar el estado y los errores de Meta. Reutilizar el registro
  en Cloud API, la sincronización y la suscripción de la app existentes.
- Guiar las migraciones desde Mali. Verificar la cuenta de destino y sus
  permisos antes del corte, conservar el ID interno y su historial cuando
  corresponda, y comprobar recepción y envío después de cambiar la conexión.
- Actualizar en Mali el estado de revisión de las plantillas por cuenta de
  mensajes y permitir un envío a un número de prueba autorizado, con
  seguimiento de la entrega o del error devuelto por Meta.
