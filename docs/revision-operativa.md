# Revisión operativa del 3 de octubre de 2026

- **Asignados hoy:** asignaciones del día local del dispositivo. **Buscar asignación:** todas las asignaciones disponibles de la campaña en el caché, incluidos días anteriores; ahora muestra fecha y hora. Ambas permiten buscar DNI, nombre o ticket.
- **Jaberos de campaña:** reúne el listado y la búsqueda por DNI o nombre. La entrada adicional Buscar era una consulta idéntica y se retiró del menú.
- **Lectura de jabas:** al iniciar sin DNI se muestra «Ingresar DNI.» antes de validar el lote o la longitud del documento.
- **Resumen de campaña:** volver, título y actualizar comparten la cabecera; campaña y fecha de inicio aparecen debajo.
- **Ranking:** inicia en Hoy; permite Semana desde el lunes, Mes y Toda la campaña. Los períodos usan la fecha del servidor en America/Lima y lecturas sincronizadas. Se recalculan las posiciones y se conservan los empates.
- **Producción por día:** se conserva para comparar jabas y cosechadores con producción entre jornadas. El ranking mide personas por período; este reporte mide el volumen diario. Las pruebas existentes verifican conteo de lecturas, separación de fechas de Lima, autorización, reporte vacío y contrato con la PWA. La migración de restauración es `202610020200_restaurar_produccion_diaria.sql`. No se ha verificado la información del servidor remoto.

## Acceso diario

Un JABERO activo de campaña necesita además una asignación del día de Perú. Registrar de nuevo al mismo trabajador renueva su jornada sin duplicar el rol. El dispositivo bloquea una segunda operación mientras haya una asignación pendiente de sincronizar y permite renovar una ya sincronizada. Los reintentos con el mismo UUID conservan su recibo y no renuevan jornadas antiguas.

Las asignaciones que ya existían al instalar la migración quedan sin fecha diaria; deben registrarse nuevamente para conceder acceso. No se les asigna el día actual automáticamente. SUPERVISORA mantiene su autorización por campaña activa. La validación guardada en el dispositivo vence cada día; sin conexión solo permite entrar si fue validada durante la misma jornada. La app vuelve al login al detectar el vencimiento y comprueba la vigencia antes de procesar escaneos.

La jornada se confirma cuando Supabase procesa el registro. Un alta pendiente offline no concede por sí sola acceso al login. Esto conserva el contrato de la cola existente; no se usa una fecha elegida por el cliente para autorizar acceso.

## Instalación

Antes de publicar esta versión de la PWA, aplicar en Supabase, después de las migraciones anteriores:

1. `202610030100_acceso_diario_jaberos.sql`
2. `202610030200_ranking_por_periodo.sql`

La primera migración conserva el tipo de retorno real del RPC original y revoca el acceso público a la función interna. La segunda agrega `obtener_ranking_cosechadores_periodo`; no modifica el ranking administrativo de Google Sheets, que sigue mostrando toda la campaña.

Las migraciones y la aplicación se prueban localmente. Este cambio no aplica SQL ni publica la PWA en el servidor remoto.
