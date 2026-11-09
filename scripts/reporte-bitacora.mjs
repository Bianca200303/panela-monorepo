// Bitácora de cambios (quién creó, modificó o eliminó qué, y cuándo) en un
// Excel. Web y celular.
//
//   npm run reporte-bitacora -- --desde 2026-11-01 --hasta 2026-11-30
//   npm run reporte-bitacora -- --buscar TEST-0002
//   npm run reporte-bitacora -- --usuario "Ana" --tabla plant_orders
//
// Todas las opciones son opcionales:
//   --desde / --hasta  AAAA-MM-DD, hora de Perú
//   --usuario          parte del nombre
//   --tabla            nombre técnico de la tabla (acepta % como comodín)
//   --buscar           texto dentro del registro o de sus cambios (código de
//                      orden, de lote, DNI, etc.)
//
// Necesita web-react/.env.reporte (ver lib-reporte.mjs).

import { serviceClient, readArgs, PLATAFORMA, fecha, sheet, newBook, addSheet, saveBook } from './lib-reporte.mjs'

const LIMITE = 50000

const ACCION = { INSERT: 'Creó', UPDATE: 'Modificó', DELETE: 'Eliminó' }

const TABLAS = {
  producers: 'Productores', plots: 'Parcelas', users: 'Usuarios (celular)', web_users: 'Usuarios (web)',
  user_module_assignments: 'Módulos asignados', coop_modules: 'Módulos', producer_quotas: 'Cupos de producción',
  production_batches: 'Producción (lotes de campo)', production_batch_harvest_dates: 'Fechas de corte',
  batch_temperatures: 'Temperaturas de lote', batch_ph_controls: 'Control de pH', batch_certs: 'Certificaciones de lote',
  production_batch_certs: 'Certificaciones de lote', exit_registrations: 'Salidas', exit_items: 'Salidas: ítems',
  exit_receptions: 'Recepción', exit_reception_items: 'Recepción: ítems', quality_evaluations: 'Evaluación de calidad',
  product_returns: 'Devoluciones', stowage_transport_inspections: 'Inspección de estiba y transporte',
  environment_inspections: 'Inspección de ambientes', cleaning_disinfections: 'Limpieza y desinfección (campo)',
  chlorine_residual_controls: 'Cloro residual (campo)', pest_controls: 'Control de plagas (campo)',
  health_incidents: 'Enfermedades y accidentes', worker_controls: 'Control de personal operario',
  equipment_maintenance_records: 'Mantenimiento de equipos', certified_workers: 'Trabajadores certificados',
  campaigns: 'Campañas', plant_clients: 'Clientes', plant_brand_catalog: 'Marcas', plant_product_catalog: 'Productos',
  plant_presentation_catalog: 'Presentación por cliente', plant_personnel: 'Personal de planta',
  plant_orders: 'Órdenes', plant_production_batches: 'Lotes de envasado', plant_batch_bunques: 'Bunques / lotes de producción',
  plant_bunque_batch_allocations: 'Reparto de bunques', plant_homogenization_inputs: 'Materia prima del bunque',
  plant_containers: 'Contenedores', plant_dispatches: 'Despachos', plant_dispatch_items: 'Despachos: lotes',
  plant_container_loadings: 'Carga de contenedor', plant_container_loading_pallets: 'Carga: pallets',
  plant_container_loading_people: 'Carga: personas', plant_packing_list_nacional_caes: 'Packing list nacional',
  plant_transport_unit_controls_caes: 'Control de unidad de transporte',
  plant_batch_weight_seal_forms: 'Control de pesos y sellado', plant_batch_foreign_object_forms: 'Objetos extraños',
  plant_packaging_seal_control_caes: 'Sellado de envasado', plant_container_tightness_control_caes: 'Hermeticidad',
  plant_sieve_monitoring_caes: 'Monitoreo de tamiz', plant_hygiene_controls: 'Higiene del personal',
  plant_hygiene_controls_caes: 'Higiene del personal', plant_cleaning_controls: 'Limpieza de ambientes',
  plant_equipment_cleaning_controls: 'Limpieza de equipos', plant_general_cleaning_controls: 'Limpieza general',
  plant_cleaning_verification_controls: 'Verificación / inspección de limpieza',
  plant_chlorine_residual_controls: 'Cloro residual (planta)', plant_chlorine_controls_caes: 'Cloro residual (planta)',
  plant_pest_controls: 'Control de plagas (planta)', plant_pest_controls_caes: 'Control de plagas (planta)',
  plant_balance_calibration_caes: 'Calibración de balanzas', plant_temp_humidity_control_caes: 'Temperatura y humedad',
  plant_handwashing_controls_caes: 'Lavado de manos', plant_solution_prep_controls_caes: 'Preparación de soluciones',
  plant_waste_management_caes: 'Manejo de residuos', form_configurations: 'Configuración de formularios',
  cooperatives: 'Cooperativas',
}
const tabla = (t) => TABLAS[t] ?? t

