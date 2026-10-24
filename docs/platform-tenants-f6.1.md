# F6.1 — EmpresaCliente / Tenant

Platform Management está implementado en `shared/src/contexts/platform/`, con `domain`,
`application`, `ports` e `index.js`. `EmpresaCliente` (alias técnico `Tenant`) es
un agregado inmutable con `id`, `nombre`, `codigo`, `estado` y `createdAt`.
Los estados admitidos son ACTIVA, SUSPENDIDA e INACTIVA. El código se normaliza a
mayúsculas y es único en la plataforma. El caso de uso `crearCrearEmpresaCliente`
recibe repositorio, generador de identidad y reloj. Su adapter Supabase queda
reservado a un cliente administrativo de confianza; no hay pantalla de alta ni
nuevos privilegios para la PWA o Sheets.

## Persistencia y migración

Aplicar `backend/supabase/migrations/202610140700_platform_tenants.sql` después de todas
las migraciones F5, incluidas 0600 y 0610. La migración es transaccional. Un
marcador de finalización en el comentario de `tenants`, confirmado en la misma
transacción, permite reejecutarla sin duplicar datos, constraints o parches RPC.
Una ejecución fallida revierte el marcador junto con los demás cambios.

La nueva tabla `tenants` contiene `id`, `nombre`, `codigo`, `estado`, `created_at`.
Se crea la EmpresaCliente SCC, código SCC, con UUID estable
`00000000-0000-4000-8000-000000000001`.

Se incorpora `tenant_id UUID NOT NULL REFERENCES tenants(id)` a:

| Área                | Tablas                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Campaign Management | campanias, variedades, lotes, lote_variedades                                                                  |
| Workforce           | trabajadores, trabajador_campania_rol, trabajadores_campania_hoja                                              |
| Acceso provisional  | usuarios_app                                                                                                   |
| Harvest legacy      | sesiones_lectura, asignaciones_ticket, lecturas_jaba                                                           |
| Harvest F5          | harvest_lotes_tickets, harvest_tickets, harvest_asignaciones_lote, harvest_registros_cosecha, harvest_cutovers |
| Comandos y recibos  | operaciones_pda_campania, operaciones_pda_procesadas                                                           |
| Integraciones       | integraciones_api, integracion_campania                                                                        |

`cultivos` permanece como catálogo de referencia compartido (arandano, mandarina),
sin personal, producción ni configuración de cliente. Las variedades concretas
y las campañas que usan ese catálogo sí tienen propietario. No se introduce Farm
Structure; lote conserva su semántica operativa anterior.

Todos los registros existentes reciben el Tenant SCC mediante `ADD COLUMN` con
default constante. Después se retira ese default de las relaciones y se hereda
ownership desde sus padres. Así no se ejecutan UPDATE sobre registros productivos
ni sobre cutovers inmutables. Se conservan UUID, DNI, tickets, fechas, versiones,
payloads, hashes y resultados de operaciones. No se convierte el histórico legacy
en cosecha F5. Las tablas de integración solo son opcionales en las fixtures
mínimas; toda tabla de integración existente se migra.

## Aislamiento y unicidad

Cada FK entre tablas con propietario tiene además su versión compuesta
`FOREIGN KEY(tenant_id, referencia...) REFERENCES padre(tenant_id, referencia...)`.
Las claves candidatas compuestas se reutilizan entre FKs. La migración valida
todos los datos existentes en su transacción. Si hay una relación inconsistente,
se aborta la migración; no se elimina ni reescribe el histórico para ocultarla.

Esto protege relaciones de campaña con trabajador/rol, usuario con trabajador,
sesión con lote/variedad/jabero/operador, asignación con trabajador, cosecha con
ticket/asignación/sesión/operación/cutover e integración con campaña. El trigger
`a_platform_propietario` hereda el Tenant del padre y rechaza contradicciones.
Cambiar `tenant_id` de una fila existente está prohibido, también en raíces sin
descendientes. Las restricciones F5 sobre campaña, idempotencia, consumo único y
cutover siguen vigentes.

