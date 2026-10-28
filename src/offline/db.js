import { openDB } from 'idb'
import { migrarOwnershipLocal, validarOwnershipCache } from './tenants.js'
import {
  tenantDeRecurso,
  exigirMismoTenant
} from '@gesgrow/core/contexts/platform/index.js'
import { evaluarDescarteOperacion } from './cola.js'
import { crearStoresHarvest, crearHarvestLocal, storesHarvest } from './harvest.js'
import { procesarEnLotes } from './lotesPersistencia.js'
import {
  modeloOperativoHarvest,
  EscrituraLegacyRetirada
} from '@gesgrow/core/contexts/harvest/index.js'
import {
  conCampania,
  establecerContextoCampania,
  obtenerContextoCampania,
  migrarCampaniasLocales
} from './campanias.js'

const DB_NAME = 'scc'
const DB_VERSION = 5

const rawDbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion, _newVersion, transaction) {
    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta')
    }

    if (!db.objectStoreNames.contains('operadores')) {
      db.createObjectStore('operadores', { keyPath: 'dni' })
    }

    if (!db.objectStoreNames.contains('trabajadores')) {
      db.createObjectStore('trabajadores', { keyPath: 'dni' })
    }

    if (!db.objectStoreNames.contains('lotes')) {
      db.createObjectStore('lotes', { keyPath: 'lote_id' })
    }

    if (!db.objectStoreNames.contains('tickets')) {
      db.createObjectStore('tickets', { keyPath: 'codigo_ticket' })
    }

    if (!db.objectStoreNames.contains('cola')) {
      const cola = db.createObjectStore('cola', { keyPath: 'id' })
      cola.createIndex('estado', 'estado')
      cola.createIndex('creado_en', 'creado_en')
    }

    if (!db.objectStoreNames.contains('sesiones')) {
      const sesiones = db.createObjectStore('sesiones', { keyPath: 'id' })
      sesiones.createIndex('estado', 'estado')
    }

    if (!db.objectStoreNames.contains('lecturas')) {
      const lecturas = db.createObjectStore('lecturas', { keyPath: 'id' })
      lecturas.createIndex('sesion_id', 'sesion_id')
      lecturas.createIndex('estado_sync', 'estado_sync')
    }
    if (oldVersion < 3) {
      const sesiones = transaction.objectStore('sesiones')
      if (!sesiones.indexNames.contains('dni_operador')) {
        sesiones.createIndex('dni_operador', 'dni_operador')
      }
    }
    if (oldVersion < 4)
      migrarCampaniasLocales(db, transaction).catch(() => transaction.abort())
    if (oldVersion < 5) crearStoresHarvest(db)
  }
}).then(migrarOwnershipLocal)

export async function comprobarTrabajoDispositivo(
  tenantId,
  dni,
  { salir = false } = {}
) {
  const db = await rawDbPromise
  const cola = (await db.getAll('cola')).filter(
    (op) => !['SINCRONIZADA', 'DESCARTADA'].includes(op.estado)
  )
  const sesiones = (await db.getAll('sesiones')).filter((s) => s.estado === 'ACTIVA')
  if (salir && (cola.length || sesiones.length))
    throw new Error(
      'Sincroniza los registros pendientes y finaliza las sesiones de lectura antes de cambiar de supervisor.'
    )
  for (const dato of [
    ...cola.map((op) => ({ ...op.payload, tenant_id: op.tenant_id })),
    ...sesiones
  ]) {
    if (
      (dato.tenant_id ?? dato.tenantId) !== tenantId ||
      (dato.dniOperador ?? dato.dni_operador) !== dni
    )
      throw new Error(
        'Hay trabajo pendiente de otra cuenta o empresa. Conserva estos datos y resuélvelo con el supervisor anterior antes de continuar.'
      )
  }
}
const harvestLocal = crearHarvestLocal({ dbPromise: rawDbPromise, crearOperacionEnTx })
export const obtenerModeloOperativoHarvest = (campaniaId) =>
  harvestLocal.obtenerModeloOperativo(campaniaId)
export const guardarSnapshotHarvest = (snapshot) =>
  harvestLocal.guardarSnapshot(snapshot)
export const obtenerEstadoHarvest = (codigo, campaniaId) =>
  harvestLocal.obtener(codigo, campaniaId)
export const reservarAsignacionHarvest = (solicitud) =>
  harvestLocal.reservarAsignacion(solicitud)
export const reservarConsumoHarvest = (solicitud) =>
  harvestLocal.reservarConsumo(solicitud)
export const confirmarOperacionHarvest = (operacion, resultado) =>
  harvestLocal.confirmar(operacion, resultado)
