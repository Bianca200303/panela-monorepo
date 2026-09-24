import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { loadLimpiezaGeneralAreas } from '@panela/core/lib/formConfig'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, MONTH_NAMES, daysInMonth, monthsBetween, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_LIMPIEZA_GENERAL = 'CONTROL DE LIMPIEZA'

// Control de Limpieza (CAESP-PP-HYS-RE-HYS-001) -- SOLO CAES, ver
// COOPERATIVE.features.limpiezaUnificada en lib/config.js. Fusiona en un
// solo registro lo que en Norandino son dos controles separados (Limpieza
// de Ambientes + Limpieza de Equipos), porque el papel real de CAES mezcla
// superficies físicas y equipos puntuales bajo la misma área. Áreas/ítems
// salen de form_configurations, ver loadLimpiezaGeneralAreas(COOPERATIVE) en
// formConfig.js -- cada ítem trae metadata de referencia (tipoLimpieza,
// producto) que se muestra en el documento pero no se captura a diario; la
// grilla diaria es un solo check por ítem por día (sin producto por celda).
export const TIPO_LIMPIEZA_LABELS = { D: 'Diaria', G: 'General', P: 'Profunda' }
export const PRODUCTO_LABELS = { C: 'Cloro', D: 'Detergente Industrial', A: 'Alcohol' }

// Formato físico: registro mensual de planta (mismo criterio que
// Ambientes/Equipos de Norandino) -- 1 control por (año, mes), con una
// grilla área/ítem × día del mes. Para el documento de una orden se cruzan
// por mes los controles cuyo (año, mes) cae dentro del rango de trabajo de
// esa orden.
// dateRange ({ desde, hasta }) opcional -- lo pasa el Resumen de
// Trazabilidad cuando necesita un rango distinto al de la orden completa
// (fecha exacta de producción del lote, no todo el rango de trabajo); sin
// él, se calcula como siempre (documento suelto).
export async function fetchControlLimpiezaGeneralData(order, dateRange) {
  const fechaDesde = dateRange?.desde ?? (order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null)
  const fechaHasta = dateRange?.hasta ?? (order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null)
  if (!fechaDesde || !fechaHasta) return { blocks: [], areas: [] }

  const areas = await loadLimpiezaGeneralAreas(COOPERATIVE)
  const months = monthsBetween(fechaDesde, fechaHasta)
  const orFilter = months.map(m => `and(year.eq.${m.year},month.eq.${m.month})`).join(',')

  const { data: controls, error } = await supabase
    .from('plant_general_cleaning_controls')
    .select(`
      id, year, month, responsible_person, observations, formato_codigo,
      plant_general_cleaning_checks ( area, item, day, status )
    `)
    .or(orFilter)
    .order('year')
    .order('month')
  if (error) throw new Error(error.message)

  const blocks = (controls ?? []).map(c => {
    const checksByCell = {}
    for (const chk of (c.plant_general_cleaning_checks ?? [])) {
      const byArea = (checksByCell[chk.area] ??= {})
      const byItem = (byArea[chk.item] ??= {})
      byItem[chk.day] = chk.status
    }
    return {
      year: c.year,
      month: c.month,
      responsiblePerson: c.responsible_person,
      observaciones: c.observations,
      formatoCodigo: c.formato_codigo,
      checksByCell,
    }
  })

  return { blocks, areas }
}

function referenciaBadges(item) {
  const tipo = (item.tipoLimpieza ?? []).join('/')
  const producto = (item.producto ?? []).join('/')
  const parts = []
  if (tipo) parts.push(tipo)
  if (producto) parts.push(producto)
  return parts.length ? ` (${parts.join(' · ')})` : ''
}

