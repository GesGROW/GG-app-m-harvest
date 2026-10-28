export function mensajeErrorTickets(error, codigoTicket = error?.codigoTicket) {
  if (error?.name === 'LoteYaAsignado') {
    const codigo = /^C(\d{6})\d{2}$/.exec(String(codigoTicket ?? ''))?.[1]
    return codigo
      ? `El lote de tickets ${codigo} ya está asignado.`
      : 'Este lote de tickets ya está asignado.'
  }
  if (error?.name === 'TicketYaUtilizado')
    return `El ticket ${codigoTicket} ya está registrado.`
  return error?.message || 'No se pudo completar la operación.'
}