export const rechazarOperacionHarvest = (operacion, error) =>
  harvestLocal.rechazar(operacion, error)
const dbPromise = {
  then(resolve, reject) {
    const id = obtenerContextoCampania()
    return rawDbPromise.then((db) => resolve(conCampania(db, id)), reject)
  }
}

export async function seleccionarCampaniaLocal(id) {
  establecerContextoCampania(id)
}

export async function obtenerCacheCampania(id) {
  return (await rawDbPromise).get('meta', `campania:${id}`)
}

// ============================================================
// OPERADORES
// ============================================================

export async function guardarOperador(operador) {
  const db = await dbPromise

  await db.put('operadores', operador)
}

export async function obtenerOperador(dni) {
  const db = await dbPromise

  return db.get('operadores', dni)
}

// ============================================================
// GUARDAR CACHÉ COMPLETO
// ============================================================

export async function guardarCache(cache) {
  if (
    !cache ||
    !Array.isArray(cache.trabajadores) ||
    !Array.isArray(cache.lotes) ||
    !Array.isArray(cache.tickets)
  ) {
    throw new Error('El servidor devolvió una caché operativa inválida.')
  }
  const tenantId = validarOwnershipCache(cache)
  cache = {
    ...cache,
    campania: {
      ...(typeof cache.campania === 'object'
        ? cache.campania
        : { nombre: cache.campania }),
      tenant_id: tenantId
    }
  }
  const db = (await dbPromise).conCampania(
    cache.campania?.id ?? cache.campania?.campania_id ?? obtenerContextoCampania()
  )

  const tx = db.transaction(
    [
      'meta',
      'trabajadores',
      'lotes',
      'tickets',
      'cola',
      'lecturas',
      'sesiones',
      'operadores',
      ...storesHarvest
    ],
    'readwrite'
  )

  try {
    await reemplazarCacheEnTx(tx, cache)
    if (cache.harvest) await harvestLocal.incorporarEnTx(tx, cache.harvest)
    await tx.done
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // IndexedDB puede haber abortado ya la transacción por un error de escritura.
    }
    await tx.done.catch(() => {})
    throw error
  }
}

async function reemplazarCacheEnTx(tx, cache) {
  const anterior = await tx.objectStore('meta').get(`campania:${cache.campania?.id}`)
  if (anterior && tenantDeRecurso(anterior) !== tenantDeRecurso(cache.campania))
    throw new Error('El propietario Tenant de la campaña es inmutable.')
  // Solo un nombre oficial de esta respuesta reemplaza nombres en tickets locales.
  const nombresServidor = new Map(
    cache.trabajadores
      .map((trabajador) => [trabajador.dni, String(trabajador.nombre ?? '').trim()])
      .filter(([, nombre]) => nombre && !/^DNI \d{8}$/.test(nombre))
  )

  await tx.objectStore('meta').put(cache.campania, 'campania_activa')
  const cacheId =
    cache.campania?.id ?? cache.campania?.campania_id ?? obtenerContextoCampania()
  await tx.objectStore('meta').put(cache.campania, `campania:${cacheId}`)

  await tx.objectStore('meta').put(cache.sincronizado_en, 'ultima_sync')

  const trabajadoresStore = tx.objectStore('trabajadores')

  const lotesStore = tx.objectStore('lotes')

  const ticketsStore = tx.objectStore('tickets')
  const ticketsLocales = await ticketsStore.getAll()
  const ticketsLocalesPorCodigo = new Map(
    ticketsLocales.map((ticket) => [ticket.codigo_ticket, ticket])
  )
  const ticketsPendientes = ticketsLocales.filter(
    (ticket) => ticket.estado_sync !== 'SINCRONIZADO'
  )
  const trabajadoresLocales = await trabajadoresStore.getAll()
  const rolesLocales = trabajadoresLocales.filter((trabajador) =>
    ['PENDIENTE', 'ERROR', 'SINCRONIZADO'].includes(trabajador.estado_sync_jabero)
  )
  const operacionesLocales = await tx.objectStore('cola').getAll()
  const dnisCosechadoresPendientes = new Set(
    operacionesLocales
      .filter(
        (operacion) =>
          operacion.tipo === 'ASIGNAR_TICKET' &&
          ['PENDIENTE', 'ERROR'].includes(operacion.estado) &&
          operacion.payload?.dniCosechador &&
          (operacion.payload.campaniaId ?? '') === cacheId
      )
      .map((operacion) => operacion.payload.dniCosechador)
  )
  const cosechadoresProvisionales = trabajadoresLocales.filter(
    (trabajador) =>
      dnisCosechadoresPendientes.has(trabajador.dni) &&
      trabajador.roles?.includes('COSECHADOR')
  )

  await trabajadoresStore.clear()
  await lotesStore.clear()
  await ticketsStore.clear()

  await procesarEnLotes(cache.trabajadores, (trabajador) =>
    trabajadoresStore.put(trabajador)
  )
  for (const local of cosechadoresProvisionales) {
    const actual = await trabajadoresStore.get(local.dni)
    if (!actual) {
      await trabajadoresStore.put(local)
      continue
    }

    actual.roles = [...new Set([...(actual.roles ?? []), 'COSECHADOR'])]
    if (!String(actual.nombre ?? '').trim()) {
      actual.nombre =
        String(local.nombre ?? '').trim() || `DNI ${String(local.dni ?? '').trim()}`
    }
    if (!String(actual.nombre ?? '').startsWith('DNI ')) {
      delete actual.provisional_local
    } else if (local.provisional_local) {
      actual.provisional_local = true
    }
    await trabajadoresStore.put(actual)
  }
  for (const local of rolesLocales) {
    if (local.estado_sync_jabero === 'SINCRONIZADO') continue
    const actual = (await trabajadoresStore.get(local.dni)) ?? { ...local }
    if (local.estado_sync_jabero === 'PENDIENTE') {
      actual.roles = [...new Set([...(actual.roles ?? []), 'JABERO'])]
    } else {
      actual.roles = (actual.roles ?? []).filter((rol) => rol !== 'JABERO')
    }
    actual.estado_sync_jabero = local.estado_sync_jabero
    actual.operacion_jabero_id = local.operacion_jabero_id
    await trabajadoresStore.put(actual)
  }

  await procesarEnLotes(cache.lotes, (lote) => lotesStore.put(lote))

  await procesarEnLotes(cache.tickets, (ticket) => {
    const ticketLocal = ticketsLocalesPorCodigo.get(ticket.codigo_ticket)
    const nombreServidor = nombresServidor.get(ticket.cosechador_dni)
    return ticketsStore.put({
      ...ticket,
      ...(nombreServidor ? { cosechador: nombreServidor } : {}),
      fecha_asignacion:
        ticket.fecha_asignacion ?? ticketLocal?.fecha_asignacion ?? null,
      estado_sync: 'SINCRONIZADO'
    })
  })

  for (const ticket of ticketsPendientes) {
    const nombreServidor = nombresServidor.get(ticket.cosechador_dni)
    await ticketsStore.put({
      ...ticket,
      ...(nombreServidor ? { cosechador: nombreServidor } : {})
    })
  }
}

