# Un archivo de Sheets por campaña

**Estado actual F7.7:** Portal Web es la interfaz administrativa actual.
No desarrollar nuevas funcionalidades en Apps Script. Los pasos siguientes
documentan la compatibilidad legacy para campañas sin cutover y consulta histórica;
no rehabilitan escritura en una campaña migrada. Véase [retirada progresiva y matriz](portal-cutover-administrativo-f7.7.md).

Cada archivo trabaja con una campaña fija. El correo de Google determina a qué archivos puede acceder una persona mediante **Compartir** en Drive. Un supervisor de ambas campañas recibe acceso a ambos archivos; su DNI y UUID de trabajador siguen siendo únicos en Supabase.

No se cargan datos diferentes en un mismo archivo según quién lo abre. No se introduce un segundo login dentro de Sheets ni se intenta detectar el correo desde `onOpen`. El archivo ya está protegido por la sesión de Google y su lista de personas autorizadas.

## 1. Preparar Supabase

Aplicar `backend/supabase/migrations/202610110500_sheets_por_campania.sql` después de la migración `202610110400_rpc_por_campania.sql` ya aplicada.

La nueva migración **no asigna permisos a ninguna campaña automáticamente**. Las cuentas técnicas existentes dejan de poder ejecutar directamente los RPC globales si no tienen `acceso_global = true`; los archivos deben actualizarse a los nuevos scripts y recibir la asignación siguiente. Esta transición no cambia los permisos de la PWA.

