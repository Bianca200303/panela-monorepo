import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { loteBunques, loteLabel } from '../loteHelpers'
import { PRINT_STYLES, fmtDate, buildFirmasHTML, buildOrdenHeaderHTML, quickDocFileName, escapeHtml, containerExcelRows } from './shared'
import { fetchOrderCertNames } from './registroTrazabilidad'

// Base común de los documentos de CAMPO por orden (ver
// [[project_documentos_campo_por_orden]]): a partir de una orden de planta
// resuelve qué lotes de campo la alimentaron (vía bunques -> insumos de
// homogenizado -> exit_items) y deja listos los IDs/módulos/fechas que cada
// documento de campo usa para filtrar sus propios registros -- directos por
// lote de campo o guía (FCMPTPH, FCPO, FET, FQD) o indirectos por módulo +
// rango de fechas (cloro, limpieza, plagas, etc.).
//
// Reemplaza la búsqueda que antes vivía solo dentro de loadInforme en
// EmbarquePage.jsx. Los kg por lote de envasado salen de loteBunques (la
// porción proporcional de cada bunque repartido), igual que el informe.
//
// Cache por objeto `order`: "Descargar todos" llama fetchData de cada
// documento de campo con la misma orden -- así la base se consulta una sola
// vez. Al recargar la página la orden es otro objeto y se vuelve a consultar.
const contextCache = new WeakMap()

export function fetchFieldContextForOrder(cooperative, order) {
  if (!contextCache.has(order)) {
    const promise = loadFieldContext(cooperative, order)
    promise.catch(() => contextCache.delete(order))
    contextCache.set(order, promise)
  }
  return contextCache.get(order)
}

async function loadFieldContext(cooperative, order) {
  // Un renglón por (lote de envasado, lote de campo) -- si el mismo lote de
  // campo entró en dos bunques del mismo lote, se suma en uno solo.
  const plantBatches = (order?.plant_production_batches ?? []).map(pb => {
    const bunques = loteBunques(pb)
    const inputsByItem = {}
    for (const h of bunques.flatMap(b => b.allocated_inputs)) {
      if (!h.source_exit_item_id) continue
      inputsByItem[h.source_exit_item_id] = (inputsByItem[h.source_exit_item_id] ?? 0) + Number(h.quantity_kg)
    }
    const inputs = Object.entries(inputsByItem).map(([exit_item_id, kg]) => ({ exit_item_id, kg }))
    const totalInputKg = inputs.reduce((s, i) => s + i.kg, 0)
    const processed = bunques.some(b => b.tamizada_kg != null)
    return {
      id: pb.id,
      label: loteLabel(pb),
      brand: pb.brand ?? null,
      inputs,
      totalInputKg,
      proc: processed ? {
        tamizada_kg:  pb.tamizada_kg ?? bunques.reduce((s, b) => s + b.allocated_kg, 0),
        reproceso_kg: bunques.reduce((s, b) => s + b.allocated_reproceso_kg, 0),
        descarte_kg:  bunques.reduce((s, b) => s + b.allocated_descarte_kg, 0),
        merma_kg:     bunques.reduce((s, b) => s + b.allocated_merma_kg, 0),
        processed_at: bunques.map(b => b.processed_at).filter(Boolean).sort().slice(-1)[0] ?? null,
      } : null,
    }
  })

  const exitItemIds = [...new Set(plantBatches.flatMap(pb => pb.inputs.map(i => i.exit_item_id)))]
  const certNames = await fetchOrderCertNames(order.id)
  const empty = {
    plantBatches, certNames, exitItems: {}, evals: {}, receptions: {}, certsByBatch: {},
    prodBatchIds: [], exitRegIds: [], moduleIds: [], modules: [], dateFrom: null, dateTo: null,
  }
  if (exitItemIds.length === 0) return empty

  const [itemsRes, evalsRes, recRes] = await Promise.all([
    supabase
      .from('exit_items')
      .select(`
        id, quantity_kg, bags_count, item_document_number,
        exit_registrations ( id, exit_code, exit_date, document_number, destination ),
        production_batches (
          id, batch_code, harvest_date, process_date, cane_kg, juice_liters, panela_kg, confitillo_kg,
          cachaza_percentage, efficiency_percentage, porcentaje_extraccion, cane_density, observations,
          producers ( id, first_name, last_name, dni, appagrop_code, is_member, coop_modules ( id, name ) ),
          plots ( name, code )
        )
      `)
      .in('id', exitItemIds)
      .eq('cooperative_id', cooperative.id),
    supabase
      .from('quality_evaluations')
      .select('exit_item_id, humidity_pct, impurities_pct, color, sack_condition, appearance, notes')
      .in('exit_item_id', exitItemIds)
      .eq('cooperative_id', cooperative.id),
    supabase
      .from('exit_reception_items')
      .select('exit_item_id, quantity_kg_sent, quantity_kg_received, discrepancy_reason, cert_status, exit_receptions ( received_at )')
      .in('exit_item_id', exitItemIds),
  ])
  for (const r of [itemsRes, evalsRes, recRes]) if (r.error) throw new Error(r.error.message)

  const exitItems = {}
  for (const ei of itemsRes.data ?? []) exitItems[ei.id] = ei
  const evals = {}
  for (const e of evalsRes.data ?? []) evals[e.exit_item_id] = e
  const receptions = {}
  for (const r of recRes.data ?? []) receptions[r.exit_item_id] = r

  const fieldBatches = Object.values(exitItems).map(ei => ei.production_batches).filter(Boolean)
  const prodBatchIds = [...new Set(fieldBatches.map(b => b.id))]
  const exitRegIds = [...new Set(Object.values(exitItems).map(ei => ei.exit_registrations?.id).filter(Boolean))]
  const moduleById = new Map()
  for (const b of fieldBatches) {
    const m = b.producers?.coop_modules
    if (m?.id) moduleById.set(m.id, m)
  }
  const processDates = fieldBatches.map(b => b.process_date).filter(Boolean).sort()

  const certsByBatch = {}
  if (prodBatchIds.length > 0) {
    const { data, error } = await supabase
      .from('production_batch_certs')
      .select('production_batch_id, batch_certs ( name )')
      .in('production_batch_id', prodBatchIds)
    if (error) throw new Error(error.message)
    for (const c of data ?? []) {
      if (!c.batch_certs?.name) continue
      ;(certsByBatch[c.production_batch_id] ??= []).push(c.batch_certs.name)
    }
  }

  return {
    plantBatches,
    certNames,
    exitItems,
    evals,
    receptions,
    certsByBatch,
    prodBatchIds,
    exitRegIds,
    moduleIds: [...moduleById.keys()],
    modules: [...moduleById.values()],
    dateFrom: processDates[0] ?? null,
    dateTo: processDates[processDates.length - 1] ?? null,
  }
}