// ============================================================
// CONSULTAS LOCALES
// ============================================================

export async function obtenerTrabajador(dni) {
  const db = await dbPromise

  return db.get('trabajadores', dni)
}

export async function obtenerTrabajadores() {
  const db = await dbPromise

  return db.getAll('trabajadores')
}

export async function agregarRolTrabajador(dni, rol, operacionId = null) {
  const db = await dbPromise
  const trabajador = await db.get('trabajadores', dni)

  if (!trabajador) {
    throw new Error('El trabajador no está disponible en los datos locales.')
  }

  trabajador.roles ??= []

  if (!trabajador.roles.includes(rol)) {
    trabajador.roles.push(rol)
  }
  if (rol === 'JABERO' && operacionId) {
    trabajador.estado_sync_jabero = 'PENDIENTE'
    trabajador.operacion_jabero_id = operacionId
  }

  await db.put('trabajadores', trabajador)

  return trabajador
}

export async function marcarJabero(
  dni,
  estado,
  operacionId,
  campaniaId = obtenerContextoCampania()
) {
  const db = (await dbPromise).conCampania(campaniaId)
  const trabajador = await db.get('trabajadores', dni)
  if (!trabajador || trabajador.operacion_jabero_id !== operacionId) return
  trabajador.estado_sync_jabero = estado
  if (estado === 'ERROR') {
    trabajador.roles = (trabajador.roles ?? []).filter((rol) => rol !== 'JABERO')
  } else {
    trabajador.roles = [...new Set([...(trabajador.roles ?? []), 'JABERO'])]
  }
  await db.put('trabajadores', trabajador)
}

export async function obtenerTicket(codigo) {
  const db = await dbPromise

  return db.get('tickets', codigo)
}

export async function obtenerTickets() {
  const db = await dbPromise

  return db.getAll('tickets')
}

export const obtenerAsignacionesTickets = (campaniaId) =>
  harvestLocal.listarAsignaciones(campaniaId)

