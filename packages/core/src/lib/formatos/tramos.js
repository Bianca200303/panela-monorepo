import { supabase } from '../supabase'

// Guías de remisión y placa del camión: viven SOLO en los tramos
// (plant_transport_unit_controls_caes = un camión en un viaje). Este módulo
// es la única forma en que los documentos las leen -- nunca se piden ni se
// copian en otro lugar, para que no puedan quedar distintas.
//
// Cada tramo: GR CAES (remitente), GR transportista (opcional, puede llegar
// tarde), si es el tramo final (llega al destino) y los lotes que van en ese
// camión.

const TRAMO_SELECT = `id, control_date, created_at, lugar_partida, lugar_destino,
  guia_remision, guia_remision_transportista, es_tramo_final,
  transportista_razon_social, chofer_nombre, vehiculo_placa,
  lotes:plant_transport_unit_control_lotes_caes ( plant_batch_id )`

export async function fetchTramos(containerId) {
  if (!containerId) return []
  const { data, error } = await supabase
    .from('plant_transport_unit_controls_caes')
    .select(TRAMO_SELECT)
    .eq('container_id', containerId)
    .order('control_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))]

// Resumen para documentos que muestran una línea por dato (Orden de Salida).
export function summarizeTramos(tramos) {
  return {
    grCaes:       uniq(tramos.map(t => t.guia_remision)),
    grTransp:     uniq(tramos.map(t => t.guia_remision_transportista)),
    empresas:     uniq(tramos.map(t => t.transportista_razon_social)),
    conductores:  uniq(tramos.map(t => t.chofer_nombre)),
    placas:       uniq(tramos.map(t => t.vehiculo_placa)),
  }
}

export const tramoFinal = (tramos) => tramos.find(t => t.es_tramo_final) ?? null

// plant_batch_id → tramos en los que viajó ese lote (normalmente uno).
export function tramosPorLote(tramos) {
  const map = {}
  for (const t of tramos) {
    for (const l of t.lotes ?? []) (map[l.plant_batch_id] ??= []).push(t)
  }
  return map
}

export const tramoRuta = (t) => `${t.lugar_partida ?? '—'} → ${t.lugar_destino ?? '—'}`
