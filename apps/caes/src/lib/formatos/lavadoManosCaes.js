import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, fmtDate, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_LAVADO_MANOS_CAES = 'LAVADO DE MANOS EN LA OPERACIÓN DE TAMIZADO'

// Lavado de Manos en la Operación de Tamizado (CAESP-PP-HYS-RE-HSP-004) --
// SOLO CAES, ver COOPERATIVE.features.controlesPlantaCAES en lib/config.js.
// 1 control por (cooperativa, fecha) -- Área/Hora inicio/Hora fin son datos
// de esa sesión, compartidos por las varias personas evaluadas ese mismo
// día (migración 20260920100000) -- ver LavadoManosCaesPage.jsx. Persona
// sale de plant_personnel; R1-R5 son tri-estado (null = no aplica).
export const REVISION_CODES = ['r1', 'r2', 'r3', 'r4', 'r5']

export async function fetchLavadoManosCaesData(order) {
  const fechaDesde = order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null
  const fechaHasta = order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null
  if (!fechaDesde || !fechaHasta) return { blocks: [] }

  const { data, error } = await supabase
    .from('plant_handwashing_controls_caes')
    .select(`
      control_date, area, hora_inicio, hora_fin, observaciones,
      plant_handwashing_person_checks_caes (
        r1, r2, r3, r4, r5, observaciones,
        personnel:plant_personnel ( first_name, last_name )
      )
    `)
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
  if (error) throw new Error(error.message)

  const blocks = (data ?? []).map(c => ({
    controlDate: c.control_date,
    area: c.area,
    horaInicio: c.hora_inicio,
    horaFin: c.hora_fin,
    observaciones: c.observaciones,
    personas: (c.plant_handwashing_person_checks_caes ?? []).map(p => ({
      nombre: p.personnel ? `${p.personnel.first_name} ${p.personnel.last_name}` : '—',
      r1: p.r1, r2: p.r2, r3: p.r3, r4: p.r4, r5: p.r5,
      observaciones: p.observaciones,
    })),
  }))

  return { blocks }
}

function revisionSymbol(v) {
  return v === true ? '✓' : v === false ? '✗' : '—'
}

function buildLavadoManosBlockHTML(block) {
  const personaRows = block.personas.map(p => `<tr>
      <td style="font-size:9px">${escapeHtml(p.nombre)}</td>
      ${REVISION_CODES.map(c => `<td style="text-align:center;font-size:9px">${revisionSymbol(p[c])}</td>`).join('')}
      <td style="font-size:9px">${escapeHtml(p.observaciones) ?? ''}</td>
    </tr>`).join('')

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${fmtDate(block.controlDate)}</strong>
        ${block.area ? ` · Área: ${escapeHtml(block.area)}` : ''}
        ${block.horaInicio ? ` · Hora inicio: ${block.horaInicio}` : ''}
        ${block.horaFin ? ` · Hora fin: ${block.horaFin}` : ''}
      </div>
      <table class="formato-table" style="width:100%">
        <thead><tr>
          <th style="text-align:left">Nombre y Apellidos</th>
          ${REVISION_CODES.map(c => `<th>${c.toUpperCase()}</th>`).join('')}
          <th style="text-align:left">Observaciones</th>
        </tr></thead>
        <tbody>${personaRows || `<tr><td colspan="${REVISION_CODES.length + 2}" style="text-align:center;font-size:10px">Sin personas registradas</td></tr>`}</tbody>
      </table>
      ${block.observaciones ? `<p style="font-size:11px;margin:4px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(block.observaciones)}</p>` : ''}
    </div>`
}

export function buildPrintHTMLLavadoManosCaes(order, containerNumber, data, firmantes) {
  const { blocks } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('lavado_manos_caes', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    .formato-table th { font-size: 9px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${COOPERATIVE?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_LAVADO_MANOS_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron registros de lavado de manos en el rango de fechas de trabajo de esta orden.</p>'
    : blocks.map(buildLavadoManosBlockHTML).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function lavadoManosCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLLavadoManosCaes(order, containerNumber, data, firmantes)
}

export function lavadoManosCaesExcel(order, containerNumber, { blocks }) {
  const aoa = [
    [FORMAT_TITLE_LAVADO_MANOS_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]

  for (const block of blocks) {
    aoa.push([fmtDate(block.controlDate), block.area ? `Área: ${block.area}` : '', block.horaInicio ? `Hora inicio: ${block.horaInicio}` : '', block.horaFin ? `Hora fin: ${block.horaFin}` : ''])
    aoa.push(['Nombre y Apellidos', ...REVISION_CODES.map(c => c.toUpperCase()), 'Observaciones'])
    for (const p of block.personas) {
      aoa.push([p.nombre, ...REVISION_CODES.map(c => p[c] === true ? 'OK' : p[c] === false ? 'X' : 'N/A'), p.observaciones ?? ''])
    }
    if (block.observaciones) aoa.push(['Observaciones:', block.observaciones])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Lavado Manos')
  XLSX.writeFile(wb, `${quickDocFileName('lavado_manos_caes', order, containerNumber)}.xlsx`)
}
