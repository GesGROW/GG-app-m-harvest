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
4. Validar la cuenta con correo y contraseña una sola vez para vincular y crear
   el PIN. La cuenta debe estar activada, pertenecer a la empresa y tener permiso
   operativo. Este formulario solo aparece después de recibir el QR.
5. Crear y confirmar un PIN de 4 dígitos. El DNI se obtiene de la cuenta validada;
   no se puede configurar el PIN de otro usuario. Se cierra la sesión Auth usada
   en esta configuración y se ingresa con la nueva sesión PIN.
6. Si el supervisor tiene campañas activas asignadas, se abre Cosecha.

En aperturas posteriores no se pide el QR: se comprueba la instalación y se
restaura la sesión PIN o se solicita **DNI y PIN de 4 dígitos**, sin correo ni
contraseña. «Configurar o recuperar mi PIN» permite validar de nuevo la cuenta
solo cuando el supervisor lo solicita. Si no hay campañas asignadas,
el equipo sigue vinculado y se muestra ese motivo sin generar otra instalación.

«Salir» cierra solo la sesión de este dispositivo y conserva la vinculación.
Se rechaza el cambio de supervisor mientras existan operaciones sin resolver,
sesiones de lectura activas o una escritura en curso. Los datos no se borran.

## Persistencia y reintentos

`gesgrow-pda` es una base IndexedDB separada de `scc`. Conserva UUID, credencial
aleatoria de 32 bytes, empresa y autorización local. La identidad de instalación
se guarda antes de enviar la solicitud. Un reintento reutiliza UUID y credencial;
antes de necesitar de nuevo el QR se consulta si la primera solicitud llegó al
servidor. No se guarda la contraseña ni el PIN en esta base ni se registra el
token QR. Se conserva únicamente el token aleatorio de sesión y su contexto.

Auth valida la cuenta únicamente durante la configuración o recuperación. La
sesión PIN diaria tiene su propio token aleatorio, ligado a usuario y PDA.
La credencial de instalación por sí sola no autentica a un supervisor.

Cada apertura y cada 30 segundos, al recuperar conexión o volver a la ventana,
se revalida equipo, membresía, módulo y campañas. Un rechazo conocido elimina
la autorización local y bloquea el acceso; no se recurre a la caché. Sin conexión
solo se permite la misma cuenta con una autorización previamente obtenida y
vigente durante un máximo de 12 horas o hasta la medianoche de Lima, lo que
ocurra primero. Sin conexión se puede continuar una sesión válida; iniciar una
nueva requiere Internet. Un PDA desconectado conoce una revocación al reconectar.

## Backend requerido

Aplicar después de las dos migraciones de vinculación anteriores:

`20261027181414_pda_ingreso_supervisor.sql`

Añade `pda_preparar_ingreso(dispositivo, credencial)`. Exige sesión autenticada,
revalida el dispositivo y deriva el operador desde la membresía de esa cuenta.
Solo devuelve sus campañas activas de la empresa vinculada. Una cuenta sin
campañas obtiene `operador: null` y puede conservar la instalación vinculada.
La migración no activa el acceso vinculado obligatorio ni modifica datos agrícolas.

Aplicar también `20261028074652_pda_acceso_dni_pin.sql`, que añade:

- `pda_configurar_pin`: exige Auth y PDA vinculado; guarda el PIN con bcrypt.
- `pda_iniciar_sesion_pin`: exige credencial de equipo, DNI y PIN; devuelve
  un token de sesión de 32 bytes y el operador derivado de esa cuenta.
- `pda_preparar_ingreso_pin`: revalida la sesión y los permisos del usuario.
- `pda_cerrar_sesion_pin`: revoca la sesión sin desvincular el equipo.

Cinco PIN incorrectos bloquean la cuenta durante 15 minutos, incluso desde
otro PDA. Diez intentos incorrectos bloquean temporalmente el dispositivo para
impedir eludir el límite usando DNI inexistentes. Los rechazos se devuelven
como datos para confirmar los contadores de intentos en la transacción.
Cambiar el PIN invalida las sesiones anteriores de la cuenta en esa empresa.
Los PIN, sus hashes y los tokens de sesión del servidor viven en tablas privadas
con RLS y sin acceso directo para `anon` o `authenticated`. El contexto de usuario
se deriva en el servidor y se restaura al terminar; el cliente no recibe un JWT.

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
→ vinculación → creación de PIN → ingreso diario, lectura por cámara y el rechazo
de credenciales. También comprueban que no aparezca ingreso antes del primer QR.
Las pruebas SQL del backend ejecutan el nuevo RPC y sus permisos contra PGlite.
La versión anterior se inspeccionó en Chrome a 390 píxeles; el cambio a DNI/PIN
se validó mediante pruebas de presentación y SQL con bcrypt real en PGlite.

Validación: 484 pruebas de PWA y 634 de backend aprobadas; compilación Vite/PWA
y comprobación del paquete compartido correctas. La migración de acceso PIN se
aplicó en Quijas-SCC el 2026-10-28 y la API reconoce las funciones nuevas. La
publicación de la nueva PWA sigue pendiente; no se inició sesión con usuarios
reales durante las pruebas.
