import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, MONTH_NAMES, daysInMonth, monthsBetween, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_HIGIENE_PERSONAL_CAES = 'CONTROL DE HIGIENE DEL PERSONAL'

// Control de Higiene del Personal (CAESP-PP-HYS-RE-HSP-003) -- SOLO CAES,
// ver COOPERATIVE.features.higieneGrillaMensual en lib/config.js. Registro
// MENSUAL (año, mes, turno) con grilla persona × ítem × día -- 8 ítems
// fijos por persona, mismo shape que Limpieza de Equipos (área/equipo ×
// día) con "persona" haciendo de área. La zona de trabajo (Tamizado y
// Homogenizado / Envasado) es un dato de la persona dentro de ese control.
export const HYGIENE_CAES_ITEMS = [
  { code: 'vestimenta', label: 'Vestimenta adecuada' },
  { code: 'sin_maquillaje', label: 'Sin maquillaje' },
  { code: 'unas_limpias', label: 'Uñas cortas y limpias' },
  { code: 'sin_joyas', label: 'Sin joyas' },
  { code: 'cabello_corto', label: 'Cabello corto' },
  { code: 'cabello_recogido', label: 'Cabello recogido' },
  { code: 'afeitado', label: 'Afeitado' },
  { code: 'heridas_cortes', label: 'Heridas o cortes descubiertos' },
]

export const HYGIENE_CAES_ZONAS = {
  tamizado_homogenizado: 'Tamizado y Homogenizado',
  envasado: 'Envasado',
}

export const HYGIENE_CAES_TURNOS = { manana: 'Mañana', tarde: 'Tarde' }

// Formato físico: registro mensual de planta (mismo criterio que Ambientes/
// Equipos) -- 1 control por (año, mes, turno), con una grilla persona/ítem
// × día del mes. Para el documento de una orden se cruzan por mes los
// controles cuyo (año, mes) cae dentro del rango de trabajo de esa orden.
// dateRange ({ desde, hasta }) opcional -- lo pasa el Resumen de
// Trazabilidad cuando necesita un rango distinto al de la orden completa
// (ver [[project_resumen_trazabilidad_fechas_por_control]]); sin él, se
// calcula del rango de trabajo de la orden como siempre (documento suelto).
export async function fetchControlHigienePersonalCaesData(order, dateRange) {
  const fechaDesde = dateRange?.desde ?? (order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null)
  const fechaHasta = dateRange?.hasta ?? (order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null)
  if (!fechaDesde || !fechaHasta) return { blocks: [] }

  const months = monthsBetween(fechaDesde, fechaHasta)
  const orFilter = months.map(m => `and(year.eq.${m.year},month.eq.${m.month})`).join(',')

  const { data: controls, error } = await supabase
    .from('plant_hygiene_controls_caes')
    .select(`
      id, year, month, turno, responsible_person, observations, formato_codigo,
      plant_hygiene_checks_caes ( personnel_id, zona, item, day, status,
        plant_personnel ( first_name, last_name )
      )
    `)
    .or(orFilter)
    .order('year')
    .order('month')
  if (error) throw new Error(error.message)

  const blocks = (controls ?? []).map(c => {
    const personsById = {}
    for (const chk of (c.plant_hygiene_checks_caes ?? [])) {
      const person = (personsById[chk.personnel_id] ??= {
        name: chk.plant_personnel ? `${chk.plant_personnel.first_name} ${chk.plant_personnel.last_name}` : '—',
        zona: chk.zona,
        checksByItem: {},
      })
      const byDay = (person.checksByItem[chk.item] ??= {})
      byDay[chk.day] = chk.status
    }
    return {
      year: c.year,
      month: c.month,
      turno: c.turno,
      responsiblePerson: c.responsible_person,
      observaciones: c.observations,
      formatoCodigo: c.formato_codigo,
      persons: Object.values(personsById),
    }
  })

  return { blocks }
}

