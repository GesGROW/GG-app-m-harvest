# Sincronización SCC con Google Sheets

**Estado actual F7.7:** Portal Web es la interfaz administrativa actual.
No desarrollar nuevas funcionalidades en Apps Script. Esta guía se conserva
para compatibilidad e histórico; las campañas con cutover administrativo rechazan
nuevas escrituras Sheets en backend. Consulte la [matriz y procedimiento de retirada](portal-cutover-administrativo-f7.7.md) antes de utilizar los pasos históricos siguientes.

Desde `202610110500_sheets_por_campania.sql`, cada archivo utiliza una campaña fija y RPC `*_hoja` con permisos por integración y campaña. La configuración vigente y el acceso por correo están en [Sheets por campaña](sheets-por-campania.md). Los contratos globales descritos abajo corresponden a la integración anterior y requieren acceso global explícito; los archivos de campaña utilizan los adaptadores nuevos.

PostgreSQL en Supabase es la fuente oficial. Google Sheets funciona como interfaz administrativa para maestros y como salida manual de reportes.

Hay dos sentidos separados:

- **MAESTROS — Sheets → Supabase:** TRABAJADORES, CAMPANIAS, VARIEDADES, LOTES y ROLES_CAMPANIA.
- **REPORTES — Supabase → Sheets:** RESUMEN, RANKING, PRODUCCION_DIARIA y PRODUCCION_LOTES.

Los reportes se construyen exclusivamente con información que ya llegó a PostgreSQL. Una lectura que continúe pendiente en un PDA offline no aparece en Sheets hasta que el PDA la sincronice con Supabase.

## Seguridad

Los cinco maestros reutilizan la misma identidad técnica y el mismo control administrativo existente:

- cuenta dedicada de Supabase Auth;
- `auth.uid()`;
- `public.integraciones_api`;
- `activo = true`;
- `puede_gestionar_maestros = true`;
- `public.autorizar_integracion_gestion_maestros()`.

La consulta de reportes usa un permiso independiente:

- `puede_consultar_reportes = true`;
- `public.autorizar_integracion_reportes()`.

Tener `authenticated` o `puede_gestionar_maestros` no habilita reportes por sí solo. Todas las RPC de reportes son `SECURITY DEFINER`, se conceden únicamente a `authenticated` y verifican además `auth.uid()`, `integraciones_api.activo = true` y `puede_consultar_reportes = true`.