export async function guardarTicketLocal({
  codigoTicket,
  cosechadorDni,
  cosechador,
  operacionId,
  fechaAsignacion = new Date().toISOString()
}) {
  const db = await dbPromise

  await db.put('tickets', {
    codigo_ticket: codigoTicket,
    cosechador_dni: cosechadorDni,
    cosechador,
    operacion_id: operacionId,
    estado_sync: 'PENDIENTE',
    fecha_asignacion: fechaAsignacion,
    actualizado_en: new Date().toISOString()
  })
}

export async function marcarTicketSincronizado(
  codigoTicket,
  campaniaId = obtenerContextoCampania()
) {
  const db = (await dbPromise).conCampania(campaniaId)
  const ticket = await db.get('tickets', codigoTicket)

  if (!ticket) {
    return
  }

  ticket.estado_sync = 'SINCRONIZADO'
  ticket.actualizado_en = new Date().toISOString()

  await db.put('tickets', ticket)
}

export async function marcarTicketError(
  codigoTicket,
  error,
  campaniaId = obtenerContextoCampania()
) {
  const db = (await dbPromise).conCampania(campaniaId)
  const ticket = await db.get('tickets', codigoTicket)

  if (!ticket) {
    return
  }

  ticket.estado_sync = 'ERROR'
  ticket.error = error
  ticket.actualizado_en = new Date().toISOString()

  await db.put('tickets', ticket)
}

export async function eliminarTicketLocal(
  codigoTicket,
  operacionId,
  campaniaId = obtenerContextoCampania()
) {
  const db = (await dbPromise).conCampania(campaniaId)
  const ticket = await db.get('tickets', codigoTicket)
  if (ticket?.operacion_id === operacionId) await db.delete('tickets', codigoTicket)
}

export async function marcarTicketPendiente(
  codigoTicket,
  campaniaId = obtenerContextoCampania()
) {
  const db = (await dbPromise).conCampania(campaniaId)
  const ticket = await db.get('tickets', codigoTicket)
  if (!ticket) return
  ticket.estado_sync = 'PENDIENTE'
  ticket.error = null
  await db.put('tickets', ticket)
}

export async function obtenerLotes() {
  const db = await dbPromise

  return db.getAll('lotes')
}

export async function obtenerCampaniaActiva() {
  const db = await dbPromise
  return db.campaniaId
    ? db.get('meta', `campania:${db.campaniaId}`)
    : db.get('meta', 'campania_activa')
}

// SESIONES Y LECTURAS LOCALES

export async function guardarSesionLocal(sesion) {
  const db = await dbPromise
  const campania = await db.get(
    'meta',
    `campania:${sesion.campania_id ?? db.campaniaId}`
  )
  if (sesion.tenantId !== undefined || sesion.tenant_id !== undefined)
    exigirMismoTenant(campania, sesion)
  await db.put('sesiones', {
    ...sesion,
    tenant_id: tenantDeRecurso(campania),
    campania_id: sesion.campania_id ?? db.campaniaId
  })
}

export async function obtenerSesionLocal(id) {
  const db = await dbPromise
  return db.get('sesiones', id)
}

async function recuperarDniOperadorSesiones(db, sesiones) {
  const sesionesSinOperador = sesiones.filter((sesion) => !sesion.dni_operador)
  if (!sesionesSinOperador.length) return sesiones

  const operaciones = await db.getAll('cola')
  const operadorPorSesion = new Map(
    operaciones
      .filter(
        (operacion) =>
          operacion.tipo === 'INICIAR_SESION' &&
          operacion.payload?.sesionId &&
          operacion.payload?.dniOperador
      )
      .map((operacion) => [operacion.payload.sesionId, operacion.payload.dniOperador])
  )

  for (const sesion of sesionesSinOperador) {
    const dniOperador = operadorPorSesion.get(sesion.id ?? sesion.sesion_id)
    if (!dniOperador) continue
    sesion.dni_operador = dniOperador
    await db.put('sesiones', sesion)
  }

  return sesiones
}

export async function obtenerSesionesActivas(dniOperador) {
  const db = await dbPromise
  const sesiones = await db.getAllFromIndex('sesiones', 'estado', 'ACTIVA')
  await recuperarDniOperadorSesiones(db, sesiones)
  return sesiones.filter(
    (sesion) =>
      sesion.dni_operador === dniOperador &&
      (sesion.campania_id ?? '') === db.campaniaId
  )
}

export async function obtenerSesionesOperador(dniOperador) {
  const db = await dbPromise
  const sesiones = await db.getAll('sesiones')
  await recuperarDniOperadorSesiones(db, sesiones)
  return sesiones.filter(
    (sesion) =>
      sesion.dni_operador === dniOperador &&
      (sesion.campania_id ?? '') === db.campaniaId
  )
}

