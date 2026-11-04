export function crearConfiguracionConsultas(vistas) {
  return {
    asignacion: {
      titulo: 'Asignación de tickets',
      vistaOperativa: vistas.asignacion,
      opciones: [
        { etiqueta: 'Operar', operativa: true },
        {
          id: 'asignados-hoy',
          etiqueta: 'Asignados hoy',
          titulo: 'Asignados hoy',
          descripcion: 'Tickets asignados durante el día de hoy.',
          columnas: ['Cosechador', 'Ticket', 'Hora'],
          vacio: 'No hay tickets asignados hoy.'
        }
      ]
    },
    jaberos: {
      titulo: 'Registro de jaberos',
      vistaOperativa: vistas.jaberos,
      opciones: [
        { etiqueta: 'Registrar', operativa: true },
        {
          id: 'jaberos-campania',
          etiqueta: 'Jaberos de campaña',
          titulo: 'Jaberos de campaña',
          descripcion: 'Listado de campaña con búsqueda por nombre o DNI.',
          columnas: ['Jabero', 'DNI', 'Estado'],
          vacio: 'No hay jaberos registrados en esta campaña.'
        }
      ]
    },
    lectura: {
      titulo: 'Lectura de jabas',
      vistaOperativa: vistas.lectura,
      opciones: [
        { etiqueta: 'Escanear', operativa: true },
        {
          id: 'cosechadores-jabas',
          etiqueta: 'Cosechadores y jabas',
          titulo: 'Cosechadores y jabas',
          descripcion: 'Resumen de producción de la sesión.',
          columnas: ['Cosechador', 'Jabas', 'Última'],
          columnasNumericas: ['Jabas'],
          chips: ['Más jabas', 'Recientes', 'A–Z'],
          vacio: 'Aún no se han registrado jabas en esta sesión.'
        },
        {
          id: 'sesiones-lectura',
          etiqueta: 'Sesiones',
          titulo: 'Sesiones',
          descripcion: 'Sesiones registradas localmente en este dispositivo.',
          columnas: ['Jabero / lote', 'Jabas', 'Estado'],
          columnasNumericas: ['Jabas'],
          chips: ['Todas', 'Activas', 'Cerradas'],
          vacio: 'No hay sesiones registradas en este dispositivo.'
        }
      ]
    }
  }
}
