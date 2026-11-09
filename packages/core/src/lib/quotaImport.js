import { supabase } from './supabase'
import { findHeaderRow, normalizeText, parseNumberCell } from './excelImport'
import { fetchAllRows } from './fetchAllRows'

// Importación de cupos por parcela × certificación desde Excel/CSV (web → Cupos).
//
// Formato: UNA FILA POR PARCELA y UNA COLUMNA POR CERTIFICACIÓN de la
// cooperativa ("Orgánica (kg)", "SPP (kg)", ...). Cada celda es el cupo de
// esa parcela en esa certificación:
//   - con número → se crea el cupo o se actualiza el existente;
//   - vacía → no se toca (no borra un cupo ya cargado).
// La parcela se reconoce por CÓDIGO o, si no viene, por DNI + nombre.
// Las columnas salen de las certificaciones activas: si la cooperativa
// agrega una, aparece sola en la plantilla.
// Aquí solo se valida; el guardado es el RPC import_plot_quotas (todo o nada).

// Columnas de identificación (texto normalizado, ver normalizeText).
const ID_COLUMNS = {
  code: ['codigo parcela', 'codigo de parcela', 'cod parcela', 'codigo'],
  dni: ['dni', 'dni productor'],
  plot: ['parcela', 'nombre parcela', 'nombre de parcela'],
  producer: ['productor', 'nombre productor', 'nombre del productor'],
  module: ['modulo'],
}

// Clave de un cupo (es único por parcela + certificación + año).
export const quotaKey = (plotId, certId) => `${plotId}|${certId}`

// Excel borra los ceros de adelante de un DNI escrito como número.
export const normalizeDni = (v) => {
  const s = String(v ?? '').replace(/\s/g, '')
  return /^\d{1,7}$/.test(s) ? s.padStart(8, '0') : s
}
const normalizeCode = (v) => String(v ?? '').trim().toUpperCase()

// Cupos de una campaña con su consumo (pueden ser más de 1000: por páginas).
export const fetchQuotasByCampaign = (campaignId) =>
  fetchAllRows(() => supabase.rpc('get_plot_quotas_by_campaign', { p_campaign_id: campaignId }))

// Producción del año SIN cupo: parcela × certificación con lotes y sin cupo,
// solo en certificaciones que la cooperativa maneja con cupo (RPC
// get_production_without_quota, misma regla que el aviso del celular).
export const fetchProductionWithoutQuota = (campaignId) =>
  fetchAllRows(() => supabase.rpc('get_production_without_quota', { p_campaign_id: campaignId }))

// Lotes con fecha de proceso fuera de toda campaña (no cuentan para ningún
// cupo hasta que se ajusten las fechas de las campañas).
export const fetchProductionOutsideCampaign = () =>
  fetchAllRows(() => supabase.rpc('get_production_outside_campaign'))

// Parcelas activas (de productores activos) de la cooperativa.
export async function fetchActivePlots(cooperativeId) {
  const all = await fetchAllRows(() => supabase.from('plots')
    .select('id, name, code, producer_id, producers!inner ( first_name, last_name, dni, cooperative_id, is_active, coop_module_id, coop_modules ( name ) )')
    .eq('is_active', true)
    .eq('producers.cooperative_id', cooperativeId)
    .eq('producers.is_active', true)
    .order('id'))
  return all.map(p => ({
    id: p.id,
    name: p.name,
    code: p.code,
    producerId: p.producer_id,
    producerName: `${p.producers.first_name} ${p.producers.last_name}`,
    dni: p.producers.dni,
    moduleId: p.producers.coop_module_id,
    moduleName: p.producers.coop_modules?.name ?? '',
  })).sort((a, b) => a.producerName.localeCompare(b.producerName) || a.name.localeCompare(b.name))
}

// ── Hoja de cupos (plantilla y "Exportar Excel": mismo formato) ───────────

const certColumnLabel = (cert) => `${cert.name} (kg)`

// Columnas: datos de la parcela + una por certificación.
export function quotaSheetColumns(certs) {
  return [
    { label: 'Productor', value: r => r.producerName },
    { label: 'DNI', value: r => r.dni },
    { label: 'Módulo', value: r => r.moduleName },
    { label: 'Parcela', value: r => r.name },
    { label: 'Código parcela', value: r => r.code },
    ...certs.map(c => ({ label: certColumnLabel(c), value: r => r.cupoByCert.get(c.id) ?? '' })),
  ]
}

