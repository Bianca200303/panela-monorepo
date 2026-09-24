import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { loadVerificacionLimpiezaAreas } from '@panela/core/lib/formConfig'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_VERIFICACION_LIMPIEZA = 'VERIFICACIÓN DEL PROGRAMA DE LIMPIEZA Y SANITIZACIÓN'

// Ahora vive en packages/core -- ya no puede importar un COOPERATIVE fijo
// (ver plan de migración a monorepo), así que todo lo que antes leía el
// módulo COOPERATIVE ahora lo recibe como parámetro explícito, pasado por
// quien llama (cada app conoce su propia cooperativa vía su lib/config.js
// local o useCooperative()).
//
// Áreas e ítems de la Verificación del Programa de Limpieza y Sanitización
// (SIG-GIA-RG-009 en Norandino, HYS-002 "Inspección de Ambientes, Equipos y
// Personal" en CAES) -- registro por FECHA exacta (no mensual), auditoría
// general de planta que combina en un solo formulario lo que Ambientes
// (estructura física) y Equipos (equipos puntuales) cubren por separado,
// más personal, plagas y residuos. Tabla independiente de Ambientes/Equipos
// aunque varios nombres de área/ítem coincidan -- son auditorías distintas,
// con su propio código de formato. Las áreas/ítems salen de
// form_configurations -- configurable por cooperativa (ver migración
// 20260913150000_verificacion_limpieza_areas_caes.sql para el catálogo de
// CAES), ver lib/formConfig.js loadVerificacionLimpiezaAreas(). El texto de
// la nota "Personal *" también difiere palabra por palabra entre
// cooperativas -- ver cooperative.features.personalCheckNote.
export function getCleaningVerificationPersonalNote(cooperative) {
  return cooperative?.features?.personalCheckNote
    ?? 'Personal *: Revisar correcto uso del uniforme, uñas y manos limpias, cabello limpio y recogido, sin joyas y accesorios, conducta adecuada, sin maquillaje.'
}

// Códigos de ítems que no todas las cooperativas tienen -- se sacan de la
// grilla según cooperative.features, encima de lo que venga configurado
// (para no tener que repetir la exclusión en cada config de cooperativa).
const OPTIONAL_ITEM_FEATURE = {
  detector_metales: 'detectorMetales',
  envolvedor_pallets: 'pallets',
}

export async function loadCleaningVerificationAreas(cooperative) {
  const areas = await loadVerificacionLimpiezaAreas(cooperative)
  return areas.map(({ area, items }) => ({
    area,
    items: items.filter(it => {
      const feature = OPTIONAL_ITEM_FEATURE[it.code]
      return !feature || cooperative?.features?.[feature]
    }),
  }))
}

// El registro (plant_cleaning_verification_controls) es por FECHA exacta,
// independiente de cualquier orden -- se cruza por fecha exacta dentro del
// rango de trabajo de la orden, mismo criterio que Salud e Higiene del
// Personal (a diferencia de Ambientes/Equipos, que se cruzan por mes).
// dateRange ({ desde, hasta }) opcional -- lo pasa el Resumen de
// Trazabilidad cuando necesita un rango distinto al de la orden completa;
// sin él, se calcula como siempre (documento suelto).
export async function fetchControlVerificacionLimpiezaData(cooperative, order, dateRange) {
  const fechaDesde = dateRange?.desde ?? (order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null)
  const fechaHasta = dateRange?.hasta ?? (order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null)
  if (!fechaDesde || !fechaHasta) return { blocks: [], areas: [] }

  const areas = await loadCleaningVerificationAreas(cooperative)
  const { data: controls, error } = await supabase
    .from('plant_cleaning_verification_controls')
    .select(`
      id, control_date, responsible_person, observations, formato_codigo,
      plant_cleaning_verification_checks ( area, item, status, corrective_action )
    `)
    .gte('control_date', fechaDesde)
    .lte('control_date', fechaHasta)
    .order('control_date')
  if (error) throw new Error(error.message)

  const blocks = (controls ?? []).map(c => {
    const checksByCell = {}
    for (const chk of (c.plant_cleaning_verification_checks ?? [])) {
      const byArea = (checksByCell[chk.area] ??= {})
      byArea[chk.item] = { status: chk.status, correctiveAction: chk.corrective_action }
    }
    return {
      controlDate: c.control_date,
      codigo: c.formato_codigo,
      responsiblePerson: c.responsible_person,
      observaciones: c.observations,
      checksByCell,
    }
  })

  return { blocks, areas }
}

