import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, fmtDate, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_PREPARACION_SOLUCIONES_CAES = 'CONTROL DE PREPARACIÓN DE SOLUCIONES'

// Control de Preparación de Soluciones (CAESP-PP-HYS-RE-HYS-003) -- SOLO
// CAES, ver COOPERATIVE.features.controlesPlantaCAES en lib/config.js.
// 1 control por (cooperativa, fecha, "Preparación de") + N filas de
// preparación (migración 20260920120000) -- ver
// PreparacionSolucionesCaesPage.jsx. Responsable sale de plant_personnel.
// Acá se aplana a la misma forma de fila que ya usaba el documento (1 fila
// = 1 evento de preparación).
export async function fetchPreparacionSolucionesCaesData(order) {
  const fechaDesde = order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null
  const fechaHasta = order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null
  if (!fechaDesde || !fechaHasta) return { rows: [] }

  const { data, error } = await supabase
    .from('plant_solution_prep_controls_caes')
    .select(`
      control_date, preparacion_de,
      plant_solution_prep_events_caes (
        concentracion_insumo, cantidad_insumo, resultado_volumen, concentracion_final, destino_uso,
        personnel:plant_personnel ( first_name, last_name )
      )
    `)
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
  if (error) throw new Error(error.message)

  const rows = (data ?? []).flatMap(c =>
    (c.plant_solution_prep_events_caes ?? []).map(ev => ({
      control_date: c.control_date,
      preparacion_de: c.preparacion_de,
      concentracion_insumo: ev.concentracion_insumo,
      cantidad_insumo: ev.cantidad_insumo,
      resultado_volumen: ev.resultado_volumen,
      concentracion_final: ev.concentracion_final,
      destino_uso: ev.destino_uso,
      responsable: ev.personnel ? `${ev.personnel.first_name} ${ev.personnel.last_name}` : '—',
    }))
  )
  return { rows }
}

export function buildPrintHTMLPreparacionSolucionesCaes(order, containerNumber, data, firmantes) {
  const { rows } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  const bodyRows = rows.map(r => `<tr>
      <td style="text-align:center;font-size:9px">${fmtDate(r.control_date)}</td>
      <td style="font-size:9px">${escapeHtml(r.preparacion_de) ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${escapeHtml(r.concentracion_insumo) ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${escapeHtml(r.cantidad_insumo) ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${escapeHtml(r.resultado_volumen) ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${escapeHtml(r.concentracion_final) ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(r.responsable) ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(r.destino_uso) ?? ''}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('preparacion_soluciones_caes', order, containerNumber)}</title>
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
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_PREPARACION_SOLUCIONES_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${rows.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron registros de preparación de soluciones en el rango de fechas de trabajo de esta orden.</p>'
    : `<table class="formato-table" style="width:100%">
        <thead><tr>
          <th>Fecha</th><th style="text-align:left">Preparación de</th><th>Concentración</th><th>Cantidad</th>
          <th>Resultado (volumen)</th><th>Concentración final</th><th style="text-align:left">Responsable</th><th style="text-align:left">Observaciones (destino/uso)</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>`}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function preparacionSolucionesCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLPreparacionSolucionesCaes(order, containerNumber, data, firmantes)
}

export function preparacionSolucionesCaesExcel(order, containerNumber, { rows }) {
  const aoa = [
    [FORMAT_TITLE_PREPARACION_SOLUCIONES_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
    ['Fecha', 'Preparación de', 'Concentración', 'Cantidad', 'Resultado (volumen)', 'Concentración final', 'Responsable', 'Observaciones'],
  ]
  for (const r of rows) {
    aoa.push([r.control_date, r.preparacion_de ?? '', r.concentracion_insumo ?? '', r.cantidad_insumo ?? '', r.resultado_volumen ?? '', r.concentracion_final ?? '', r.responsable ?? '', r.destino_uso ?? ''])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Prep Soluciones')
  XLSX.writeFile(wb, `${quickDocFileName('preparacion_soluciones_caes', order, containerNumber)}.xlsx`)
}