// Filas: una por parcela, con su cupo actual en cada certificación.
//   plots: [{ id, name, code, producerName, dni, moduleName }]
//   quotas: cupos de la campaña (get_plot_quotas_by_campaign)
export function quotaSheetRows(plots, quotas) {
  const byPlot = new Map()
  for (const q of quotas) {
    if (!byPlot.has(q.plot_id)) byPlot.set(q.plot_id, new Map())
    byPlot.get(q.plot_id).set(q.cert_id, Number(q.cupo_kg))
  }
  return plots.map(p => ({ ...p, cupoByCert: byPlot.get(p.id) ?? new Map() }))
}

// ── Avisos por posibles errores de digitación (no bloquean) ───────────────
// Se usan en la importación y en el formulario de cupo.
//   previousKg: cupo actual (null si es nuevo)
//   usedKg: panela ya registrada contra ese cupo
//   referenceKg: cupo típico de la cooperativa (mediana), o null
const BIG_CHANGE = 3
const OUTLIER = 5
export function quotaWarnings({ cupoKg, previousKg = null, usedKg = 0, referenceKg = null }) {
  const warnings = []
  if (previousKg > 0 && (cupoKg >= previousKg * BIG_CHANGE || cupoKg <= previousKg / BIG_CHANGE)) {
    warnings.push(`cambia mucho respecto del cupo actual (${fmtKg(previousKg)} kg)`)
  }
  if (usedKg > cupoKg) {
    warnings.push(`queda por debajo de lo ya usado (${fmtKg(usedKg)} kg)`)
  }
  if (referenceKg > 0 && cupoKg >= referenceKg * OUTLIER) {
    warnings.push(`es mucho mayor que el cupo habitual (${fmtKg(referenceKg)} kg)`)
  }
  return warnings
}

const fmtKg = (n) => Number(n).toLocaleString('es-PE', { maximumFractionDigits: 2 })