function buildHigienePersonalCaesBlockHTML(block) {
  const days = Array.from({ length: daysInMonth(block.year, block.month) }, (_, i) => i + 1)
  const dayHeaders = days.map(d => `<th style="font-size:7px;padding:1px;width:16px">${d}</th>`).join('')

  const rows = []
  for (const person of block.persons) {
    const zonaLabel = HYGIENE_CAES_ZONAS[person.zona] ?? person.zona
    rows.push(`<tr><td colspan="${days.length + 1}" style="background:#e5e5e5;font-weight:700;font-size:9px;padding:2px 5px;text-align:left">${escapeHtml(person.name)} — ${escapeHtml(zonaLabel)}</td></tr>`)
    for (const item of HYGIENE_CAES_ITEMS) {
      const cells = days.map(d => {
        const status = person.checksByItem?.[item.code]?.[d]
        const symbol = status === 'correcto' ? '✓' : status === 'no_correcto' ? '✗' : ''
        const color = status === 'correcto' ? '#166534' : status === 'no_correcto' ? '#991b1b' : '#ccc'
        return `<td style="text-align:center;color:${color};font-weight:700;font-size:8px;padding:1px">${symbol}</td>`
      }).join('')
      rows.push(`<tr><td style="font-size:9px;padding:2px 5px;white-space:nowrap;text-align:left">${item.label}</td>${cells}</tr>`)
    }
  }

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${MONTH_NAMES[block.month - 1]} ${block.year} — ${HYGIENE_CAES_TURNOS[block.turno] ?? block.turno}</strong> · Responsable: ${escapeHtml(block.responsiblePerson) ?? '—'}${block.formatoCodigo ? ` · Código: ${escapeHtml(block.formatoCodigo)}` : ''}
      </div>
      <div style="overflow-x:auto">
        <table class="formato-table" style="min-width:100%">
          <thead><tr><th style="text-align:left;font-size:8px">Persona / Ítem</th>${dayHeaders}</tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
      <p style="font-size:9px;margin:4px 0 0;color:#555">✓: Conforme &nbsp;&nbsp; ✗: No conforme</p>
      ${block.observaciones ? `<p style="font-size:11px;margin:4px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(block.observaciones)}</p>` : ''}
    </div>`
}

export function buildPrintHTMLControlHigienePersonalCaes(order, containerNumber, data, firmantes) {
  const { blocks } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_higiene_personal_caes', order, containerNumber)}</title>
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
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_HIGIENE_PERSONAL_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron controles de higiene del personal en los meses de trabajo de esta orden.</p>'
    : blocks.map(buildHigienePersonalCaesBlockHTML).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlHigienePersonalCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlHigienePersonalCaes(order, containerNumber, data, firmantes)
}

export function controlHigienePersonalCaesExcel(order, containerNumber, { blocks }) {
  const aoa = [
    [FORMAT_TITLE_HIGIENE_PERSONAL_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]

  for (const block of blocks) {
    const nDays = new Date(block.year, block.month, 0).getDate()
    const days = Array.from({ length: nDays }, (_, i) => i + 1)
    aoa.push([`${block.year}-${String(block.month).padStart(2, '0')} - ${HYGIENE_CAES_TURNOS[block.turno] ?? block.turno}`, `Responsable: ${block.responsiblePerson ?? ''}`, block.formatoCodigo ? `Código: ${block.formatoCodigo}` : ''])
    aoa.push(['Persona / Ítem', ...days])
    for (const person of block.persons) {
      aoa.push([`${person.name} — ${HYGIENE_CAES_ZONAS[person.zona] ?? person.zona}`])
      for (const item of HYGIENE_CAES_ITEMS) {
        aoa.push([item.label, ...days.map(d => {
          const status = person.checksByItem?.[item.code]?.[d]
          return status === 'correcto' ? 'OK' : status === 'no_correcto' ? 'X' : ''
        })])
      }
    }
    if (block.observaciones) aoa.push(['Observaciones:', block.observaciones])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Higiene Personal')
  XLSX.writeFile(wb, `${quickDocFileName('control_higiene_personal_caes', order, containerNumber)}.xlsx`)
}
