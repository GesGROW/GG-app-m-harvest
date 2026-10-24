# F6.4 — Administración comercial, ciclo de vida y auditoría

Platform incorpora cambios comerciales con intención idempotente, historial
inmutable y una proyección actual que debe coincidir con ese historial. Harvest,
Campaign, Workforce e Identity conservan sus modelos y contratos operativos.
No se introduce ningún concepto de pago, factura o pasarela.

## Modelo y tablas

La API pública de Platform exporta `CambioComercial`, `EventoComercial`,
`EVENTOS_COMERCIALES`, `PERMISO_COMERCIAL` y `crearAdministracionComercial`.
Application recibe el TenantContext autorizado y el puerto comercial;
infraestructura implementa el transporte RPC con el cliente provisional. No se
importa Supabase Auth desde Platform ni se convierte al Trabajador en actor comercial.

La migración nueva `202610141000_platform_ciclo_vida.sql` se aplica después de
F6.3. Sus cambios se confirman juntos; el marcador de finalización permite
repetirla sin duplicar baseline, comandos o eventos.

| Tabla nueva | Propósito |
| --- | --- |
| `platform_delegaciones_comerciales` | Permiso comercial explícito por Usuario y Tenant, concedido sólo por administración de confianza |
| `platform_operaciones_comerciales` | Intención admitida e inmutable: UUID idempotente, actor, parámetros canónicos, plantilla capturada, motivo, fecha solicitada y versión de referencia |
| `platform_eventos_comerciales` | Hechos inmutables: Tenant, operación, tipo, fase, actor, fecha real, effective_at, snapshots anterior/nuevo, motivo/contexto y versión aplicada |

`platform_suscripciones` mantiene una suscripción actual por empresa y añade
`version_comercial` y `estado_pre_suspension`. Los planes, suscripciones y
entitlements F6.3 se conservan. Los entitlements retirados se deshabilitan;
ninguna operación elimina físicamente sus filas.

## Operaciones y transiciones

| Application | Evento | Comportamiento |
| --- | --- | --- |
| `crearSuscripcion` | CREAR_SUSCRIPCION | Empresa sin suscripción; ACTIVA o TRIAL; copia inicial de módulos del Plan |
| `cambiarPlan` | CAMBIAR_PLAN | Cambia el Plan y su plantilla; conserva add-ons y excepciones explícitas |
| `renovarSuscripcion` | RENOVAR_SUSCRIPCION | Exige extender una vigencia finita; renueva expiradas; conserva suspensión si existe |
| `suspenderSuscripcion` | SUSPENDER_SUSCRIPCION | ACTIVA/TRIAL → SUSPENDIDA; conserva módulos y estado previo |
| `reactivarSuscripcion` | REACTIVAR_SUSCRIPCION | SUSPENDIDA → estado previo, dentro de vigencia; fuera de vigencia exige renovación |
| `cancelarSuscripcion` | CANCELAR_SUSCRIPCION | CANCELADA; terminal para el contrato actual |
| `habilitarModulo` | HABILITAR_MODULO | Catálogo real; ADD_ON o EXCEPCION; vigencia propia opcional |
| `deshabilitarModulo` | DESHABILITAR_MODULO | Deshabilita el entitlement y lo conserva como excepción explícita |

Cambiar Plan modifica sólo entitlements con origen PLAN. Los módulos ausentes
en la nueva plantilla quedan deshabilitados; los incluidos se habilitan. Un
ADD_ON/EXCEPCION, incluso una baja explícita, no se sobrescribe al cambiar Plan.
La renovación no extiende automáticamente vigencias particulares de add-ons.
Reactivar un trial suspendido conserva TRIAL; renovar lo convierte en ACTIVA,
sin implicar que exista un pago. Una suspensión anterior a F6.4 sin estado
previo conocido se reactiva como ACTIVA conservando su vigencia existente.

