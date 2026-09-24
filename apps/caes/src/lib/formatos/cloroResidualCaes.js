import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, escapeHtml, fmtDate } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_CLORO_RESIDUAL_CAES = 'CONTROL DE CONSUMO DE CLORO Y VERIFICACIÓN DE CLORO RESIDUAL'

// Control de Consumo de Cloro y Verificación de Cloro Residual
// (CAESP-PP-HYS-RE-CDA-001) -- SOLO CAES, ver
// COOPERATIVE.features.cloroPreparacionMonitoreo en lib/config.js.
// Distinto del Control de Cloro Residual de Norandino (cloroResidual.js,
// plant_chlorine_residual_controls): acá es un registro por FECHA con DOS
// listas independientes de eventos (preparación/cloración + monitoreo en
// puntos de muestreo libres), ver CloroResidualCaesPage.jsx.
export const CLORO_CAES_MIN_PPM = 0.5
export const CLORO_CAES_MAX_PPM = 2

// El registro (plant_chlorine_controls_caes) es por FECHA exacta,
// independiente de cualquier orden -- se cruza por fecha exacta dentro del
// rango de trabajo de la orden, mismo criterio que los demás controles por
// fecha (Higiene, Verificación, Plagas, Almacén).
// dateRange ({ desde, hasta }) opcional -- lo pasa el Resumen de
// Trazabilidad cuando necesita un rango distinto al de la orden completa;
// sin él, se calcula como siempre (documento suelto).
export async function fetchControlCloroResidualCaesData(order, dateRange) {
  const fechaDesde = dateRange?.desde ?? (order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null)
  const fechaHasta = dateRange?.hasta ?? (order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null)
  if (!fechaDesde || !fechaHasta) return { blocks: [] }

  const { data: controls, error } = await supabase
    .from('plant_chlorine_controls_caes')
    .select(`
      id, control_date, observations, formato_codigo,
      plant_chlorine_prep_events_caes ( event_time, concentracion_deseada_ppm, cantidad_agua_l, cantidad_cloro_ml, responsable_cloracion, observations ),
      plant_chlorine_monitoring_events_caes ( event_time, sampling_point, result_ppm, responsable_medicion, corrective_action )
    `)
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
  if (error) throw new Error(error.message)

  const blocks = (controls ?? []).map(c => ({
    controlDate: c.control_date,
    codigo: c.formato_codigo,
    observaciones: c.observations,
    prepEvents: c.plant_chlorine_prep_events_caes ?? [],
    monitoringEvents: c.plant_chlorine_monitoring_events_caes ?? [],
  }))

  return { blocks }
}

