import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { loteLabel } from '@panela/core/lib/loteHelpers'
import { PRINT_STYLES, fmtDate, fmtNum, buildFirmasHTML, quickDocFileName, escapeHtml } from '@panela/core/lib/formatos/shared'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { getLoteLabel } from '@panela/core/lib/labels'

const LOTE_LABEL = getLoteLabel(COOPERATIVE)

export const FORMAT_TITLE_CONTROL_CUERPOS_EXTRANOS = 'INSPECCIÓN DE CUERPOS EXTRAÑOS'

// Formato físico SIG-PPA-GIA-RG-001: una página por formulario diario
// (`plant_batch_foreign_object_forms`, 1 por lote y fecha), con un renglón
// por inspección (`plant_batch_foreign_object_checks`).
//
// Cada inspección es una de dos cosas excluyentes: 'prueba' (calibración,
// sin bolsas reales) o 'rechazo' (bolsa real separada, sin test/conformidad).
// "Cantidad de rechazos indicado en el equipo" sigue siendo inspection_number
// -- el correlativo que ya asigna la base de datos, equivalente al contador
// físico del equipo porque ambos cuentan bolsa por bolsa.
export async function fetchControlCuerposExtranosData(order) {
  const batches = order.plant_production_batches ?? []
  const batchIds = batches.map(b => b.id)
  if (batchIds.length === 0) return { blocks: [] }

  const { data: forms, error } = await supabase
    .from('plant_batch_foreign_object_forms')
    .select('id, plant_batch_id, control_date, responsible_person, final_observations, plant_batch_foreign_object_checks ( inspection_number, check_time, check_type, bags_separated, test_type, conforme )')
    .in('plant_batch_id', batchIds)
    .order('control_date')
  if (error) throw new Error(error.message)

  const batchById = {}
  for (const b of batches) batchById[b.id] = b

  // T1 = bolsas rechazadas de verdad (solo inspecciones tipo 'rechazo').
  // T2 = T1 + pruebas de calibración hechas ('prueba') -- total de veces
  // que se sacó algo de la línea, sea rechazo real o pieza de prueba.
  const blocks = (forms ?? []).map(f => {
    const batch = batchById[f.plant_batch_id]
    const checks = (f.plant_batch_foreign_object_checks ?? []).slice().sort((a, b) => a.inspection_number - b.inspection_number)
    const t1 = checks.filter(c => c.check_type === 'rechazo').reduce((s, c) => s + Number(c.bags_separated ?? 0), 0)
    const pruebas = checks.filter(c => c.check_type === 'prueba').length
    return {
      lote: loteLabel(batch),
      fecha: f.control_date,
      responsable: f.responsible_person,
      descripcionBolsa: batch?.plant_product_catalog?.description ?? null,
      packagingKg: batch?.packaging_kg != null ? Number(batch.packaging_kg) : null,
      observaciones: f.final_observations,
      checks,
      t1,
      t2: t1 + pruebas,
    }
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.lote.localeCompare(b.lote))

  return { blocks }
}

function buildCuerposExtranosBlockHTML(block) {
  const bodyRows = block.checks.map(c => `
    <tr>
      <td style="text-align:center">${(c.check_time ?? '').slice(0, 5)}</td>
      <td style="text-align:center">${c.check_type === 'rechazo' ? 'Rechazo' : 'Prueba'}</td>
      <td style="text-align:center">${c.check_type === 'rechazo' && c.bags_separated > 0 ? c.bags_separated : '—'}</td>
      <td style="text-align:center">${String(c.inspection_number).padStart(2, '0')}</td>
      <td style="text-align:center">${c.check_type === 'prueba' ? (c.test_type ?? '—') : '—'}</td>
      <td style="text-align:center">${c.check_type === 'prueba' ? (c.conforme ? '✓' : '✗') : '—'}</td>
    </tr>`).join('')

  const panelaRechazadaKg = block.t1 * (block.packagingKg ?? 0)

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${LOTE_LABEL}: ${block.lote}</strong> · Fecha: ${fmtDate(block.fecha)} · Responsable: ${block.responsable ?? '—'}
        ${block.descripcionBolsa ? ` · Descripción de bolsa: ${block.descripcionBolsa}` : ''}
        ${block.packagingKg != null ? ` · Peso bolsa: ${fmtNum(block.packagingKg)} Kg` : ''}
      </div>

      <table class="formato-table" style="max-width:560px">
        <thead>
          <tr>
            <th>Hora de rechazo</th>
            <th>Tipo</th>
            <th>Cantidad de bolsas separadas</th>
            <th>Cantidad de rechazos indicado en el equipo</th>
            <th>Test de prueba</th>
            <th>Conformidad</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>

      <div style="display:flex;gap:24px;margin-top:6px;flex-wrap:wrap;font-size:11px">
        <div><span class="meta-label">T1 (bolsas separadas):</span> ${block.t1}</div>
        <div><span class="meta-label">T2 (rechazos + pruebas):</span> ${block.t2}</div>
        <div><span class="meta-label">Panela rechazada (T1 × peso bolsa):</span> ${fmtNum(panelaRechazadaKg)} Kg</div>
      </div>

      ${block.observaciones ? `<p style="font-size:11px;margin:6px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(block.observaciones)}</p>` : ''}
    </div>`
}

export function buildPrintHTMLControlCuerposExtranos(order, containerNumber, data, firmantes) {
  const { blocks } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('inspeccion_cuerpos_extranos', order, containerNumber)}</title>
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
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_CONTROL_CUERPOS_EXTRANOS}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Nº orden producción:</span> ${order?.client_order_number ?? order?.order_code ?? '—'}</div>
      <div><span class="meta-label">Nº Contenedor:</span> ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${blocks.map(buildCuerposExtranosBlockHTML).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlCuerposExtranosPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlCuerposExtranos(order, containerNumber, data, firmantes)
}

export function controlCuerposExtranosExcel(order, containerNumber, { blocks }) {
  const aoa = [
    ['INSPECCIÓN DE CUERPOS EXTRAÑOS'],
    ['Nº orden producción:', order?.client_order_number ?? order?.order_code ?? ''],
    ['Nº Contenedor:', containerNumber ?? ''],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
  ]
  const cols = ['Hora de rechazo', 'Tipo', 'Cantidad de bolsas separadas', 'Cantidad de rechazos indicado en el equipo', 'Test de prueba', 'Conformidad']

  for (const block of blocks) {
    aoa.push([
      `${LOTE_LABEL}: ${block.lote}`, `Fecha: ${block.fecha}`, `Responsable: ${block.responsable ?? ''}`,
      block.descripcionBolsa ? `Descripción de bolsa: ${block.descripcionBolsa}` : '',
      block.packagingKg != null ? `Peso bolsa: ${block.packagingKg} Kg` : '',
    ])
    aoa.push(cols)
    for (const c of block.checks) {
      aoa.push([
        c.check_time?.slice(0, 5) ?? '',
        c.check_type === 'rechazo' ? 'Rechazo real' : 'Prueba',
        c.check_type === 'rechazo' ? (c.bags_separated ?? 0) : '',
        c.inspection_number,
        c.check_type === 'prueba' ? (c.test_type ?? '') : '',
        c.check_type === 'prueba' ? (c.conforme ? 'Conforme' : 'No conforme') : '',
      ])
    }
    aoa.push(['T1 (bolsas separadas):', block.t1, 'T2 (rechazos + pruebas):', block.t2, 'Panela rechazada (T1 x peso bolsa) Kg:', block.t1 * (block.packagingKg ?? 0)])
    if (block.observaciones) aoa.push(['Observaciones:', block.observaciones])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cuerpos Extraños')
  XLSX.writeFile(wb, `${quickDocFileName('inspeccion_cuerpos_extranos', order, containerNumber)}.xlsx`)
}
