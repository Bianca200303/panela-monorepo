// Esta app es SIEMPRE Norandino -- a diferencia del viejo src/lib/config.js
// (todavía en el web-react raíz, se borra al final de la migración), acá no
// hace falta resolver la cooperativa desde VITE_COOPERATIVE_ID: cada app del
// monorepo ya sabe cuál es la suya por construcción.
//
// features: comportamientos propios de Norandino. Se mantiene el objeto
// completo (aunque algunos flags dejen de tener efecto una vez que el
// archivo que los leía se separó físicamente por cooperativa en la Fase 4)
// -- podarlos es limpieza de mantenibilidad, no una condición para que esto
// funcione, y se hace incremental a medida que cada consumidor deja de
// mirarlos (ver Fase 5 del plan de migración).
export const COOPERATIVE = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Cooperativa Agraria Norandino',
  code: 'NORANDINO',
  logo: '/logos/norandino.png',
  ruc: '20525416543',
  features: {
    certificacion: true, loteLabel: 'Lote', bunqueLabel: 'Bunque', pallets: true, detectorMetales: true,
    limpiezaUnificada: false, cloroPreparacionMonitoreo: false, higieneGrillaMensual: false, plagasEventosMensuales: false,
    liberacionProductoTerminado: false, controlesPlantaCAES: false, ventaNacionalExportacion: false,
    personalCheckNote: 'Personal *: Revisar correcto uso del uniforme, uñas y manos limpias, cabello limpio y recogido, sin joyas y accesorios, conducta adecuada, sin maquillaje.',
    precintoPropioLabel: 'Precinto de Norandino',
    verificacionLimpiezaLabel: 'Verificación de Limpieza y Sanitización',
    verificacionLimpiezaTab: 'Verificación Limpieza',
    verificacionLimpiezaNombre: 'verificación',
  },
}

export const COOPERATIVE_ID = COOPERATIVE.id
