import { supabase } from '../supabase'
import { escapeHtml } from './shared'
import { fetchFieldContextForOrder, buildCampoDocHTML, campoSinRegistrosHTML, campoLoteHeaderHTML, campoExcelHeader, writeCampoExcel, producerName } from './campoOrden'

export const FORMAT_TITLE_FCPO = 'FORMATO DE CONTROL DE PERSONAL OPERARIO'

export const WORK_AREA_LABELS = {
  M:   'Molienda',
  // Mismos nombres que la app móvil (WorkArea), que es donde se registran.
  H:   'Cámara de combustión (hornero)',
  TT:  'Tratamiento Térmico',
  TEA: 'Tamizado, Empaque y Almacenamiento',
  rr:  'Otros',
}

const FCPO_CRITERIA = [
  { key: 'uniform_complete',  label: 'Uniforme completo' },
  { key: 'no_makeup',         label: 'Sin maquillaje' },
  { key: 'nails_short_clean', label: 'Uñas cortas limpias' },
  { key: 'nails_no_polish',   label: 'Uñas no esmaltadas' },
  { key: 'hands_clean',       label: 'Manos limpias' },
  { key: 'no_jewelry',        label: 'Sin joyas / accesorios' },
  { key: 'hair_covered',      label: 'Cabello cubierto' },
  { key: 'no_beard',          label: 'Sin barba' },
  { key: 'no_wounds',         label: 'Sin heridas / cortes' },
]

// Cuerpo del FCPO (tablas por área + resumen de cumplimiento), compartido
// entre la versión emitida de Reportes y la versión por orden de abajo.
export function buildFcpoAreasHTML(areas) {
  const totalWorkers   = areas.reduce((s, a) => s + (a.items?.length ?? 0), 0)
  const totalCriteria  = totalWorkers * FCPO_CRITERIA.length
  const totalCompliant = areas.reduce((s, a) =>
    s + (a.items ?? []).reduce((si, w) =>
      si + FCPO_CRITERIA.filter(c => w[c.key]).length, 0), 0)
  const pctCumple = totalCriteria > 0 ? (totalCompliant / totalCriteria * 100).toFixed(1) : '—'

  const areaBlocks = areas.map(area => {
    const areaLabel = WORK_AREA_LABELS[area.work_area] ?? area.work_area
    const workers   = area.items ?? []
    const criteriaHeaders = FCPO_CRITERIA.map(c =>
      `<th style="font-size:9px;white-space:nowrap;writing-mode:vertical-rl;transform:rotate(180deg);padding:4px 2px;max-height:80px">${c.label}</th>`
    ).join('')
    const workerRows = workers.length > 0
      ? workers.map((w, i) => {
          const cells = FCPO_CRITERIA.map(c =>
            `<td style="text-align:center;font-weight:700;color:${w[c.key] ? '#166534' : '#991b1b'}">${w[c.key] ? '✓' : '✗'}</td>`
          ).join('')
          const nonCompliant = FCPO_CRITERIA.filter(c => !w[c.key]).map(c => c.label)
          return `<tr>
            <td style="text-align:center">${i + 1}</td>
            <td>${w.worker_name ?? '—'}</td>
            ${cells}
            <td style="font-size:9px;color:#555">${nonCompliant.length > 0 ? nonCompliant.join(', ') : '—'}</td>
          </tr>`
        }).join('')
      : `<tr><td colspan="${FCPO_CRITERIA.length + 3}" style="text-align:center;color:#999;font-style:italic">Sin trabajadores registrados</td></tr>`

    const areaTotal     = workers.length * FCPO_CRITERIA.length
    const areaCompliant = workers.reduce((s, w) => s + FCPO_CRITERIA.filter(c => w[c.key]).length, 0)
    const areaPct       = areaTotal > 0 ? (areaCompliant / areaTotal * 100).toFixed(0) : '—'

    return `
      <div class="section-label" style="margin-top:14px">Área: ${areaLabel.toUpperCase()}</div>
      <table class="formato-table">
        <thead>
          <tr>
            <th style="width:28px">#</th>
            <th style="text-align:left;min-width:120px">Nombre del trabajador</th>
            ${criteriaHeaders}
            <th style="font-size:9px;min-width:80px">No conformidades</th>
          </tr>
        </thead>
        <tbody>${workerRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="font-weight:700;font-size:10px">Cumplimiento del área</td>
            <td colspan="${FCPO_CRITERIA.length}" style="text-align:center;font-weight:700;color:${Number(areaPct) >= 90 ? '#166534' : '#991b1b'}">${areaPct}%</td>
            <td style="text-align:center;font-size:10px">${workers.length} trabajador(es)</td>
          </tr>
        </tfoot>
      </table>
      ${area.observations ? `<div style="font-size:10px;margin-top:3px;color:#555"><strong>Obs. área:</strong> ${escapeHtml(area.observations)}</div>` : ''}
    `
  }).join('')

  return `${areaBlocks}

  <div style="margin-top:12px;padding:6px 8px;background:#f0f0f0;border:1px solid #ccc;font-size:11px;display:flex;gap:32px">
    <span><strong>Total trabajadores evaluados:</strong> ${totalWorkers}</span>
    <span><strong>Total criterios:</strong> ${FCPO_CRITERIA.length} por trabajador</span>
    <span><strong>Cumplimiento global:</strong> <strong style="color:${Number(pctCumple) >= 90 ? '#166534' : '#991b1b'}">${pctCumple}%</strong></span>
  </div>`
}