// ── Armado común de los documentos de campo por orden ──────────────────────
// Mismo encabezado que los documentos de planta (datos de la orden), en vez
// del encabezado de "emisión" (código correlativo, fecha de emisión) que
// usaban los formatos de Reportes -- decisión del usuario: los de campo se
// generan al momento igual que los de planta, sin código.

export function certText(certNames) {
  return certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : '—'
}

export function buildCampoDocHTML(cooperative, order, containerNumber, { key, title, certNames, body, firmantes, styles = '' }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName(key, order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    ${styles}
  </style>
</head>
<body>
  ${buildOrdenHeaderHTML(cooperative, order, certText(certNames), title)}
  ${body}
  <div class="formato-firmas">${buildFirmasHTML(firmantes)}</div>
</body>
</html>`
}

export function campoSinRegistrosHTML(texto) {
  return `<p style="margin-top:12px;font-size:12px">${escapeHtml(texto)}</p>`
}

// Separador de un lote de campo dentro de un documento (un bloque por lote).
export function campoLoteHeaderHTML(batch, extra = '') {
  const p = batch?.producers
  return `<div class="lote-separator">
    <strong>Lote de campo ${escapeHtml(batch?.batch_code) ?? '—'}</strong> · ${escapeHtml(producerName(p)) || '—'}
    · Módulo: ${escapeHtml(p?.coop_modules?.name) ?? '—'} · F. proceso: ${fmtDate(batch?.process_date)}${extra}
  </div>`
}

export function campoExcelHeader(order, certNames, title) {
  return [
    [title],
    ...containerExcelRows(order),
    ['Nº de venta:', order?.sale_number ?? ''],
    ['Producto:', order?.product ?? ''],
    ['Nº orden producción:', order?.client_order_number ?? order?.order_code ?? ''],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    ['Certificación:', certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : ''],
    [],
  ]
}

// sheets: [[nombre de hoja, filas (aoa)], ...]
export function writeCampoExcel(key, order, containerNumber, sheets) {
  const wb = XLSX.utils.book_new()
  for (const [name, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name.slice(0, 31))
  XLSX.writeFile(wb, `${quickDocFileName(key, order, containerNumber)}.xlsx`)
}

export function producerName(producer) {
  return producer ? `${producer.first_name} ${producer.last_name}` : ''
}

// ── Controles por FECHA (cloro, limpieza, inspección, plagas, salud,
// mantenimiento) ─────────────────────────────────────────────────────────────
// No están atados a un lote sino a un módulo y una fecha. Criterio acordado
// con el usuario (2026-10-29): por cada módulo que aportó lotes de campo a
// la orden,
//   - 'dia': los registros de los DÍAS EXACTOS de producción de esos lotes
//     (cloro, limpieza, inspección de ambientes -- se registran a diario);
//   - 'mes': los registros de los MESES de esas fechas de producción
//     (plagas, enfermedades/accidentes, mantenimiento -- no son diarios y
//     con el día exacto casi siempre saldrían vacíos).

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { ym, from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, label: `${MESES[m - 1]} ${y}` }
}

// [{ id, name, dates: ['YYYY-MM-DD'], months: [{ ym, from, to, label }] }]
export function campoModulos(ctx) {
  const byModule = new Map()
  for (const ei of Object.values(ctx.exitItems)) {
    const b = ei.production_batches
    const m = b?.producers?.coop_modules
    if (!m?.id) continue
    if (!byModule.has(m.id)) byModule.set(m.id, { id: m.id, name: m.name, dates: new Set() })
    if (b.process_date) byModule.get(m.id).dates.add(b.process_date)
  }
  return [...byModule.values()]
    .map(m => {
      const dates = [...m.dates].sort()
      return { id: m.id, name: m.name, dates, months: [...new Set(dates.map(d => d.slice(0, 7)))].map(monthRange) }
    })
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

// Registros de `table` por módulo según el criterio ('dia' | 'mes'). Una
// sola consulta para todos los módulos (rango total), luego se reparte y
// filtra por módulo en memoria.
export async function fetchCampoModuloRecords(cooperative, order, { table, select, dateCol, mode, orderBy = [] }) {
  const ctx = await fetchFieldContextForOrder(cooperative, order)
  const modulos = campoModulos(ctx)
  const allDates = modulos.flatMap(m => mode === 'mes' ? m.months.flatMap(r => [r.from, r.to]) : m.dates).sort()
  if (modulos.length === 0 || allDates.length === 0) {
    return { certNames: ctx.certNames, mode, modulos: modulos.map(m => ({ ...m, records: [] })) }
  }

  let q = supabase.from(table).select(`coop_module_id, ${select}`)
    .eq('cooperative_id', cooperative.id)
    .in('coop_module_id', modulos.map(m => m.id))
    .gte(dateCol, allDates[0])
    .lte(dateCol, allDates[allDates.length - 1])
    .order(dateCol)
  for (const col of orderBy) q = q.order(col)
  const { data, error } = await q
  if (error) throw new Error(error.message)

  return {
    certNames: ctx.certNames,
    mode,
    modulos: modulos.map(m => {
      const inPeriod = mode === 'mes'
        ? d => m.months.some(r => d >= r.from && d <= r.to)
        : d => m.dates.includes(d)
      return { ...m, records: (data ?? []).filter(r => r.coop_module_id === m.id && inPeriod(r[dateCol]?.slice(0, 10))) }
    }),
  }
}

export function campoModuloHeaderHTML(mod, mode) {
  const periodo = mode === 'mes'
    ? `Período: ${mod.months.map(r => r.label).join(', ')}`
    : `Fechas de producción: ${mod.dates.map(fmtDate).join(', ')}`
  return `<div class="lote-separator"><strong>Módulo ${escapeHtml(mod.name) ?? '—'}</strong> · ${periodo}</div>`
}

// Cuerpo común: un bloque por módulo, con aviso si ese módulo no tiene
// registros en sus fechas/meses.
export function campoModulosBodyHTML({ mode, modulos }, buildBody, sinRegistros) {
  if (modulos.length === 0) return campoSinRegistrosHTML('La orden no tiene lotes de campo asignados.')
  return modulos.map(m => `<div class="lote-block">${campoModuloHeaderHTML(m, mode)}${
    m.records.length > 0 ? buildBody(m) : campoSinRegistrosHTML(sinRegistros)
  }</div>`).join('')
}
