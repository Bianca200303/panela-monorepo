import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { loadLimpiezaEquiposAreas } from '@panela/core/lib/formConfig'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, MONTH_NAMES, daysInMonth, monthsBetween, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_LIMPIEZA_EQUIPOS = 'CONTROL DEL PROGRAMA DE LIMPIEZA Y SANITIZACIÓN DE EQUIPOS - UTENSILIOS'

// Áreas y equipos del Control del Programa de Limpieza y Sanitización de
// Equipos - Utensilios (SIG-GIA-RG-003). "Balanzas" aparece dos veces en
// Envasado en el papel físico real (dos balanzas distintas del área), por
// eso hay dos códigos separados (`balanzas` y `balanzas_2`). Los ítems de
// "Otros" no llevan producto (en el papel real solo tienen check, sin letra
// de producto) -- `tracksProduct: false`. Las áreas/equipos salen de
// form_configurations -- configurable por cooperativa, ver
// lib/formConfig.js loadLimpiezaEquiposAreas(COOPERATIVE).
export const EQUIPMENT_CLEANING_PRODUCT_LABELS = {
  H: 'Hipoclorito de sodio 7.5%',
  A: 'Alcohol 70%',
  D: 'Detergente Industrial',
}
export const EQUIPMENT_CLEANING_PRODUCT_CODES = ['H', 'A', 'D']

// Códigos de equipos que no todas las cooperativas tienen -- se sacan de la
// grilla según COOPERATIVE.features, encima de lo que venga configurado
// (para no tener que repetir la exclusión en cada config de cooperativa).
const OPTIONAL_ITEM_FEATURE = {
  detector_metales: 'detectorMetales',
  envolvedor_pallets: 'pallets',
}

export async function loadEquipmentCleaningAreas() {
  const areas = await loadLimpiezaEquiposAreas(COOPERATIVE)
  return areas.map(({ area, items }) => ({
    area,
    items: items.filter(it => {
      const feature = OPTIONAL_ITEM_FEATURE[it.code]
      return !feature || COOPERATIVE?.features?.[feature]
    }),
  }))
}

// Formato físico SIG-GIA-RG-003: registro mensual de planta (mismo criterio
// que Ambientes) -- 1 control por (año, mes), con una grilla área/equipo ×
// día del mes. Cada celda lleva un solo chequeo (correcto/no correcto) más
// el/los producto(s) usados (H/A/D, pueden combinarse). Para el documento de
// una orden se cruzan por mes los controles cuyo (año, mes) cae dentro del
// rango de trabajo de esa orden.
export async function fetchControlLimpiezaEquiposData(order) {
  const fechaDesde = order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null
  const fechaHasta = order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null
  if (!fechaDesde || !fechaHasta) return { blocks: [], areas: [] }

  const areas = await loadEquipmentCleaningAreas()
  const months = monthsBetween(fechaDesde, fechaHasta)
  const orFilter = months.map(m => `and(year.eq.${m.year},month.eq.${m.month})`).join(',')

  const { data: controls, error } = await supabase
    .from('plant_equipment_cleaning_controls')
    .select(`
      id, year, month, responsible_person, observations,
      plant_equipment_cleaning_checks ( area, equipment, day, status, products )
    `)
    .or(orFilter)
    .order('year')
    .order('month')
  if (error) throw new Error(error.message)

  const blocks = (controls ?? []).map(c => {
    const checksByCell = {}
    for (const chk of (c.plant_equipment_cleaning_checks ?? [])) {
      const byArea = (checksByCell[chk.area] ??= {})
      const byEquipment = (byArea[chk.equipment] ??= {})
      byEquipment[chk.day] = { status: chk.status, products: chk.products ?? [] }
    }
    return {
      year: c.year,
      month: c.month,
      responsiblePerson: c.responsible_person,
      observaciones: c.observations,
      checksByCell,
    }
  })

  return { blocks, areas }
}

