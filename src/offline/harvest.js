import {
  CatalogoDeTickets,
  LoteDeTickets,
  Ticket,
  TicketNoEncontrado,
  TicketYaUtilizado,
  LoteYaAsignado,
  validarSnapshotHarvest,
  modeloOperativoHarvest,
  CampaniaSinCutover
} from '@gesgrow/core/contexts/harvest/index.js'
import { autorizacionOperadorVigente } from '@gesgrow/core/contexts/identity-access/index.js'
import { resolverCampaniaOperador } from '@gesgrow/core/contexts/campaign-management/index.js'
import { resolverCosechadorLocal } from '@gesgrow/core/contexts/workforce/index.js'
import { conCampania, obtenerContextoCampania } from './campanias.js'
import { procesarEnLotes } from './lotesPersistencia.js'
import { obtenerOperacionesDependientes } from './cola.js'
import {
  exigirMismoTenant,
  tenantDeRecurso
} from '@gesgrow/core/contexts/platform/index.js'

export const storesHarvest = [
  'harvestTickets',
  'harvestLotes',
  'harvestAsignaciones',
  'harvestRegistros',
  'harvestReservas'
]
const storesTransaccion = [
  ...storesHarvest,
  'meta',
  'cola',
  'trabajadores',
  'tickets',
  'lecturas',
  'sesiones',
  'operadores'
]

export function crearStoresHarvest(db) {
  for (const [nombre, campo] of [
    ['harvestTickets', 'codigo'],
    ['harvestLotes', 'id'],
    ['harvestAsignaciones', 'loteId'],
    ['harvestRegistros', 'codigoTicket']
  ]) {
    const store = db.createObjectStore(nombre, { keyPath: ['campaniaId', campo] })
    store.createIndex('campania', 'campaniaId')
  }
  const reservas = db.createObjectStore('harvestReservas', { keyPath: 'operacionId' })
  reservas.createIndex('recurso', ['campaniaId', 'tipo', 'recurso'])
  reservas.createIndex('campania', 'campaniaId')
}

