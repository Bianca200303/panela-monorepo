import { supabase } from './supabase'

// Campañas productivas (Catálogos → Campañas). Cada una tiene un periodo
// (start_date..end_date, inclusive); sin fechas la BD pone el año completo y
// no permite que dos campañas de la cooperativa se crucen
// (20261108120000_cupos_por_campana.sql). Los cupos son por campaña y un
// lote cuenta en la campaña que contiene su fecha de proceso.
// Fechas como texto 'YYYY-MM-DD' (comparables como texto, sin zona horaria).

export const formatIsoDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '')

export const campaignPeriod = (c) => `${formatIsoDate(c.start_date)} al ${formatIsoDate(c.end_date)}`

// Hoy en hora local (no UTC: de noche en Perú UTC ya es "mañana").
export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Campañas de la cooperativa, la más reciente primero.
export async function fetchCampaigns(cooperativeId) {
  const { data, error } = await supabase.from('campaigns')
    .select('id, year, start_date, end_date, is_active')
    .eq('cooperative_id', cooperativeId)
    .order('start_date', { ascending: false })
  if (error) throw error
  return data ?? []
}

export const campaignForDate = (campaigns, iso) =>
  campaigns.find(c => c.start_date <= iso && iso <= c.end_date) ?? null

// La que se muestra al entrar: la que contiene hoy; si no, la activa; si
// no, la más reciente.
export const defaultCampaign = (campaigns) =>
  campaignForDate(campaigns, todayIso()) ?? campaigns.find(c => c.is_active) ?? campaigns[0] ?? null

// La campaña inmediatamente anterior (para "Copiar de la campaña anterior").
export const previousCampaign = (campaigns, campaign) =>
  campaigns
    .filter(c => c.end_date < campaign.start_date)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? null

// Huecos entre campañas consecutivas: días que no pertenecen a ninguna
// (un lote con esa fecha no cuenta para ningún cupo). [{ from, to }]
export function campaignGaps(campaigns) {
  const sorted = [...campaigns].sort((a, b) => a.start_date.localeCompare(b.start_date))
  const gaps = []
  for (let i = 1; i < sorted.length; i++) {
    const from = addDaysIso(sorted[i - 1].end_date, 1)
    if (from < sorted[i].start_date) gaps.push({ from, to: addDaysIso(sorted[i].start_date, -1) })
  }
  return gaps
}
