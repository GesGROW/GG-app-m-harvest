# GesGROW · Aplicación móvil de Cosecha

PWA de campo con Vite, service worker e IndexedDB. Conserva el ingreso operativo por
DNI, captura de tickets y cola offline. Esta separación no cambia el contrato del PDA.

## Desarrollo

Requiere Node.js 24 y npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

Configurar VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY. Usar solamente la clave
pública; nunca service_role. En PowerShell: Copy-Item .env.example .env.
Puerto habitual: 5173.

## Validación

```sh
npm test
npm run build
npm run preview
```

Las pruebas operativas y de arquitectura se ejecutan dentro de este repositorio.
Las pruebas SQL y de Google Sheets se mantienen en GG-backend.

## Diseño

La PWA sigue la versión clara del Portal GesGROW: Google Sans Flex, verde profundo,
superficies crema, acentos lima y controles redondeados. `src/tokens.css` concentra
la paleta y la tipografía; `src/tables.css` unifica todas las tablas con el Portal.
`src/style.css` adapta los componentes a móvil y PDA,
con controles táctiles de al menos 48 px y campos de escaneo de 64 px.
Los encabezados de tabla se alinean a la izquierda, el contenido largo se ajusta
dentro de su celda y las tablas anchas tienen desplazamiento horizontal propio.
Las vistas de lotes muestran sus nombres; los códigos e identificadores se
conservan internamente para la operación y sincronización.

La referencia visual son `owner-home.css`, `account-access.css` y `portal-tables.css`
del Portal. El logotipo y la fotografía se conservan en `public/brand/`, y las
fuentes en `src/assets/fonts/`. Son copias locales: la aplicación no depende del
checkout del Portal ni de un proveedor externo de fuentes. El service worker
incluye estos recursos para que el diseño esté disponible sin conexión.

## Publicación y PDA

Publicar dist/ en un origen HTTPS dedicado, distinto del Portal. El manifiesto y el
service worker tienen scope /. Para el nuevo hosting se debe actualizar la URL de
instalación en el PDA. Esta migración de repositorios no cambia el hosting actual ni
elimina cachés, registros pendientes o datos de los dispositivos.

## Código compartido

Este repositorio incluye en vendor/ la entrega exacta de @gesgrow/core 0.1.0.
package-lock.json fija su integridad. npm ci funciona sin clonar los otros proyectos,
sin una carpeta shared/ externa y sin acceso a un registro privado.
La fuente canónica se mantiene en GG-backend, dentro de
supabase/functions/_shared/core/, para que también sea desplegable por las Edge Functions.

Para actualizar el paquete se recibe un nuevo .tgz, se cambia la dependencia file:
y se actualiza package-lock.json con npm install. No modificar node_modules ni editar
copias independientes de las reglas.

## Contrato de compatibilidad del backend

GG-backend prueba sus RPC contra una instantánea versionada de los adapters y la
cola offline de esta aplicación. Para generar una nueva entrega:

```sh
npm run pack:contracts -- ruta/al/vendor/de/GG-backend
```

El artefacto @gesgrow/harvest-client-contracts sólo se usa en pruebas; no crea una
dependencia de ejecución entre backend y PWA. Hay que subir la versión del cliente
cuando se distribuye una nueva entrega y actualizar el lockfile del consumidor.

## Proyectos

- Portal: https://github.com/GesGROW/GG-portal
- Backend: https://github.com/GesGROW/GG-backend
- PWA Cosecha: https://github.com/GesGROW/GG-app-m-harvest

Este repositorio comienza con el código completo y un historial inicial nuevo.