function buildLimpiezaGeneralBlockHTML(block, areas) {
  const days = Array.from({ length: daysInMonth(block.year, block.month) }, (_, i) => i + 1)
  const dayHeaders = days.map(d => `<th style="font-size:7px;padding:1px;width:16px">${d}</th>`).join('')

  const rows = []
  for (const { area, items } of areas) {
    rows.push(`<tr><td colspan="${days.length + 1}" style="background:#e5e5e5;font-weight:700;font-size:9px;padding:2px 5px;text-align:left">${escapeHtml(area)}</td></tr>`)
    for (const item of items) {
      const cells = days.map(d => {
        const status = block.checksByCell?.[area]?.[item.code]?.[d]
        const symbol = status === 'correcto' ? '✓' : status === 'no_correcto' ? '✗' : ''
        const color = status === 'correcto' ? '#166534' : status === 'no_correcto' ? '#991b1b' : '#ccc'
        return `<td style="text-align:center;color:${color};font-weight:700;font-size:9px;padding:1px">${symbol}</td>`
      }).join('')
      rows.push(`<tr><td style="font-size:9px;padding:2px 5px;white-space:nowrap;text-align:left">${escapeHtml(item.label)}${escapeHtml(referenciaBadges(item))}</td>${cells}</tr>`)
    }
  }

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${MONTH_NAMES[block.month - 1]} ${block.year}</strong> · Responsable: ${escapeHtml(block.responsiblePerson) ?? '—'}${block.formatoCodigo ? ` · Código: ${escapeHtml(block.formatoCodigo)}` : ''}
      </div>
      <div style="overflow-x:auto">
        <table class="formato-table" style="min-width:100%">
          <thead><tr><th style="text-align:left;font-size:8px">Área / Ítem (Tipo · Producto)</th>${dayHeaders}</tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
      <p style="font-size:9px;margin:4px 0 0;color:#555">
        ✓: Correcto &nbsp;&nbsp; ✗: No es correcto &nbsp;&nbsp;
        Tipo de limpieza: D=Diaria, G=General, P=Profunda &nbsp;&nbsp;
        Producto: C=Cloro, D=Detergente Industrial, A=Alcohol
      </p>
      ${block.observaciones ? `<p style="font-size:11px;margin:4px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(block.observaciones)}</p>` : ''}
    </div>`
}

export function buildPrintHTMLControlLimpiezaGeneral(order, containerNumber, data, firmantes) {
  const { blocks, areas } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_limpieza_general', order, containerNumber)}</title>
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
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_LIMPIEZA_GENERAL}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron controles de limpieza en los meses de trabajo de esta orden.</p>'
    : blocks.map(b => buildLimpiezaGeneralBlockHTML(b, areas)).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlLimpiezaGeneralPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlLimpiezaGeneral(order, containerNumber, data, firmantes)
}

export function controlLimpiezaGeneralExcel(order, containerNumber, { blocks, areas }) {
  const aoa = [
    ['CONTROL DE LIMPIEZA'],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]

  for (const block of blocks) {
    const nDays = new Date(block.year, block.month, 0).getDate()
    const days = Array.from({ length: nDays }, (_, i) => i + 1)
    aoa.push([`${block.year}-${String(block.month).padStart(2, '0')}`, `Responsable: ${block.responsiblePerson ?? ''}`, block.formatoCodigo ? `Código: ${block.formatoCodigo}` : ''])
    aoa.push(['Área / Ítem', 'Tipo', 'Producto', ...days])
    for (const { area, items } of areas) {
      aoa.push([area])
      for (const item of items) {
        aoa.push([
          item.label,
          (item.tipoLimpieza ?? []).join('/'),
          (item.producto ?? []).join('/'),
          ...days.map(d => {
            const status = block.checksByCell?.[area]?.[item.code]?.[d]
            return status === 'correcto' ? 'OK' : status === 'no_correcto' ? 'X' : ''
          }),
        ])
      }
    }
    if (block.observaciones) aoa.push(['Observaciones:', block.observaciones])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Limpieza')
  XLSX.writeFile(wb, `${quickDocFileName('control_limpieza_general', order, containerNumber)}.xlsx`)
}
