import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, fmtDate, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_CALIBRACION_BALANZAS_CAES = 'VERIFICACIÓN INTERNA DE CALIBRACIÓN DE BALANZAS'

// Verificación Interna de Calibración de Balanzas (CAESP-CC-PP-BPM-RE-MYC-002)
// -- SOLO CAES, ver COOPERATIVE.features.controlesPlantaCAES en
// lib/config.js. Registro plano por (fecha, balanza), 5 lecturas fijas
// P1-P5 -- ver CalibracionBalanzasCaesPage.jsx.
export const READING_POINTS = ['p1', 'p2', 'p3', 'p4', 'p5']
export const ESTADO_LABELS = { conforme: 'Conforme', no_conforme: 'No conforme' }

export async function fetchCalibracionBalanzasCaesData(order) {
  const fechaDesde = order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null
  const fechaHasta = order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null
  if (!fechaDesde || !fechaHasta) return { rows: [] }

  const { data, error } = await supabase
    .from('plant_balance_calibration_caes')
    .select('control_date, balance_code, area, equipment_name, error_maximo_permitido, peso_patron, p1_peso, p1_error, p2_peso, p2_error, p3_peso, p3_error, p4_peso, p4_error, p5_peso, p5_error, error_promedio, estado, acciones_correctivas')
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
  if (error) throw new Error(error.message)

  return { rows: data ?? [] }
}

export function buildPrintHTMLCalibracionBalanzasCaes(order, containerNumber, data, firmantes) {
  const { rows } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  const bodyRows = rows.map(r => `<tr>
      <td style="text-align:center;font-size:9px">${fmtDate(r.control_date)}</td>
      <td style="font-size:9px">${escapeHtml(r.balance_code) ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(r.area) ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(r.equipment_name) ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${escapeHtml(r.error_maximo_permitido) ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${escapeHtml(r.peso_patron) ?? '—'}</td>
      ${READING_POINTS.map(p => `<td style="text-align:center;font-size:9px">${r[`${p}_peso`] ?? '—'} / ${r[`${p}_error`] ?? '—'}</td>`).join('')}
      <td style="text-align:center;font-size:9px">${r.error_promedio ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${ESTADO_LABELS[r.estado] ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(r.acciones_correctivas) ?? ''}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('calibracion_balanzas_caes', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
    .formato-table th { font-size: 8px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${COOPERATIVE?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_CALIBRACION_BALANZAS_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${rows.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron registros de calibración de balanzas en el rango de fechas de trabajo de esta orden.</p>'
    : `<div style="overflow-x:auto"><table class="formato-table" style="min-width:100%">
        <thead><tr>
          <th>Fecha</th><th>Código</th><th>Área</th><th>Equipo</th><th>Error máx.</th><th>Pesa patrón</th>
          ${READING_POINTS.map(p => `<th>${p.toUpperCase()} (peso/error)</th>`).join('')}
          <th>Error prom.</th><th>Estado</th><th style="text-align:left">Acciones Correctivas</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table></div>`}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function calibracionBalanzasCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLCalibracionBalanzasCaes(order, containerNumber, data, firmantes)
}

export function calibracionBalanzasCaesExcel(order, containerNumber, { rows }) {
  const aoa = [
    [FORMAT_TITLE_CALIBRACION_BALANZAS_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
    ['Fecha', 'Código', 'Área', 'Equipo', 'Error máx.', 'Pesa patrón', ...READING_POINTS.flatMap(p => [`${p.toUpperCase()} peso`, `${p.toUpperCase()} error`]), 'Error prom.', 'Estado', 'Acciones Correctivas'],
  ]
  for (const r of rows) {
    aoa.push([
      r.control_date, r.balance_code ?? '', r.area ?? '', r.equipment_name ?? '', r.error_maximo_permitido ?? '', r.peso_patron ?? '',
      ...READING_POINTS.flatMap(p => [r[`${p}_peso`] ?? '', r[`${p}_error`] ?? '']),
      r.error_promedio ?? '', ESTADO_LABELS[r.estado] ?? '', r.acciones_correctivas ?? '',
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Calibracion Balanzas')
  XLSX.writeFile(wb, `${quickDocFileName('calibracion_balanzas_caes', order, containerNumber)}.xlsx`)
}
