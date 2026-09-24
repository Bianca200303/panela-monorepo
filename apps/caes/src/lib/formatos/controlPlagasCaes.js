import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, MONTH_NAMES, monthsBetween, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_CONTROL_PLAGAS_CAES = 'CONTROL DE ROEDORES E INSECTOS'

// Control de Roedores e Insectos (CAESP-PP-HYS-RE-CDP-001) -- SOLO CAES, ver
// COOPERATIVE.features.plagasEventosMensuales en lib/config.js. A diferencia
// de Control de Plagas de Norandino (1 control por fecha, catálogo fijo de
// 14 dispositivos + 10 especies), acá es un registro MENSUAL con dos listas
// de eventos libres (trampas de roedores evaluadas varias veces durante el
// mes, insectocutores con área) -- ver ControlPlagasCaesPage.jsx.
export const ESTADO_TRAMPA_LABELS = { sc: 'S.C.', cp: 'C.P.', ct: 'C.T.', det: 'DET.' }
export const ESTADO_TRAMPA_FULL_LABELS = { sc: 'Sin consumo', cp: 'Consumo parcial', ct: 'Consumo total', det: 'Deteriorada' }
export const INSECT_SPECIES_CAES = { mo: 'Moscas', a: 'Abejas', ma: 'Mariposas' }

// El registro (plant_pest_controls_caes) es MENSUAL -- se cruza por mes
// dentro del rango de trabajo de la orden, mismo criterio que Ambientes/
// Equipos/Limpieza General.
// dateRange ({ desde, hasta }) opcional -- lo pasa el Resumen de
// Trazabilidad cuando necesita un rango distinto al de la orden completa;
// sin él, se calcula como siempre (documento suelto).
export async function fetchControlPlagasCaesData(order, dateRange) {
  const fechaDesde = dateRange?.desde ?? (order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null)
  const fechaHasta = dateRange?.hasta ?? (order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null)
  if (!fechaDesde || !fechaHasta) return { blocks: [] }

  const months = monthsBetween(fechaDesde, fechaHasta)
  const orFilter = months.map(m => `and(year.eq.${m.year},month.eq.${m.month})`).join(',')

  const { data: controls, error } = await supabase
    .from('plant_pest_controls_caes')
    .select(`
      id, year, month, cebo_producto, cebo_cantidad, insecto_producto, insecto_cantidad, observations, formato_codigo,
      plant_pest_rodent_events_caes ( trap_code, event_date, trap_active, estado, observations ),
      plant_pest_insect_events_caes ( insectocutor_code, area, event_date, species, observations )
    `)
    .or(orFilter)
    .order('year')
    .order('month')
  if (error) throw new Error(error.message)

  const blocks = (controls ?? []).map(c => ({
    year: c.year,
    month: c.month,
    ceboProducto: c.cebo_producto,
    ceboCantidad: c.cebo_cantidad,
    insectoProducto: c.insecto_producto,
    insectoCantidad: c.insecto_cantidad,
    observaciones: c.observations,
    codigo: c.formato_codigo,
    rodentEvents: c.plant_pest_rodent_events_caes ?? [],
    insectEvents: c.plant_pest_insect_events_caes ?? [],
  }))

  return { blocks }
}

