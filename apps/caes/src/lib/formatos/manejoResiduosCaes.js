import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, fmtDate, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_MANEJO_RESIDUOS_CAES = 'MANEJO DE RESIDUOS'

// Manejo de Residuos (CAESP-PP-HYS-RE-MDR-001) -- SOLO CAES, ver
// COOPERATIVE.features.controlesPlantaCAES en lib/config.js. Registro
// plano (fecha+hora) -- ver ManejoResiduosCaesPage.jsx.
export const CLASIFICACION_ITEMS = [
  { code: 'es_organico', label: 'Orgánicos' },
  { code: 'es_aprovechable', label: 'Aprovechable' },
  { code: 'es_no_aprovechable', label: 'No aprovechable' },
  { code: 'es_peligroso', label: 'Peligrosos' },
]

export async function fetchManejoResiduosCaesData(order) {
  const fechaDesde = order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null
  const fechaHasta = order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null
  if (!fechaDesde || !fechaHasta) return { rows: [] }

  const { data, error } = await supabase
    .from('plant_waste_management_caes')
    .select('control_date, control_time, es_organico, es_aprovechable, es_no_aprovechable, es_peligroso, origen_residuo, cantidad_bolsas, disposicion_recolector_municipal, disposicion_otro, observacion')
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
  if (error) throw new Error(error.message)

  return { rows: data ?? [] }
}

function disposicionLabel(r) {
  if (r.disposicion_recolector_municipal) return 'Recolector Municipal'
  if (r.disposicion_otro) return `Otro: ${r.disposicion_otro}`
  return '—'
}

export function buildPrintHTMLManejoResiduosCaes(order, containerNumber, data, firmantes) {
  const { rows } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  const bodyRows = rows.map(r => `<tr>
      <td style="text-align:center;font-size:9px">${fmtDate(r.control_date)}</td>
      <td style="text-align:center;font-size:9px">${r.control_time ?? '—'}</td>
      ${CLASIFICACION_ITEMS.map(item => `<td style="text-align:center;font-size:9px">${r[item.code] ? '✓' : ''}</td>`).join('')}
      <td style="font-size:9px">${escapeHtml((r.origen_residuo ?? []).join(', ')) || '—'}</td>
      <td style="text-align:right;font-size:9px">${r.cantidad_bolsas ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(disposicionLabel(r))}</td>
      <td style="font-size:9px">${escapeHtml(r.observacion) ?? ''}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('manejo_residuos_caes', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
    .formato-table th { font-size: 9px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${COOPERATIVE?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_MANEJO_RESIDUOS_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${rows.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron registros de manejo de residuos en el rango de fechas de trabajo de esta orden.</p>'
    : `<table class="formato-table" style="width:100%">
        <thead><tr>
          <th>Fecha</th><th>Hora</th>
          ${CLASIFICACION_ITEMS.map(item => `<th>${item.label}</th>`).join('')}
          <th style="text-align:left">Origen</th><th>Cant. (bolsas)</th><th style="text-align:left">Disposición final</th><th style="text-align:left">Observación</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>`}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function manejoResiduosCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLManejoResiduosCaes(order, containerNumber, data, firmantes)
}

export function manejoResiduosCaesExcel(order, containerNumber, { rows }) {
  const aoa = [
    [FORMAT_TITLE_MANEJO_RESIDUOS_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
    ['Fecha', 'Hora', ...CLASIFICACION_ITEMS.map(i => i.label), 'Origen', 'Cant. (bolsas)', 'Disposición final', 'Observación'],
  ]
  for (const r of rows) {
    aoa.push([
      r.control_date, r.control_time ?? '',
      ...CLASIFICACION_ITEMS.map(item => r[item.code] ? 'X' : ''),
      (r.origen_residuo ?? []).join(', '), r.cantidad_bolsas ?? '', disposicionLabel(r), r.observacion ?? '',
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Manejo Residuos')
  XLSX.writeFile(wb, `${quickDocFileName('manejo_residuos_caes', order, containerNumber)}.xlsx`)
}