function buildCloroResidualCaesBlockHTML(block) {
  const prepRows = block.prepEvents.map(ev => `<tr>
      <td style="text-align:center;font-size:10px">${ev.event_time ?? '—'}</td>
      <td style="text-align:center;font-size:10px">${ev.concentracion_deseada_ppm ?? '—'}</td>
      <td style="text-align:center;font-size:10px">${ev.cantidad_agua_l ?? '—'}</td>
      <td style="text-align:center;font-size:10px">${ev.cantidad_cloro_ml ?? '—'}</td>
      <td style="font-size:10px">${escapeHtml(ev.responsable_cloracion) ?? ''}</td>
      <td style="font-size:10px">${escapeHtml(ev.observations) ?? ''}</td>
    </tr>`).join('')

  const monitoringRows = block.monitoringEvents.map(ev => {
    const belowLimit = ev.result_ppm != null && (ev.result_ppm < CLORO_CAES_MIN_PPM || ev.result_ppm > CLORO_CAES_MAX_PPM)
    const color = belowLimit ? '#991b1b' : '#111'
    return `<tr>
      <td style="text-align:center;font-size:10px">${ev.event_time ?? '—'}</td>
      <td style="font-size:10px">${escapeHtml(ev.sampling_point) ?? ''}</td>
      <td style="text-align:center;font-weight:700;color:${color};font-size:10px">${ev.result_ppm ?? '—'}</td>
      <td style="font-size:10px">${escapeHtml(ev.responsable_medicion) ?? ''}</td>
      <td style="font-size:10px">${escapeHtml(ev.corrective_action) ?? ''}</td>
    </tr>`
  }).join('')

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${fmtDate(block.controlDate)}</strong>${block.codigo ? ` · Código: ${escapeHtml(block.codigo)}` : ''}
      </div>
      <p class="section-label">Preparación / Cloración</p>
      <table class="formato-table" style="width:100%">
        <thead><tr><th>Hora</th><th>Conc. deseada (ppm)</th><th>Agua a clorar (L)</th><th>Cloro a adicionar (ml)</th><th>Responsable</th><th>Observaciones</th></tr></thead>
        <tbody>${prepRows || '<tr><td colspan="6" style="text-align:center;font-size:10px">Sin registros</td></tr>'}</tbody>
      </table>
      <p class="section-label" style="margin-top:8px">Monitoreo de Cloro Residual</p>
      <table class="formato-table" style="width:100%">
        <thead><tr><th>Hora</th><th>Punto de muestreo</th><th>Resultado (ppm)</th><th>Responsable</th><th>Acciones correctivas</th></tr></thead>
        <tbody>${monitoringRows || '<tr><td colspan="5" style="text-align:center;font-size:10px">Sin registros</td></tr>'}</tbody>
      </table>
      <p style="font-size:9px;margin:4px 0 0;color:#555">*Límite de control: ${CLORO_CAES_MIN_PPM} - ${CLORO_CAES_MAX_PPM} ppm de cloro libre residual</p>
      ${block.observaciones ? `<p style="font-size:11px;margin:4px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(block.observaciones)}</p>` : ''}
    </div>`
}

export function buildPrintHTMLControlCloroResidualCaes(order, containerNumber, data, firmantes) {
  const { blocks } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_cloro_residual_caes', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    .formato-table th { font-size: 9px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${COOPERATIVE?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_CLORO_RESIDUAL_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron controles de cloro residual en el rango de fechas de trabajo de esta orden.</p>'
    : blocks.map(buildCloroResidualCaesBlockHTML).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlCloroResidualCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlCloroResidualCaes(order, containerNumber, data, firmantes)
}

export function controlCloroResidualCaesExcel(order, containerNumber, { blocks }) {
  const aoa = [
    [FORMAT_TITLE_CLORO_RESIDUAL_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]

  for (const block of blocks) {
    aoa.push([fmtDate(block.controlDate), block.codigo ? `Código: ${block.codigo}` : ''])
    aoa.push(['Preparación / Cloración'])
    aoa.push(['Hora', 'Conc. deseada (ppm)', 'Agua a clorar (L)', 'Cloro a adicionar (ml)', 'Responsable', 'Observaciones'])
    for (const ev of block.prepEvents) {
      aoa.push([ev.event_time ?? '', ev.concentracion_deseada_ppm ?? '', ev.cantidad_agua_l ?? '', ev.cantidad_cloro_ml ?? '', ev.responsable_cloracion ?? '', ev.observations ?? ''])
    }
    aoa.push([])
    aoa.push(['Monitoreo de Cloro Residual'])
    aoa.push(['Hora', 'Punto de muestreo', 'Resultado (ppm)', 'Responsable', 'Acciones correctivas'])
    for (const ev of block.monitoringEvents) {
      aoa.push([ev.event_time ?? '', ev.sampling_point ?? '', ev.result_ppm ?? '', ev.responsable_medicion ?? '', ev.corrective_action ?? ''])
    }
    if (block.observaciones) aoa.push(['Observaciones:', block.observaciones])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cloro Residual')
  XLSX.writeFile(wb, `${quickDocFileName('control_cloro_residual_caes', order, containerNumber)}.xlsx`)
}
