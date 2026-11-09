import { supabase } from './supabase'

// Controles de planta por lote. Es la misma lista que muestra OrderCard en
// cada etapa del lote, y depende de la cooperativa:
//   - Norandino: Pesos y sellado + Objetos extraños (detectorMetales). Son
//     formularios con estado: cuentan solo si alguno quedó 'terminado'.
//   - CAES (controlesPlantaCAES): Monitoreo del Tamizado, Sellado/Envasado y
//     Hermeticidad. Son registros sueltos: cuenta con que haya al menos uno.
// `key` es lo que usa OrderCard para saber qué modal abrir; `stage` dice en
// qué etapa del lote se muestra (tamizado | envasado).
export function controlsFor(cooperative) {
  const f = cooperative?.features ?? {}
  if (f.controlesPlantaCAES) {
    return [
      { key: 'monitoreoTamizado', stage: 'tamizado', label: 'Monitoreo del Tamizado', table: 'plant_sieve_monitoring_caes' },
      { key: 'selladoEnvasado', stage: 'envasado', label: 'Sellado, Envasado y Empaque', table: 'plant_packaging_seal_control_caes' },
      { key: 'hermeticidad', stage: 'envasado', label: 'Hermeticidad de Envases', table: 'plant_container_tightness_control_caes' },
    ]
  }
  return [
    { key: 'pesosSellado', stage: 'envasado', label: 'Pesos y sellado', table: 'plant_batch_weight_seal_forms', withStatus: true },
    ...(f.detectorMetales
      ? [{ key: 'objetosExtranos', stage: 'envasado', label: 'Objetos extraños', table: 'plant_batch_foreign_object_forms', withStatus: true }]
      : []),
  ]
}

// Estado de cada control para varios lotes a la vez (una consulta por tabla,
// no una por lote). Devuelve { [batchId]: { [key]: { count, state } } } con
// state: 'ok' | 'sin_registro' | 'sin_terminar'. Si una consulta falla, ese
// control queda fuera (state undefined): mejor no mostrar que mostrar algo falso.
export async function getLoteControlStatus(cooperative, batchIds) {
  const controls = controlsFor(cooperative)
  const byBatch = Object.fromEntries(batchIds.map(id => [id, {}]))
  if (batchIds.length === 0) return byBatch
  const results = await Promise.all(controls.map(c =>
    supabase
      .from(c.table)
      .select(c.withStatus ? 'plant_batch_id, status' : 'plant_batch_id')
      .in('plant_batch_id', batchIds)
  ))
  controls.forEach((c, i) => {
    const { data, error } = results[i]
    if (error) return
    for (const id of batchIds) {
      const rows = (data ?? []).filter(r => r.plant_batch_id === id)
      const state = rows.length === 0
        ? 'sin_registro'
        : c.withStatus && !rows.some(r => r.status === 'terminado') ? 'sin_terminar' : 'ok'
      byBatch[id][c.key] = { count: rows.length, state }
    }
  })
  return byBatch
}

// Devuelve [{ label, reason }] con los controles que faltan para el lote.
// reason: 'sin_registro' | 'sin_terminar'. No bloquea el cierre -- solo
// alimenta el aviso (ver OrderCard.jsx).
export async function getPendingLoteControls(cooperative, plantBatchId) {
  const status = (await getLoteControlStatus(cooperative, [plantBatchId]))[plantBatchId]
  return controlsFor(cooperative)
    .filter(c => status[c.key] && status[c.key].state !== 'ok')
    .map(c => ({ label: c.label, reason: status[c.key].state }))
}