export async function obtenerSesionActivaJabero(dniJabero) {
  const db = await dbPromise
  const sesiones = await db.getAllFromIndex('sesiones', 'estado', 'ACTIVA')
  return sesiones.find(
    (sesion) =>
      sesion.dni_jabero === dniJabero && (sesion.campania_id ?? '') === db.campaniaId
  )
}

export async function cerrarSesionLocal(id) {
  const db = await dbPromise
  const sesion = await db.get('sesiones', id)

  if (!sesion) {
    return
  }

  sesion.estado = 'CERRADA'
  sesion.fecha_fin = new Date().toISOString()
  await db.put('sesiones', sesion)
}

export async function guardarLecturaLocal(lectura) {
  const db = await dbPromise
  const campania = await db.get(
    'meta',
    `campania:${lectura.campania_id ?? db.campaniaId}`
  )
  if (lectura.tenantId !== undefined || lectura.tenant_id !== undefined)
    exigirMismoTenant(campania, lectura)
  await db.put('lecturas', {
    ...lectura,
    tenant_id: tenantDeRecurso(campania),
    campania_id: lectura.campania_id ?? db.campaniaId
  })
}

export async function marcarLecturaSincronizada(id) {
  const db = await dbPromise
  const lectura = await db.get('lecturas', id)

  if (!lectura) {
    return
  }

  lectura.estado_sync = 'SINCRONIZADO'
  await db.put('lecturas', lectura)
}

export async function contarLecturasSesion(sesionId) {
  return (await obtenerLecturasSesion(sesionId)).length
}

export async function obtenerLecturasSesion(sesionId) {
  const db = await dbPromise
  const lecturas = await db.getAllFromIndex('lecturas', 'sesion_id', sesionId)
  const rechazadas = new Set(
    (await db.getAll('cola'))
      .filter(
        (op) =>
          op.tipo === 'REGISTRAR_JABA' &&
          op.estado === 'ERROR' &&
          (op.payload.campaniaId ?? '') === db.campaniaId
      )
      .map((op) => op.payload.lecturaId)
  )
  return lecturas.filter(
    (l) =>
      (l.campania_id ?? '') === db.campaniaId &&
      l.valida !== false &&
      !rechazadas.has(l.id)
  )
}
export async function obtenerLecturasSesionCompletas(sesionId) {
  const db = await dbPromise
  return (await db.getAllFromIndex('lecturas', 'sesion_id', sesionId)).filter(
    (l) => (l.campania_id ?? '') === db.campaniaId
  )
}

export async function contarLecturasCosechador(sesionId, dni) {
  const lecturas = await obtenerLecturasSesion(sesionId)
  return lecturas.filter((lectura) => lectura.cosechador_dni === dni).length
}

export async function obtenerUltimaLecturaSesion(sesionId) {
  const lecturas = await obtenerLecturasSesion(sesionId)
  return lecturas
    .sort((a, b) => (a.fecha_hora ?? '').localeCompare(b.fecha_hora ?? ''))
    .at(-1)
}

// ============================================================
// COLA DE SINCRONIZACIÓN
// ============================================================

export async function agregarOperacion(tipo, payload) {
  const db = await dbPromise
  const tx = db.transaction(['meta', 'cola'], 'readwrite')
  const operacion = await crearOperacionEnTx(tx, tipo, payload)
  await tx.done
  return operacion
}

async function crearOperacionEnTx(tx, tipo, payload) {
  const metaStore = tx.objectStore('meta')
  const ultimoCreadoEn = await metaStore.get('ultimo_creado_en_ms')
  const creadoEnMs = Math.max(Date.now(), (ultimoCreadoEn ?? 0) + 1)

  const operacion = {
    tenant_id: tenantDeRecurso(
      await metaStore.get(`campania:${payload.campaniaId ?? tx.campaniaId}`)
    ),
    id: crypto.randomUUID(),

    tipo,

    payload: { ...payload, campaniaId: payload.campaniaId ?? tx.campaniaId },

    estado: 'PENDIENTE',

    intentos: 0,

    error: null,

    creado_en: new Date(creadoEnMs).toISOString()
  }

  await metaStore.put(creadoEnMs, 'ultimo_creado_en_ms')
  await tx.objectStore('cola').put(operacion)
  return operacion
}