function buildLimpiezaEquiposBlockHTML(block, areas) {
  const days = Array.from({ length: daysInMonth(block.year, block.month) }, (_, i) => i + 1)
  const dayHeaders = days.map(d => `<th style="font-size:7px;padding:1px;width:16px">${d}</th>`).join('')

  const rows = []
  for (const { area, items } of areas) {
    rows.push(`<tr><td colspan="${days.length + 1}" style="background:#e5e5e5;font-weight:700;font-size:9px;padding:2px 5px;text-align:left">${escapeHtml(area)}</td></tr>`)
    for (const item of items) {
      const cells = days.map(d => {
        const cell = block.checksByCell?.[area]?.[item.code]?.[d]
        const symbol = cell?.status === 'correcto' ? '✓' : cell?.status === 'no_correcto' ? '✗' : ''
        const color = cell?.status === 'correcto' ? '#166534' : cell?.status === 'no_correcto' ? '#991b1b' : '#ccc'
        const products = (cell?.products ?? []).join('')
        return `<td style="text-align:center;color:${color};font-weight:700;font-size:8px;padding:1px">${symbol}${products ? `<br/>${products}` : ''}</td>`
      }).join('')
      rows.push(`<tr><td style="font-size:9px;padding:2px 5px;white-space:nowrap;text-align:left">${escapeHtml(item.label)}</td>${cells}</tr>`)
    }
  }

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${MONTH_NAMES[block.month - 1]} ${block.year}</strong> · Responsable: ${escapeHtml(block.responsiblePerson) ?? '—'}
      </div>
      <div style="overflow-x:auto">
        <table class="formato-table" style="min-width:100%">
          <thead><tr><th style="text-align:left;font-size:8px">Área / Equipo</th>${dayHeaders}</tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
      <p style="font-size:9px;margin:4px 0 0;color:#555">
        ✓: Correcto &nbsp;&nbsp; ✗: No es correcto &nbsp;&nbsp;
        ${EQUIPMENT_CLEANING_PRODUCT_CODES.map(c => `${c}: ${EQUIPMENT_CLEANING_PRODUCT_LABELS[c]}`).join(' &nbsp;&nbsp; ')}
      </p>
      ${block.observaciones ? `<p style="font-size:11px;margin:4px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(block.observaciones)}</p>` : ''}
    </div>`
}

export function buildPrintHTMLControlLimpiezaEquipos(order, containerNumber, data, firmantes) {
  const { blocks, areas } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_limpieza_equipos', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
    .formato-table th { font-size: 8px; }
    .formato-table td { font-size: 9px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${COOPERATIVE?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_LIMPIEZA_EQUIPOS}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron controles de limpieza de equipos en los meses de trabajo de esta orden.</p>'
    : blocks.map(b => buildLimpiezaEquiposBlockHTML(b, areas)).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlLimpiezaEquiposPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlLimpiezaEquipos(order, containerNumber, data, firmantes)
}

export function controlLimpiezaEquiposExcel(order, containerNumber, { blocks, areas }) {
  const aoa = [
    ['CONTROL DEL PROGRAMA DE LIMPIEZA Y SANITIZACIÓN DE EQUIPOS - UTENSILIOS'],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]

  for (const block of blocks) {
    const nDays = new Date(block.year, block.month, 0).getDate()
    const days = Array.from({ length: nDays }, (_, i) => i + 1)
    aoa.push([`${block.year}-${String(block.month).padStart(2, '0')}`, `Responsable: ${block.responsiblePerson ?? ''}`])
    aoa.push(['Área / Equipo', ...days])
    for (const { area, items } of areas) {
      aoa.push([area])
      for (const item of items) {
        aoa.push([item.label, ...days.map(d => {
          const cell = block.checksByCell?.[area]?.[item.code]?.[d]
          if (!cell?.status) return ''
          const mark = cell.status === 'correcto' ? 'OK' : 'X'
          const products = (cell.products ?? []).join('')
          return products ? `${mark} (${products})` : mark
        })])
      }
    }
    if (block.observaciones) aoa.push(['Observaciones:', block.observaciones])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Limpieza Equipos')
  XLSX.writeFile(wb, `${quickDocFileName('control_limpieza_equipos', order, containerNumber)}.xlsx`)
}