// ── Versión por ORDEN (pestaña Campo de Documentos) ─────────────────────────
// Un bloque por lote de campo de la orden que tenga control de personal
// registrado (worker_controls, se carga desde el celular por lote).
export async function fetchFcpoOrdenData(cooperative, order) {
  const ctx = await fetchFieldContextForOrder(cooperative, order)
  if (ctx.prodBatchIds.length === 0) return { certNames: ctx.certNames, lotes: [] }

  const { data, error } = await supabase
    .from('worker_controls')
    .select('production_batch_id, work_area, observations, worker_control_items ( worker_name, uniform_complete, no_makeup, nails_short_clean, nails_no_polish, hands_clean, no_jewelry, hair_covered, no_beard, no_wounds )')
    .in('production_batch_id', ctx.prodBatchIds)
    .eq('cooperative_id', cooperative.id)
    .order('work_area')
  if (error) throw new Error(error.message)

  const areasByBatch = {}
  for (const wc of data ?? []) {
    ;(areasByBatch[wc.production_batch_id] ??= []).push({ work_area: wc.work_area, observations: wc.observations, items: wc.worker_control_items ?? [] })
  }
  const batchById = {}
  for (const ei of Object.values(ctx.exitItems)) if (ei.production_batches) batchById[ei.production_batches.id] = ei.production_batches
  const lotes = Object.entries(areasByBatch)
    .map(([batchId, areas]) => ({ batch: batchById[batchId], areas }))
    .sort((a, b) => (a.batch?.process_date ?? '').localeCompare(b.batch?.process_date ?? ''))
  return { certNames: ctx.certNames, lotes }
}

export function fcpoOrdenPdf(cooperative, order, containerNumber, { certNames, lotes }, firmantes) {
  return buildCampoDocHTML(cooperative, order, containerNumber, {
    key: 'fcpo',
    title: FORMAT_TITLE_FCPO,
    certNames,
    firmantes,
    styles: '.formato-table th { vertical-align: bottom; }',
    body: lotes.length > 0
      ? lotes.map(l => `<div class="lote-block">${campoLoteHeaderHTML(l.batch)}${buildFcpoAreasHTML(l.areas)}</div>`).join('')
      : campoSinRegistrosHTML('Ningún lote de campo de esta orden tiene control de personal registrado.'),
  })
}

export function fcpoOrdenExcel(cooperative, order, containerNumber, { certNames, lotes }) {
  const rows = [...campoExcelHeader(order, certNames, FORMAT_TITLE_FCPO), [
    'Lote de campo', 'Productor', 'Módulo', 'F. proceso', 'Área', 'Trabajador', ...FCPO_CRITERIA.map(c => c.label), 'No conformidades', 'Obs. área',
  ]]
  for (const { batch, areas } of lotes) {
    for (const area of areas) {
      for (const w of area.items) {
        rows.push([
          batch?.batch_code ?? '', producerName(batch?.producers), batch?.producers?.coop_modules?.name ?? '', batch?.process_date ?? '',
          WORK_AREA_LABELS[area.work_area] ?? area.work_area, w.worker_name ?? '',
          ...FCPO_CRITERIA.map(c => w[c.key] ? '✓' : '✗'),
          FCPO_CRITERIA.filter(c => !w[c.key]).map(c => c.label).join(', '),
          area.observations ?? '',
        ])
      }
    }
  }
  writeCampoExcel('fcpo', order, containerNumber, [['Control de personal', rows]])
}
