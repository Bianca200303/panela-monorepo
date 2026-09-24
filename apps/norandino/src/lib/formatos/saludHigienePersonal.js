import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, fmtDate, buildFirmasHTML, quickDocFileName, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_SALUD_HIGIENE_PERSONAL = 'CONTROL DE SALUD E HIGIENE DEL PERSONAL'

// Los 9 criterios del Control de Salud e Higiene del Personal (SIG-GIA-RG-005)
// -- son los MISMOS para cualquier área (Envasado, Tamizado, etc.), a
// diferencia de FCPO_CRITERIA (fcpo.js) que es para el productor en su
// propio lote de campo. Exportado porque tanto la página de registro
// (HigienePage.jsx) como el documento de abajo lo necesitan.
export const HYGIENE_CRITERIA = [
  { code: 'unas_manos_limpias',            label: 'Uñas cortas y manos limpias' },
  { code: 'uniforme',                      label: 'Uso de uniforme' },
  { code: 'cabello',                       label: 'Cabello corto o recogido, y limpio' },
  { code: 'rostro_sin_maquillaje',         label: 'Rostro sin maquillaje' },
  { code: 'barba',                         label: 'Barba corta y/o recogida' },
  { code: 'sin_joyas_accesorios_perfume',  label: 'Sin joyas, accesorios, ni perfume' },
  { code: 'gafas',                         label: 'Gafas en buen estado' },
  { code: 'ausencia_cortes_heridas',       label: 'Ausencia de cortes o heridas' },
  { code: 'ausencia_signos_enfermedad',    label: 'Ausencia de signos de enfermedad' },
]

// Formato físico SIG-GIA-RG-005: el registro (plant_hygiene_controls) es
// independiente de cualquier orden/lote -- 1 control por fecha+turno+área,
// sin FK a la orden (una misma inspección puede aplicar a varios
// contenedores activos ese día). Para armar el documento de una orden se
// cruzan por fecha los controles cuyo control_date cae dentro del rango de
// trabajo de esa orden (tamizado_fecha_inicio..envasado_fecha_fin). Un
// bloque por control encontrado, un renglón por trabajador de ese control.
// dateRange ({ desde, hasta }) opcional -- lo pasa el Resumen de
// Trazabilidad cuando necesita un rango distinto al de la orden completa;
// sin él, se calcula como siempre (documento suelto).
export async function fetchControlSaludHigienePersonalData(order, dateRange) {
  // Tolerante a que falte alguna de las 4 fechas (ej. la orden todavía no
  // tiene envasado cargado, o nunca tuvo tamizado) -- toma la que haya como
  // límite, en vez de exigir las 4 y devolver vacío sin avisar nada si
  // falta una sola.
  const fechaDesde = dateRange?.desde ?? (order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null)
  const fechaHasta = dateRange?.hasta ?? (order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null)
  if (!fechaDesde || !fechaHasta) return { blocks: [] }

  const { data: controls, error } = await supabase
    .from('plant_hygiene_controls')
    .select(`
      id, control_date, turno, area, responsible_person, observations, formato_codigo,
      plant_hygiene_control_workers (
        attended,
        plant_personnel ( first_name, last_name ),
        plant_hygiene_control_criteria ( item_code, status )
      )
    `)
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
    .order('turno')
    .order('area')
  if (error) throw new Error(error.message)

  const blocks = (controls ?? []).map(c => ({
    fecha: c.control_date,
    codigo: c.formato_codigo,
    turno: c.turno,
    area: c.area,
    responsable: c.responsible_person,
    observaciones: c.observations,
    workers: (c.plant_hygiene_control_workers ?? []).map(w => ({
      name: w.plant_personnel ? `${w.plant_personnel.first_name} ${w.plant_personnel.last_name}` : '—',
      attended: w.attended,
      criteria: Object.fromEntries((w.plant_hygiene_control_criteria ?? []).map(cr => [cr.item_code, cr.status])),
    })),
  }))

  return { blocks }
}

function buildHigienePersonalBlockHTML(block) {
  const bodyRows = block.workers.map(w => {
    const critCells = HYGIENE_CRITERIA.map(c => {
      if (!w.attended) return `<td style="text-align:center">—</td>`
      const status = w.criteria?.[c.code]
      const symbol = status === 'cumple' ? '✓' : status === 'no_cumple' ? '✗' : '—'
      return `<td style="text-align:center">${symbol}</td>`
    }).join('')
    return `<tr>
      <td>${escapeHtml(w.name)}${!w.attended ? ' <span style="color:#991b1b;font-size:9px">(no asistió)</span>' : ''}</td>
      ${critCells}
    </tr>`
  }).join('')

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>Fecha: ${fmtDate(block.fecha)}</strong> · Turno: ${block.turno === 'tarde' ? 'Tarde' : 'Mañana'} · Área: ${escapeHtml(block.area)} · Responsable: ${escapeHtml(block.responsable) ?? '—'}
      </div>
      <table class="formato-table">
        <thead>
          <tr>
            <th style="text-align:left">Nombres y Apellidos</th>
            ${HYGIENE_CRITERIA.map(c => `<th>${c.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
      ${block.observaciones ? `<p style="font-size:11px;margin:6px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(block.observaciones)}</p>` : ''}
    </div>`
}

export function buildPrintHTMLControlSaludHigienePersonal(order, containerNumber, data, firmantes) {
  const { blocks } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_salud_higiene_personal', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
    .formato-table th { font-size: 9px; }
    .formato-table td { font-size: 10px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${COOPERATIVE?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_SALUD_HIGIENE_PERSONAL}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron controles de higiene en el rango de fechas de trabajo de esta orden.</p>'
    : blocks.map(buildHigienePersonalBlockHTML).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlSaludHigienePersonalPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlSaludHigienePersonal(order, containerNumber, data, firmantes)
}

export function controlSaludHigienePersonalExcel(order, containerNumber, { blocks }) {
  const aoa = [
    ['CONTROL DE SALUD E HIGIENE DEL PERSONAL'],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]
  const cols = ['Nombres y Apellidos', ...HYGIENE_CRITERIA.map(c => c.label)]

  for (const block of blocks) {
    aoa.push([`Fecha: ${block.fecha}`, `Turno: ${block.turno}`, `Área: ${block.area}`, `Responsable: ${block.responsable ?? ''}`])
    aoa.push(cols)
    for (const w of block.workers) {
      aoa.push([
        w.attended ? w.name : `${w.name} (no asistió)`,
        ...HYGIENE_CRITERIA.map(c => w.attended ? (w.criteria?.[c.code] ?? '') : ''),
      ])
    }
    if (block.observaciones) aoa.push(['Observaciones:', block.observaciones])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Higiene Personal')
  XLSX.writeFile(wb, `${quickDocFileName('control_salud_higiene_personal', order, containerNumber)}.xlsx`)
}