// Mediana de los cupos; null si hay muy pocos para comparar.
export function typicalQuotaKg(values) {
  const v = values.filter(n => n > 0).sort((a, b) => a - b)
  if (v.length < 5) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

// ── Validación del archivo ────────────────────────────────────────────────

// Devuelve { error } si el archivo no sirve, o
// { ready, errors, skipped, unchanged, ignoredColumns }:
//   ready: [{ rowNum, plot, cert, cupoKg, previousKg, usedKg, warnings }]
//     (un cupo por item; solo los nuevos o que cambian)
//   errors: [{ rowNum, message }]
//   skipped: filas de parcela sin ningún cupo escrito
//   unchanged: cupos iguales a los ya cargados (la plantilla los trae
//     llenos): no se envían
//   ignoredColumns: encabezados que no son datos de la parcela ni una certificación
export function validateQuotaRows(rows, { plots, certs, quotas }) {
  const certKey = (c) => `cert:${c.id}`
  const columns = {
    ...ID_COLUMNS,
    ...Object.fromEntries(certs.map(c => {
      const n = normalizeText(c.name)
      return [certKey(c), [n, `cupo ${n}`]]
    })),
  }
  const header = findHeaderRow(rows, columns, ['code']) ?? findHeaderRow(rows, columns, ['dni', 'plot'])
  if (!header) {
    return { error: 'El archivo debe tener la columna "Código parcela", o las columnas "DNI" y "Parcela". Use la plantilla.' }
  }
  const { headerIndex, colIndex } = header
  const certCols = certs.filter(c => certKey(c) in colIndex)
  if (certCols.length === 0) {
    return { error: `El archivo no tiene columnas de certificación (${certs.map(certColumnLabel).join(', ')}). Use la plantilla.` }
  }
  const known = new Set(Object.values(colIndex))
  const ignoredColumns = rows[headerIndex]
    .map((h, i) => (known.has(i) || String(h).trim() === '' ? null : String(h).trim()))
    .filter(Boolean)

  const byCode = new Map(plots.filter(p => p.code).map(p => [normalizeCode(p.code), p]))
  const byDni = new Map()
  for (const p of plots) {
    const k = normalizeDni(p.dni)
    if (!byDni.has(k)) byDni.set(k, [])
    byDni.get(k).push(p)
  }
  const previous = new Map(quotas.map(q => [quotaKey(q.plot_id, q.cert_id), q]))

  const cell = (row, key) => (key in colIndex ? row[colIndex[key]] : '')
  const ready = []
  const errors = []
  const seenPlot = new Map() // plot.id → fila donde apareció
  let skipped = 0
  let unchanged = 0

  rows.slice(headerIndex + 1).forEach((row, i) => {
    const rowNum = headerIndex + i + 2 // número de fila como lo ve Excel
    if (row.every(c => String(c).trim() === '')) return
    const fail = (message) => errors.push({ rowNum, message })

    const filled = certCols.filter(c => String(cell(row, certKey(c))).trim() !== '')
    if (filled.length === 0) { skipped++; return }

    // Parcela
    const code = normalizeCode(cell(row, 'code'))
    const dni = normalizeDni(cell(row, 'dni'))
    const plotName = String(cell(row, 'plot')).trim()
    let plot
    if (code) {
      plot = byCode.get(code)
      if (!plot) return fail(`la parcela con código ${code} no existe o está de baja`)
      if (dni && normalizeDni(plot.dni) !== dni) return fail(`la parcela ${code} no es del DNI ${dni}`)
    } else {
      if (!dni || !plotName) return fail('falta el código de parcela, o el DNI y la parcela')
      const producerPlots = byDni.get(dni)
      if (!producerPlots) return fail(`el DNI ${dni} no existe o no tiene parcelas activas`)
      const matches = producerPlots.filter(p => normalizeText(p.name) === normalizeText(plotName))
      if (matches.length === 0) return fail(`la parcela "${plotName}" no es del DNI ${dni}`)
      if (matches.length > 1) return fail(`el DNI ${dni} tiene varias parcelas "${plotName}"; use el código de parcela`)
      plot = matches[0]
    }
    if (seenPlot.has(plot.id)) {
      return fail(`la parcela ${plot.name} (${plot.producerName}) ya está en la fila ${seenPlot.get(plot.id)}`)
    }
    seenPlot.set(plot.id, rowNum)

    // Un cupo por cada certificación escrita. Si una celda está mal, la
    // fila entera queda con error (no se importa a medias).
    const rowReady = []
    const rowErrors = []
    let rowUnchanged = 0
    for (const cert of filled) {
      const raw = cell(row, certKey(cert))
      const cupoKg = parseNumberCell(raw)
      if (Number.isNaN(cupoKg) || cupoKg <= 0) {
        rowErrors.push(`${cert.name}: "${raw}" no es un número mayor a 0`)
        continue
      }
      const rounded = Math.round(cupoKg * 100) / 100
      const prev = previous.get(quotaKey(plot.id, cert.id))
      if (prev && Number(prev.cupo_kg) === rounded) { rowUnchanged++; continue }
      rowReady.push({
        rowNum,
        plot,
        cert,
        cupoKg: rounded,
        previousKg: prev ? Number(prev.cupo_kg) : null,
        usedKg: prev ? Number(prev.acumulado_kg) : 0,
      })
    }
    if (rowErrors.length) return fail(rowErrors.join('; '))
    ready.push(...rowReady)
    unchanged += rowUnchanged
  })

  // Cupo habitual: el del archivo junto con los ya cargados que no cambian.
  const replaced = new Set(ready.map(r => quotaKey(r.plot.id, r.cert.id)))
  const referenceKg = typicalQuotaKg([
    ...ready.map(r => r.cupoKg),
    ...quotas.filter(q => !replaced.has(quotaKey(q.plot_id, q.cert_id))).map(q => Number(q.cupo_kg)),
  ])
  for (const r of ready) r.warnings = quotaWarnings({ ...r, referenceKg })

  return { ready, errors, skipped, unchanged, ignoredColumns }
}

// Las notas no van en el archivo: el RPC conserva las que ya tenga el cupo.
export async function importQuotas(campaignId, ready) {
  const { data, error } = await supabase.rpc('import_plot_quotas', {
    p_campaign_id: campaignId,
    p_rows: ready.map(r => ({ plot_id: r.plot.id, batch_cert_id: r.cert.id, cupo_kg: r.cupoKg, notes: null })),
  })
  if (error) throw error
  return data
}