No se usa `service_role`, no se crean credenciales nuevas y las RPC administrativas no se conceden a `anon`. La integración conserva las mismas cuatro Script Properties: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_INTEGRATION_EMAIL` y `SUPABASE_INTEGRATION_PASSWORD`.

Después de aplicar `20260930_admin_reportes_sheets.sql`, el permiso de reportes debe concederse manualmente a la identidad técnica ya existente. La migración no lo activa para ninguna cuenta:

```sql
update public.integraciones_api
set puede_consultar_reportes = true
where auth_user_id = '<UUID cuenta Sheets>';
```

## TRABAJADORES

La hoja conserva el flujo ya probado: A:D son editables y E:H son columnas técnicas. Editar A:D marca la fila como PENDIENTE, limpia la observación y conserva ID Sistema y Última sincronización.

## CAMPANIAS

La hoja CAMPANIAS usa Código, Nombre, Fecha inicio, Fecha fin y Estado como campos editables. Estado usa ACTIVA/CERRADA. Las columnas técnicas son F:I. Editar A:E marca la fila PENDIENTE sin llamar Supabase desde `onEdit`.

`admin_guardar_campania` mantiene el UUID cuando existe ID Sistema y usa `codigo` como fallback únicamente porque `public.campanias.codigo` es UNIQUE. `admin_listar_campanias()` devuelve el maestro para reconstrucción de la hoja.

## VARIEDADES

La hoja VARIEDADES usa Nombre y Activo como campos editables y C:F como columnas técnicas. Activo usa Sí/No. Editar A:B marca la fila PENDIENTE y conserva su UUID.

`admin_guardar_variedad` mantiene el UUID cuando existe ID Sistema y usa `nombre` como fallback únicamente porque `public.variedades.nombre` es UNIQUE. No se implementa DELETE; una variedad se retira con `activo = false`.

## LOTES

Desde `202610110100_lotes_variedades.sql`, un lote admite varias variedades mediante `public.lote_variedades`. La columna D acepta nombres separados por punto y coma, por ejemplo `Ventura; Biloxi`. Cada fila representa un lote; no duplique filas para agregar variedades. La sincronización usa `admin_guardar_lote_variedades(uuid, varchar, varchar, uuid, uuid[], boolean)`. La descripción de la RPC singular más abajo corresponde al contrato anterior.


El esquema confirmado de `public.lotes` usa UUID como identidad persistente y tiene la restricción real `UNIQUE (campania_id, codigo)`. Por tanto, `codigo` no es una identidad global. Cuando no existe ID Sistema, la identidad natural de fallback es exactamente `(campania_id, codigo)`.

La hoja LOTES usa:

| Columna | Campo | Uso |
| --- | --- | --- |
| A | Código | Editable |
| B | Nombre | Editable; vacío se persiste como NULL |
| C | Campaña | Editable; muestra `campanias.codigo` |
| D | Variedades (separadas por ;) | Editable; muestra uno o varios nombres de `variedades` |
| E | Activo | Editable; dropdown Sí/No |
| F | Estado Sync | Técnica |
| G | Observación | Técnica |
| H | ID Sistema | Técnica |
| I | Última sincronización | Técnica |

F:I quedan protegidas. Editar A:E marca F = PENDIENTE, limpia G y conserva H:I. `onEdit` no llama a Supabase.

### Referencias visibles y UUID

La campaña visible se resuelve así: `CAMPANIAS.codigo → CAMPANIAS.ID Sistema → campania_id`.

Cada variedad visible se resuelve así: `VARIEDADES.nombre → VARIEDADES.ID Sistema → lote_variedades.variedad_id`. El conjunto de UUID se envía como `p_variedad_ids`.

La fila referenciada debe estar SINCRONIZADA y tener un UUID válido. PostgreSQL persiste los UUID; los textos visibles no son identidad final.

### Campañas y variedades activas

Para crear un lote o cambiar su `campania_id`, la campaña destino debe estar ACTIVA. Cada variedad agregada o reactivada debe estar activa. Un lote con sesiones de lectura conserva su campaña para no trasladar su producción histórica.

Un lote histórico puede conservar una campaña que posteriormente quedó CERRADA y variedades que posteriormente quedaron inactivas. Si esas asociaciones se conservan, se permite editar los demás campos del lote. La validación se aplica a nuevas asignaciones, no a la mera conservación del histórico.

`admin_listar_lotes()` incluye lotes activos e inactivos, y también relaciones históricas con campañas cerradas o variedades inactivas.

### Dropdowns de LOTES

El dropdown de Campaña se construye a partir de CAMPANIAS sincronizadas y ACTIVA. El dropdown de Variedad se construye a partir de VARIEDADES sincronizadas y activas. Estas listas se releen desde los maestros; no se mantienen catálogos duplicados.

Las validaciones de Campaña y Variedad permiten conservar visualmente un valor histórico cargado desde PostgreSQL aunque ya no aparezca entre las opciones operativas. Esto evita borrar una relación histórica al reconstruir la hoja.

### Cambios de claves visibles

Si se cambia `campanias.codigo` o `variedades.nombre`, las FK de `public.lotes` y `public.lote_variedades` siguen apuntando a los mismos UUID. LOTES puede mostrar temporalmente el texto anterior hasta ejecutar `SCC → Actualizar desde sistema`. No se implementan cascadas visuales en `onEdit`.

### Borrado

No se implementa DELETE para LOTES. Para retirar un lote se usa Activo = No, preservando su histórico. Quitar un nombre de D desactiva la asociación correspondiente; no la borra. Cada sesión guarda su propio `variedad_id`, por lo que el histórico sigue mostrando la variedad cosechada.

## ROLES_CAMPANIA

El maestro `public.trabajador_campania_rol` usa UUID como identidad persistente y la restricción real `UNIQUE (trabajador_id, campania_id, rol)`. Cuando una fila todavía no tiene ID Sistema, el fallback administrativo usa exactamente esa triple identidad. DNI, nombre del trabajador y código de campaña son referencias visibles de Google Sheets; PostgreSQL persiste UUID.

La hoja ROLES_CAMPANIA usa:

| Columna | Campo | Uso |
| --- | --- | --- |
| A | DNI | Editable; referencia visible al trabajador |
| B | Trabajador | Informativa; se completa desde TRABAJADORES al editar el DNI |
| C | Campaña | Editable; muestra `campanias.codigo` |
| D | Rol | Editable; `COSECHADOR`, `JABERO` o `SUPERVISORA` |
| E | Activo | Editable; dropdown Sí/No |
| F | Estado Sync | Técnica |
| G | Observación | Técnica |
| H | ID Sistema | Técnica |
| I | Última sincronización | Técnica |

F:I quedan protegidas. Editar A, C, D o E marca la fila PENDIENTE, limpia la observación y conserva H:I. B es solo informativa. `onEdit` solo usa datos ya presentes en el Spreadsheet; no llama Supabase.

### Resolución de referencias

El trabajador se resuelve así: `ROLES_CAMPANIA.DNI → TRABAJADORES.DNI → TRABAJADORES.ID Sistema → trabajador_id`.

La campaña se resuelve así: `ROLES_CAMPANIA.Campaña → CAMPANIAS.codigo → CAMPANIAS.ID Sistema → campania_id`.

La fila de TRABAJADORES o CAMPANIAS referenciada debe estar SINCRONIZADA y tener un UUID válido. El nombre visible y el DNI no sustituyen al UUID como identidad persistente.

### Reglas de vigencia e históricos

Para una nueva asignación, una reactivación (`Activo: No → Sí`) o un cambio de trabajador, campaña o rol, el trabajador destino debe estar activo y la campaña destino debe estar ACTIVA.

Una asignación histórica puede conservar su trabajador aunque luego quede inactivo y su campaña aunque luego quede CERRADA, siempre que no cambie la triple identidad. No se implementa DELETE; una asignación se retira con Activo = No.

Los dropdowns de trabajador y campaña solo ofrecen referencias sincronizadas y vigentes. Esas dos referencias usan `allowInvalid(true)` para que un valor histórico cargado desde PostgreSQL siga siendo visible aunque ya no aparezca como opción operativa. El dropdown de Rol bloquea valores libres y solo acepta `COSECHADOR`, `JABERO` o `SUPERVISORA`.

### Acceso a la aplicación

`TRABAJADOR`, `ROL EN CAMPAÑA` y `ACCESO A PWA` son conceptos distintos. Un trabajador puede existir sin rol de campaña, y un rol `COSECHADOR` no concede acceso a la PWA por sí solo.

`admin_guardar_rol_campania` recalcula `usuarios_app.activo` después de cada cambio. El acceso queda vigente cuando el trabajador conserva al menos un rol activo aplicable (`JABERO` o `SUPERVISORA`) dentro de una campaña ACTIVA. Si una fila cambia de trabajador, se recalcula tanto el trabajador anterior como el nuevo para evitar dejar acceso habilitado por una relación que ya no existe.

Desde `202610030100_acceso_diario_jaberos.sql`, ese indicador expresa la habilitación por rol de campaña; el login aplica además la vigencia diaria. Un JABERO solo puede ingresar si `fecha_asignacion_jabero` corresponde al día actual de `America/Lima`. Guardar o reactivar el rol JABERO activo, o registrarlo nuevamente desde la PWA, asigna la jornada que confirma Supabase. Una fila de Sheets ya SINCRONIZADA no se renueva automáticamente al actualizar desde sistema: para una nueva jornada se debe registrar nuevamente o guardar la asignación como PENDIENTE y sincronizarla. El rol SUPERVISORA conserva su acceso durante la campaña activa.

La PWA utiliza `validar_operador_diario`; el RPC original `validar_operador` conserva su tipo de retorno y también verifica la vigencia diaria. La autorización guardada en el dispositivo vence al cambiar el día de Perú; para ingresar sin conexión debe haberse validado ese mismo día. Las asignaciones nuevas realizadas sin conexión requieren confirmación de Supabase antes de conceder login a otro dispositivo.

La integración técnica de Google Sheets no corresponde a un registro de `usuarios_app`. Por eso, una asignación nueva guarda `registrado_por_usuario_id = NULL`; las actualizaciones no sobrescriben ese campo y conservan el valor histórico existente.

`admin_listar_roles_campania()` incluye asignaciones activas e inactivas e informa las referencias visibles y el estado de acceso resultante.

## Sincronizar datos

`SCC → Sincronizar datos` procesa en este orden:

1. TRABAJADORES
2. CAMPANIAS
3. VARIEDADES
4. LOTES
5. ROLES_CAMPANIA

Cada maestro procesa únicamente filas PENDIENTE y aísla los errores por fila. Un error de una fila no detiene las siguientes; un error general de un maestro no impide intentar los demás.

LOTES se ejecuta al final. En ese momento Apps Script vuelve a leer CAMPANIAS y VARIEDADES, de modo que una campaña o variedad sincronizada durante esa misma ejecución puede usarse inmediatamente en una fila LOTES.

ROLES_CAMPANIA se ejecuta después de los maestros que resuelven sus referencias. Relee TRABAJADORES y CAMPANIAS, de modo que un trabajador o una campaña sincronizados en la misma ejecución pueden usarse inmediatamente. Antes de guardar obtiene una instantánea con `admin_listar_roles_campania()` para distinguir históricos, reactivaciones y cambios de identidad.

Antes de procesar LOTES se obtiene una instantánea con `admin_listar_lotes()`. Esa instantánea permite distinguir una relación histórica sin cambios de una nueva asignación y aplicar correctamente las reglas ACTIVA/activo.

## Actualizar desde sistema

`SCC → Actualizar desde sistema` trabaja sobre la hoja activa:

- TRABAJADORES → `admin_listar_trabajadores()`;
- CAMPANIAS → `admin_listar_campanias()`;
- VARIEDADES → `admin_listar_variedades()`;
- LOTES → `admin_listar_lotes()`;
- ROLES_CAMPANIA → `admin_listar_roles_campania()`.

Si la hoja activa contiene cualquier fila PENDIENTE o ERROR, se aborta antes de reconstruir para no sobrescribir cambios locales.

Si la hoja activa es RESUMEN, RANKING, PRODUCCION_DIARIA o PRODUCCION_LOTES, el comando no intenta tratarla como maestro y muestra: `Esta hoja es un reporte. Usa SCC → Actualizar reportes.`

Al reconstruir LOTES se escribe Código, Nombre, código visible de campaña, nombre visible de variedad, Sí/No, SINCRONIZADO, observación vacía, UUID real y timestamp actual. Después se recalculan los dropdowns.

## RPC de LOTES

`public.admin_guardar_lote(uuid, varchar, varchar, uuid, uuid, boolean)`:

- con `p_lote_id`, busca y actualiza exactamente ese UUID; si no existe devuelve `El lote indicado no existe`;
- sin `p_lote_id`, busca únicamente por `(p_campania_id, codigo)`; si existe actualiza y si no existe crea;
- nunca busca un lote únicamente por `codigo`;
- normaliza Código con `btrim`, Nombre vacío a NULL y valida los límites de 30/100 caracteres;
- traduce el conflicto de `UNIQUE(campania_id, codigo)` a `Ya existe otro lote con ese código en la campaña seleccionada`;
- devuelve siempre el UUID real y las referencias visibles resultantes.

`public.admin_listar_lotes()` hace join con CAMPANIAS y VARIEDADES, incluye históricos/inactivos y ordena por `campania_codigo ASC, codigo ASC`.

Ambas RPC llaman primero a `public.autorizar_integracion_gestion_maestros()`, revocan ejecución de PUBLIC/anon y conceden EXECUTE únicamente a authenticated. No se concede SELECT directo sobre `public.lotes`.

## Archivos de Apps Script

El proyecto administrativo usa `Code.gs`, `Config.gs`, `Menu.gs`, `Supabase.gs`, `Trabajadores.gs`, `TrabajadoresPure.gs`, `Campanias.gs`, `CampaniasPure.gs`, `Variedades.gs`, `VariedadesPure.gs`, `Lotes.gs`, `LotesPure.gs`, `RolesCampania.gs`, `RolesCampaniaPure.gs`, `Reportes.gs` y `ReportesPure.gs`.

Al abrir el Spreadsheet, `onOpen` crea el menú SCC y configura las hojas administrativas y de reportes.

## Actualizar reportes

`SCC → Actualizar reportes` consulta, valida y actualiza de forma independiente:

1. RESUMEN → `admin_obtener_resumen_campania(p_zona_horaria)`;
2. RANKING → `admin_obtener_ranking_cosechadores_periodo(p_periodo, p_zona_horaria)`;
3. PRODUCCION_DIARIA → `admin_obtener_produccion_diaria(p_zona_horaria)`;
4. PRODUCCION_LOTES → `admin_obtener_produccion_lotes()`.

RESUMEN y PRODUCCION_DIARIA reciben `SpreadsheetApp.getActive().getSpreadsheetTimeZone()`. La zona no está hardcodeada. Las fechas PostgreSQL `date` (`YYYY-MM-DD`) se convierten como fecha calendario mediante el timezone del Spreadsheet, sin pasar por una representación UTC que pueda cambiar el día. Los `timestamptz`, como `ultima_lectura`, sí se convierten como instantes y se muestran con formato `dd/MM/yyyy HH:mm` en la zona del Spreadsheet.

Cada reporte sigue el flujo consultar RPC → validar/normalizar respuesta → reemplazar hoja. Si la consulta o validación falla, no se borra el reporte visible anterior. El error se registra para ese reporte y se continúan intentando los demás. Al final se muestra un resumen con OK/ERROR por hoja.

Las hojas de reportes son salida del sistema. No usan Estado Sync, Observación, ID Sistema ni Última sincronización; no se marcan PENDIENTE, no participan en `onEdit` y `SCC → Sincronizar datos` nunca las envía a PostgreSQL.

### RESUMEN

Presenta una vista administrativa simple con campaña, fecha de inicio, total de jabas, cosechadores con producción, lotes con producción, sesiones, días con producción, última actividad y timestamp de última actualización del Spreadsheet. Si existe campaña activa sin producción, las métricas se muestran en cero y la última actividad queda vacía.

### RANKING

El selector editable **B2** ofrece Hoy, Semana, Mes y Campaña; Campaña es el valor inicial para conservar el alcance del reporte anterior. Elegir un período no consulta Supabase: usa **SCC → Actualizar ranking** para actualizar solo esta hoja o **SCC → Actualizar reportes** para actualizar las cuatro. El resto de la hoja permanece protegido como reporte generado.

Arriba de la tabla se muestran campaña, período efectivamente consultado y fechas, fechas de comparación, total de jabas, cosechadores con producción y última actualización. El período mostrado se conserva hasta una actualización exitosa, aunque el selector cambie. Las lecturas pendientes en un PDA offline no se incluyen.

El encabezado está en la fila 11; columnas: Posición, DNI, Cosechador, Jabas, Última lectura y Cambio. Al abrir una hoja con el formato anterior se desplazan sus filas para conservar la producción visible. Se congelan las primeras 11 filas y el filtro abarca únicamente la tabla. El DNI se escribe como texto, incluidos sus ceros iniciales.

El orden y las posiciones actual y anterior vienen del backend. Apps Script no recalcula el ranking y conserva empates producidos por `DENSE_RANK`. Se resaltan las posiciones 1, 2 y 3 con colores oro, plata y bronce; todos los cosechadores empatados reciben el mismo resaltado. Sin producción se conserva el resumen en cero, el encabezado y una fila informativa; se eliminan las filas y reglas visuales anteriores.

La columna Cambio usa `posición anterior − posición actual`: ↑ sube, ↓ baja, = mantiene y Nuevo indica que el cosechador no tuvo producción en el período anterior. El ranking anterior incluye a quienes no aparecen en el actual. Las comparaciones siempre usan la misma campaña activa:

- Hoy: jornada de ayer.
- Semana: lunes a hoy contra lunes al mismo día de la semana anterior.
- Mes: desde el día 1 hasta hoy contra esos días del mes anterior, limitado a su último día si es más corto.
- Campaña: acumulado de la campaña hasta hoy contra el acumulado hasta ayer, sin comparar trabajadores de otra campaña.

Los períodos usan días calendario de la zona horaria del Spreadsheet y excluyen lecturas desde la medianoche posterior a hoy. La jornada actual puede estar incompleta. Si una campaña recién empieza hoy y no tiene días previos, se muestra Sin comparación. Las fechas visibles explican el alcance exacto. Una consulta o validación fallida conserva el reporte anterior.

Los cosechadores provisionales sin nombre aparecen como `ASIGNAR NOMBRE`, conservando DNI, posición, jabas y última lectura. Este texto solo se muestra en el reporte; no se guarda como nombre del trabajador ni impide actualizar el ranking completo.

### PRODUCCION_DIARIA

Columnas: Fecha, Jabas, Cosechadores y Sesiones. El backend entrega los días de producción del más reciente al más antiguo. Si no hay producción se conserva únicamente el encabezado.

### PRODUCCION_LOTES

Columnas: Lote, Nombre, Variedad, Jabas, Cosechadores, Sesiones y Última lectura. El orden viene del backend. Si no hay producción se conserva únicamente el encabezado.

Los cuatro reportes se protegen como hojas generadas por el sistema, congelan encabezados cuando corresponde y usan formatos numéricos y de fecha. RANKING permite editar únicamente su selector y añade resumen y formato condicional.

## Reglas de negocio de los reportes

Las RPC administrativas replican el SQL ya usado por SCC operativo. Una fila de `lecturas_jaba` equivale a una jaba, por lo que `total_jabas` usa siempre `COUNT(lj.id)`. No se deduplican tickets.

- RESUMEN: `COUNT(lj.id)`, cosechadores distintos, lotes distintos, sesiones distintas, días distintos en el timezone solicitado y `MAX(lj.fecha_hora)`.
- RANKING: `COUNT(lj.id)` por período, `DENSE_RANK` por `total_jabas DESC` en ambos períodos y última lectura por cosechador. La identidad de comparación es `trabajadores.id`.
- PRODUCCION_DIARIA: agrupa `(lj.fecha_hora AT TIME ZONE p_zona_horaria)::date`, con jabas, cosechadores y sesiones.
- PRODUCCION_LOTES: jabas, cosechadores, sesiones y última lectura por combinación de lote y variedad cosechada.

Las RPC operativas existentes de la PWA no se modifican; las versiones administrativas son paralelas y no requieren `p_dni_operador`.

### Instalación del ranking por período

1. Aplicar `backend/supabase/migrations/202610030300_admin_ranking_por_periodo.sql` en Supabase. Reutiliza el permiso de reportes existente, conserva la RPC administrativa anterior y no concede acceso a `anon`.
2. Actualizar `Reportes.gs`, `ReportesPure.gs` y `Menu.gs` en el proyecto Apps Script vinculado al Spreadsheet.
3. Recargar el Spreadsheet para configurar el selector y el menú; usar SCC → Actualizar ranking.

La migración se verifica localmente con PostgreSQL embebido (PGlite), incluyendo límites de medianoche, empates, cambios de posición, febrero y permisos. Las pruebas de Apps Script simulan el Spreadsheet; la instalación y revisión en la hoja real requieren el proyecto vinculado.

## Migraciones

`20260930_admin_lotes.sql` reutiliza `public.integraciones_api` y `public.autorizar_integracion_gestion_maestros()`; no los recrea. La migración solo crea las RPC administrativas de LOTES, configura sus permisos y solicita la recarga del schema de PostgREST.

`20261001_admin_roles_campania.sql` crea `admin_guardar_rol_campania(...)` y `admin_listar_roles_campania()`, conserva la identidad `UNIQUE (trabajador_id, campania_id, rol)`, aplica las reglas de vigencia para nuevas asignaciones/reactivaciones/cambios de identidad y recalcula `usuarios_app`. Revoca ejecución de PUBLIC/anon, concede `EXECUTE` únicamente a `authenticated` y solicita `NOTIFY pgrst, 'reload schema'`.

`20260930_admin_reportes_sheets.sql` agrega `puede_consultar_reportes` con `DEFAULT false`, crea `public.autorizar_integracion_reportes()` y las cuatro RPC administrativas de consulta. Revoca acceso de PUBLIC/anon, concede `EXECUTE` únicamente a `authenticated` y solicita `NOTIFY pgrst, 'reload schema'`. La migración no asigna el permiso a ninguna integración existente y no modifica datos remotos por sí sola.

## Actualización a lotes con varias variedades

1. Aplicar `202610110100_lotes_variedades.sql` y luego `202610110200_produccion_lote_variedad.sql` en Supabase, después de las migraciones anteriores.
2. Actualizar Apps Script con `Config.gs`, `Lotes.gs` y `LotesPure.gs` del repositorio.
3. Publicar la PWA actualizada y actualizar la caché operativa en cada PDA para obtener las variedades del lote.
4. En LOTES, escribir por ejemplo `Ventura; Biloxi` en D y ejecutar la sincronización habitual. Al actualizar desde el sistema se reconstruye una sola fila por lote.

La migración copia la variedad actual de cada lote a sus asociaciones y a las sesiones existentes. No puede reconstruir cambios de variedad anteriores que no estaban registrados. El campo antiguo `lotes.variedad_id` queda estable como compatibilidad para cachés y operaciones pendientes anteriores; las nuevas sesiones usan la variedad elegida. Si esa asociación ya fue retirada, se rechaza un inicio pendiente nuevo con ella. Las sesiones ya persistidas se pueden reintentar y conservan su variedad.

`obtener_cache_operativa` conserva el cuerpo original en `obtener_cache_operativa_legacy`, sin permisos de ejecución externos, y reemplaza únicamente el listado de lotes. El RPC base no está versionado: las pruebas locales verifican su contrato con una fixture; no sustituyen la comprobación contra el esquema desplegado. `listar_lotes_activos_v2()` devuelve un lote con un arreglo de variedades activas.

Los reportes PWA y Sheets agrupan por lote y variedad a partir de `sesiones_lectura.variedad_id`, incluyendo asociaciones retiradas. El resumen PWA cuenta UUID de lotes distintos y suma todas las jabas. Ambos pasos SQL son transaccionales.
