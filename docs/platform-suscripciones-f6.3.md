# F6.3 — Planes, suscripciones y módulos habilitados

Platform Management responde si una EmpresaCliente puede usar una capacidad.
Identity sigue respondiendo quién actúa, en qué empresa y con qué permisos.
No se crean permisos comerciales ni se cambia el modelo Usuario/Trabajador.

## Modelo y persistencia

La API pública `shared/src/contexts/platform/index.js` exporta `Plan`, `Modulo`,
`Suscripcion`, `ModuloContratado` (alias `TenantModuleEntitlement`), los catálogos
y `crearEntitlements`. Domain permanece puro; Application consume un puerto
`puedeUsarModulo(tenantId, modulo)`. El adapter está en infraestructura y la
composición se realiza en bootstrap y `application/accesoEmpresa.js`.

La migración nueva `202610140900_platform_suscripciones.sql` depende de F6.1 y
F6.2. No modifica sus archivos ni reescribe hechos, campañas, trabajadores,
cutovers o recibos anteriores.

| Tabla | Responsabilidad |
| --- | --- |
| `platform_modulos` | Catálogo de capacidades reales y disponibilidad |
| `platform_planes` | Nombre y código comercial; activo; fecha de creación |
| `platform_plan_modulos` | Plantilla inicial de módulos de un Plan |
| `platform_suscripciones` | Una suscripción actual por Tenant, Plan, estado y vigencia |
| `platform_tenant_modulos` | Entitlement por `(tenant_id, modulo_codigo)`, suscripción, habilitado, origen y vigencia propia |

Módulos iniciales: **HARVEST**, **CAMPAIGN**, **WORKFORCE**. Los nombres
INVENTORY, MACHINERY, IRRIGATION y QUALITY quedan reservados en el modelo para
evolución; no tienen filas habilitadas, BC, operaciones ni contratación actual.
Identity y Platform son capacidades base; no aparecen como módulos vendibles.

Planes iniciales sin precios ni cobros:

- `PILOTO_SCC`: los tres módulos actuales.
- `OPERACION_CAMPO`: HARVEST; permite demostrar/provisionar add-ons de gestión
  sin condicionar la operación a un nombre comercial.

`platform_crear_suscripcion` copia la plantilla al crear el contrato dentro de
una transacción. Cambiar el nombre, la plantilla o la disponibilidad comercial
del Plan no recalcula entitlements existentes. Un entitlement puede proceder
de `PLAN`, `ADD_ON` o `EXCEPCION`; estos orígenes documentan su procedencia y
no alteran la autorización. Un add-on necesita suscripción vigente, aunque su
módulo no aparezca en la plantilla del Plan.

## Resolución de acceso

```text
sesión verificada → Usuario → membresía activa → TenantContext
                     → permiso efectivo
                     → entitlement Platform vigente
                     → operación del BC
```

`platform_puede_usar_modulo` valida nuevamente la selección con
`iam_resolver_tenant_context`. El Tenant es una solicitud del cliente; sesión,
membresía y estado del Tenant se contrastan en servidor. Para campañas, el
Tenant procede de `platform_tenant_campania`, que consulta ownership persistido.
No se reciben listas de módulos habilitados ni estados comerciales de la UI.
Ningún GUC personalizado ni nombre de Plan otorga acceso.

La resolución privada `platform_modulo_habilitado` comprueba catálogo disponible,
Tenant activo, entitlement habilitado, misma suscripción/empresa y ambas
vigencias. Usa `statement_timestamp()` del servidor. El comienzo es inclusivo
y el final exclusivo. Sólo **ACTIVA** y **TRIAL** admiten uso; TRIAL requiere
fecha final. **SUSPENDIDA**, **CANCELADA** y **VENCIDA** deniegan. Una suscripción
ACTIVA con fecha final pasada también deniega sin depender de un job que cambie
el estado. La vigencia del entitlement puede ser más corta que la suscripción.

`crearAccesoEmpresa` comprueba permiso antes del puerto Platform. Los RPC
operativos vuelven a comprobar ambos, incluso si alguien omite Application.
La API pública TenantContext de Identity conserva exclusivamente permisos.

| Operación | Permiso Identity | Módulo |
| --- | --- | --- |
| Guardar campaña | `campaign.manage` | CAMPAIGN |
| Gestionar trabajadores | `workforce.manage` | WORKFORCE |
| Consultar ticket/recursos de cosecha | `harvest.view` | HARVEST |
| Asignar, abrir/cerrar sesión y registrar cosecha | `harvest.operate` | HARVEST |
| Reportes de producción | `reports.view` | HARVEST |
| Activar cutover Harvest | `campaign.manage` | HARVEST |
| Empresa, usuarios y membresías | `company.manage` | Capacidad base |