export async function guardarAsignacionOffline({
  codigoTicket,
  cosechadorDni,
  cosechador,
  dniOperador,
  fechaAsignacion = new Date().toISOString(),
  modeloSolicitado
}) {
  const db = await dbPromise
  const tx = db.transaction(['meta', 'cola', 'tickets', 'trabajadores'], 'readwrite')
  await validarEscrituraLegacyEnTx(tx, modeloSolicitado === 'LEGACY')
  if (await tx.objectStore('tickets').get(codigoTicket)) {
    throw new Error('El ticket ya fue asignado.')
  }
  const trabajadoresStore = tx.objectStore('trabajadores')
  const trabajadorActual = await trabajadoresStore.get(cosechadorDni)
  const yaEraCosechador = trabajadorActual?.roles?.includes('COSECHADOR') === true
  const nombreVisible =
    String(cosechador ?? '').trim() || `DNI ${String(cosechadorDni ?? '').trim()}`

  await trabajadoresStore.put({
    ...(trabajadorActual ?? {}),
    dni: cosechadorDni,
    nombre: String(trabajadorActual?.nombre ?? '').trim() || nombreVisible,
    roles: [...new Set([...(trabajadorActual?.roles ?? []), 'COSECHADOR'])],
    activo: trabajadorActual?.activo ?? true,
    provisional_local: yaEraCosechador
      ? trabajadorActual?.provisional_local === true
      : true
  })

  const operacion = await crearOperacionEnTx(tx, 'ASIGNAR_TICKET', {
    dniOperador,
    dniCosechador: cosechadorDni,
    codigoTicket
  })
  if (modeloSolicitado === 'LEGACY') {
    operacion.modelo = 'LEGACY'
    operacion.origenVersion = 6
    await tx.objectStore('cola').put(operacion)
  }
  await tx.objectStore('tickets').put({
    codigo_ticket: codigoTicket,
    cosechador_dni: cosechadorDni,
    cosechador,
    operacion_id: operacion.id,
    estado_sync: 'PENDIENTE',
    fecha_asignacion: fechaAsignacion,
    actualizado_en: new Date().toISOString()
  })
  await tx.done
  return operacion
}

export async function registrarJaberoOffline(dniOperador, dniTrabajador) {
  dniTrabajador = String(dniTrabajador ?? '').trim()
  if (!/^\d{8}$/.test(dniTrabajador)) {
    throw new Error('El DNI debe contener 8 dígitos.')
  }
  const db = await dbPromise
  const tx = db.transaction(['meta', 'cola', 'trabajadores'], 'readwrite')
  const campania = await tx
    .objectStore('meta')
    .get(tx.campaniaId ? `campania:${tx.campaniaId}` : 'campania_activa')
  const trabajadorActual = await tx.objectStore('trabajadores').get(dniTrabajador)
  if (!campania || (campania.estado && campania.estado !== 'ACTIVA')) {
    throw new Error('No hay una campaña activa en los datos locales.')
  }
  if (trabajadorActual?.activo === false) {
    throw new Error('El trabajador está inactivo.')
  }
  if (trabajadorActual?.estado_sync_jabero === 'ERROR') {
    throw new Error(
      'El jabero no está disponible para registrar. Revise su estado de sincronización.'
    )
  }
  if (trabajadorActual?.estado_sync_jabero === 'PENDIENTE') {
    throw new Error(
      'El trabajador ya está registrado como jabero. Su asignación está pendiente de sincronizar.'
    )
  }
  const trabajador = trabajadorActual ?? {
    dni: dniTrabajador,
    nombre: `DNI ${dniTrabajador}`,
    activo: true,
    roles: [],
    provisional_local: true
  }
  const operacion = await crearOperacionEnTx(tx, 'REGISTRAR_JABERO', {
    dniOperador,
    dniTrabajador
  })
  trabajador.roles = [...new Set([...(trabajador.roles ?? []), 'JABERO'])]
  trabajador.estado_sync_jabero = 'PENDIENTE'
  trabajador.operacion_jabero_id = operacion.id
  await tx.objectStore('trabajadores').put(trabajador)
  await tx.done
  return operacion
}

function validarCampaniaSesion(sesion, campaniaId) {
  if ((sesion.campania_id ?? '') !== campaniaId) {
    throw new Error('La sesión no pertenece a la campaña seleccionada.')
  }
}

export async function iniciarSesionOffline(sesion, dniOperador) {
  const db = await dbPromise
  const tx = db.transaction(['meta', 'cola', 'sesiones'], 'readwrite')
  const activas = await tx.objectStore('sesiones').index('estado').getAll('ACTIVA')
  sesion = { ...sesion, campania_id: sesion.campania_id ?? tx.campaniaId }
  validarCampaniaSesion(sesion, tx.campaniaId)
  if (
    activas.some(
      (actual) =>
        actual.dni_jabero === sesion.dni_jabero &&
        (actual.campania_id ?? '') === sesion.campania_id
    )
  ) {
    throw new Error('El jabero ya tiene una sesión activa. Continúe esa sesión.')
  }
  const campania = await tx.objectStore('meta').get(`campania:${tx.campaniaId}`)
  if (sesion.tenantId !== undefined || sesion.tenant_id !== undefined)
    exigirMismoTenant(campania, sesion)
  sesion.tenant_id = tenantDeRecurso(campania)
  const operacion = await crearOperacionEnTx(tx, 'INICIAR_SESION', {
    dniOperador,
    dniJabero: sesion.dni_jabero,
    loteId: sesion.lote_id,
    variedadId: sesion.variedad_id ?? null,
    campaniaId: sesion.campania_id,
    sesionId: sesion.id
  })
  await tx.objectStore('sesiones').put(sesion)
  await tx.done
  return operacion
}

