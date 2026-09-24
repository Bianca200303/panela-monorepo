import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_CONTROL_PLAGAS = 'CONTROL DE PLAGAS'

// Catálogos del Control de Plagas (SIG-GIA-RG-007) -- registro por FECHA
// exacta, independiente de cualquier orden/lote. Jaulas mecánicas y trampas
// de goma comparten exactamente las mismas columnas en el papel físico real
// (Operatividad, Evidencia, Roedores atrapados, N° de roedor atrapado) --
// unificadas aquí en un solo catálogo con `deviceType` para distinguirlas.
// Trampas de luz es un esquema totalmente distinto (conteo por especie de
// insecto, 10 columnas fijas). Fijo en código, no configurable vía
// form_configurations.
export const RODENT_TRAPS = [
  { code: 'J13', deviceType: 'jaula', label: 'N° de jaula: J13' },
  { code: 'J14', deviceType: 'jaula', label: 'N° de jaula: J14' },
  { code: 'J15', deviceType: 'jaula', label: 'N° de jaula: J15' },
  { code: 'J16', deviceType: 'jaula', label: 'N° de jaula: J16' },
  { code: 'J17', deviceType: 'jaula', label: 'N° de jaula: J17' },
  { code: 'J18', deviceType: 'jaula', label: 'N° de jaula: J18' },
  { code: 'T21', deviceType: 'trampa_goma', label: 'N° de trampa: T21' },
  { code: 'T22', deviceType: 'trampa_goma', label: 'N° de trampa: T22' },
  { code: 'T23', deviceType: 'trampa_goma', label: 'N° de trampa: T23' },
  { code: 'T24', deviceType: 'trampa_goma', label: 'N° de trampa: T24' },
  { code: 'T25', deviceType: 'trampa_goma', label: 'N° de trampa: T25' },
  { code: 'T26', deviceType: 'trampa_goma', label: 'N° de trampa: T26' },
  { code: 'T31', deviceType: 'trampa_goma', label: 'N° de trampa: T31' },
  { code: 'T32', deviceType: 'trampa_goma', label: 'N° de trampa: T32' },
]
export const RODENT_DEVICE_TYPE_LABELS = { jaula: 'Jaulas mecánicas', trampa_goma: 'Trampas de goma' }

export const LIGHT_TRAPS = [
  { code: '01', label: 'N° de trampa: 01', place: 'Aduana Sanitaria' },
  { code: '02', label: 'N° de trampa: 02', place: 'Envasado' },
  { code: '03', label: 'N° de trampa: 03', place: 'Envasado' },
  { code: '04', label: 'N° de trampa: 04', place: 'Envasado' },
  { code: '05', label: 'N° de trampa: 05', place: 'Almacén PT' },
  { code: '06', label: 'N° de trampa: 06', place: 'Almacén MP' },
]

// Especies de la leyenda del papel: MD, MC, AB, E, P, Z, MQ, AV, L, más
// "Otros" para lo que no encaje en la leyenda.
export const INSECT_SPECIES = [
  { code: 'md', label: 'MD', fullLabel: 'Mosca doméstica' },
  { code: 'mc', label: 'MC', fullLabel: 'Mosca de carne' },
  { code: 'ab', label: 'AB', fullLabel: 'Abeja' },
  { code: 'e', label: 'E', fullLabel: 'Escarabajo' },
  { code: 'p', label: 'P', fullLabel: 'Polilla' },
  { code: 'z', label: 'Z', fullLabel: 'Zancudo' },
  { code: 'mq', label: 'MQ', fullLabel: 'Mosquito' },
  { code: 'av', label: 'AV', fullLabel: 'Avispa' },
  { code: 'l', label: 'L', fullLabel: 'Luciérnagas' },
  { code: 'otros', label: 'Otros', fullLabel: 'Otros' },
]

