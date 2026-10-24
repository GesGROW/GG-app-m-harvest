# Campañas por cultivo en la PWA

La PWA admite una campaña activa por cultivo. Arándanos y mandarina pueden estar activos simultáneamente. Un trabajador conserva su único DNI y puede tener roles en ambas campañas; los lotes, variedades, asignaciones de personal, tickets, sesiones y reportes se consultan dentro de la campaña elegida.

## Ingreso en un mismo PDA

- Una campaña autorizada para el DNI: ingreso automático.
- Varias campañas autorizadas: aparece «¿Con qué cultivo vas a trabajar?» después de validar el DNI.
- Al recargar se conserva la elección si sigue autorizada. Para cambiar de cultivo se cierra el ingreso y se vuelve a entrar con el mismo DNI.
- Solo aparecen campañas activas y cultivos activos. Los jaberos necesitan su asignación del día; las supervisoras mantienen la regla existente de acceso por rol.
- La autorización offline conserva su vigencia diaria. Cada campaña debe cargarse con conexión antes de utilizarla sin conexión.

La caché local se separa por campaña. Cada operación pendiente conserva el UUID de su campaña y el DNI del operador que la creó, aunque después se ingrese en otro cultivo. La sincronización procesa todas las campañas pendientes; un rechazo bloquea las operaciones posteriores de esa campaña y permite continuar con las otras. La pantalla de sincronización muestra las operaciones de la campaña abierta.

Los códigos de ticket siguen siendo únicos en el servidor: un ticket asignado a una campaña no puede asignarse ni leerse en otra. Que las cachés estén separadas no permite reutilizar ese código en dos campañas.

## Migraciones y publicación

Aplicar las migraciones anteriores de lotes y variedades y luego, en este orden:

1. `backend/supabase/migrations/202610110300_cultivos_campanias.sql`.
2. `backend/supabase/migrations/202610110400_rpc_por_campania.sql`.
3. Publicar el build de la PWA y realizar un ingreso online en cada PDA para actualizar la autorización con las campañas disponibles.

La primera migración crea los cultivos Arándanos y Mandarina y asigna **Arándanos a todas las campañas y variedades existentes**. Esto corresponde a la configuración anterior. Las campañas y variedades de otros cultivos deben crearse indicando explícitamente `cultivo_id`; una campaña con lotes o personal y una variedad asociada a lotes no pueden cambiar de cultivo.

La segunda migración crea los RPC `*_campania` que utiliza la PWA. Autoriza el DNI en la campaña recibida y comprueba la pertenencia del lote, sesión y ticket. La caché se construye directamente con consultas por UUID de campaña y ya no utiliza `obtener_cache_operativa_legacy`: el formato SQL de esa función desplegada no condiciona la migración. Para los otros RPC mantiene sus cuerpos, adaptando su selección de campaña activa mediante `pg_get_functiondef`, porque algunos RPC base solo existen en la base desplegada y no están versionados en este repositorio. Si falta una firma requerida, aborta esa migración completa. Las pruebas usan PostgreSQL local con los contratos representativos de esos RPC; falta comprobarlos en la instancia desplegada antes de publicar la PWA.

Si una versión anterior de la última migración falló con «El RPC de caché requiere revisión», ejecutar nuevamente **el archivo completo actualizado `202610110400_rpc_por_campania.sql`**. Ese error se produce dentro de la transacción y revierte los cambios de esa última migración; no requiere repetir las migraciones anteriores. Si el editor mantiene una transacción abortada abierta, ejecutar primero `ROLLBACK;`.

IndexedDB pasa de versión 3 a 4, conserva registros y operaciones y obtiene la campaña anterior desde `meta.campania_activa`. Si un PDA tiene operaciones antiguas de diferentes campañas y nunca guardó su campaña original, esa información no puede reconstruirse de manera fiable desde la caché actual. Conviene completar su sincronización con la versión anterior antes de actualizar. Los registros sin una campaña identificable se conservan, pero el servidor exige indicar la campaña cuando hay varias activas.

Para preparar Mandarina, crear su campaña y variedades con el UUID de cultivo `a1000000-0000-4000-8000-000000000002`, asociar sus variedades a sus lotes y asignar al personal mediante `trabajador_campania_rol`. La asignación usa el mismo trabajador existente por DNI; el acceso en `usuarios_app` debe estar activo conforme a la regla de roles existente. El esquema conserva `campania_id` en lotes y asignaciones de personal y añade `cultivo_id` a campañas y variedades.

## Google Sheets por campaña

La adaptación de Apps Script utiliza un archivo por campaña y permisos de Google Drive por correo. La migración `202610110500_sheets_por_campania.sql` agrega permisos de integración por campaña y los RPC `*_hoja` para maestros y reportes. Cada archivo envía su UUID de campaña; las variedades se crean dentro de su cultivo. La preparación de los archivos, cuentas y permisos está en [Sheets por campaña](sheets-por-campania.md).

## Verificación local

Las pruebas cubren campañas activas simultáneas, DNI compartido, autorización diaria, login con selección de cultivo, separación de cachés y colas, actualización de IndexedDB sin perder pendientes, validaciones entre cultivos, idempotencia y producción separada en los cuatro reportes de la PWA.

Ejecutar `npm test` y `npm run build` para validar la implementación. Estas comprobaciones no aplican migraciones ni publican cambios en Supabase o en los PDA.
