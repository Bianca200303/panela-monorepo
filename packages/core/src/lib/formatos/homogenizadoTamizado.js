import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { PRINT_STYLES, fmtNum, enrichRawMaterialEntries, quickDocFileName, buildFirmasHTML, escapeHtml } from './shared'
import { loteLabel } from '../loteHelpers'
import { getLoteLabel, getBunqueLabel } from '../labels'
import { buildRegistroTrazabilidadRows, fetchOrderCertNames } from './registroTrazabilidad'

export const FORMAT_TITLE_REGISTRO_HOMOGENIZADO_TAMIZADO = 'HOMOGENIZADO Y TAMIZADO'

// A diferencia del Registro de Trazabilidad (un solo bloque por orden), el
// formato físico COA-PPA-OIM-RG-001 es una página por bunque -- aquí se arman
// todos los bunques procesados de la orden como bloques dentro de un mismo
// documento, cada uno con su propia tabla de insumos y su propio consolidado
// tamizado/reproceso/descarte/merma, que son datos del bunque, no de la orden.

async function fetchHomogenizadoTamizadoData(order, kgPerQuintal) {
  const { data: batches, error: batchesErr } = await supabase
    .from('plant_production_batches')
    .select('id, batch_code, client_batch_number')
    .eq('order_id', order.id)
    .order('created_at')
  if (batchesErr) throw new Error(batchesErr.message)
  if ((batches ?? []).length === 0) return { blocks: [], certNames: [], kgPerQuintal }

  const batchLabel = {}
  for (const b of batches) batchLabel[b.id] = loteLabel(b)
  const batchIds = batches.map(b => b.id)

  const { data: allocations, error: allocErr } = await supabase
    .from('plant_bunque_batch_allocations')
    .select('plant_batch_id, bunque:plant_batch_bunques ( id, bunque_number, tamizada_kg, reproceso_kg, descarte_kg, merma_kg, processed_at )')
    .in('plant_batch_id', batchIds)
  if (allocErr) throw new Error(allocErr.message)

  // El formato físico (una página por bunque) documenta el bunque como
  // evento real completo -- si repartió a más de un lote de ESTA misma
  // orden, se documenta una sola vez con sus datos reales (no fraccionados),
  // listando todos los lotes de esta orden a los que aportó.
  const byBunque = {}
  for (const alloc of allocations ?? []) {
    const bq = alloc.bunque
    if (!bq || bq.tamizada_kg == null) continue
    if (!byBunque[bq.id]) byBunque[bq.id] = { bunque: bq, batchLabels: [] }
    const label = batchLabel[alloc.plant_batch_id]
    if (label && !byBunque[bq.id].batchLabels.includes(label)) byBunque[bq.id].batchLabels.push(label)
  }
  const processedBunques = Object.values(byBunque)
  if (processedBunques.length === 0) return { blocks: [], certNames: [], kgPerQuintal }

  const bunqueIds = processedBunques.map(pb => pb.bunque.id)
  const { data: inputs, error: inputsErr } = await supabase
    .from('plant_homogenization_inputs')
    .select('source_exit_item_id, quantity_kg, bunque_id')
    .in('bunque_id', bunqueIds)
  if (inputsErr) throw new Error(inputsErr.message)

  // Agrupa por (fuente, bunque) -- un mismo lote de campo puede alimentar
  // varios bunques del mismo lote de envasado.
  const rowsByKey = {}
  for (const inp of inputs ?? []) {
    const key = `${inp.source_exit_item_id}::${inp.bunque_id}`
    if (!rowsByKey[key]) {
      rowsByKey[key] = { exit_item_id: inp.source_exit_item_id, bunque_id: inp.bunque_id, kg: 0 }
    }
    rowsByKey[key].kg += Number(inp.quantity_kg)
  }

  const [enriched, certNames] = await Promise.all([
    enrichRawMaterialEntries(Object.values(rowsByKey)),
    fetchOrderCertNames(order.id),
  ])

  const rowsByBunque = {}
  for (const r of enriched) {
    (rowsByBunque[r.bunque_id] ??= []).push(r)
  }

  const blocks = processedBunques.map(({ bunque, batchLabels }) => {
    const rawRows = (rowsByBunque[bunque.id] ?? []).sort((a, b) => (a.producer_name ?? '').localeCompare(b.producer_name ?? ''))
    return {
      loteLabel: batchLabels.join(', ') || '—',
      bunqueNumber: bunque.bunque_number,
      fecha: bunque.processed_at
        ? new Date(bunque.processed_at).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '—',
      bunque,
      rows: buildRegistroTrazabilidadRows(rawRows, kgPerQuintal),
    }
  })

  return { blocks, certNames, kgPerQuintal }
}