CANCELADA bloquea renovación/reactivación del contrato actual. La contratación
de un nuevo contrato después de una cancelación terminal requerirá una ampliación
explícita del modelo de contratos; esta fase mantiene la unicidad actual F6.3.
La expiración sigue resolviéndose por fechas del servidor aunque el estado
persistido todavía diga ACTIVA/TRIAL. No se necesita un job de expiración para
denegar acceso; una VENCIDA importada también se puede renovar.

## Autorización y TenantContext

Cada solicitud requiere sesión verificada, Usuario activo, membresía válida y
Tenant autorizado mediante Identity F6.2. Además exige el permiso efectivo
`company.manage` y la delegación Platform `subscription.manage`. Se autorizan
permisos, sin comparar nombres de rol en las decisiones de acceso.

La delegación comercial se mantiene fuera de los roles que un administrador de
empresa puede asignarse a través de `iam_guardar_membresia`. ADMIN_EMPRESA no
obtiene contratación automáticamente. Sólo el backend de confianza puede
aprovisionar/revocar delegaciones; no hay RPC de autoconcesión desde UI.
Ejemplo de aprovisionamiento administrativo, con un Usuario que ya tiene
membresía y permiso efectivo company.manage en la empresa:

```sql
insert into public.platform_delegaciones_comerciales(tenant_id,usuario_id)
values ('<tenant uuid>','<identity_usuario uuid>')
on conflict(tenant_id,usuario_id,permiso) do update set activo=true;
```

Las operaciones del portal usan la sesión personal autorizada, y el actor se
deriva en servidor de `iam_exigir_permiso`/`auth.uid()`. Ningún RPC recibe un
actor o una lista de módulos habilitados como autoridad. La selección de empresa
del frontend se valida otra vez; Application descarta un Tenant adicional del
formulario. Platform es capacidad base, por lo que la administración puede
crear un contrato o reactivar una suscripción sin tener HARVEST habilitado.

Los BC operativos mantienen el orden F6.3: TenantContext válido → permiso
efectivo → entitlement vigente → operación. Ningún BC operativo conoce Planes,
eventos comerciales o nombres de suscripción.

## Auditoría y estado actual

F6.4 crea un evento ESTADO_IMPORTADO/BASELINE por contrato existente, incluido
SCC. Conserva todos sus valores y captura el snapshot inicial con actor de
migración. No inventa autoría ni acontecimientos anteriores no registrados.

Cada cambio aplicado incrementa la versión bajo bloqueo del Tenant y guarda
snapshots completos, ordenados y con fechas UTC. Los snapshots anterior/nuevo
encadenan el estado y muestran Plan, vigencias, módulos, origen y habilitación.
El último snapshot aplicado explica la proyección actual; los eventos y sus
parámetros explican cómo se llegó a él.

Eventos y comandos tienen triggers que rechazan UPDATE, DELETE y TRUNCATE.
Las escrituras de proyección se comprueban mediante constraint triggers
diferidos: al confirmar la transacción deben coincidir exactamente con el
último estado auditado. Una modificación manual sin evento también falla.
Se revocan las escrituras directas del service_role sobre contratos y
entitlements, junto con el antiguo provisionamiento F6.3 sin ID de operación.
La firma antigua permanece privada, pero la nueva administración sustituye ese
camino para impedir cambios sin auditoría.

La migración revoca explícitamente los grants por defecto que Supabase pueda
aplicar al crear tablas o funciones. service_role puede gestionar delegaciones
y ejecutar el worker, pero no insertar eventos falsos ni invocar helpers de
aplicación. RLS permite historial/comandos sólo al administrador comercial
autorizado. FKs compuestas relacionan actor/membresía/empresa y
evento/operación/empresa, evitando referencias cross-tenant.

## Cambios inmediatos, programación e idempotencia

`platform_solicitar_cambio` recibe un UUID de operación, selección de Tenant,
tipo, parámetros permitidos, motivo obligatorio y `effective_at` opcional.
Vacío significa ahora, calculado después del bloqueo mediante reloj del
servidor. Una fecha explícita pasada se rechaza; la UI sólo propone una intención.

