import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { loadLimpiezaAmbientesAreas } from '@panela/core/lib/formConfig'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, MONTH_NAMES, daysInMonth, monthsBetween, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_LIMPIEZA_AMBIENTES = 'CONTROL DEL PROGRAMA DE LIMPIEZA Y SANITIZACIÓN DE AMBIENTES'

// Elementos del Control del Programa de Limpieza y Sanitización de
// Ambientes (SIG-GIA-RG-002), por área. Techos/Paredes y Puertas solo
// llevan chequeo de "limpieza"; Pisos lleva "limpieza" Y "sanitización"
// por separado (confirmado con el usuario -- son 2 controles distintos).
export const CLEANING_ELEMENTS = [
  { code: 'techos_paredes', label: 'Techos, Paredes', checks: ['limpieza'] },
  { code: 'puertas',        label: 'Puertas',         checks: ['limpieza'] },
  { code: 'pisos',          label: 'Pisos',           checks: ['limpieza', 'sanitizacion'] },
]
export const CLEANING_CHECK_LABELS = { limpieza: 'Limpieza', sanitizacion: 'Sanitización' }

// Formato físico SIG-GIA-RG-002: registro mensual de planta (independiente
// de cualquier orden, igual criterio que Salud e Higiene del Personal) -- 1
// control por (año, mes), con una grilla área/elemento × día del mes. Para
// el documento de una orden se cruzan por mes los controles cuyo (año, mes)
// cae dentro del rango de trabajo de esa orden.
export async function fetchControlLimpiezaAmbientesData(order) {
  const fechaDesde = order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null
  const fechaHasta = order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null
  if (!fechaDesde || !fechaHasta) return { blocks: [] }

  const months = monthsBetween(fechaDesde, fechaHasta)
  const orFilter = months.map(m => `and(year.eq.${m.year},month.eq.${m.month})`).join(',')

  const [{ data: controls, error }, areas] = await Promise.all([
    supabase
      .from('plant_cleaning_controls')
      .select(`
        id, year, month, responsible_person, observations,
        plant_cleaning_checks ( area, element, check_type, day, status )
      `)
      .or(orFilter)
      .order('year')
      .order('month'),
    loadLimpiezaAmbientesAreas(COOPERATIVE),
  ])
  if (error) throw new Error(error.message)

  const blocks = (controls ?? []).map(c => {
    const checksByCell = {}
    for (const chk of (c.plant_cleaning_checks ?? [])) {
      const byArea = (checksByCell[chk.area] ??= {})
      const byElement = (byArea[chk.element] ??= {})
      const byType = (byElement[chk.check_type] ??= {})
      byType[chk.day] = chk.status
    }
    return {
      year: c.year,
      month: c.month,
      responsiblePerson: c.responsible_person,
      observaciones: c.observations,
      areas,
      checksByCell,
    }
  })

  return { blocks }
}

function buildLimpiezaAmbientesBlockHTML(block) {
  const days = Array.from({ length: daysInMonth(block.year, block.month) }, (_, i) => i + 1)
  const dayHeaders = days.map(d => `<th style="font-size:7px;padding:1px;width:16px">${d}</th>`).join('')

  const rows = []
  for (const area of block.areas) {
    rows.push(`<tr><td colspan="${days.length + 1}" style="background:#e5e5e5;font-weight:700;font-size:9px;padding:2px 5px;text-align:left">${area}</td></tr>`)
    for (const el of CLEANING_ELEMENTS) {
      for (const checkType of el.checks) {
        const label = el.checks.length > 1 ? `${el.label} — ${CLEANING_CHECK_LABELS[checkType]}` : el.label
        const cells = days.map(d => {
          const status = block.checksByCell?.[area]?.[el.code]?.[checkType]?.[d]
          const symbol = status === 'correcto' ? '✓' : status === 'no_correcto' ? '✗' : ''
          const color = status === 'correcto' ? '#166534' : status === 'no_correcto' ? '#991b1b' : '#ccc'
          return `<td style="text-align:center;color:${color};font-weight:700;font-size:9px;padding:1px">${symbol}</td>`
        }).join('')
        rows.push(`<tr><td style="font-size:9px;padding:2px 5px;white-space:nowrap;text-align:left">${label}</td>${cells}</tr>`)
      }
    }
  }

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${MONTH_NAMES[block.month - 1]} ${block.year}</strong> · Responsable: ${escapeHtml(block.responsiblePerson) ?? '—'}
      </div>
      <div style="overflow-x:auto">
        <table class="formato-table" style="min-width:100%">
          <thead><tr><th style="text-align:left;font-size:8px">Área / Elemento</th>${dayHeaders}</tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
      <p style="font-size:9px;margin:4px 0 0;color:#555">✓: Correcto &nbsp;&nbsp; ✗: No es correcto</p>
      ${block.observaciones ? `<p style="font-size:11px;margin:4px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(block.observaciones)}</p>` : ''}
    </div>`
}

export function buildPrintHTMLControlLimpiezaAmbientes(order, containerNumber, data, firmantes) {
  const { blocks } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_limpieza_ambientes', order, containerNumber)}</title>
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
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_LIMPIEZA_AMBIENTES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron controles de limpieza de ambientes en los meses de trabajo de esta orden.</p>'
    : blocks.map(buildLimpiezaAmbientesBlockHTML).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlLimpiezaAmbientesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlLimpiezaAmbientes(order, containerNumber, data, firmantes)
}

export function controlLimpiezaAmbientesExcel(order, containerNumber, { blocks }) {
  const aoa = [
    ['CONTROL DEL PROGRAMA DE LIMPIEZA Y SANITIZACIÓN DE AMBIENTES'],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]

  for (const block of blocks) {
    const nDays = new Date(block.year, block.month, 0).getDate()
    const days = Array.from({ length: nDays }, (_, i) => i + 1)
    aoa.push([`${block.year}-${String(block.month).padStart(2, '0')}`, `Responsable: ${block.responsiblePerson ?? ''}`])
    aoa.push(['Área / Elemento', ...days])
    for (const area of block.areas) {
      aoa.push([area])
      for (const el of CLEANING_ELEMENTS) {
        for (const checkType of el.checks) {
          const label = el.checks.length > 1 ? `${el.label} - ${checkType === 'sanitizacion' ? 'Sanitización' : 'Limpieza'}` : el.label
          aoa.push([label, ...days.map(d => {
            const status = block.checksByCell?.[area]?.[el.code]?.[checkType]?.[d]
            return status === 'correcto' ? 'OK' : status === 'no_correcto' ? 'X' : ''
          })])
        }
      }
    }
    if (block.observaciones) aoa.push(['Observaciones:', block.observaciones])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Limpieza Ambientes')
  XLSX.writeFile(wb, `${quickDocFileName('control_limpieza_ambientes', order, containerNumber)}.xlsx`)
}
