# F6.2 — Identity & Access

El contexto `shared/src/contexts/identity-access/` publica Usuario, MembresiaEmpresa,
RolAplicacion, Permiso y TenantContext. Usuario es un principal del sistema,
independiente del Trabajador agrícola. Un Usuario puede pertenecer a varias
empresas. Cada membresía puede vincularse opcionalmente con un Trabajador de su
misma empresa. Crear trabajadores no crea cuentas ni concede permisos.

## Persistencia

Aplicar `202610140800_identity_access.sql` después de F5.2–F5.6 y F6.1. La
migración es transaccional, reejecutable y no configura GUC `scc.*` permanentes.

| Tabla                    | Responsabilidad                                                |
| ------------------------ | -------------------------------------------------------------- |
| identity_usuarios        | Principal global, nombre, email opcional y estado activo       |
| identity_identidades     | Vinculación del sujeto verificado por el proveedor con Usuario |
| identity_membresias      | Usuario → Tenant, estado activo y Trabajador opcional          |
| identity_roles           | Roles de aplicación por Tenant                                 |
| identity_permisos        | Catálogo global de capacidades                                 |
| identity_rol_permisos    | Capacidades de cada rol dentro de su Tenant                    |
| identity_membresia_roles | Asignación de roles a membresías del mismo Tenant              |

RLS permite leer la cuenta propia y los miembros de una empresa administrable.
Las mutaciones no admiten DML directo desde frontend: los RPC exigen permisos
efectivos. Las FK compuestas impiden vínculos con roles o trabajadores de otra
empresa. La pertenencia organizacional de las filas es inmutable.

`sesiones_lectura` y `operaciones_pda_campania` incorporan `identity_usuario_id`.
El autor agrícola legacy queda opcional para las escrituras de cuenta. Checks
impiden mezclar ambos autores, y las referencias Usuario/Tenant apuntan a una
membresía de esa empresa. No se reescriben hechos, UUID, actores o recibos previos.

## Autenticación y TenantContext

El puerto Identity ofrece iniciarSesion, obtenerSesion y cerrarSesion. Su adapter
provisional en `infrastructure/supabase/identityAdapter.js` usa correo/contraseña,
verificación remota del usuario y cierre de sesión. Ningún BC ni Application
importa el SDK. Los JWT no se devuelven al dominio o a la presentación.

El servidor resuelve:

1. Sesión verificada → `auth.uid()` del JWT validado por el servidor.
2. Sujeto del proveedor → Usuario activo.
3. Membresía activa → Tenant activo.
4. Roles activos → unión de permisos efectivos del Tenant.
5. TenantContext con usuarioId, membresiaId, tenantId, empresa y permisos.

`iam_obtener_identidad()` crea el perfil de una cuenta verificada en su primer
acceso, sin conceder membresías. Una cuenta sin empresa no obtiene TenantContext.
Una única membresía se selecciona automáticamente; varias requieren una elección.
`p_tenant_id` es una solicitud de selección, validada por el servidor. Los RPC de
campaña derivan Tenant directamente de la campaña persistida. No se confía en
roles, permisos ni Tenant configurados externamente. La siguiente solicitud
revalida revocaciones de Usuario, Tenant, membresía y rol.

La pantalla Cuenta GesGROW permite login, selección de empresa y consultas de
campañas, personal, equipo y resumen según permisos. Application publica los
casos de uso de gestión y Harvest autenticado. Ocultar botones es presentación;
los RPC siguen siendo la autoridad final.

## Roles y permisos

| Plantilla      | Capacidades                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------- |
| ADMIN_EMPRESA  | company.manage, campaign.manage, workforce.manage, harvest.operate, harvest.view, reports.view |
| GESTOR         | campaign.manage, workforce.manage, harvest.view, reports.view                                  |
| OPERADOR_CAMPO | harvest.operate, harvest.view                                                                  |
| CONSULTA       | harvest.view, reports.view                                                                     |

Las plantillas se persisten por empresa, también para Tenants nuevos. El nombre
del rol solo participa en su aprovisionamiento; la autorización consulta permisos
efectivos. No se unen permisos entre empresas. SUPERVISORA/JABERO/COSECHADOR son
roles laborales de Workforce y no conceden acceso de aplicación.

## Harvest y legacy

Las rutas `iam_asignar_lote`, `iam_iniciar_sesion_lectura`, `iam_registrar_cosecha`
y `iam_cerrar_sesion_lectura` usan Usuario como autor y no llaman al login por DNI.
El destinatario de la asignación sigue siendo un Trabajador y Workforce valida
la aptitud del jabero. Se conservan las tablas F5, bloqueos, UUID operativos,
recibos, consumo único y frontera de cutover. Los reportes autenticados usan la
proyección F5.6 con reports.view. Activar el cutover exige campaign.manage.

El PDA conserva la autorización diaria y su cola por DNI, identificadas como
**legacy provisional**. Una cuenta Identity autenticada no puede saltarse sus
permisos llamando a la ruta legacy con el DNI de otra persona; debe cerrar sesión
para entrar al modo PDA. No se migran cuentas desde usuarios_app ni se asignan
roles a partir de Workforce.

IndexedDB permanece en v5, sin stores, índices ni payloads nuevos. La operación
offline, los comandos compatibles, las respuestas perdidas y los RPC de
Sheets/Apps Script se conservan. El acceso de cuenta revalida online y no usa el
store operadores por DNI para guardar autoridad. Los casos de uso/API de cuenta
incluyen gestión y operación Harvest; sus formularios operativos no sustituyen
las pantallas del PDA en esta fase.

## Primer administrador

Las credenciales se provisionan en el proveedor Auth, por ejemplo mediante su
consola administrativa. Después del primer login, un administrador de confianza
asigna la primera membresía ADMIN_EMPRESA desde SQL. La migración no lo hace
automáticamente y no se incluye una clave administrativa en el navegador.

Ejemplo con un sujeto Auth ya verificado y Tenant existente, sustituyendo ambos UUID:

```sql
begin;
with cuenta as (
  select usuario_id from public.identity_identidades
  where proveedor='SUPABASE' and sujeto='<auth-subject-uuid>'::uuid
), membresia as (
  insert into public.identity_membresias(usuario_id,tenant_id)
  select usuario_id,'<tenant-uuid>'::uuid from cuenta
  on conflict(usuario_id,tenant_id) do update set activo=true
  returning id,tenant_id
)
insert into public.identity_membresia_roles(tenant_id,membresia_id,rol_id)
select m.tenant_id,m.id,r.id from membresia m join public.identity_roles r
  on r.tenant_id=m.tenant_id and r.codigo='ADMIN_EMPRESA'
on conflict do nothing;
commit;
```

Los administradores pueden gestionar miembros por iam_guardar_membresia,
utilizando roles y vínculos válidos de su empresa.

## Verificación y F6.3

Las pruebas cubren cuenta sin membresía, una/múltiples empresas, selección,
revocación, permisos efectivos, RLS/ACL con anon/authenticated, vínculos opcionales,
cruces, Usuario sin Trabajador operando Harvest, reintentos, consumo único,
reportes, DNI provisional e integraciones después de la migración. El fixture
auth.uid simula la identidad del JWT localmente; no sustituye la verificación
contra un proveedor desplegado.

F6.2 no añade planes, suscripciones, módulos contratados ni pagos. La ampliación
de capacidades comerciales está documentada en
[Platform F6.3](platform-suscripciones-f6.3.md); los pagos permanecen fuera de su alcance.

Referencias del adapter: [getUser](https://supabase.com/docs/reference/javascript/auth-getuser),
[inicio de sesión](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
y [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
