import { supabase } from './supabase'
import { formatDate } from './loteHelpers'

// Validación de las fechas del flujo de una orden de producción
// (tamizado/envasado inicio y fin):
//  1. Orden lógico: fin ≥ inicio, y el envasado no empieza antes del tamizado.
//  2. Ninguna puede ser anterior a la recepción (acopio) de la materia prima
//     que usa la orden. La materia prima se asigna después de crear la orden
//     (al repartir bunques), así que esto se revisa al editar la orden y al
//     guardar un bunque con reparto a lotes.

const DATE_FIELDS = [
  ['tamizado_fecha_inicio', 'inicio del tamizado'],
  ['tamizado_fecha_fin',    'fin del tamizado'],
  ['envasado_fecha_inicio', 'inicio del envasado'],
  ['envasado_fecha_fin',    'fin del envasado'],
]

// Timestamp (received_at) → "YYYY-MM-DD" en hora local.
export function toLocalDateStr(ts) {
  if (!ts) return null
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function orderDateSequenceError(dates) {
  const { tamizado_fecha_inicio: ti, tamizado_fecha_fin: tf, envasado_fecha_inicio: ei, envasado_fecha_fin: ef } = dates
  if (ti && tf && tf < ti) return 'El fin del tamizado no puede ser anterior a su inicio.'
  if (ei && ef && ef < ei) return 'El fin del envasado no puede ser anterior a su inicio.'
  if (ti && ei && ei < ti) return 'El envasado no puede empezar antes que el tamizado.'
  return null
}

export function orderDatesBeforeReceptionError(dates, receptionDate, orderName = null) {
  if (!receptionDate) return null
  for (const [key, label] of DATE_FIELDS) {
    if (dates[key] && dates[key] < receptionDate) {
      const de = orderName ? ` de la orden ${orderName}` : ''
      return `La fecha de ${label}${de} (${formatDate(dates[key])}) no puede ser anterior a la recepción de la materia prima (${formatDate(receptionDate)}).`
    }
  }
  return null
}

// Fecha de la recepción más reciente de la materia prima de las guías
// (exit_items) indicadas, o null si no hay.
export async function fetchLatestReceptionDate(exitItemIds) {
  const ids = [...new Set(exitItemIds.filter(Boolean))]
  if (ids.length === 0) return null
  const { data, error } = await supabase
    .from('exit_reception_items')
    .select('exit_receptions ( received_at )')
    .in('exit_item_id', ids)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map(r => toLocalDateStr(r.exit_receptions?.received_at))
    .filter(Boolean)
    .sort()
    .pop() ?? null
}

// Recepción más reciente de la materia prima que ya usa la orden
// (lotes → reparto de bunques → materia prima del bunque).
export async function fetchOrderLatestReceptionDate(orderId) {
  const { data, error } = await supabase
    .from('plant_production_batches')
    .select('plant_bunque_batch_allocations ( bunque:plant_batch_bunques ( plant_homogenization_inputs ( source_exit_item_id ) ) )')
    .eq('order_id', orderId)
  if (error) throw new Error(error.message)
  const ids = (data ?? []).flatMap(b => (b.plant_bunque_batch_allocations ?? [])
    .flatMap(a => (a.bunque?.plant_homogenization_inputs ?? []).map(i => i.source_exit_item_id)))
  return fetchLatestReceptionDate(ids)
}
