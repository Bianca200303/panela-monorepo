import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, fmtDate, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_HERMETICIDAD_ENVASES_CAES = 'CONTROL DE HERMETICIDAD DE ENVASES'

// Control de Hermeticidad de Envases (CAESP-PP-BPM-RE-CPR-007) -- SOLO
// CAES, ver COOPERATIVE.features.controlesPlantaCAES en lib/config.js.
// Muestreo AQL (ISO 2859-1), registro plano por (fecha, lote) -- ver
// HermeticidadEnvasesCaesPage.jsx.
export async function fetchHermeticidadEnvasesCaesData(order) {
  const fechaDesde = order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null
  const fechaHasta = order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null
  if (!fechaDesde || !fechaHasta) return { rows: [] }

  const { data, error } = await supabase
    .from('plant_container_tightness_control_caes')
    .select('control_date, lote_code, tamano_lote, nivel_inspeccion, letra_codigo, nivel_calidad_aceptable, tamano_muestra, numero_aceptacion, numero_rechazo, producto_conforme, producto_no_conforme, accion_tomada, acciones_correctivas')
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
  if (error) throw new Error(error.message)

  return { rows: data ?? [] }
}

export function buildPrintHTMLHermeticidadEnvasesCaes(order, containerNumber, data, firmantes) {
  const { rows } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  const bodyRows = rows.map(r => `<tr>
      <td style="text-align:center;font-size:9px">${fmtDate(r.control_date)}</td>
      <td style="font-size:9px">${escapeHtml(r.lote_code) ?? '—'}</td>
      <td style="text-align:right;font-size:9px">${r.tamano_lote ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${escapeHtml(r.nivel_inspeccion) ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${escapeHtml(r.letra_codigo) ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${escapeHtml(r.nivel_calidad_aceptable) ?? '—'}</td>
      <td style="text-align:right;font-size:9px">${r.tamano_muestra ?? '—'}</td>
      <td style="text-align:right;font-size:9px">${r.numero_aceptacion ?? '—'}</td>
      <td style="text-align:right;font-size:9px">${r.numero_rechazo ?? '—'}</td>
      <td style="text-align:right;font-size:9px">${r.producto_conforme ?? '—'}</td>
      <td style="text-align:right;font-size:9px">${r.producto_no_conforme ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(r.accion_tomada) ?? ''}</td>
      <td style="font-size:9px">${escapeHtml(r.acciones_correctivas) ?? ''}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('hermeticidad_envases_caes', order, containerNumber)}</title>
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
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_HERMETICIDAD_ENVASES_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${rows.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron registros de hermeticidad de envases en el rango de fechas de trabajo de esta orden.</p>'
    : `<div style="overflow-x:auto"><table class="formato-table" style="min-width:100%">
        <thead><tr>
          <th>Fecha</th><th>N° Lote</th><th>Tamaño de lote</th><th>Nivel insp.</th><th>Letra código</th>
          <th>NCA</th><th>Tamaño muestra</th><th>N° aceptación</th><th>N° rechazo</th>
          <th>Conforme</th><th>No conforme</th><th style="text-align:left">Acción tomada</th><th style="text-align:left">Acciones Correctivas</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table></div>`}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function hermeticidadEnvasesCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLHermeticidadEnvasesCaes(order, containerNumber, data, firmantes)
}

export function hermeticidadEnvasesCaesExcel(order, containerNumber, { rows }) {
  const aoa = [
    [FORMAT_TITLE_HERMETICIDAD_ENVASES_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
    ['Fecha', 'N° Lote', 'Tamaño de lote', 'Nivel insp.', 'Letra código', 'NCA', 'Tamaño muestra', 'N° aceptación', 'N° rechazo', 'Conforme', 'No conforme', 'Acción tomada', 'Acciones Correctivas'],
  ]
  for (const r of rows) {
    aoa.push([
      r.control_date, r.lote_code ?? '', r.tamano_lote ?? '', r.nivel_inspeccion ?? '', r.letra_codigo ?? '',
      r.nivel_calidad_aceptable ?? '', r.tamano_muestra ?? '', r.numero_aceptacion ?? '', r.numero_rechazo ?? '',
      r.producto_conforme ?? '', r.producto_no_conforme ?? '', r.accion_tomada ?? '', r.acciones_correctivas ?? '',
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Hermeticidad Envases')
  XLSX.writeFile(wb, `${quickDocFileName('hermeticidad_envases_caes', order, containerNumber)}.xlsx`)
}
