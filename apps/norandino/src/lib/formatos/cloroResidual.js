import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { loadCloroResidualPuntos } from '@panela/core/lib/formConfig'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_CLORO_RESIDUAL = 'CONTROL DE CLORO RESIDUAL'
export const CHLORINE_RESIDUAL_MIN_PPM = 0.5

// Formato físico SIG-GIA-RG-001: registro por FECHA exacta, con una
// medición numérica (ppm) por cada punto de control de la planta -- a
// diferencia de los demás controles de limpieza, aquí el dato es un
// número, no un estado correcto/no correcto. Límite de referencia: mín
// 0.5ppm (solo resaltado visual, no validación dura). Se cruza por fecha
// exacta contra el rango de trabajo de la orden, mismo criterio que
// Higiene/Verificación.
//
// Los puntos de control (antes 3 fijos harcodeados) salen de
// form_configurations -- configurable por cooperativa, ver
// lib/formConfig.js loadCloroResidualPuntos(COOPERATIVE). El punto (texto libre) es a
// la vez lo que se guarda en point_code y lo que se muestra.
// dateRange ({ desde, hasta }) opcional -- lo pasa el Resumen de
// Trazabilidad cuando necesita un rango distinto al de la orden completa;
// sin él, se calcula como siempre (documento suelto).
export async function fetchControlCloroResidualData(order, dateRange) {
  const fechaDesde = dateRange?.desde ?? (order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null)
  const fechaHasta = dateRange?.hasta ?? (order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null)
  if (!fechaDesde || !fechaHasta) return { blocks: [], points: [] }

  const points = await loadCloroResidualPuntos(COOPERATIVE)
  const { data: controls, error } = await supabase
    .from('plant_chlorine_residual_controls')
    .select(`
      id, control_date, responsible_person, formato_codigo,
      plant_chlorine_residual_checks ( point_code, result_ppm, observations, corrective_action )
    `)
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
  if (error) throw new Error(error.message)

  const blocks = (controls ?? []).map(c => {
    const checksByPoint = {}
    for (const chk of (c.plant_chlorine_residual_checks ?? [])) {
      checksByPoint[chk.point_code] = {
        resultPpm: chk.result_ppm,
        observations: chk.observations,
        correctiveAction: chk.corrective_action,
      }
    }
    return {
      controlDate: c.control_date,
      codigo: c.formato_codigo,
      responsiblePerson: c.responsible_person,
      checksByPoint,
    }
  })

  return { blocks, points }
}

function buildCloroResidualBlockHTML(block, points) {
  const rows = points.map(point => {
    const cell = block.checksByPoint?.[point]
    const ppm = cell?.resultPpm
    const belowLimit = ppm != null && ppm < CHLORINE_RESIDUAL_MIN_PPM
    const color = belowLimit ? '#991b1b' : '#111'
    return `<tr>
      <td style="font-size:10px;padding:2px 5px;white-space:nowrap;text-align:left">${escapeHtml(point)}</td>
      <td style="text-align:center;color:${color};font-weight:700;font-size:11px;padding:1px;width:70px">${ppm != null ? ppm : '—'}</td>
      <td style="font-size:10px;padding:2px 5px;text-align:left">${escapeHtml(cell?.observations) ?? ''}</td>
      <td style="font-size:10px;padding:2px 5px;text-align:left">${cell?.correctiveAction ?? ''}</td>
    </tr>`
  }).join('')

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${block.controlDate ? new Date(`${block.controlDate}T00:00:00`).toLocaleDateString('es-PE') : '—'}</strong> · Responsable: ${escapeHtml(block.responsiblePerson) ?? '—'}
      </div>
      <table class="formato-table" style="width:100%">
        <thead><tr><th style="text-align:left">Punto de Control</th><th>Resultado CLR (ppm)</th><th style="text-align:left">Observaciones</th><th style="text-align:left">Acción Correctiva</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:9px;margin:4px 0 0;color:#555">*Límite de cloro libre residual: Mín ${CHLORINE_RESIDUAL_MIN_PPM}ppm</p>
    </div>`
}

export function buildPrintHTMLControlCloroResidual(order, containerNumber, data, firmantes) {
  const { blocks, points } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_cloro_residual', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    .formato-table th { font-size: 9px; }
    .formato-table td { font-size: 10px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${COOPERATIVE?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_CLORO_RESIDUAL}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron controles de cloro residual en el rango de fechas de trabajo de esta orden.</p>'
    : blocks.map(b => buildCloroResidualBlockHTML(b, points)).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlCloroResidualPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlCloroResidual(order, containerNumber, data, firmantes)
}

export function controlCloroResidualExcel(order, containerNumber, { blocks, points }) {
  const aoa = [
    ['CONTROL DE CLORO RESIDUAL'],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]

  for (const block of blocks) {
    aoa.push([block.controlDate, `Responsable: ${block.responsiblePerson ?? ''}`])
    aoa.push(['Punto de Control', 'Resultado CLR (ppm)', 'Observaciones', 'Acción Correctiva'])
    for (const point of points) {
      const cell = block.checksByPoint?.[point]
      aoa.push([point, cell?.resultPpm ?? '', cell?.observations ?? '', cell?.correctiveAction ?? ''])
    }
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cloro Residual')
  XLSX.writeFile(wb, `${quickDocFileName('control_cloro_residual', order, containerNumber)}.xlsx`)
}