Mantener una cuenta de Supabase Auth dedicada por archivo, distinta del correo personal de los supervisores. Puede reutilizarse la cuenta técnica actual para Arándanos y crear otra para Mandarina. Evitar compartir entre archivos una cuenta con acceso a varias campañas: los editores de un archivo vinculado también pueden acceder a su proyecto Apps Script y sus propiedades. [Acceso a proyectos vinculados](https://developers.google.com/apps-script/guides/collaborating), [propiedades compartidas](https://developers.google.com/apps-script/guides/properties).

Desde el SQL Editor, con permisos administrativos, asignar la cuenta técnica a su campaña usando valores reales:

```sql
-- Consultar los UUID de campañas e identidades técnicas.
select c.id, c.codigo, c.nombre, cu.nombre as cultivo
from public.campanias c join public.cultivos cu on cu.id = c.cultivo_id;

select id, auth_user_id, nombre, activo,
       puede_gestionar_maestros, puede_consultar_reportes, acceso_global
from public.integraciones_api;
```

Si la cuenta Auth todavía no tiene integración, crearla:

```sql
insert into public.integraciones_api
  (auth_user_id, nombre, activo, puede_gestionar_maestros, puede_consultar_reportes)
values
  ('<UUID de la cuenta en Supabase Auth>', 'Sheets Mandarina 2026', true, true, true);
```

Luego otorgar alcance a la campaña correspondiente:

```sql
insert into public.integracion_campania (integracion_id, campania_id, activo)
values ('<UUID de integraciones_api.id>', '<UUID de campanias.id>', true)
on conflict (integracion_id, campania_id) do update set activo = true;
```

Las capacidades siguen siendo independientes: `puede_gestionar_maestros` habilita los maestros y `puede_consultar_reportes` habilita reportes. `acceso_global` queda en `false` para las cuentas de cada archivo. Para una integración de administración central confiable puede habilitarse explícitamente; no debe colocarse esa credencial en un archivo compartido con un equipo de campaña.

La campaña debe existir antes de configurar el archivo. Las nuevas campañas se crean de forma central indicando su `cultivo_id`. Por ejemplo, Mandarina utiliza `a1000000-0000-4000-8000-000000000002`. Una vez creada y asignada, el archivo permite modificar esa campaña, sus fechas y estado; no crea ni modifica otra campaña.

## 2. Preparar los archivos

Crear un archivo vacío para cada campaña, por ejemplo **SCC — Arándanos 2026** y **SCC — Mandarina 2026**. Para usar una plantilla, copiarla sin registros ni reportes de otra campaña. Una copia de un archivo ya poblado conserva esas celdas y no debe compartirse antes de retirar los datos anteriores.

En **Extensiones → Apps Script**, incorporar los archivos de `apps-script/`, incluido el nuevo `CampaniaArchivo.gs`, y actualizar `Config.gs`, `Supabase.gs` y `Menu.gs`. No es necesario cambiar las columnas actuales.

En la configuración del proyecto establecer las seis Script Properties:

| Propiedad                       | Valor                                            |
| ------------------------------- | ------------------------------------------------ |
| `SUPABASE_URL`                  | URL del proyecto Supabase                        |
| `SUPABASE_PUBLISHABLE_KEY`      | Clave pública existente                          |
| `SUPABASE_INTEGRATION_EMAIL`    | Correo de la cuenta Auth técnica de este archivo |
| `SUPABASE_INTEGRATION_PASSWORD` | Contraseña de esa cuenta técnica                 |
| `SCC_CAMPANIA_ID`               | UUID de la campaña fija de este archivo          |
| `SCC_SPREADSHEET_ID`            | ID de este archivo, tomado de su URL             |

El ID de archivo evita sincronizar una copia con la configuración del archivo anterior. El UUID de campaña se envía en cada consulta y guardado; Supabase vuelve a comprobar los permisos y los UUID de las filas. Las propiedades son configuración operativa; los permisos efectivos están en Supabase.

Después de cambiar de cuenta técnica, ejecutar `limpiarTokenSupabase_()` una vez desde el editor para retirar el token anterior de la caché.

Reabrir el archivo y usar **SCC → Ver campaña de este archivo** para comprobar cultivo, nombre, código y estado. Después seleccionar y ejecutar **SCC → Actualizar desde sistema** en CAMPANIAS, VARIEDADES, TRABAJADORES, LOTES y ROLES_CAMPANIA; por último actualizar reportes. Las actualizaciones conservan la validación existente que impide reemplazar filas pendientes o con error.

## 3. Compartir según el correo

En **Compartir**, mantener **Acceso general: Restringido** y agregar las cuentas de Google correspondientes:

- Responsable exclusivo de arándanos: acceso al archivo de arándanos.
- Responsable exclusivo de mandarina: acceso al archivo de mandarina.
- Supervisor o administrador de ambas campañas: acceso a ambos archivos.
- Solo consulta: lector. Ve los reportes ya actualizados; no ejecuta los menús administrativos.
- Gestión de maestros y actualización manual: editor de confianza. Su acceso incluye el proyecto vinculado; los permisos de la cuenta técnica se aplican a todos los editores de ese archivo.

Los permisos personales son los de Drive. Los permisos de Supabase son los de la cuenta técnica por archivo. No se auditan acciones bajo el correo individual ni se asigna automáticamente acceso de Drive a partir del DNI. La persona que administra los archivos da o retira el acceso por correo en Compartir.

## Personal compartido y sincronización

TRABAJADORES muestra las personas con roles en la campaña y las que se importaron desde ese archivo antes de asignarles un rol. Las altas se conservan al actualizar la hoja aunque aún no exista un rol. Al ingresar un DNI existente sin ID Sistema se reutiliza su UUID; no se crea otra persona.

Los nombres, apellidos y el estado **Activo de TRABAJADORES son datos globales del trabajador**. Para importar un trabajador que ya participa en otra campaña, ingresar sus mismos datos. Para modificar datos globales de una persona compartida, la integración debe tener permisos en todas las campañas donde participa. Una cuenta de una sola campaña recibe un error y la fila conserva su ID.

Para retirar a alguien de una sola campaña, desactivar su rol en **ROLES_CAMPANIA**, sin desactivar globalmente al trabajador. Así un supervisor puede mantener su acceso en la otra campaña. El registro de personal importado conserva la relación administrativa y no concede por sí mismo acceso a la PWA: ese acceso sigue dependiendo de los roles existentes.

VARIEDADES se consulta y guarda dentro del cultivo de la campaña fija. Dos cultivos pueden tener una variedad con el mismo nombre y UUID distintos. LOTES y ROLES_CAMPANIA solo aceptan registros de la campaña del archivo; los lotes conservan múltiples variedades del cultivo correspondiente.

Los cuatro reportes reciben contexto explícito de campaña. También pueden consultarse cuando la campaña se cierra, manteniendo el archivo como histórico. El ranking conserva sus períodos Hoy/Semana/Mes/Campaña. Los reportes siguen utilizando solo lecturas ya sincronizadas con Supabase.

## Verificación

`npm test` incluye pruebas de PostgreSQL con dos campañas y cuentas con permisos distintos, supervisor compartido, importaciones sin rol, variedades por cultivo, reportes separados e históricos, revocación y rechazo de RPC globales sin alcance. Las pruebas de Apps Script verifican el UUID en las peticiones, copias sin configurar y reintentos HTTP.

Las pruebas locales no crean archivos, comparten permisos, configuran cuentas ni aplican migraciones en servicios externos. Esa configuración se realiza con los pasos anteriores.