El selector de campañas acepta permiso de gestión con CAMPAIGN, o permiso de
operación/consulta/reportes con HARVEST. Leer maestros como recursos de una
cosecha no requiere contratar su gestión: HARVEST no implica contratar
CAMPAIGN/WORKFORCE. Sus relaciones siguen sujetas a FKs y reglas laborales
existentes. Los BC operativos no importan Plan ni Suscripcion; consumen contratos
operativos y la composición verifica capacidades por la API pública de Platform.

## Provisionamiento y aislamiento

RLS permite consultar suscripción/entitlements sólo con membresía activa de la
empresa. Catálogos compartidos son legibles para cuentas autenticadas. No se
concede escritura ni provisionamiento a `anon` o `authenticated`, tampoco a
ADMIN_EMPRESA mediante `company.manage`. Esa facultad permitiría que una cuenta
se otorgase contratación comercial a sí misma.

`platform_crear_suscripcion` se concede únicamente al backend de confianza
`service_role` en Supabase. La clave de ese servicio no se introduce en el
frontend. Sus estados, add-ons, excepciones o revocaciones se actualizan desde
administración confiable. Ejemplo de alta desde SQL administrativo:

```sql
select public.platform_crear_suscripcion(
  '<tenant uuid>', '<plan uuid>', 'TRIAL', now(), now() + interval '14 days'
);
-- Add-on explícito; la FK verifica que la suscripción pertenezca al Tenant.
insert into public.platform_tenant_modulos
  (tenant_id,suscripcion_id,modulo_codigo,origen,desde)
values ('<tenant uuid>','<suscripcion uuid>','WORKFORCE','ADD_ON',now());
```

La FK compuesta `(tenant_id, suscripcion_id)` impide usar un contrato de otra
empresa. Ownership es obligatorio e inmutable en suscripciones y entitlements.
La unicidad de una suscripción actual por Tenant y de un entitlement por módulo
evita resoluciones ambiguas. Las relaciones y unicidades de F6.1 se conservan.

## SCC y compatibilidad

El Tenant inicial `00000000-0000-4000-8000-000000000001` recibe una suscripción
ACTIVA `PILOTO_SCC`, sin vencimiento automático, con HARVEST, CAMPAIGN y WORKFORCE.
Los demás Tenants necesitan provisionamiento explícito. La migración es
transaccional e idempotente mediante marcador de finalización; reejecutarla
no duplica el piloto ni restaura módulos posteriormente revocados o excepciones.

Las guardas SQL envuelven las APIs conocidas preservando cuerpos, firmas, ACL,
retornos tempranos y restauración del contexto transaccional de F6.1. No añaden
configuraciones permanentes `proconfig` para GUC personalizados. Sheets mantiene
su autorización por integración y campaña más el módulo de su operación.
El login por DNI sigue provisional: autentica como antes; las operaciones PDA,
los comandos v4 y reportes exigen HARVEST del propietario persistido. No se
agregan nuevas dependencias sobre DNI al acceso por cuenta.

IndexedDB continúa en v5 con los mismos stores, comandos y payloads. No se
interpreta una copia offline como autoridad comercial: el servidor valida al
sincronizar. La vista de cuenta muestra módulos obtenidos del servidor y filtra
acciones por permiso y capacidad; modificar esos controles no concede acceso.

## Verificación y alcance posterior

Las pruebas cubren estados y ventanas de vigencia, ausencia de suscripción o
módulo, ambas combinaciones permiso/módulo, add-ons fuera del Plan, plantilla
independiente, FK e inmutabilidad, RLS y ACL reales, GUC falsificados,
provisionamiento confiable, reejecución sin reset, SCC, DNI y comandos v4.
Las suites de Identity y Sheets ejecutan F6.3; se conserva el flujo real de
asignación, consumo, reintento, cutover y reportes F5 con cuenta sin trabajador.
PGlite verifica PostgreSQL localmente; esta tarea no despliega la migración en
Supabase remoto ni ejerce una sesión contra el proveedor remoto.

La administración comercial, auditoría, renovaciones y cambios de suscripción
se amplían en [F6.4](platform-ciclo-vida-f6.4.md). Su nueva API sustituye el
provisionamiento directo para exigir idempotencia y eventos. Las capacidades
futuras requieren sus BC. Cobros, facturas y pasarela continúan fuera del alcance;
suscripción y pago siguen siendo conceptos distintos.