export async function registrarLecturaOffline(lectura, dniOperador) {
  const db = await dbPromise
  const tx = db.transaction(['meta', 'cola', 'lecturas', 'sesiones'], 'readwrite')
  await validarEscrituraLegacyEnTx(tx, lectura.modelo === 'LEGACY')
  const sesion = await tx.objectStore('sesiones').get(lectura.sesion_id)
  if (!sesion || sesion.estado !== 'ACTIVA') {
    throw new Error('La sesión de lectura ya no está activa.')
  }
  validarCampaniaSesion(sesion, tx.campaniaId)
  exigirMismoTenant(
    await tx.objectStore('meta').get(`campania:${tx.campaniaId}`),
    sesion
  )
  if (lectura.tenantId !== undefined || lectura.tenant_id !== undefined)
    exigirMismoTenant(sesion, lectura)
  const operacion = await crearOperacionEnTx(tx, 'REGISTRAR_JABA', {
    dniOperador,
    sesionId: lectura.sesion_id,
    codigoTicket: lectura.codigo_ticket,
    lecturaId: lectura.id,
    fechaHora: lectura.fecha_hora,
    campaniaId: sesion.campania_id
  })
  if (lectura.modelo === 'LEGACY') {
    operacion.modelo = 'LEGACY'
    operacion.origenVersion = 6
    await tx.objectStore('cola').put(operacion)
  }
  await tx.objectStore('lecturas').put({
    ...lectura,
    tenant_id: tenantDeRecurso(sesion),
    campania_id: sesion.campania_id ?? tx.campaniaId
  })
  await tx.done
  return operacion
}

async function validarEscrituraLegacyEnTx(tx, estricto) {
  const meta = await tx.objectStore('meta').get(`harvest:${tx.campaniaId}`)
  if (meta?.cutover) throw new EscrituraLegacyRetirada()
  if (estricto) modeloOperativoHarvest(meta?.cutover, tx.campaniaId)
}

export async function finalizarSesionOffline(sesionId, dniOperador) {
  const db = await dbPromise
  const tx = db.transaction(['meta', 'cola', 'sesiones'], 'readwrite')
  const sesion = await tx.objectStore('sesiones').get(sesionId)
  if (!sesion || sesion.estado !== 'ACTIVA') {
    throw new Error('La sesión ya fue finalizada.')
  }
  validarCampaniaSesion(sesion, tx.campaniaId)
  exigirMismoTenant(
    await tx.objectStore('meta').get(`campania:${tx.campaniaId}`),
    sesion
  )
  const operacion = await crearOperacionEnTx(tx, 'CERRAR_SESION', {
    dniOperador,
    sesionId,
    campaniaId: sesion.campania_id
  })
  sesion.estado = 'CERRADA'
  sesion.fecha_fin = new Date().toISOString()
  await tx.objectStore('sesiones').put(sesion)
  await tx.done
  return operacion
}

export async function obtenerOperacionesPendientes() {
  const db = await dbPromise

  return db.getAllFromIndex('cola', 'estado', 'PENDIENTE')
}

export async function existeTicketPendiente(codigoTicket) {
  const db = await dbPromise
  const operaciones = await db.getAll('cola')

  return operaciones.some(
    (operacion) =>
      operacion.tipo === 'ASIGNAR_TICKET' &&
      operacion.estado !== 'ERROR' &&
      operacion.payload.codigoTicket === codigoTicket &&
      (operacion.payload.campaniaId ?? '') === db.campaniaId
  )
}

export async function actualizarOperacion(operacion) {
  const db = await dbPromise

  await db.put('cola', operacion)
}

export async function eliminarOperacion(id) {
  const db = await dbPromise

  await db.delete('cola', id)
}

export async function contarPendientes() {
  const db = await dbPromise

  const pendientes = await db.getAllFromIndex('cola', 'estado', 'PENDIENTE')

  return pendientes.filter((op) => (op.payload.campaniaId ?? '') === db.campaniaId)
    .length
}