function buildPlagasCaesBlockHTML(block) {
  const rodentRows = block.rodentEvents.map(ev => `<tr>
      <td style="font-size:9px;text-align:left">${escapeHtml(ev.trap_code)}</td>
      <td style="text-align:center;font-size:9px">${ev.event_date ? new Date(`${ev.event_date}T00:00:00`).toLocaleDateString('es-PE') : '—'}</td>
      <td style="text-align:center;font-size:9px">${ev.trap_active === true ? 'Sí' : ev.trap_active === false ? 'No' : '—'}</td>
      <td style="text-align:center;font-size:9px">${(ev.estado ?? []).map(e => ESTADO_TRAMPA_LABELS[e] ?? e).join(', ')}</td>
      <td style="font-size:9px;text-align:left">${escapeHtml(ev.observations) ?? ''}</td>
    </tr>`).join('')

  const insectRows = block.insectEvents.map(ev => `<tr>
      <td style="font-size:9px;text-align:left">${escapeHtml(ev.insectocutor_code)}</td>
      <td style="font-size:9px;text-align:left">${escapeHtml(ev.area) ?? ''}</td>
      <td style="text-align:center;font-size:9px">${ev.event_date ? new Date(`${ev.event_date}T00:00:00`).toLocaleDateString('es-PE') : '—'}</td>
      <td style="text-align:center;font-size:9px">${(ev.species ?? []).map(s => INSECT_SPECIES_CAES[s] ?? s).join(', ')}</td>
      <td style="font-size:9px;text-align:left">${escapeHtml(ev.observations) ?? ''}</td>
    </tr>`).join('')

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${MONTH_NAMES[block.month - 1]} ${block.year}</strong>${block.codigo ? ` · Código: ${escapeHtml(block.codigo)}` : ''}
      </div>
      <p class="section-label">Control de Roedores</p>
      <p style="font-size:10px;margin:0 0 4px">Cebo: ${escapeHtml(block.ceboProducto) ?? '—'} · Cantidad: ${escapeHtml(block.ceboCantidad) ?? '—'}</p>
      <table class="formato-table" style="width:100%">
        <thead><tr><th>N° Trampa</th><th>Fecha</th><th>Activa</th><th>Estado</th><th style="text-align:left">Observaciones</th></tr></thead>
        <tbody>${rodentRows || '<tr><td colspan="5" style="text-align:center;font-size:9px">Sin registros</td></tr>'}</tbody>
      </table>
      <p class="section-label" style="margin-top:8px">Control de Insectos</p>
      <p style="font-size:10px;margin:0 0 4px">Producto: ${escapeHtml(block.insectoProducto) ?? '—'} · Cantidad: ${escapeHtml(block.insectoCantidad) ?? '—'}</p>
      <table class="formato-table" style="width:100%">
        <thead><tr><th>N° Insectocutor</th><th>Área</th><th>Fecha</th><th>Especies</th><th style="text-align:left">Observaciones</th></tr></thead>
        <tbody>${insectRows || '<tr><td colspan="5" style="text-align:center;font-size:9px">Sin registros</td></tr>'}</tbody>
      </table>
      ${block.observaciones ? `<p style="font-size:11px;margin:4px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(block.observaciones)}</p>` : ''}
    </div>`
}

export function buildPrintHTMLControlPlagasCaes(order, containerNumber, data, firmantes) {
  const { blocks } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_plagas_caes', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    .formato-table th { font-size: 9px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${COOPERATIVE?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_CONTROL_PLAGAS_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron controles de plagas en los meses de trabajo de esta orden.</p>'
    : blocks.map(buildPlagasCaesBlockHTML).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlPlagasCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlPlagasCaes(order, containerNumber, data, firmantes)
}

export function controlPlagasCaesExcel(order, containerNumber, { blocks }) {
  const aoa = [
    [FORMAT_TITLE_CONTROL_PLAGAS_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]

  for (const block of blocks) {
    aoa.push([`${MONTH_NAMES[block.month - 1]} ${block.year}`, block.codigo ? `Código: ${block.codigo}` : ''])
    aoa.push(['Control de Roedores', `Cebo: ${block.ceboProducto ?? ''}`, `Cantidad: ${block.ceboCantidad ?? ''}`])
    aoa.push(['N° Trampa', 'Fecha', 'Activa', 'Estado', 'Observaciones'])
    for (const ev of block.rodentEvents) {
      aoa.push([ev.trap_code ?? '', ev.event_date ?? '', ev.trap_active === true ? 'Sí' : ev.trap_active === false ? 'No' : '', (ev.estado ?? []).join('/'), ev.observations ?? ''])
    }
    aoa.push([])
    aoa.push(['Control de Insectos', `Producto: ${block.insectoProducto ?? ''}`, `Cantidad: ${block.insectoCantidad ?? ''}`])
    aoa.push(['N° Insectocutor', 'Área', 'Fecha', 'Especies', 'Observaciones'])
    for (const ev of block.insectEvents) {
      aoa.push([ev.insectocutor_code ?? '', ev.area ?? '', ev.event_date ?? '', (ev.species ?? []).join('/'), ev.observations ?? ''])
    }
    if (block.observaciones) aoa.push(['Observaciones:', block.observaciones])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Control Plagas')
  XLSX.writeFile(wb, `${quickDocFileName('control_plagas_caes', order, containerNumber)}.xlsx`)
}