function buildVerificacionLimpiezaBlockHTML(cooperative, block, areas) {
  const rows = []
  for (const { area, items } of areas) {
    rows.push(`<tr><td colspan="3" style="background:#e5e5e5;font-weight:700;font-size:10px;padding:2px 5px;text-align:left">${area}</td></tr>`)
    for (const item of items) {
      const cell = block.checksByCell?.[area]?.[item.code]
      const symbol = cell?.status === 'correcto' ? '✓' : cell?.status === 'no_correcto' ? '✗' : ''
      const color = cell?.status === 'correcto' ? '#166534' : cell?.status === 'no_correcto' ? '#991b1b' : '#ccc'
      rows.push(`<tr>
        <td style="font-size:10px;padding:2px 5px;white-space:nowrap;text-align:left">${item.label}</td>
        <td style="text-align:center;color:${color};font-weight:700;font-size:11px;padding:1px;width:60px">${symbol}</td>
        <td style="font-size:10px;padding:2px 5px;text-align:left">${cell?.correctiveAction ?? ''}</td>
      </tr>`)
    }
  }

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${block.controlDate ? new Date(`${block.controlDate}T00:00:00`).toLocaleDateString('es-PE') : '—'}</strong> · Responsable: ${escapeHtml(block.responsiblePerson) ?? '—'}
      </div>
      <table class="formato-table" style="width:100%">
        <thead><tr><th style="text-align:left">Área / Descripción</th><th>Condición</th><th style="text-align:left">Acciones Correctivas</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <p style="font-size:9px;margin:4px 0 0;color:#555">✓: Correcto &nbsp;&nbsp; ✗: No es correcto &nbsp;&nbsp; ${getCleaningVerificationPersonalNote(cooperative)}</p>
      ${block.observaciones ? `<p style="font-size:11px;margin:4px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(block.observaciones)}</p>` : ''}
    </div>`
}

export function buildPrintHTMLControlVerificacionLimpieza(cooperative, order, containerNumber, data, firmantes) {
  const { blocks, areas } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_verificacion_limpieza', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    .formato-table th { font-size: 9px; }
    .formato-table td { font-size: 10px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${cooperative?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_VERIFICACION_LIMPIEZA}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron verificaciones de limpieza en el rango de fechas de trabajo de esta orden.</p>'
    : blocks.map(b => buildVerificacionLimpiezaBlockHTML(cooperative, b, areas)).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlVerificacionLimpiezaPdf(cooperative, order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlVerificacionLimpieza(cooperative, order, containerNumber, data, firmantes)
}

export function controlVerificacionLimpiezaExcel(order, containerNumber, { blocks, areas }) {
  const aoa = [
    ['VERIFICACIÓN DEL PROGRAMA DE LIMPIEZA Y SANITIZACIÓN'],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]

  for (const block of blocks) {
    aoa.push([block.controlDate, `Responsable: ${block.responsiblePerson ?? ''}`])
    aoa.push(['Área / Descripción', 'Condición', 'Acciones Correctivas'])
    for (const { area, items } of areas) {
      aoa.push([area])
      for (const item of items) {
        const cell = block.checksByCell?.[area]?.[item.code]
        const mark = cell?.status === 'correcto' ? 'OK' : cell?.status === 'no_correcto' ? 'X' : ''
        aoa.push([item.label, mark, cell?.correctiveAction ?? ''])
      }
    }
    if (block.observaciones) aoa.push(['Observaciones:', block.observaciones])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Verificacion Limpieza')
  XLSX.writeFile(wb, `${quickDocFileName('control_verificacion_limpieza', order, containerNumber)}.xlsx`)
}