export async function contarErrores() {
  const db = await dbPromise
  const errores = await db.getAllFromIndex('cola', 'estado', 'ERROR')

  return errores.filter((op) => (op.payload.campaniaId ?? '') === db.campaniaId).length
}

export async function obtenerColaCompleta() {
  const db = await dbPromise

  return db.getAll('cola')
}

export async function marcarOperacionSincronizada(id) {
  const db = await dbPromise

  const operacion = await db.get('cola', id)

  if (!operacion) {
    return
  }

  operacion.estado = 'SINCRONIZADA'
  operacion.error = null
  operacion.sincronizado_en = new Date().toISOString()

  await db.put('cola', operacion)
}

export async function marcarOperacionError(id, error) {
  const db = await dbPromise

  const operacion = await db.get('cola', id)

  if (!operacion) {
    return
  }

  operacion.estado = 'ERROR'
  operacion.error = error
  operacion.intentos = (operacion.intentos ?? 0) + 1

  await db.put('cola', operacion)
}

export async function marcarOperacionTemporal(id, error) {
  const db = await dbPromise
  const tx = db.transaction('cola', 'readwrite')
  try {
    const operacion = await tx.store.get(id)
    // Una respuesta tardía no reactiva un rechazo/ACK incorporado por otra pestaña.
    if (operacion?.estado === 'PENDIENTE') {
      await tx.store.put({
        ...operacion,
        error,
        intentos: (operacion.intentos ?? 0) + 1
      })
    }
    await tx.done
  } catch (fallo) {
    try {
      tx.abort()
    } catch {}
    await tx.done.catch(() => {})
    throw fallo
  }
}

export async function reintentarOperacion(id) {
  const db = await dbPromise
  const operacion = await db.get('cola', id)
  if (!operacion || operacion.estado !== 'ERROR') return false
  if (operacion.retiradaPorCutover) return false
  if (operacion.modelo === 'HARVEST') return harvestLocal.reintentar(operacion)
  operacion.estado = 'PENDIENTE'
  operacion.error = null
  await db.put('cola', operacion)
  if (operacion.tipo === 'ASIGNAR_TICKET') {
    await marcarTicketPendiente(
      operacion.payload.codigoTicket,
      operacion.payload.campaniaId
    )
  }
  if (operacion.tipo === 'REGISTRAR_JABERO') {
    await marcarJabero(
      operacion.payload.dniTrabajador,
      'PENDIENTE',
      id,
      operacion.payload.campaniaId
    )
  }
  return true
}

export async function descartarOperacion(id) {
  const db = await dbPromise
  const operaciones = await db.getAll('cola')
  const operacion = operaciones.find((item) => item.id === id)
  if (!evaluarDescarteOperacion(operacion, operaciones).permitido) return false
  if (operacion.tipo === 'ASIGNAR_TICKET') {
    await eliminarTicketLocal(
      operacion.payload.codigoTicket,
      id,
      operacion.payload.campaniaId
    )
  } else {
    const local = db.conCampania(operacion.payload.campaniaId ?? '')
    const trabajador = await local.get('trabajadores', operacion.payload.dniTrabajador)
    if (trabajador?.operacion_jabero_id === id) {
      delete trabajador.estado_sync_jabero
      delete trabajador.operacion_jabero_id
      await local.put('trabajadores', trabajador)
    }
  }
  await db.delete('cola', id)
  return true
}

export async function limpiarOperacionesSincronizadas(dias = 30) {
  const db = await dbPromise
  const limite = Date.now() - dias * 86400000
  const tx = db.transaction(['cola', 'sesiones'], 'readwrite')
  const activas = new Set(
    (await tx.objectStore('sesiones').index('estado').getAll('ACTIVA')).map(
      (sesion) => sesion.id
    )
  )
  const cola = tx.objectStore('cola')
  const operaciones = await cola.getAll()
  const necesarias = new Set(
    operaciones
      .filter((op) => op.estado !== 'SINCRONIZADA')
      .flatMap((op) => op.dependencias ?? [])
  )
  let eliminadas = 0
  for (const operacion of operaciones) {
    if (
      operacion.estado === 'SINCRONIZADA' &&
      !necesarias.has(operacion.id) &&
      Date.parse(operacion.sincronizado_en) < limite &&
      !(operacion.tipo === 'INICIAR_SESION' && activas.has(operacion.payload.sesionId))
    ) {
      await cola.delete(operacion.id)
      eliminadas += 1
    }
  }
  await tx.done
  return eliminadas
}

export async function reintentarErrores() {
  const db = await dbPromise

  const operaciones = await db.getAll('cola')

  for (const operacion of operaciones) {
    if (operacion.estado === 'ERROR') {
      await reintentarOperacion(operacion.id)
    }
  }
}