export function crearHarvestLocal({ dbPromise, crearOperacionEnTx }) {
  async function atomica(campaniaId, accion) {
    const db = conCampania(await dbPromise, campaniaId)
    const tx = db.transaction(storesTransaccion, 'readwrite')
    try {
      const valor = await accion(tx)
      await tx.done
      return valor
    } catch (error) {
      try {
        tx.abort()
      } catch {}
      await tx.done.catch(() => {})
      throw error
    }
  }
  const get = (tx, store, id) => tx.objectStore(store).get([tx.campaniaId, id])
  const reservas = (tx, tipo, recurso) =>
    tx
      .objectStore('harvestReservas')
      .index('recurso')
      .getAll([tx.campaniaId, tipo, recurso])
  async function activa(tx, tipo, recurso) {
    for (const r of await reservas(tx, tipo, recurso)) {
      const op = await tx.objectStore('cola').get(r.operacionId)
      if (r.estado === 'ACTIVA' && op?.estado === 'PENDIENTE') return r
    }
    return null
  }
  async function autorizar(tx, dni) {
    const operador = await tx.objectStore('operadores').get(dni)
    if (!autorizacionOperadorVigente(operador))
      throw new Error(
        'La autorización local del operador no está vigente. Conéctese para ingresar.'
      )
    resolverCampaniaOperador(operador, tx.campaniaId)
    const campania = await tx.objectStore('meta').get(`campania:${tx.campaniaId}`)
    if (!campania || (campania.estado && campania.estado !== 'ACTIVA'))
      throw new Error('No hay una campaña activa en los datos locales.')
    return campania
  }
  async function estado(tx, codigo, permitirConflicto = false) {
    const base = await get(tx, 'harvestTickets', codigo)
    if (!base) throw new TicketNoEncontrado(codigo)
    const loteBase = await get(tx, 'harvestLotes', base.loteId)
    if (!loteBase) throw new Error('La caché del lote de tickets está incompleta.')
    const asignacion = await get(tx, 'harvestAsignaciones', base.loteId)
    const registro = await get(tx, 'harvestRegistros', codigo)
    const campania = await tx.objectStore('meta').get(`campania:${tx.campaniaId}`)
    if (campania)
      exigirMismoTenant(
        campania,
        base,
        loteBase,
        ...[asignacion, registro].filter(Boolean)
      )
    const ra = await activa(tx, 'ASIGNACION', base.loteId)
    const rc = await activa(tx, 'CONSUMO', codigo)
    if (!permitirConflicto) {
      for (const r of [
        ...(await reservas(tx, 'ASIGNACION', base.loteId)),
        ...(await reservas(tx, 'CONSUMO', codigo))
      ]) {
        if (r.autoridadIncierta && !(r.tipo === 'ASIGNACION' ? asignacion : registro))
          throw new Error(
            'Esta operación fue rechazada por el servidor. Actualice la caché antes de volver a escanear.'
          )
      }
    }
    const lote = new LoteDeTickets(loteBase)
    if (asignacion) lote.asignar(asignacion)
    else if (ra)
      lote.asignar({ trabajadorId: ra.trabajadorId, operacionId: ra.operacionId })
    const ticket = new Ticket(base)
    if (registro) ticket.registrarCosecha({ ...registro, lote })
    else if (rc)
      ticket.registrarCosecha({
        id: rc.registroId,
        fechaHora: rc.fechaHora,
        sesionId: rc.sesionId,
        operacionId: rc.operacionId,
        lote
      })
    const trabajadores = await tx.objectStore('trabajadores').getAll()
    const intencionAsignacion =
      ra ??
      (await reservas(tx, 'ASIGNACION', base.loteId)).find(
        (r) => r.estado === 'CONFIRMADA' && r.operacionId === asignacion?.operacionId
      )
    const identidad = (
      (await tx.objectStore('meta').get(`harvest:${tx.campaniaId}`))
        ?.identidadesTrabajadores ?? []
    ).find((w) => w.id === asignacion?.trabajadorId)
    const dni = identidad?.dni ?? intencionAsignacion?.trabajadorDni
    const trabajador = trabajadores.find(
      (w) => w.dni === dni || (asignacion && w.id === asignacion.trabajadorId)
    )
    const dniVisible = trabajador?.dni ?? dni ?? asignacion?.trabajadorId
    return {
      catalogo: new CatalogoDeTickets({ lotes: [lote], tickets: [ticket] }),
      lote,
      ticket,
      asignacionServidor: asignacion,
      registroServidor: registro,
      reservaAsignacion: ra,
      reservaConsumo: rc,
      estadoServidor: registro ? 'UTILIZADO' : 'DISPONIBLE',
      estadoEfectivo: registro ? 'UTILIZADO' : rc ? 'CONSUMO_PENDIENTE' : 'DISPONIBLE',
      proyeccion: {
        codigo_ticket: codigo,
        lote_tickets_id: lote.id,
        cosechador_dni: dniVisible,
        cosechador: trabajador?.nombre ?? intencionAsignacion?.nombre ?? dniVisible,
        trabajador_id: lote.asignacion?.trabajadorId,
        estado_sync: ra || rc ? 'PENDIENTE' : 'SINCRONIZADO'
      }
    }
  }
  async function invalidar(
    tx,
    op,
    mensaje,
    dependiente = false,
    autoridadIncierta = false
  ) {
    if (op.estado === 'SINCRONIZADA') return
    op.estado = 'ERROR'
    op.error = mensaje
    op.intentos = (op.intentos ?? 0) + 1
    if (op.modelo === 'HARVEST') op.rechazoHarvest = true
    if (dependiente) op.bloqueadaPorDependencia = true
    await tx.objectStore('cola').put(op)
    const reserva = await tx.objectStore('harvestReservas').get(op.id)
    if (reserva)
      await tx.objectStore('harvestReservas').put({
        ...reserva,
        estado: dependiente ? 'BLOQUEADA' : 'RECHAZADA',
        error: mensaje,
        autoridadIncierta
      })
    if (op.tipo === 'REGISTRAR_JABA') {
      const lectura = await tx.objectStore('lecturas').get(op.payload.lecturaId)
      if (lectura)
        await tx
          .objectStore('lecturas')
          .put({ ...lectura, valida: false, estado_sync: 'ERROR', error: mensaje })
    }
    if (op.tipo === 'ASIGNAR_TICKET') {
      const ticket = await tx.objectStore('tickets').get(op.payload.codigoTicket)
      if (ticket?.operacion_id === op.id)
        await tx
          .objectStore('tickets')
          .put({ ...ticket, estado_sync: 'ERROR', error: mensaje })
    }
  }
  async function rechazarEnTx(tx, op, mensaje, autoridadIncierta = false) {
    const operaciones = await tx.objectStore('cola').getAll()
    const visitadas = new Set()
    async function visita(actual, dependiente) {
      if (visitadas.has(actual.id) || actual.estado === 'SINCRONIZADA') return
      visitadas.add(actual.id)
      if (op.retiradaPorCutover) {
        actual.retiradaPorCutover = true
        actual.rechazoHarvest = true
      }
      await invalidar(
        tx,
        actual,
        dependiente ? `Dependencia ${op.id} rechazada: ${mensaje}` : mensaje,
        dependiente,
        !dependiente && autoridadIncierta
      )
      for (const hijo of obtenerOperacionesDependientes(actual, operaciones))
        await visita(hijo, true)
    }
    await visita(op, false)
  }
  async function adoptarV4(tx) {
    if (
      (await tx.objectStore('meta').get(`harvest:${tx.campaniaId}`))?.cutover === null
    )
      return
    const legacy =
      (await tx.objectStore('meta').get(`harvest:${tx.campaniaId}`))?.codigosLegacy ??
      []
    const operaciones = (await tx.objectStore('cola').getAll()).sort((a, b) =>
      a.creado_en.localeCompare(b.creado_en)
    )
    for (const op of operaciones) {
      if (
        op.modelo ||
        op.estado === 'SINCRONIZADA' ||
        (op.payload.campaniaId ?? '') !== tx.campaniaId ||
        !['ASIGNAR_TICKET', 'REGISTRAR_JABA'].includes(op.tipo)
      )
        continue
      const base = await get(tx, 'harvestTickets', op.payload.codigoTicket)
      if (!base || legacy.includes(base.codigo)) continue // Namespace legacy/desconocido/ambiguo: servidor decide.
      op.modelo = 'HARVEST'
      op.origenVersion = 4
      const asignacion = await get(tx, 'harvestAsignaciones', base.loteId)
      const ra = await activa(tx, 'ASIGNACION', base.loteId)
      const tipo = op.tipo === 'ASIGNAR_TICKET' ? 'ASIGNACION' : 'CONSUMO'
      const recurso = tipo === 'ASIGNACION' ? base.loteId : base.codigo
      const trabajador = await tx
        .objectStore('trabajadores')
        .get(op.payload.dniCosechador ?? '')
      const reserva = {
        operacionId: op.id,
        campaniaId: tx.campaniaId,
        tipo,
        recurso,
        trabajadorId: trabajador?.id ?? `DNI:${op.payload.dniCosechador}`,
        trabajadorDni: op.payload.dniCosechador,
        nombre: trabajador?.nombre,
        registroId: op.payload.lecturaId,
        sesionId: op.payload.sesionId,
        fechaHora: op.payload.fechaHora,
        estado: op.estado === 'PENDIENTE' ? 'ACTIVA' : 'RECHAZADA'
      }
      op.dependencias = op.dependencias ?? []
      if (tipo === 'CONSUMO' && ra && !asignacion) op.dependencias.push(ra.operacionId)
      await tx.objectStore('cola').put(op)
      const anterior = await activa(tx, tipo, recurso)
      await tx.objectStore('harvestReservas').put(reserva)
      if (op.estado === 'PENDIENTE' && anterior)
        await rechazarEnTx(tx, op, 'Existe otra intención pendiente para este recurso.')
      else if (op.estado === 'PENDIENTE' && tipo === 'CONSUMO' && !asignacion && !ra)
        await rechazarEnTx(tx, op, 'El lote no tiene asignación efectiva.')
    }
  }
  async function incorporar(tx, snapshot, confirmacion = false) {
    validarSnapshotHarvest(snapshot)
    const campania = await tx.objectStore('meta').get(`campania:${tx.campaniaId}`)
    if (campania) exigirMismoTenant(campania, snapshot)
    const anteriorTenant = await tx.objectStore('meta').get(`harvest:${tx.campaniaId}`)
    if (anteriorTenant) exigirMismoTenant(anteriorTenant, snapshot)
    if (snapshot.campaniaId !== tx.campaniaId)
      throw new Error('La instantánea pertenece a otra campaña.')
    // Hechos confirmados inmutables: una respuesta anterior al ACK no deshace
    // asignaciones/consumos confirmados. No hay API de borrado/reasignación.
    const grupos = [
      [
        'harvestAsignaciones',
        snapshot.asignacionesDeLote,
        'loteId',
        ['operacionId', 'trabajadorId']
      ],
      [
        'harvestRegistros',
        snapshot.registrosCosecha,
        'codigoTicket',
        [
          'id',
          'loteId',
          'trabajadorId',
          'asignacionOperacionId',
          'operacionId',
          'sesionId'
        ]
      ],
      ['harvestLotes', snapshot.lotesDeTickets, 'id', []],
      ['harvestTickets', snapshot.tickets, 'codigo', ['loteId']]
    ]
    const existentes = new Map(
      await Promise.all(
        grupos.map(async ([store, , campo]) => [
          store,
          new Map(
            (await tx.objectStore(store).index('campania').getAll(tx.campaniaId)).map(
              (fila) => [fila[campo], fila]
            )
          )
        ])
      )
    )
    for (const [store, filas, campo, identidad] of grupos) {
      await procesarEnLotes(filas, async (fila) => {
        const anterior = existentes.get(store).get(fila[campo])
        if (
          anterior &&
          identidad.some((clave) => (anterior[clave] ?? null) !== (fila[clave] ?? null))
        )
          throw new Error('La instantánea contradice un hecho confirmado e inmutable.')
        let confirmada = fila
        if (store === 'harvestRegistros') {
          if (
            anterior?.versionProduccion !== undefined &&
            fila.versionProduccion !== undefined &&
            anterior.versionProduccion !== fila.versionProduccion
          )
            throw new Error('La versión productiva confirmada es inmutable.')
          if (
            anterior?.versionProduccion !== undefined &&
            fila.versionProduccion === undefined
          )
            confirmada = { ...fila, versionProduccion: anterior.versionProduccion }
        }
        if (store === 'harvestLotes') {
          const asignacion = existentes.get('harvestAsignaciones').get(fila.id)
          confirmada = {
            ...fila,
            estado: asignacion ? 'ASIGNADO' : 'DISPONIBLE',
            asignacionOperacionId: asignacion?.operacionId ?? null
          }
        } else if (store === 'harvestTickets') {
          const registro = existentes.get('harvestRegistros').get(fila.codigo)
          confirmada = {
            ...fila,
            estado: registro ? 'UTILIZADO' : 'DISPONIBLE',
            registroId: registro?.id ?? null,
            consumoOperacionId: registro?.operacionId ?? null
          }
        }
        confirmada = { ...confirmada, tenantId: tenantDeRecurso(snapshot) }
        existentes.get(store).set(fila[campo], confirmada)
        await tx.objectStore(store).put(confirmada)
      })
    }
    if (!confirmacion) {
      const meta = await tx.objectStore('meta').get(`harvest:${tx.campaniaId}`)
      if (
        meta?.cutover &&
        snapshot.cutover &&
        (meta.cutover.version !== snapshot.cutover.version ||
          meta.cutover.activadoEn !== snapshot.cutover.activadoEn)
      )
        throw new Error('El cutover confirmado es inmutable.')
      const identidades = new Map(
        (meta?.identidadesTrabajadores ?? []).map((w) => [w.id, w])
      )
      for (const w of snapshot.identidadesTrabajadores ?? []) identidades.set(w.id, w)
      await tx.objectStore('meta').put(
        {
          ...meta,
          ...(Object.hasOwn(snapshot, 'cutover')
            ? { cutover: meta?.cutover ?? snapshot.cutover }
            : {}),
          snapshotId: snapshot.snapshotId,
          tenantId: tenantDeRecurso(snapshot),
          obtenidoEn: snapshot.obtenidoEn ?? meta?.obtenidoEn,
          operadorDni: snapshot.operadorDni,
          codigosLegacy: snapshot.codigosLegacy ?? meta?.codigosLegacy ?? [],
          identidadesTrabajadores: [...identidades.values()]
        },
        `harvest:${tx.campaniaId}`
      )
      for (const identidad of identidades.values()) {
        const trabajador = await tx.objectStore('trabajadores').get(identidad.dni)
        await tx
          .objectStore('trabajadores')
          .put({ ...(trabajador ?? { dni: identidad.dni }), id: identidad.id })
      }
    }
    await adoptarV4(tx)
    // Un cliente anterior pudo confirmar un piloto sin conocer su versión.
    // La proyección actual corrige ese conteo sin reabrir el ticket consumido.
    const registros = new Map(
      (
        await tx.objectStore('harvestRegistros').index('campania').getAll(tx.campaniaId)
      ).map((r) => [r.codigoTicket, r])
    )
    for (const lectura of await tx.objectStore('lecturas').getAll()) {
      const registro = registros.get(lectura.codigo_ticket)
      if (
        (lectura.campania_id ?? '') === tx.campaniaId &&
        registro?.versionProduccion === null &&
        (lectura.operacion_id === registro.operacionId ||
          (lectura.registro_confirmado_id ?? lectura.id) === registro.id)
      )
        await tx.objectStore('lecturas').put({ ...lectura, valida: false })
    }
    // No se decide si un pendiente legacy ya fue admitido: eso lo prueba su
    // recibo servidor. Hasta reconciliarlo, no cuenta como producción válida.
    if ((await tx.objectStore('meta').get(`harvest:${tx.campaniaId}`))?.cutover) {
      for (const op of await tx.objectStore('cola').getAll()) {
        if (
          op.tipo !== 'REGISTRAR_JABA' ||
          op.estado !== 'PENDIENTE' ||
          op.modelo === 'HARVEST' ||
          (op.payload.campaniaId ?? '') !== tx.campaniaId ||
          !op.payload.lecturaId
        )
          continue
        const lectura = await tx.objectStore('lecturas').get(op.payload.lecturaId)
        if (lectura)
          await tx
            .objectStore('lecturas')
            .put({ ...lectura, valida: false, revision_corte: true })
      }
    }
    for (const r of await tx
      .objectStore('harvestReservas')
      .index('campania')
      .getAll(tx.campaniaId)) {
      if (r.estado !== 'ACTIVA') continue
      const hecho = await get(
        tx,
        r.tipo === 'ASIGNACION' ? 'harvestAsignaciones' : 'harvestRegistros',
        r.recurso
      )
      if (hecho && hecho.operacionId !== r.operacionId) {
        const op = await tx.objectStore('cola').get(r.operacionId)
        if (op)
          await rechazarEnTx(
            tx,
            op,
            'El servidor confirmó otra operación para este recurso.'
          )
      }
    }
  }
  async function obtener(codigo, campaniaId = obtenerContextoCampania()) {
    const db = conCampania(await dbPromise, campaniaId)
    const tx = db.transaction(storesTransaccion, 'readonly')
    const valor = await estado(tx, codigo)
    await tx.done
    return valor
  }
  async function reservarAsignacion(args) {
    const campaniaId = args.campaniaId ?? obtenerContextoCampania()
    return atomica(campaniaId, async (tx) => {
      const campania = await autorizar(tx, args.dniOperador)
      if (
        (await tx.objectStore('meta').get(`harvest:${tx.campaniaId}`))?.cutover === null
      )
        throw new CampaniaSinCutover()
      await adoptarV4(tx)
      const e = await estado(tx, args.codigoTicket)
      if (e.lote.asignacion) throw new LoteYaAsignado(e.lote.id)
      const actual = await tx.objectStore('trabajadores').get(args.cosechadorDni)
      const trabajador = resolverCosechadorLocal(args.cosechadorDni, actual, campania, {
        permitirProvisional: true
      })
      await tx.objectStore('trabajadores').put(trabajador)
      const op = await crearOperacionEnTx(tx, 'ASIGNAR_TICKET', {
        dniOperador: args.dniOperador,
        dniCosechador: args.cosechadorDni,
        codigoTicket: args.codigoTicket
      })
      op.modelo = 'HARVEST'
      op.origenVersion = 5
      op.dependencias = []
      e.lote.asignar({
        trabajadorId: trabajador.id ?? `DNI:${trabajador.dni}`,
        operacionId: op.id
      })
      await tx.objectStore('cola').put(op)
      await tx.objectStore('harvestReservas').put({
        tenantId: tenantDeRecurso(campania),
        operacionId: op.id,
        campaniaId,
        tipo: 'ASIGNACION',
        recurso: e.lote.id,
        estado: 'ACTIVA',
        trabajadorId: e.lote.asignacion.trabajadorId,
        trabajadorDni: trabajador.dni,
        nombre: trabajador.nombre
      })
      return op
    })
  }
  async function reservarConsumo(args) {
    const campaniaId = args.campaniaId ?? obtenerContextoCampania()
    return atomica(campaniaId, async (tx) => {
      const campania = await autorizar(tx, args.dniOperador)
      if (
        (await tx.objectStore('meta').get(`harvest:${tx.campaniaId}`))?.cutover === null
      )
        throw new CampaniaSinCutover()
      await adoptarV4(tx)
      const sesion = await tx.objectStore('sesiones').get(args.sesionId)
      if (
        !sesion ||
        sesion.estado !== 'ACTIVA' ||
        sesion.campania_id !== campaniaId ||
        sesion.dni_operador !== args.dniOperador
      )
        throw new Error(
          'La sesión no está activa o no corresponde al operador y la campaña.'
        )
      const e = await estado(tx, args.codigoTicket)
      exigirMismoTenant(campania, sesion)
      if (e.ticket.registroCosecha) throw new TicketYaUtilizado(args.codigoTicket)
      const op = await crearOperacionEnTx(tx, 'REGISTRAR_JABA', {
        dniOperador: args.dniOperador,
        sesionId: args.sesionId,
        codigoTicket: args.codigoTicket,
        lecturaId: args.registroId,
        fechaHora: args.fechaHora
      })
      op.modelo = 'HARVEST'
      op.origenVersion = 5
      op.dependencias = []
      if (e.reservaAsignacion) op.dependencias.push(e.reservaAsignacion.operacionId)
      for (const pendiente of await tx.objectStore('cola').getAll()) {
        if (
          pendiente.estado === 'SINCRONIZADA' ||
          (pendiente.payload.campaniaId ?? '') !== campaniaId
        )
          continue
        if (
          (pendiente.tipo === 'INICIAR_SESION' &&
            pendiente.payload.sesionId === args.sesionId) ||
          (pendiente.tipo === 'REGISTRAR_JABERO' &&
            pendiente.payload.dniTrabajador === sesion.dni_jabero)
        ) {
          if (pendiente.estado !== 'PENDIENTE')
            throw new Error('Una dependencia de la sesión fue rechazada.')
          op.dependencias.push(pendiente.id)
        }
      }
      e.ticket.registrarCosecha({
        id: args.registroId,
        lote: e.lote,
        fechaHora: args.fechaHora,
        sesionId: args.sesionId,
        operacionId: op.id
      })
      await tx.objectStore('cola').put(op)
      await tx.objectStore('harvestReservas').put({
        tenantId: tenantDeRecurso(campania),
        operacionId: op.id,
        campaniaId,
        tipo: 'CONSUMO',
        recurso: args.codigoTicket,
        estado: 'ACTIVA',
        registroId: args.registroId,
        fechaHora: args.fechaHora,
        sesionId: args.sesionId
      })
      await tx.objectStore('lecturas').put({
        tenant_id: tenantDeRecurso(campania),
        id: args.registroId,
        sesion_id: args.sesionId,
        codigo_ticket: args.codigoTicket,
        campania_id: campaniaId,
        cosechador_dni: e.proyeccion.cosechador_dni,
        cosechador: e.proyeccion.cosechador,
        trabajador_id: e.lote.asignacion.trabajadorId,
        fecha_hora: args.fechaHora,
        estado_sync: 'PENDIENTE',
        valida: true,
        modelo: 'HARVEST',
        operacion_id: op.id
      })
      return { operacion: op, ticket: e.proyeccion }
    })
  }
  async function confirmar(op, resultado) {
    return atomica(op.payload.campaniaId ?? '', async (tx) => {
      const actual = await tx.objectStore('cola').get(op.id)
      if (!actual || actual.estado === 'SINCRONIZADA') return
      if (resultado?.lote && resultado?.ticket) {
        const { lote, ticket } = resultado
        if (
          lote.campaniaId !== tx.campaniaId ||
          ticket.codigo !== op.payload.codigoTicket ||
          (op.tipo === 'ASIGNAR_TICKET'
            ? lote.asignacion?.operacionId
            : ticket.registroCosecha?.operacionId) !== op.id
        )
          throw new Error('La confirmación no corresponde a la intención local.')
        const r = ticket.registroCosecha
        if (op.tipo === 'REGISTRAR_JABA' && r?.sesionId !== actual.payload.sesionId)
          throw new Error('La confirmación pertenece a otra sesión.')
        const s = {
          tenantId: tenantDeRecurso(
            await tx.objectStore('meta').get(`campania:${tx.campaniaId}`)
          ),
          versionContrato: 1,
          tipo: 'SNAPSHOT',
          completo: true,
          campaniaId: tx.campaniaId,
          operadorDni: op.payload.dniOperador,
          snapshotId: `ack:${op.id}`,
          lotesDeTickets: [
            {
              id: lote.id,
              campaniaId: lote.campaniaId,
              estado: lote.estado,
              asignacionOperacionId: lote.asignacion?.operacionId ?? null
            }
          ],
          asignacionesDeLote: lote.asignacion
            ? [{ ...lote.asignacion, campaniaId: lote.campaniaId }]
            : [],
          tickets: [
            {
              codigo: ticket.codigo,
              loteId: ticket.loteId,
              campaniaId: lote.campaniaId,
              estado: ticket.estado,
              registroId: r?.id ?? null,
              consumoOperacionId: r?.operacionId ?? null
            }
          ],
          registrosCosecha: r ? [{ ...r }] : []
        }
        // El grafo del ACK no sustituye el identificador de un snapshot completo.
        await incorporar(tx, s, true)
        if (op.tipo === 'ASIGNAR_TICKET') {
          const w = await tx.objectStore('trabajadores').get(op.payload.dniCosechador)
          if (w)
            await tx
              .objectStore('trabajadores')
              .put({ ...w, id: lote.asignacion.trabajadorId })
        }
      } else if (
        actual.origenVersion === 5 ||
        (!resultado?.legacy && (await tx.objectStore('harvestReservas').get(op.id)))
      )
        throw new Error('Falta el resultado confirmado del modelo Harvest.')
      const reserva = await tx.objectStore('harvestReservas').get(op.id)
      if (resultado?.legacy && reserva?.tipo === 'ASIGNACION') {
        const operaciones = await tx.objectStore('cola').getAll()
        for (const hijo of obtenerOperacionesDependientes(actual, operaciones))
          await rechazarEnTx(
            tx,
            hijo,
            'La asignación v4 fue confirmada en el modelo legacy, no en Harvest.'
          )
      }
      if (reserva)
        await tx.objectStore('harvestReservas').put({
          ...reserva,
          trabajadorId: resultado?.asignacion?.trabajadorId ?? reserva.trabajadorId,
          estado: resultado?.legacy ? 'COMPATIBILIDAD_LEGACY' : 'CONFIRMADA',
          autoridadIncierta: false
        })
      if (op.tipo === 'REGISTRAR_JABA') {
        const l = await tx.objectStore('lecturas').get(op.payload.lecturaId)
        const registroConfirmado = resultado?.registro
          ? await get(tx, 'harvestRegistros', op.payload.codigoTicket)
          : null
        if (l)
          await tx.objectStore('lecturas').put({
            ...l,
            valida: registroConfirmado?.versionProduccion !== null,
            revision_corte: false,
            estado_sync: 'SINCRONIZADO',
            registro_confirmado_id: resultado?.registro?.id ?? l.id,
            fecha_hora: resultado?.registro?.fechaHora ?? l.fecha_hora,
            trabajador_id: resultado?.registro?.trabajadorId ?? l.trabajador_id,
            error: null
          })
      }
      if (op.tipo === 'ASIGNAR_TICKET') {
        const t = await tx.objectStore('tickets').get(op.payload.codigoTicket)
        if (t?.operacion_id === op.id)
          await tx
            .objectStore('tickets')
            .put({ ...t, estado_sync: 'SINCRONIZADO', error: null })
      }
      await tx.objectStore('cola').put({
        ...actual,
        estado: 'SINCRONIZADA',
        error: null,
        sincronizado_en: new Date().toISOString()
      })
    })
  }
  async function rechazar(op, error) {
    return atomica(op.payload.campaniaId ?? '', async (tx) => {
      const actual = await tx.objectStore('cola').get(op.id)
      if (actual && error.name === 'EscrituraLegacyRetirada') {
        actual.rechazoHarvest = true
        actual.retiradaPorCutover = true
      }
      if (actual)
        await rechazarEnTx(
          tx,
          actual,
          error.message,
          ['LoteYaAsignado', 'TicketYaUtilizado', 'TicketNoEncontrado'].includes(
            error.name
          )
        )
    })
  }
  async function reintentar(op) {
    return atomica(op.payload.campaniaId ?? '', async (tx) => {
      const actual = await tx.objectStore('cola').get(op.id)
      if (!actual || actual.estado !== 'ERROR') return false
      await autorizar(tx, actual.payload.dniOperador)
      for (const id of actual.dependencias ?? []) {
        const padre = await tx.objectStore('cola').get(id)
        if (!padre || padre.estado === 'ERROR') return false
      }
      const r = await tx.objectStore('harvestReservas').get(op.id)
      if (r) {
        const e = await estado(tx, op.payload.codigoTicket)
        if (
          r.tipo === 'ASIGNACION' &&
          e.lote.asignacion?.operacionId !== op.id &&
          e.lote.asignacion
        )
          throw new LoteYaAsignado(e.lote.id)
        if (
          r.tipo === 'CONSUMO' &&
          e.ticket.registroCosecha?.operacionId !== op.id &&
          e.ticket.registroCosecha
        )
          throw new TicketYaUtilizado(op.payload.codigoTicket)
        await tx
          .objectStore('harvestReservas')
          .put({ ...r, estado: 'ACTIVA', autoridadIncierta: false })
      }
      await tx.objectStore('cola').put({
        ...actual,
        estado: 'PENDIENTE',
        error: null,
        bloqueadaPorDependencia: false,
        rechazoHarvest: false
      })
      const l =
        actual.tipo === 'REGISTRAR_JABA'
          ? await tx.objectStore('lecturas').get(actual.payload.lecturaId)
          : null
      if (l)
        await tx
          .objectStore('lecturas')
          .put({ ...l, valida: true, estado_sync: 'PENDIENTE', error: null })
      return true
    })
  }
  return {
    async obtenerModeloOperativo(campaniaId = obtenerContextoCampania()) {
      const meta = await (await dbPromise).get('meta', `harvest:${campaniaId}`)
      return modeloOperativoHarvest(meta?.cutover, campaniaId)
    },
    obtener,
    reservarAsignacion,
    reservarConsumo,
    confirmar,
    rechazar,
    reintentar,
    guardarSnapshot: (s) => atomica(s.campaniaId, (tx) => incorporar(tx, s)),
    incorporarEnTx: incorporar
  }
}