- Trabajadores: `UNIQUE(tenant_id, dni)`, sustituyendo DNI global.
- Campañas: `UNIQUE(tenant_id, codigo)`.
- Una campaña activa por `(tenant_id, cultivo_id)`.
- Variedades: nombre único por `(tenant_id, cultivo_id, nombre)`.
- UUID y códigos de ticket siguen globales para conservar lectores y comandos.

Los cuerpos de los RPC vigentes se adaptan con `pg_get_functiondef`, siguiendo el
precedente de las migraciones de multicultivo. Las comparaciones SQL por DNI,
altas provisionales con `ON CONFLICT`, validaciones de maestros y listados se
acotan al Tenant operativo. Se mantienen firmas, grants y contratos de Apps
Script. `acceso_global` de una integración significa sus campañas dentro de su
EmpresaCliente; no permite acceder a otras empresas.

## Contexto y dependencias

Platform posee EmpresaCliente y publica las reglas de ownership. Campaign
Management posee Campaña con `tenantId`; Workforce posee Trabajador con
`tenantId`. Ninguno necesita importar internos de otro contexto. Campaign usa la
API pública de Platform para contrastar respuestas y cachés. La composición de
Application inyecta el resolver de Platform y puede recibir el puerto
`TenantContext.obtener()` desde Identity & Access. Harvest sigue obteniendo
campaña y personal por los contratos existentes; SQL deriva el propietario de
la campaña persistida y exige sus relaciones compuestas.

No existe un nuevo parámetro RPC `tenantId` enviado por UI. Los RPC con campaña
establecen temporalmente el contexto existente de campaña y conservan sus
validaciones de operador o integración. Se guarda y restaura explícitamente el
contexto con `set_config(..., true)`, también ante retornos anticipados y
excepciones. No se configuran GUC `scc.*` en `proconfig`; Supabase administrado
no permite esas opciones permanentes. Cuando el RPC tiene campaña explícita,
las búsquedas de trabajador derivan Tenant directamente de la campaña persistida.
`platform_tenant_operativo()` no acepta una GUC arbitraria de Tenant: deriva el
propietario desde la campaña persistida. Los contratos legacy sin campaña y el
login provisional siguen asociados al SCC inicial.

IndexedDB permanece en v5, con los mismos stores, claves e índices. Al abrir la
base, una transacción de contenido añade ownership al SCC existente y registra
`platform:ownership:v1` en meta. Esta migración es idempotente y no modifica los
payloads de la cola. Las nuevas cachés, snapshots, reservas y comandos conservan
ownership. La partición de trabajadores sigue siendo `(campania_id, dni)`; el UUID
global de campaña determina Tenant y se rechazan cambios de propietario,
snapshots incompatibles y datos locales con referencias cruzadas.

## Pendiente de F6.2

Estas responsabilidades ya se implementan en
[F6.2 — Identity & Access](identity-access-f6.2.md). Este apartado conserva el
límite original de alcance de F6.1.

Identity & Access debe autenticar la identidad y resolver membresías, permisos y
TenantContext confiable en el servidor. Debe reemplazar el acceso provisional por
DNI, habilitar selección autorizada de EmpresaCliente y particionar la caché de
identidad (el store legacy de operadores conserva su clave DNI). Las restricciones
de ownership implementadas aquí protegen integridad de relaciones; no convierten
la autenticación provisional en autorización SaaS completa. Los estados del Tenant
son parte del modelo; sus efectos sobre sesiones/permisos quedan para Identity.

No se implementan planes, pagos, módulos contratados ni suscripciones. La migración
se verifica localmente con PGlite y fake-indexeddb; no se despliega automáticamente
en Supabase remoto.

## Verificación

Las pruebas cubren creación de EmpresaCliente, ownership obligatorio de Campaña y
Trabajador, DNI repetido entre empresas, FKs y ownership inmutable, asignación y
consumo Harvest sin cruces, conservación de cosechas anteriores/recibos, migración
local idempotente en v5, puertos TenantContext, cachés contradictorias y los flujos
actuales de Sheets después de F6.1. La suite completa incluye los flujos de cutover,
reportes, cola, legacy, adapters Supabase y Apps Script.