Un cambio futuro añade un evento PROGRAMADA. Los snapshots todavía representan
el estado actual sin modificar; el contexto y el comando conservan la intención
y los módulos de la plantilla elegida. La plantilla queda capturada al admitir
el cambio y no se recalcula a partir de ediciones posteriores del catálogo.
Al llegar la fecha se añade APLICADA o RECHAZADA, con fecha real de ejecución
distinta de la fecha prevista. El actor sigue siendo quien lo solicitó; el
contexto identifica al ejecutor del cambio programado como SISTEMA.

Antes de aplicar se revalidan delegación, usuario, membresía, permiso y
transición. La versión debe coincidir con la de admisión. Una intervención
comercial posterior provoca rechazo auditable del cambio anterior programado;
una cancelación no puede ser sobrescrita por una renovación antigua. Si se
programan varias intenciones sobre la misma versión, aplicar una deja las otras
en conflicto: deben revisarse y presentarse de nuevo con IDs distintos.

El worker `platform_procesar_programados()` está concedido a service_role para
ser invocado desde un scheduler de backend. También se aplican cambios vencidos
al consultar entitlements o administración comercial. No se depende de un
temporizador del frontend para bloquear/habilitar acceso. Si el RPC envolvente
falla, su transacción revierte también la materialización/auditoría; el cambio
se vuelve a evaluar en la siguiente consulta o ejecución del worker. El acceso
sigue considerando la intención vencida dentro de esa transacción.

Bloqueos por operación y Tenant, eventos únicos por operación/fase y una versión
única por empresa serializan los cambios. La solicitud canónica compara tipo,
Tenant, actor, parámetros, motivo y fecha solicitada. El mismo ID e intención
devuelven el recibo original, incluso después de otros cambios; reutilizarlo
con otro actor, empresa o intención se rechaza. Un reintento requiere autorización
vigente. La respuesta de un cambio programado conserva PROGRAMADA como recibo
de admisión; el historial muestra su aplicación/rechazo posterior.

## Vista y compatibilidad

La vista de cuenta ofrece “Administrar suscripción” sólo cuando el servidor
confirma delegación. Incluye las ocho operaciones, motivo, fecha prevista,
estado actual y un historial con estados, Planes, módulos y actores. Las fechas
se muestran en hora local; las decisiones de vigencia siguen en servidor.
“Preparar otro cambio” genera otra intención; reintentar una respuesta perdida
conserva el mismo UUID. Los datos de auditoría se renderizan con textContent.

La migración no cambia la suscripción piloto ni los tres módulos actuales de
SCC, no reinicia bajas/excepciones ni concede administradores comerciales.
F6.1–F6.3 se mantienen como migraciones anteriores sin editar sus archivos.
IndexedDB v5, comandos legacy y login DNI siguen iguales. Las suites de
Identity y Sheets aplican F6.4 y verifican Harvest, cutover, reintentos, reportes,
Apps Script y aislamiento después de la migración.

## Validación y pagos pendientes

Pruebas de dominio, Application, adapter, vista y PostgreSQL/PGlite cubren todo
el ciclo, cambios futuros antes/después, caducidad/renovación, conflicto de
versiones, actor revocado, idempotencia, ACL/RLS, grants por defecto Supabase,
auditoría inmutable, rollback de escrituras sin auditoría y preservación de SCC.
La validación es local; esta tarea no despliega la migración ni configura un
scheduler remoto. La activación bajo carga y concurrencia entre conexiones
debe verificarse en staging PostgreSQL antes de desplegar.

Para integrar pagos quedan contratos de proveedor, conciliación de pagos,
facturas, reglas de cobro y tratamiento idempotente de notificaciones cuando
esa fase sea autorizada. El actor técnico y la política que traduzcan un pago
a cambios comerciales deberán quedar auditados mediante este contrato. No se
introducen Stripe, Mercado Pago, tarjetas, cobro automático ni webhooks de pago.
