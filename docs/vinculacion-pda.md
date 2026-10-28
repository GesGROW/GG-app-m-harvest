# Primera pantalla y vinculación de PDA

El equipo se vincula una vez por instalación y origen web. El vínculo se
conserva al salir, cambiar de operador o actualizar la app. Borrar el
almacenamiento crea una instalación nueva.

## Flujo

1. En el portal, entrar a Cosecha → App de Cosecha y generar el QR de la empresa.
2. Abrir la PWA en un PDA nuevo y pulsar «Escanear QR con cámara». Permitir el
   acceso y apuntar al QR. Se conserva el lector nativo y el fallback local
   para navegadores sin BarcodeDetector. No se solicita escribir un enlace.
3. Después del escaneo, validar una cuenta de la empresa con correo y contraseña
   una sola vez para autorizar el vínculo y asignar el nombre del PDA.
4. Ingresar el DNI de 8 dígitos. No se configura ni se solicita PIN.
5. Si el operador tiene campañas activas asignadas, se abre Cosecha.

En aperturas posteriores se restaura la jornada vigente o se muestra solamente
el ingreso por DNI. Los equipos que usaban PIN conservan UUID, credencial y
empresa; se elimina la referencia local a esa sesión y se pide el DNI sin
repetir el QR. Las tablas y funciones históricas de PIN no se eliminan.

También se acepta `/#vincular=<token>`; el fragmento se retira del historial
inmediatamente y su secreto no se guarda. En desarrollo se permite escanear el
QR del origen publicado `https://gg-app-m-harvest.vercel.app`.

## Persistencia y reintentos

`gesgrow-pda` es una base IndexedDB separada de `scc`. Conserva UUID, credencial
aleatoria de 32 bytes, empresa, DNI de la jornada y autorización local. La
identidad se guarda antes de enviar la vinculación; una respuesta perdida
reutiliza la misma identidad al recuperar la instalación. No se guarda la
contraseña ni el secreto del QR.

La credencial prueba el vínculo del equipo; el DNI identifica al operador
según las reglas anteriores de Cosecha. No se crea una sesión Auth del portal
a partir del DNI. Un cliente operativo anónimo consulta el nuevo RPC, separado
de la cuenta usada para autorizar la vinculación inicial.

Cada apertura, cada 30 segundos, al recuperar conexión o volver a la ventana,
se revalidan el equipo y los accesos del operador. Se consultan nuevamente
sus campañas y se filtran por la empresa vinculada. Los rechazos conocidos
eliminan la autorización local; no se recurre a la caché después del rechazo.

Sin conexión solo continúa una jornada previamente validada hasta la medianoche
de Lima. Iniciar una jornada nueva requiere Internet. Un PDA desconectado
conoce una revocación al reconectar.

«Salir» elimina la jornada local, conservando la empresa y la credencial.
Se bloquea el cambio mientras existan pendientes, sesiones de lectura activas
o una escritura en curso. Los datos de campo no se borran.

## Backend requerido

Aplicar las migraciones de vinculación anteriores y después
`20261028160710_pda_ingreso_solo_dni.sql`.

`pda_preparar_ingreso_dni(dispositivo, credencial, dni)` verifica primero el
equipo y el módulo, exige un trabajador con acceso activo en esa empresa y
reutiliza `validar_operador_campanias`. Admite el supervisor del portal y el
operador anterior. Solo devuelve campañas de la empresa vinculada. El marcador
de actor es la identidad asociada o el trabajador para operadores anteriores.
El endpoint público es invoker; la lógica privilegiada queda en el esquema
privado, sin otorgar acceso directo a tablas. Solo el cliente anónimo lo invoca.

## Compatibilidad operativa

Los RPC de campo actuales conservan su contrato y UUID. Antes de cada caso de
uso o envío, la PWA comprueba DNI, empresa y campañas autorizadas. No se adoptan
pendientes de otro operador.

**Mantener `accesoVinculadoObligatorio = false` durante esta transición.**
La sustitución de todos los RPC por `pda_operar` y la retirada de las rutas
anteriores son una migración distinta; los clientes antiguos conservan su
acceso mientras estas rutas sigan habilitadas.

## Validación

Las pruebas cubren QR por cámara antes de mostrar el ingreso, vinculación única,
ingreso solo por DNI, actualización desde PIN sin desvincular, cambio de operador,
persistencia, aislamiento de empresa/campaña, expiración offline, revocación y
protección de pendientes. El backend ejecuta los RPC y sus permisos en PGlite.