// Formato físico SIG-GIA-RG-007: registro por FECHA exacta, con 2 tipos de
// dispositivo -- trampas de roedores (jaulas + trampas de goma, mismas
// columnas) y trampas de luz (conteo por especie de insecto). Se cruza por
// fecha exacta contra el rango de trabajo de la orden, mismo criterio que
// Higiene/Verificación/Cloro Residual.
// dateRange ({ desde, hasta }) opcional -- lo pasa el Resumen de
// Trazabilidad cuando necesita un rango distinto al de la orden completa;
// sin él, se calcula como siempre (documento suelto).
export async function fetchControlPlagasData(order, dateRange) {
  const fechaDesde = dateRange?.desde ?? (order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null)
  const fechaHasta = dateRange?.hasta ?? (order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null)
  if (!fechaDesde || !fechaHasta) return { blocks: [] }

  const { data: controls, error } = await supabase
    .from('plant_pest_controls')
    .select(`
      id, control_date, responsible_person, formato_codigo,
      ambientes_equipo_personal_ok, ambientes_equipo_personal_observaciones,
      plant_rodent_trap_checks ( device_type, device_code, operatividad, evidencia, atrapados, cantidad_atrapada, observations, corrective_action ),
      plant_light_trap_checks ( * )
    `)
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
  if (error) throw new Error(error.message)

  const blocks = (controls ?? []).map(c => {
    const rodentByDevice = {}
    for (const r of (c.plant_rodent_trap_checks ?? [])) {
      rodentByDevice[r.device_code] = {
        operatividad: r.operatividad, evidencia: r.evidencia, atrapados: r.atrapados,
        cantidadAtrapada: r.cantidad_atrapada, observations: r.observations, correctiveAction: r.corrective_action,
      }
    }
    const lightByTrap = {}
    for (const r of (c.plant_light_trap_checks ?? [])) {
      const counts = {}
      for (const sp of INSECT_SPECIES) counts[sp.code] = r[`${sp.code}_count`]
      lightByTrap[r.trap_code] = { operatividad: r.operatividad, counts, observations: r.observations, correctiveAction: r.corrective_action }
    }
    return {
      controlDate: c.control_date,
      codigo: c.formato_codigo,
      responsiblePerson: c.responsible_person,
      rodentByDevice,
      lightByTrap,
      ambientesEquipoPersonalOk: c.ambientes_equipo_personal_ok,
      ambientesEquipoPersonalObservaciones: c.ambientes_equipo_personal_observaciones,
    }
  })

  return { blocks }
}

function symbolFor(status, okValue, badValue) {
  if (status === okValue) return { symbol: '✓', color: '#166534' }
  if (status === badValue) return { symbol: '✗', color: '#991b1b' }
  return { symbol: '', color: '#ccc' }
}

