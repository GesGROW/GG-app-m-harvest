# Validación pendiente F5.6: PostgreSQL real y staging PDA

**Pendiente de ejecución.** Las migraciones nuevas siguen sin desplegarse remotamente. PGlite y fake-indexeddb verifican reglas y rollback, pero no prueban bloqueos MVCC entre conexiones PostgreSQL ni el PDA real. No anunciar F5.6 validada en producción hasta registrar estos resultados.

## Preparación

Usar un entorno PostgreSQL/Supabase de staging separado de producción con todas las migraciones hasta `202610140610_harvest_proyecciones.sql`. Preparar campañas A/B activas, operador autorizado, cosechador, jabero habilitado, sesiones activas, lotes físicos, tickets Harvest disponibles y hechos legacy con códigos repetidos. Revisar posibles registros piloto: no contarán como producción tras aplicar F5.6.

Usar dos conexiones independientes, con identidades/permisos reales. El actor administrativo requiere `puede_gestionar_maestros` y acceso a la campaña mediante el contrato existente. El operador conserva su autorización habitual. No usar las funciones simuladas `scc.test.*` de las fixtures PGlite. Registrar versión PostgreSQL, aislamiento, consultas, tiempos, bloqueos, SQLSTATE y conteos antes/después. No ejecutar este protocolo sobre datos históricos productivos.

## Corte contra escritor legacy

1. Sin corte en A, conexión W: BEGIN; ejecutar `registrar_lectura_jaba_campania` con un UUID nuevo; mantener la transacción abierta.
2. Conexión C: BEGIN; ejecutar `admin_activar_harvest_campania(A,1)`. Debe esperar al bloqueo de campaña de W.
3. W: COMMIT. C debe completar la activación; C: COMMIT.
4. Verificar un hecho legacy, un corte y cero registros nuevos. Repetir el comando de W con su UUID debe devolver el recibo sin escritura, incluso si se cerró su sesión. Un nuevo UUID legacy debe fallar `harvest_legacy_solo_lectura`; no deben quedar recibo ni operación parcial. Una fecha cliente anterior al corte no permite insertar.

Invertir el orden con una campaña fresca: C activa y mantiene la transacción abierta; W intenta escribir. W debe esperar y, después del COMMIT de C, rechazar la escritura. Si C hace ROLLBACK, W debe poder continuar en legacy. Verificar que el corte y `updated_at` también se revierten.

Repetir con W en REPEATABLE READ y SERIALIZABLE, estableciendo su snapshot con una consulta **antes** de la activación de C. El intento posterior al COMMIT de C debe fallar por serialización (40001), o rechazar tras reintentar desde una transacción nueva. No debe aceptar una fila legacy usando un snapshot antiguo que no veía el corte. La actualización de la tupla de campaña es parte de esta protección. Un deadlock/timeout exige investigar y documentar el orden de bloqueos; no equivale a éxito de validación.

## Activación simultánea

Dos administradores activan la misma campaña fresca con versión 1 desde conexiones distintas. Una activación espera a la otra; ambas respuestas confirmadas deben devolver exactamente el mismo instante/versión/actor de la primera activación. Debe existir una sola fila. Una solicitud versión 2, UPDATE, DELETE o TRUNCATE no puede mover/eliminar el corte. Un actor sin permiso de esa campaña debe ser rechazado sin filas ni cambio de contexto.

## Asignación y consumo después del corte

Ejecutar también [el protocolo de asignación F5.3](prueba-concurrencia-harvest-f5.3.md) y [el de consumo F5.4](prueba-concurrencia-harvest-f5.4.md), ahora con cutover confirmado en la campaña.

Para consumo, conexiones W1/W2 llaman `harvest_registrar_cosecha` con el mismo ticket, sesión válida y UUID de operación distinto. Mantener la primera transacción abierta: la segunda debe esperar. Al COMMIT de la primera, la otra devuelve `harvest_ticket_ya_utilizado` y no deja operación/recibo/registro parcial. Al ROLLBACK de la primera, la segunda debe poder ganar. Al terminar debe existir exactamente un registro de versión 1, trabajador de la asignación y fecha de admisión desde el corte. Reintentar su UUID devuelve el registro original; otro UUID no consume otra vez.

Repetir con el mismo UUID de operación para respuestas perdidas y verificar idempotencia. Comprobar directamente `harvest_registro_ticket_unico`, FK de campaña/versión y restricciones de contexto bajo el rol esperado. Los ensayos DML de constraints se realizan con un rol de test controlado, no concediendo acceso directo a clientes.

## Reportes y conservación

En A insertar N lecturas legacy antes de activar, incluyendo dos con el mismo código. Después activar y registrar M tickets nuevos. Ejecutar resumen, ranking, diaria y por lote mediante los RPC de PDA y administrativos por campaña. La suma debe ser N+M en las cuatro vistas; trabajador único por UUID; lote físico/variedad de la sesión. Verificar filtros diarios y períodos/posición anterior del ranking, campañas cerradas para administración y aislamiento respecto de B sin migrar.

Probar eventos con `fecha_hora` inmediatamente anterior, igual y posterior al instante de activación, admitidos después del corte: pertenecen a Harvest, incluso si su agrupación diaria usa un día anterior. Ningún hecho aparece dos veces. Reutilizar un UUID legacy en Harvest debe rechazarse. DML legacy posterior no modifica ni borra el histórico. Comparar filas y conteos históricos con la copia previa. Un registro piloto sin versión continúa consumido, con cero contribución reportable; su recibo antiguo permanece intacto.

## Prueba operativa PDA en staging

1. Instalar el cliente en el PDA real y renovar caché en una campaña sin corte. Comprobar modelo legacy y lecturas repetidas. Conservar operaciones anteriores ya aceptadas con respuesta perdida y otras nunca enviadas.
2. Desconectar el PDA, activar el corte desde un actor autorizado y reconectar. Verificar que los recibos antiguos se confirman sin duplicar; los pendientes legacy no admitidos quedan en ERROR, visibles y conservados. Sus lecturas dejan de contar; consumos de asignaciones rechazadas no se envían. No se reintentan automáticamente ni bloquean permanentemente operaciones independientes.
3. Refrescar caché con el corte, desconectar de nuevo. Escanear cualquier ticket del lote para asignarlo; consumir un hermano y comprobar trabajador efectivo. El segundo escaneo del mismo ticket debe fallar de inmediato. Cerrar/reabrir el navegador y verificar reservas, cola y estado efectivo intactos.
4. Reconectar y confirmar asignación/consumo, conservando UUID, identidad y conteos. Con dos PDA desconectados reservar el mismo lote/ticket; al reconectar, el perdedor conserva el rechazo y el ganador determina el estado autoritativo. Revisar producción válida y dependientes.
5. Simular una respuesta de caché anterior al corte que llega tarde: no puede volver el modelo a legacy ni perder reservas. Una caché antigua sin `cutover` exige renovación para nuevas operaciones. Comprobar comandos v4 con códigos Harvest inequívocos, códigos legacy y códigos ambiguos.
6. Consultar los cuatro reportes antes/después y confirmar N+M, repetir contra B sin corte y contra una campaña cerrada con usuario administrativo. No modificar Sheets/Apps Script.

Registrar navegador, firmware/dispositivo, versión de service worker, estado de red, campaña, UUID de comandos y evidencias de conteos. Confirmar que IndexedDB sigue en v5, conserva stores/datos y que no se borraron comandos pendientes ni histórico. Aprobar el resultado de staging antes de planificar activaciones productivas; aplicar migraciones no activa ninguna campaña por sí solo.
