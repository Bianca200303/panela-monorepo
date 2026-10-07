// Esta app es SIEMPRE CAES -- a diferencia del viejo src/lib/config.js
// (todavía en el web-react raíz, se borra al final de la migración), acá no
// hace falta resolver la cooperativa desde VITE_COOPERATIVE_ID: cada app del
// monorepo ya sabe cuál es la suya por construcción (ver
// [[project overview]] / plan de migración a monorepo).
//
// features: comportamientos propios de CAES. Se mantiene el objeto completo
// (aunque algunos flags dejen de tener efecto una vez que el archivo que los
// leía se separó físicamente por cooperativa en la Fase 4) -- podarlos es
// limpieza de mantenibilidad, no una condición para que esto funcione, y se
// hace incremental a medida que cada consumidor deja de mirarlos (ver Fase 5
// del plan de migración).
export const COOPERATIVE = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  name: 'Cooperativa Agraria Ecológica y Solidaria Piura',
  code: 'CAES',
  logo: '/logos/caes.png',
  ruc: null,
  features: {
    certificacion: false, loteLabel: 'Lote de envasado', loteLabelPorVenta: { exportacion: 'Lote de exportación', nacional: 'Lote nacional' }, bunqueLabel: 'Lote de producción', pallets: false, detectorMetales: false,
    limpiezaUnificada: true, cloroPreparacionMonitoreo: true, higieneGrillaMensual: true, plagasEventosMensuales: true,
    liberacionProductoTerminado: true, controlesPlantaCAES: true, ventaNacionalExportacion: true,
    personalCheckNote: 'Personal *: Revisar el correcto uso del uniforme; uñas y manos limpias; cabello limpio y recogido; sin joyas y accesorios; conducta adecuada; ni signos de enfermedad.',
    precintoPropioLabel: 'Precinto de CAES',
    verificacionLimpiezaLabel: 'Inspección de Ambientes, Equipos y Personal',
    verificacionLimpiezaTab: 'Inspección Ambientes',
    verificacionLimpiezaNombre: 'inspección',
  },
}

export const COOPERATIVE_ID = COOPERATIVE.id
