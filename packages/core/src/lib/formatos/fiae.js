import { supabase } from '../supabase'
import { escapeHtml, fmtDate } from './shared'
import { buildCampoDocHTML, campoExcelHeader, writeCampoExcel, fetchCampoModuloRecords, campoModulosBodyHTML } from './campoOrden'

export const FORMAT_TITLE_FIAE = 'FORMATO DE INSPECCIÓN DE AMBIENTES, EQUIPO Y PERSONAL'

const FIAE_AREA_ORDER = [
  'reception_milling', 'thermal_treatment', 'sieving_packing',
  'warehouses', 'dressing_rooms', 'restrooms', 'cleaning_implements', 'reservoir',
]
const FIAE_AREA_LABELS = {
  reception_milling:   'Recepción de Materia Prima — Molienda — Secado de Bagazo',
  thermal_treatment:   'Tratamiento Térmico',
  sieving_packing:     'Tamizado y Envasado',
  warehouses:          'Almacenes',
  dressing_rooms:      'Vestuarios',
  restrooms:           'Servicios Higiénicos',
  cleaning_implements: 'Implementos de Limpieza',
  reservoir:           'Reservorio',
}

// Cuerpo del formato (sin el encabezado de emisión), compartido entre la
// versión emitida de Reportes y la versión por orden (pestaña Campo).
export function buildFiaeBodyHTML(items) {

  const byArea = {}
  ;(items ?? []).forEach(it => {
    if (!byArea[it.area_code]) byArea[it.area_code] = []
    byArea[it.area_code].push(it)
  })

  const totalItems  = items?.length ?? 0
  const conformes   = (items ?? []).filter(i => i.condition === 'compliant').length
  const noConformes = totalItems - conformes
  const pct = totalItems > 0 ? Math.round(conformes / totalItems * 100) : 0

  const areaSections = FIAE_AREA_ORDER
    .filter(code => byArea[code]?.length > 0)
    .map((code, aIdx) => {
      const label = FIAE_AREA_LABELS[code] ?? code
      const rows = byArea[code].map((it, i) => {
        const ok = it.condition === 'compliant'
        const stateColor = ok ? '#166534' : '#dc2626'
        return `<tr>
          <td style="text-align:center;width:30px">${i + 1}</td>
          <td>${it.item_description ?? it.item_code}</td>
          <td style="text-align:center;font-size:15px;color:${stateColor}">${ok ? '✓' : '✗'}</td>
          <td style="text-align:center;font-weight:700;color:${stateColor}">${ok ? 'Conforme' : 'No Conforme'}</td>
          <td style="font-size:10px">${it.corrective_actions ?? '—'}</td>
          <td style="font-size:10px">${escapeHtml(it.observations) ?? '—'}</td>
        </tr>`
      }).join('')
      return `<div style="margin-bottom:8px">
        <div style="background:#374151;color:#fff;padding:4px 8px;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">
          ${aIdx + 1}. ${label}
        </div>
        <table class="formato-table">
          <thead>
            <tr><th>N°</th><th style="text-align:left;min-width:160px">Ítem</th>
              <th style="width:30px"></th><th>Estado</th>
              <th>Acciones correctivas</th><th>Observaciones</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
    }).join('')

  return `  <div style="margin-top:10px">${areaSections}</div>
  <div style="margin-top:8px;padding:6px 8px;background:#f0f0f0;border:1px solid #ccc;font-size:11px;display:flex;gap:32px">
    <span><strong>Total ítems:</strong> ${totalItems}</span>
    <span><strong>Conformes:</strong> <span style="color:#166534;font-weight:700">${conformes}</span></span>
    <span><strong>No Conformes:</strong> <span style="color:#dc2626;font-weight:700">${noConformes}</span></span>
    <span><strong>Cumplimiento:</strong> <strong style="color:${pct >= 90 ? '#166534' : '#b45309'}">${pct}%</strong></span>
  </div>`
}

// ── Versión por ORDEN (pestaña Campo de Documentos) ─────────────────────────
// Por módulo, las inspecciones de los días exactos de producción (una
// sub-sección por inspección, igual que el formato emitido de Reportes que
// era de una sola inspección).
export async function fetchFiaeOrdenData(cooperative, order) {
  const data = await fetchCampoModuloRecords(cooperative, order, {
    table: 'environment_inspections',
    select: 'id, inspection_date',
    dateCol: 'inspection_date',
    mode: 'dia',
  })
  const ids = data.modulos.flatMap(m => m.records.map(r => r.id))
  if (ids.length === 0) return data
  const { data: items, error } = await supabase
    .from('environment_inspection_items')
    .select('environment_inspection_id, area_code, item_code, item_description, condition, corrective_actions, observations')
    .in('environment_inspection_id', ids)
  if (error) throw new Error(error.message)
  return {
    ...data,
    modulos: data.modulos.map(m => ({
      ...m,
      records: m.records.map(r => ({ ...r, items: (items ?? []).filter(i => i.environment_inspection_id === r.id) })),
    })),
  }
}

export function fiaeOrdenPdf(cooperative, order, containerNumber, data, firmantes) {
  return buildCampoDocHTML(cooperative, order, containerNumber, {
    key: 'fiae', title: FORMAT_TITLE_FIAE, certNames: data.certNames, firmantes,
    body: campoModulosBodyHTML(data, m => m.records.map(r => `
      <div class="section-label" style="margin-top:8px">Inspección del ${fmtDate(r.inspection_date)}</div>
      ${buildFiaeBodyHTML(r.items)}`).join(''), 'Sin inspecciones en las fechas de producción.'),
  })
}

export function fiaeOrdenExcel(cooperative, order, containerNumber, data) {
  const rows = [...campoExcelHeader(order, data.certNames, FORMAT_TITLE_FIAE),
    ['Módulo', 'Fecha de inspección', 'Área', 'Ítem', 'Estado', 'Acciones correctivas', 'Observaciones']]
  for (const m of data.modulos) for (const r of m.records) for (const it of r.items) {
    rows.push([m.name, r.inspection_date, FIAE_AREA_LABELS[it.area_code] ?? it.area_code, it.item_description ?? it.item_code,
      it.condition === 'compliant' ? 'Conforme' : 'No conforme', it.corrective_actions ?? '', it.observations ?? ''])
  }
  writeCampoExcel('fiae', order, containerNumber, [['Inspección de ambientes', rows]])
}