function buildHomogenizadoBunqueBlockHTML(cooperative, block, kgPerQuintal) {
  const LOTE_LABEL = getLoteLabel(cooperative)
  const BUNQUE_LABEL = getBunqueLabel(cooperative)
  const { loteLabel: bloqueLoteLabel, bunqueNumber, fecha, rows, bunque } = block

  const bodyRows = rows.map(r => `
    <tr>
      <td style="text-align:center">${r.bags_count ?? '—'}</td>
      <td>${escapeHtml(r.producer_name) ?? '—'}</td>
      <td style="white-space:nowrap;font-size:9px">${r.guia_remision ?? '—'}</td>
      <td style="white-space:nowrap;font-size:9px">${r.comprobante_acopio ?? '—'}</td>
      <td style="text-align:right">${fmtNum(r.kg_suelta)}</td>
      <td style="text-align:right">${fmtNum(r.kg_seca)}</td>
      <td style="text-align:right">${fmtNum(r.kg_cerosa)}</td>
      <td>${escapeHtml(r.module_name) ?? '—'}</td>
      <td style="text-align:right;font-weight:700">${fmtNum(r.kg)}</td>
      <td style="text-align:right">${fmtNum(r.qq)}</td>
    </tr>`).join('')

  const totalSuelta = rows.reduce((s, r) => s + r.kg_suelta, 0)
  const totalSeca   = rows.reduce((s, r) => s + r.kg_seca, 0)
  const totalCerosa = rows.reduce((s, r) => s + r.kg_cerosa, 0)
  const totalKg     = rows.reduce((s, r) => s + r.kg, 0)
  const totalQq     = rows.reduce((s, r) => s + r.qq, 0)

  const tamKg = Number(bunque.tamizada_kg ?? 0)
  const repKg = Number(bunque.reproceso_kg ?? 0)
  const desKg = Number(bunque.descarte_kg ?? 0)
  const merKg = Number(bunque.merma_kg ?? 0)
  const totalHomogenizadoKg = tamKg + repKg + desKg + merKg
  const qq = kg => kgPerQuintal > 0 ? kg / kgPerQuintal : 0

  return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${LOTE_LABEL}: ${bloqueLoteLabel}</strong> · ${BUNQUE_LABEL}: ${bunqueNumber} · Fecha: ${fecha}
      </div>

      <table class="formato-table">
        <thead>
          <tr>
            <th>Nro Sacos</th>
            <th style="text-align:left">Productor</th>
            <th>Nro Guía</th>
            <th>Comprobante Acopio</th>
            <th>Suelta</th>
            <th>Seca</th>
            <th>Cerosa</th>
            <th>Módulo</th>
            <th>Total Kg</th>
            <th>Total QQ</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="text-align:right">Totales:</td>
            <td style="text-align:right">${fmtNum(totalSuelta)}</td>
            <td style="text-align:right">${fmtNum(totalSeca)}</td>
            <td style="text-align:right">${fmtNum(totalCerosa)}</td>
            <td></td>
            <td style="text-align:right">${fmtNum(totalKg)}</td>
            <td style="text-align:right">${fmtNum(totalQq)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="section-label">Consolidado total de homogenizado y tamizado</div>
      <table class="formato-table" style="max-width:360px">
        <thead><tr><th style="text-align:left">Descripción</th><th>Kg</th><th>QQ</th></tr></thead>
        <tbody>
          <tr><td>Tamizado</td><td style="text-align:right">${fmtNum(tamKg)}</td><td style="text-align:right">${fmtNum(qq(tamKg))}</td></tr>
          <tr><td>Reproceso</td><td style="text-align:right">${fmtNum(repKg)}</td><td style="text-align:right">${fmtNum(qq(repKg))}</td></tr>
          <tr><td>Descarte</td><td style="text-align:right">${fmtNum(desKg)}</td><td style="text-align:right">${fmtNum(qq(desKg))}</td></tr>
          <tr><td>Merma</td><td style="text-align:right">${fmtNum(merKg)}</td><td style="text-align:right">${fmtNum(qq(merKg))}</td></tr>
        </tbody>
        <tfoot>
          <tr><td>Total Homogenizado</td><td style="text-align:right">${fmtNum(totalHomogenizadoKg)}</td><td style="text-align:right">${fmtNum(qq(totalHomogenizadoKg))}</td></tr>
        </tfoot>
      </table>
    </div>`
}

// cooperative como primer parámetro (antes leía COOPERATIVE del módulo
// lib/config, que ya no existe en core) -- los call sites lo inyectan desde
// useCooperative().
export function buildPrintHTMLRegistroHomogenizadoTamizado(cooperative, order, containerNumber, data, firmantes) {
  const { blocks, certNames, kgPerQuintal } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const certText = certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : '—'

  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('registro_homogenizado_tamizado', order, containerNumber)}</title>
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
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${cooperative?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_REGISTRO_HOMOGENIZADO_TAMIZADO}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Contenedor N°:</span> ${order?.internal_container_number ?? '—'}</div>
      <div><span class="meta-label">Nº de venta:</span> ${order?.sale_number ?? '—'}</div>
      <div><span class="meta-label">Producto:</span> ${order?.product ?? '—'}</div>
      <div><span class="meta-label">Nº orden producción:</span> ${order?.client_order_number ?? order?.order_code ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
      <div><span class="meta-label">Certificación:</span> ${certText}</div>
    </div>
  </div>

  ${blocks.map(b => buildHomogenizadoBunqueBlockHTML(cooperative, b, kgPerQuintal)).join('')}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function registroHomogenizadoTamizadoPdf(cooperative, order, containerNumber, data, firmantes) {
  return buildPrintHTMLRegistroHomogenizadoTamizado(cooperative, order, containerNumber, data, firmantes)
}

export function registroHomogenizadoTamizadoExcel(cooperative, order, containerNumber, { blocks, certNames, kgPerQuintal }) {
  const LOTE_LABEL = getLoteLabel(cooperative)
  const BUNQUE_LABEL = getBunqueLabel(cooperative)
  const certText = certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : ''
  const aoa = [
    ['REGISTRO DE HOMOGENIZADO Y TAMIZADO'],
    ['Contenedor N°:', order?.internal_container_number ?? ''],
    ['Nº de venta:', order?.sale_number ?? ''],
    ['Producto:', order?.product ?? ''],
    ['Nº orden producción:', order?.client_order_number ?? order?.order_code ?? ''],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    ['Certificación:', certText],
    [],
  ]
  const cols = ['Nro Sacos', 'Productor', 'Nro Guía', 'Comprobante Acopio', 'Suelta', 'Seca', 'Cerosa', 'Módulo', 'Total Kg', 'Total QQ']
  const qqOf = (kgPerQuintal > 0) ? (kg => kg / kgPerQuintal) : (() => 0)

  for (const block of blocks) {
    aoa.push([`${LOTE_LABEL}: ${block.loteLabel}`, `${BUNQUE_LABEL}: ${block.bunqueNumber}`, `Fecha: ${block.fecha}`])
    aoa.push(cols)
    for (const r of block.rows) {
      aoa.push([r.bags_count ?? '', r.producer_name ?? '', r.guia_remision ?? '', r.comprobante_acopio ?? '', r.kg_suelta, r.kg_seca, r.kg_cerosa, r.module_name ?? '', r.kg, r.qq])
    }
    aoa.push([
      'Totales:', '', '', '',
      block.rows.reduce((s, r) => s + r.kg_suelta, 0),
      block.rows.reduce((s, r) => s + r.kg_seca, 0),
      block.rows.reduce((s, r) => s + r.kg_cerosa, 0),
      '',
      block.rows.reduce((s, r) => s + r.kg, 0),
      block.rows.reduce((s, r) => s + r.qq, 0),
    ])
    aoa.push([])

    const tam = Number(block.bunque.tamizada_kg ?? 0)
    const rep = Number(block.bunque.reproceso_kg ?? 0)
    const des = Number(block.bunque.descarte_kg ?? 0)
    const mer = Number(block.bunque.merma_kg ?? 0)
    aoa.push(['Consolidado total de homogenizado y tamizado'])
    aoa.push(['Descripción', 'Kg', 'QQ'])
    aoa.push(['Tamizado', tam, qqOf(tam)])
    aoa.push(['Reproceso', rep, qqOf(rep)])
    aoa.push(['Descarte', des, qqOf(des)])
    aoa.push(['Merma', mer, qqOf(mer)])
    aoa.push(['Total Homogenizado', tam + rep + des + mer, qqOf(tam + rep + des + mer)])
    aoa.push([])
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Homogenizado y Tamizado')
  XLSX.writeFile(wb, `${quickDocFileName('registro_homogenizado_tamizado', order, containerNumber)}.xlsx`)
}

export { fetchHomogenizadoTamizadoData }
