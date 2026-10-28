# Preparación local durante el ingreso

El menú espera a que la caché de la campaña se confirme en IndexedDB. La
descarga y la persistencia forman parte del ingreso; mostrar el menú antes de
confirmar esa transacción permitiría operar con datos incompletos.

El 2026-10-28 se revisaron los registros recientes de Quijas-SCC. La validación
de DNI registraba 10 solicitudes, 380 ms de media y 776 ms de máximo en el
servidor/API; la caché operativa y el snapshot registraban 8 solicitudes cada
uno, con medias de 196 y 438 ms. Estos tiempos no incluyen toda la red del
PDA, la importación de JavaScript ni la escritura local; no explican por sí
solos los 20 segundos comunicados por el usuario.

## Cambio

- Las escrituras independientes y los borrados se agrupan en lotes de 256
  peticiones dentro de la misma transacción.
- Una lectura local de trabajadores o tickets consulta el propietario una vez
  para el resultado completo y sigue contrastándolo con cada fila. No se guarda
  esa autorización entre transacciones ni se omiten verificaciones por empresa.
- La incorporación del snapshot lee por índice los hechos de la campaña antes
  de escribir. Mantiene mapas de identidades confirmadas para evitar miles de
  lecturas individuales. Conserva el orden entre asignaciones, registros, lotes
  y tickets, así como sus comprobaciones de inmutabilidad y versión productiva.
- Se mantiene el guardado atómico: un rechazo tardío revierte también los lotes
  anteriores, los metadatos y la caché operativa.

No se modifican RPC, permisos, esquema IndexedDB, credenciales de PDA, cola,
identificadores de operaciones ni la primera vinculación por cámara.

## Medición y límites

Prueba local con Chrome e IndexedDB reales, datos sintéticos de 3.290 tickets
y 1.995 registros de cosecha, además de su caché operativa. En actualizaciones
con datos ya guardados:

| Versión | Primera actualización | Repetición |
| --- | ---: | ---: |
| Anterior | 3.043 ms | 3.022 ms |
| Optimizada | 1.284 ms | 1.169 ms |

La reducción observada ronda el 60% en esta parte del ingreso. No es una
medición de extremo a extremo ni un tiempo garantizado para el PDA del usuario.
No se accedió al dispositivo real ni se usaron sus credenciales en la prueba.

La suite completa comprueba pendientes, aislamiento, snapshots tardíos y
rollback. La regresión adicional provoca una contradicción en el ticket 300
para comprobar que el error revierte todo, incluso después de procesar el
primer lote de 256 registros.