function buildPlagasBlockHTML(block) {
  const rodentRows = RODENT_TRAPS.map(trap => {
    const cell = block.rodentByDevice?.[trap.code] ?? {}
    const op = symbolFor(cell.operatividad, 'operativo', 'no_operativo')
    const ev = symbolFor(cell.evidencia, 'si', 'no')
    const at = symbolFor(cell.atrapados, 'si', 'no')
    return `<tr>
      <td style="font-size:9px;padding:2px 5px;white-space:nowrap;text-align:left">${trap.label}</td>
      <td style="text-align:center;color:${op.color};font-weight:700;font-size:10px">${op.symbol}</td>
      <td style="text-align:center;color:${ev.color};font-weight:700;font-size:10px">${ev.symbol}</td>
      <td style="text-align:center;color:${at.color};font-weight:700;font-size:10px">${at.symbol}</td>
      <td style="text-align:center;font-size:9px">${cell.cantidadAtrapada ?? ''}</td>
      <td style="font-size:9px;padding:2px 5px;text-align:left">${escapeHtml(cell.observations) ?? ''}</td>
      <td style="font-size:9px;padding:2px 5px;text-align:left">${cell.correctiveAction ?? ''}</td>
    </tr>`
  }).join('')

  const lightRows = LIGHT_TRAPS.map(trap => {
    const cell = block.lightByTrap?.[trap.code] ?? {}
    const op = symbolFor(cell.operatividad, 'operativo', 'no_operativo')
    const counts = INSECT_SPECIES.map(sp => `<td style="text-align:center;font-size:9px">${cell.counts?.[sp.code] ?? ''}</td>`).join('')
    return `<tr>
      <td style="font-size:9px;padding:2px 5px;white-space:nowrap;text-align:left">${trap.label}<br/><span style="color:#666">Lugar: ${trap.place}</span></td>
      <td style="text-align:center;color:${op.color};font-weight:700;font-size:10px">${op.symbol}</td>
      ${counts}
      <td style="font-size:9px;padding:2px 5px;text-align:left">${escapeHtml(cell.observations) ?? ''}</td>
      <td style="font-size:9px;padding:2px 5px;text-align:left">${cell.correctiveAction ?? ''}</td>
    </tr>`
  }).join('')

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${block.controlDate ? new Date(`${block.controlDate}T00:00:00`).toLocaleDateString('es-PE') : '—'}</strong> · Responsable: ${escapeHtml(block.responsiblePerson) ?? '—'}
      </div>
      <p style="font-size:10px;font-weight:700;margin:6px 0 2px">Roedores</p>
      <table class="formato-table" style="width:100%">
        <thead><tr>
          <th style="text-align:left">Dispositivo</th><th>Operatividad</th><th>Evidencia</th><th>Atrapados</th><th>N° roedor</th>
          <th style="text-align:left">Observaciones</th><th style="text-align:left">Acción Correctiva</th>
        </tr></thead>
        <tbody>${rodentRows}</tbody>
      </table>
      <p style="font-size:10px;font-weight:700;margin:10px 0 2px">Insectos — Trampas de luz</p>
      <div style="overflow-x:auto">
        <table class="formato-table" style="min-width:100%">
          <thead><tr>
            <th style="text-align:left">Trampa</th><th>Operatividad</th>
            ${INSECT_SPECIES.map(sp => `<th title="${sp.fullLabel}">${sp.label}</th>`).join('')}
            <th style="text-align:left">Observaciones</th><th style="text-align:left">Acción Correctiva</th>
          </tr></thead>
          <tbody>${lightRows}</tbody>
        </table>
      </div>
      <p style="font-size:9px;margin:4px 0 0;color:#555">
        MD:mosca doméstica, MC:mosca de carne, AB:abeja, E:escarabajo, P:polilla, Z:zancudo, MQ:mosquito, AV:avispa, L:luciérnagas.
        Para control de insectos se usa insectocutores con lámina adhesiva.
      </p>
    </div>`
}

export function buildPrintHTMLControlPlagas(order, containerNumber, data, firmantes) {
  const { blocks } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_plagas', order, containerNumber)}</title>
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
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_CONTROL_PLAGAS}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron controles de plagas en el rango de fechas de trabajo de esta orden.</p>'
    : blocks.map(buildPlagasBlockHTML).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlPlagasPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlPlagas(order, containerNumber, data, firmantes)
}

export function controlPlagasExcel(order, containerNumber, { blocks }) {
  const aoa = [
    ['CONTROL DE PLAGAS'],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]

  for (const block of blocks) {
    aoa.push([block.controlDate, `Responsable: ${block.responsiblePerson ?? ''}`])
    aoa.push(['Roedores'])
    aoa.push(['Dispositivo', 'Operatividad', 'Evidencia', 'Atrapados', 'N° roedor', 'Observaciones', 'Acción Correctiva'])
    for (const trap of RODENT_TRAPS) {
      const cell = block.rodentByDevice?.[trap.code] ?? {}
      aoa.push([trap.label, cell.operatividad ?? '', cell.evidencia ?? '', cell.atrapados ?? '', cell.cantidadAtrapada ?? '', cell.observations ?? '', cell.correctiveAction ?? ''])
    }
    aoa.push([])
    aoa.push(['Insectos - Trampas de luz'])
    aoa.push(['Trampa', 'Lugar', 'Operatividad', ...INSECT_SPECIES.map(sp => sp.label), 'Observaciones', 'Acción Correctiva'])
    for (const trap of LIGHT_TRAPS) {
      const cell = block.lightByTrap?.[trap.code] ?? {}
      aoa.push([trap.label, trap.place, cell.operatividad ?? '', ...INSECT_SPECIES.map(sp => cell.counts?.[sp.code] ?? ''), cell.observations ?? '', cell.correctiveAction ?? ''])
    }
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Control Plagas')
  XLSX.writeFile(wb, `${quickDocFileName('control_plagas', order, containerNumber)}.xlsx`)
}
