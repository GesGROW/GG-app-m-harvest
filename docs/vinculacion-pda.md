# Primera pantalla y vinculación de PDA

La PWA inicia con «Vincular este PDA». El equipo se vincula una vez por
instalación y origen web. La vinculación se conserva al cerrar la sesión del
supervisor. Borrar el almacenamiento del navegador crea una instalación nueva;
no se ofrece borrado de credenciales ni cambio de empresa dentro de la app.

## Flujo

1. En el portal, entrar a Cosecha → App de Cosecha y generar el QR de la empresa.
2. Abrir la PWA en el PDA y pulsar «Escanear QR con cámara». Permitir el acceso
   a la cámara y apuntar al QR de la empresa. No se solicita pegar ni escribir
   un enlace. Un lector local de QR permite usar la cámara incluso en navegadores
   que no dispongan de BarcodeDetector.
3. También se acepta abrir directamente `/#vincular=<token>` en la PWA. El
   fragmento se retira inmediatamente del historial y el token no se persiste.
   En desarrollo local también se acepta escanear el QR que apunta al origen
   publicado `https://gg-app-m-harvest.vercel.app`; el enlace nunca se abre como
   una redirección a otro sitio.
4. Iniciar sesión con el correo y la contraseña de la cuenta del supervisor.
   La cuenta debe estar activada, pertenecer a la empresa y tener permiso operativo.
5. Pulsar «Vincular PDA». La empresa y el nombre quedan guardados en el equipo.
6. Si el supervisor tiene campañas activas asignadas, se abre el flujo de
   Cosecha existente. El DNI se deriva de su cuenta autenticada, sin elegir otro
   operador por un DNI suministrado desde el formulario.

En aperturas posteriores no se pide el QR: se comprueba la instalación y se
restaura la cuenta o se solicita iniciar sesión. Si no hay campañas asignadas,
el equipo sigue vinculado y se muestra ese motivo sin generar otra instalación.

«Salir» cierra solo la sesión de este dispositivo y conserva la vinculación.
Se rechaza el cambio de supervisor mientras existan operaciones sin resolver,
sesiones de lectura activas o una escritura en curso. Los datos no se borran.

## Persistencia y reintentos

`gesgrow-pda` es una base IndexedDB separada de `scc`. Conserva UUID, credencial
aleatoria de 32 bytes, empresa y autorización local. La identidad de instalación
se guarda antes de enviar la solicitud. Un reintento reutiliza UUID y credencial;
antes de necesitar de nuevo el QR se consulta si la primera solicitud llegó al
servidor. No se guarda la contraseña en esta base ni se registra el token QR.

La sesión de cuenta la gestiona el proveedor Auth. La credencial de instalación
es un secreto del cliente; no constituye autenticación de un supervisor.

Cada apertura y cada 30 segundos, al recuperar conexión o volver a la ventana,
se revalida equipo, membresía, módulo y campañas. Un rechazo conocido elimina
la autorización local y bloquea el acceso; no se recurre a la caché. Sin conexión
solo se permite la misma cuenta con una autorización previamente obtenida y
vigente hasta la medianoche de Lima. Un PDA desconectado no puede conocer una
revocación hasta reconectar. Una sesión Auth local ausente también impide entrar.

## Backend requerido

Aplicar después de las dos migraciones de vinculación anteriores:

`20261027181414_pda_ingreso_supervisor.sql`

Añade `pda_preparar_ingreso(dispositivo, credencial)`. Exige sesión autenticada,
revalida el dispositivo y deriva el operador desde la membresía de esa cuenta.
Solo devuelve sus campañas activas de la empresa vinculada. Una cuenta sin
campañas obtiene `operador: null` y puede conservar la instalación vinculada.
La migración no activa el acceso vinculado obligatorio ni modifica datos agrícolas.

## Compatibilidad operativa

Esta entrega implementa la vinculación, el acceso del supervisor y las guardas
del cliente. La cola y los RPC de campo actuales conservan su contrato y UUID.
Un cliente separado y sin sesión de cuenta atiende esos RPC, que todavía exigen
acceso anónimo por DNI. Antes de cada caso de uso o envío, la PWA comprueba la
cuenta, empresa y campaña vinculadas. No se adoptan pendientes de otro actor.

**Mantener `accesoVinculadoObligatorio = false` durante esta transición.**
La sustitución de todos los RPC operativos por `pda_operar` y la retirada de las
rutas antiguas no forman parte de la primera pantalla de vinculación. Mientras
esas rutas sigan habilitadas, clientes antiguos conservan el acceso anterior.

## Validación

Las pruebas de servicio verifican persistencia, recuperación de respuesta
perdida, vencimiento, revocación, aislamiento de empresa/actor/campaña, cambio de
cuenta y operaciones en curso. Las pruebas de presentación recorren QR → cuenta
→ vinculación → ingreso, lectura por cámara y el rechazo de credenciales.
Las pruebas SQL del backend ejecutan el nuevo RPC y sus permisos contra PGlite.
Se inspeccionó el arranque real en Chrome a 390 píxeles de ancho; no se usaron
credenciales reales ni se vinculó un equipo de producción desde esa revisión.

Validación: 480 pruebas de PWA y 630 de backend aprobadas; compilación Vite/PWA
y comprobación del paquete compartido correctas. La publicación y la aplicación
de la nueva migración se realizan por separado del desarrollo local.
