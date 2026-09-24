import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, fmtDate, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_TEMP_HUMEDAD_AMBIENTES_CAES = 'CONTROL DE TEMPERATURA Y HUMEDAD DE AMBIENTES'

// Control de Temperatura y Humedad de Ambientes (CAESP-PP-BPM-RE-RMP-003)
// -- SOLO CAES, ver COOPERATIVE.features.controlesPlantaCAES en
// lib/config.js. 4 ubicaciones fijas por fecha -- ver
// TempHumedadAmbientesCaesPage.jsx.
export const UBICACIONES = [
  'Almacén de Materia Prima',
  'Almacén de Producto Terminado',
  'Tamizado, Homogenizado y Envasado',
  'Laboratorio',
]

export async function fetchTempHumedadAmbientesCaesData(order) {
  const fechaDesde = order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null
  const fechaHasta = order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null
  if (!fechaDesde || !fechaHasta) return { rows: [] }

  const { data, error } = await supabase
    .from('plant_temp_humidity_control_caes')
    .select('control_date, ubicacion, t1, t2, t3, t_promedio, hr1, hr2, hr3, hr_promedio, accion_correctiva, observaciones')
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
  if (error) throw new Error(error.message)

  return { rows: data ?? [] }
}

export function buildPrintHTMLTempHumedadAmbientesCaes(order, containerNumber, data, firmantes) {
  const { rows } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  const bodyRows = rows.map(r => `<tr>
      <td style="text-align:center;font-size:9px">${fmtDate(r.control_date)}</td>
      <td style="font-size:9px">${escapeHtml(r.ubicacion) ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${r.t1 ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${r.t2 ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${r.t3 ?? '—'}</td>
      <td style="text-align:center;font-size:9px;font-weight:700">${r.t_promedio ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${r.hr1 ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${r.hr2 ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${r.hr3 ?? '—'}</td>
      <td style="text-align:center;font-size:9px;font-weight:700">${r.hr_promedio ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(r.accion_correctiva) ?? ''}</td>
      <td style="font-size:9px">${escapeHtml(r.observaciones) ?? ''}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('temp_humedad_ambientes_caes', order, containerNumber)}</title>
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
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_TEMP_HUMEDAD_AMBIENTES_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${rows.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron registros de temperatura y humedad en el rango de fechas de trabajo de esta orden.</p>'
    : `<div style="overflow-x:auto"><table class="formato-table" style="min-width:100%">
        <thead><tr>
          <th rowspan="2">Fecha</th><th rowspan="2">Ubicación</th>
          <th colspan="4">Temperatura (°C)</th><th colspan="4">Humedad Relativa (%)</th>
          <th rowspan="2" style="text-align:left">Acción Correctiva</th><th rowspan="2" style="text-align:left">Observaciones</th>
        </tr>
        <tr>
          <th>T1</th><th>T2</th><th>T3</th><th>X̄</th>
          <th>HR1</th><th>HR2</th><th>HR3</th><th>X̄</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table></div>`}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function tempHumedadAmbientesCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLTempHumedadAmbientesCaes(order, containerNumber, data, firmantes)
}

export function tempHumedadAmbientesCaesExcel(order, containerNumber, { rows }) {
  const aoa = [
    [FORMAT_TITLE_TEMP_HUMEDAD_AMBIENTES_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
    ['Fecha', 'Ubicación', 'T1', 'T2', 'T3', 'T prom.', 'HR1', 'HR2', 'HR3', 'HR prom.', 'Acción Correctiva', 'Observaciones'],
  ]
  for (const r of rows) {
    aoa.push([r.control_date, r.ubicacion ?? '', r.t1 ?? '', r.t2 ?? '', r.t3 ?? '', r.t_promedio ?? '', r.hr1 ?? '', r.hr2 ?? '', r.hr3 ?? '', r.hr_promedio ?? '', r.accion_correctiva ?? '', r.observaciones ?? ''])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Temp Humedad')
  XLSX.writeFile(wb, `${quickDocFileName('temp_humedad_ambientes_caes', order, containerNumber)}.xlsx`)
}