// Campos que identifican al registro, en orden de preferencia, para que la
// fila se entienda sin abrir el JSON.
const IDENTIFICADORES = ['order_code', 'batch_code', 'code', 'bunque_number', 'container_number', 'comprobante',
  'document_number', 'name', 'username', 'user_id', 'dni', 'first_name', 'last_name', 'fecha', 'date']

const valor = (v) => {
  if (v === null || v === undefined || v === '') return '(vacío)'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const recorta = (s) => (s.length > 32000 ? `${s.slice(0, 32000)}…` : s)

function identifica(row) {
  if (!row) return ''
  return IDENTIFICADORES.filter(k => row[k] !== null && row[k] !== undefined && row[k] !== '')
    .slice(0, 3).map(k => `${k}: ${valor(row[k])}`).join(' · ')
}

function detalle(r) {
  if (r.accion === 'UPDATE') {
    return recorta(Object.entries(r.cambios ?? {})
      .map(([campo, { antes, despues }]) => `${campo}: ${valor(antes)} → ${valor(despues)}`)
      .join('; '))
  }
  return recorta(JSON.stringify(r.datos ?? {}))
}

const args = readArgs(['desde', 'hasta', 'usuario', 'tabla', 'buscar'])
const db = serviceClient()

const rows = await db.rpc('reporte_bitacora', {
  p_desde: args.desde,
  p_hasta: args.hasta,
  p_tabla: args.tabla,
  p_usuario: args.usuario,
  p_buscar: args.buscar,
  p_limite: LIMITE,
})
if (rows.length === LIMITE) console.warn(`Se alcanzó el límite de ${LIMITE} movimientos: acote el período o los filtros.`)

const wb = newBook()

addSheet(wb, sheet(rows, [
  ['fecha', 'Fecha y hora', fecha],
  ['cooperativa', 'Cooperativa'],
  ['plataforma', 'Plataforma', v => PLATAFORMA[v] ?? v],
  ['usuario', 'Usuario'],
  ['rol', 'Rol'],
  ['accion', 'Acción', v => ACCION[v] ?? v],
  ['tabla', 'Qué', tabla],
  ['datos', 'Registro', (v, r) => identifica(r.datos) || r.registro],
  ['cambios', 'Detalle', (v, r) => detalle(r)],
  ['tabla', 'Tabla (técnico)'],
  ['registro', 'Id del registro'],
]), 'Movimientos')

function resumen(keyFn, labelCols) {
  const map = new Map()
  for (const r of rows) {
    const key = keyFn(r)
    const acc = map.get(key) ?? { ...labelCols(r), INSERT: 0, UPDATE: 0, DELETE: 0, ultimo: r.fecha }
    acc[r.accion] += 1
    if (r.fecha > acc.ultimo) acc.ultimo = r.fecha
    map.set(key, acc)
  }
  return [...map.values()].sort((a, b) => (b.INSERT + b.UPDATE + b.DELETE) - (a.INSERT + a.UPDATE + a.DELETE))
}

const conteos = [
  ['INSERT', 'Creó'],
  ['UPDATE', 'Modificó'],
  ['DELETE', 'Eliminó'],
  ['ultimo', 'Último movimiento', fecha],
]

addSheet(wb, sheet(
  resumen(r => `${r.cooperativa}|${r.plataforma}|${r.usuario}`, r => ({ cooperativa: r.cooperativa, plataforma: r.plataforma, usuario: r.usuario, rol: r.rol })),
  [['cooperativa', 'Cooperativa'], ['plataforma', 'Plataforma', v => PLATAFORMA[v] ?? v], ['usuario', 'Usuario'], ['rol', 'Rol'], ...conteos],
), 'Por usuario')

addSheet(wb, sheet(
  resumen(r => `${r.cooperativa}|${r.tabla}`, r => ({ cooperativa: r.cooperativa, tabla: r.tabla })),
  [['cooperativa', 'Cooperativa'], ['tabla', 'Qué', tabla], ['tabla', 'Tabla (técnico)'], ...conteos],
), 'Por tipo de registro')

const filtros = [args.usuario && `usuario ${args.usuario}`, args.tabla && `tabla ${args.tabla}`, args.buscar && `"${args.buscar}"`].filter(Boolean)
saveBook(wb, `Bitácora ${args.desde ?? 'inicio'} a ${args.hasta ?? new Date().toISOString().slice(0, 10)}${filtros.length ? ` (${filtros.join(', ')})` : ''}.xlsx`
  .replace(/[\\/:*?"<>|]/g, ''))
