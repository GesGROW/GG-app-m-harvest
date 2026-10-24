import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CatalogoDeTickets,
  DatoDeTicketsInvalido,
  LoteDeTickets,
  LoteDeTicketsDuplicado,
  Ticket,
  TicketDuplicado,
  crearGenerarLotesDeTickets,
  crearResolverCatalogoDeTickets
} from '@gesgrow/core/contexts/harvest/index.js'

function preparar(cambios = {}) {
  let secuencia = 0
  const guardados = []
  const codigos = []
  const generar = crearGenerarLotesDeTickets({
    generarIdLote: () => `LT-${++secuencia}`,
    generadorCodigoTicket: {
      generar: async (contexto) => {
        codigos.push(contexto)
        return `CODIGO-${contexto.indice}`
      }
    },
    repositorioTickets: {
      guardarLotesConTickets: async (generacion) => guardados.push(generacion)
    },
    ...cambios
  })
  return { generar, guardados, codigos }
}

for (const [cantidadTickets, tamanioLote, tamaniosEsperados] of [
  [40, 10, [10, 10, 10, 10]],
  [12, 5, [5, 5, 2]],
  [3, 8, [3]],
  [5, 1, [1, 1, 1, 1, 1]],
  [1, 1, [1]]
]) {
  test(`generación ${cantidadTickets}/${tamanioLote}: cantidades, tamaño configurable y lote final`, async () => {
    const { generar, guardados, codigos } = preparar()
    const resultado = await generar({
      campaniaId: ' C-1 ',
      cantidadTickets,
      tamanioLote
    })
    assert.equal(resultado.lotes.length, tamaniosEsperados.length)
    assert.equal(resultado.tickets.length, cantidadTickets)
    assert.equal(
      new Set(resultado.tickets.map((ticket) => ticket.codigo)).size,
      cantidadTickets
    )
    assert.deepEqual(
      resultado.lotes.map(
        (lote) => resultado.tickets.filter((ticket) => ticket.loteId === lote.id).length
      ),
      tamaniosEsperados
    )
    assert.ok(resultado.catalogo instanceof CatalogoDeTickets)
    assert.ok(
      resultado.lotes.every(
        (lote) =>
          lote instanceof LoteDeTickets &&
          lote.campaniaId === 'C-1' &&
          lote.estado === 'DISPONIBLE'
      )
    )
    assert.ok(
      resultado.tickets.every(
        (ticket) => ticket instanceof Ticket && ticket.estado === 'DISPONIBLE'
      )
    )
    assert.equal(guardados.length, 1)
    assert.strictEqual(guardados[0].lotes, resultado.lotes)
    assert.strictEqual(guardados[0].tickets, resultado.tickets)
    assert.equal(guardados[0].campaniaId, 'C-1')
    assert.deepEqual(
      codigos.map((contexto) => contexto.indice),
      Array.from({ length: cantidadTickets }, (_, i) => i)
    )
    for (const contexto of codigos) {
      assert.equal(contexto.campaniaId, 'C-1')
      assert.equal(contexto.loteId, resultado.tickets[contexto.indice].loteId)
    }
  })
}

test('el formato de código se sustituye por contrato sin cambiar Application ni Domain', async () => {
  const { generar } = preparar({
    generadorCodigoTicket: { generar: ({ indice }) => `OTRO FORMATO / ${indice}` }
  })
  const resultado = await generar({
    campaniaId: 'C',
    cantidadTickets: 2,
    tamanioLote: 2
  })
  assert.deepEqual(
    resultado.tickets.map((ticket) => ticket.codigo),
    ['OTRO FORMATO / 0', 'OTRO FORMATO / 1']
  )
})

test('parámetros inválidos se rechazan antes de generar o persistir', async () => {
  const { generar, guardados, codigos } = preparar()
  for (const campo of ['cantidadTickets', 'tamanioLote']) {
    for (const valor of [
      0,
      -1,
      1.5,
      Infinity,
      NaN,
      '10',
      undefined,
      Number.MAX_SAFE_INTEGER + 1
    ])
      await assert.rejects(
        generar({
          campaniaId: 'C',
          cantidadTickets: 2,
          tamanioLote: 1,
          [campo]: valor
        }),
        DatoDeTicketsInvalido
      )
  }
  await assert.rejects(
    generar({ campaniaId: ' ', cantidadTickets: 2, tamanioLote: 1 }),
    DatoDeTicketsInvalido
  )
  assert.deepEqual(guardados, [])
  assert.deepEqual(codigos, [])
})

test('errores del generador y códigos duplicados no guardan lotes parciales', async () => {
  const fallo = new Error('Generador indisponible')
  for (const [generadorCodigoTicket, esperado] of [
    [
      {
        generar: ({ indice }) => {
          if (indice === 2) throw fallo
          return `T-${indice}`
        }
      },
      (error) => error === fallo
    ],
    [{ generar: () => 'REPETIDO' }, TicketDuplicado],
    [{ generar: () => '' }, DatoDeTicketsInvalido]
  ]) {
    const { generar, guardados } = preparar({ generadorCodigoTicket })
    await assert.rejects(
      generar({ campaniaId: 'C', cantidadTickets: 4, tamanioLote: 2 }),
      esperado
    )
    assert.deepEqual(guardados, [])
  }
})

test('identidades de lote duplicadas no llegan a persistencia', async () => {
  const { generar, guardados } = preparar({ generarIdLote: () => 'MISMO' })
  await assert.rejects(
    generar({ campaniaId: 'C', cantidadTickets: 2, tamanioLote: 1 }),
    LoteDeTicketsDuplicado
  )
  assert.deepEqual(guardados, [])
})

test('el caso espera confirmación atómica y propaga el rechazo de persistencia sin éxito', async () => {
  let rechazar
  let termino = false
  const fallo = new Error('Rollback')
  const { generar } = preparar({
    repositorioTickets: {
      guardarLotesConTickets: () =>
        new Promise((_, reject) => {
          rechazar = reject
        })
    }
  })
  const pendiente = generar({
    campaniaId: 'C',
    cantidadTickets: 2,
    tamanioLote: 1
  }).then((valor) => {
    termino = true
    return valor
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(termino, false)
  rechazar(fallo)
  await assert.rejects(pendiente, (error) => error === fallo)
  assert.equal(termino, false)
})

test('la resolución delega una consulta por campaña/código y devuelve el catálogo del puerto', async () => {
  const { generar } = preparar()
  const { catalogo } = await generar({
    campaniaId: 'C',
    cantidadTickets: 1,
    tamanioLote: 1
  })
  const consultas = []
  const resolver = crearResolverCatalogoDeTickets({
    repositorioTickets: {
      resolverCatalogoPorCodigo: async (consulta) => {
        consultas.push(consulta)
        return catalogo
      }
    }
  })
  assert.strictEqual(
    await resolver({ campaniaId: ' C ', codigoTicket: ' T ' }),
    catalogo
  )
  assert.deepEqual(consultas, [{ campaniaId: 'C', codigoTicket: 'T' }])
  await assert.rejects(
    resolver({ campaniaId: '', codigoTicket: 'T' }),
    DatoDeTicketsInvalido
  )
  assert.equal(consultas.length, 1)
})
