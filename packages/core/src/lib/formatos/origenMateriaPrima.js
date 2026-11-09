import * as XLSX from 'xlsx'
import { PRINT_STYLES, fmtDate, fmtNum, buildFirmasHTML, buildOrdenHeaderHTML, quickDocFileName, escapeHtml, containerExcelRows } from './shared'
import { getLoteLabel } from '../labels'
import { fetchOrderCertNames } from './registroTrazabilidad'
import { fetchFieldContextForOrder } from './campoOrden'

export const FORMAT_TITLE_ORIGEN_MATERIA_PRIMA = 'ORIGEN DE LA MATERIA PRIMA'

// processed_at y received_at son timestamptz -- recortar el ISO (UTC) daba el
// día siguiente para registros hechos de noche en Perú (UTC-5). Se pasa a
// fecha local "YYYY-MM-DD", que es lo que espera fmtDate.
function localDate(ts) {
  if (!ts) return null
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Primer documento de CAMPO por orden: por cada lote de envasado, de qué
// lotes de campo salió (productor, módulo, guía, kg aportados) y cómo llegó
// cada uno a la recepción (evaluación de calidad, certificaciones). Reúne lo
// que el informe de trazabilidad mostraba como datos sueltos fuera de los
// formatos, ver [[project_documentos_campo_por_orden]].
export async function fetchOrigenMateriaPrimaData(cooperative, order) {
  const [ctx, certNames] = await Promise.all([
    fetchFieldContextForOrder(cooperative, order),
    fetchOrderCertNames(order.id),
  ])
  const blocks = ctx.plantBatches.map(pb => ({
    label: pb.label,
    brand: pb.brand,
    totalInputKg: pb.totalInputKg,
    proc: pb.proc,
    rows: pb.inputs
      .map(inp => {
        const ei = ctx.exitItems[inp.exit_item_id]
        const batch = ei?.production_batches
        const producer = batch?.producers
        const ev = ctx.evals[inp.exit_item_id]
        const rec = ctx.receptions[inp.exit_item_id]
        return {
          lote_campo: ei?.item_document_number ?? batch?.batch_code ?? null,
          producer_name: producer ? `${producer.first_name} ${producer.last_name}` : null,
          dni: producer?.dni ?? null,
          module_name: producer?.coop_modules?.name ?? null,
          guia: ei?.exit_registrations?.document_number ?? ei?.exit_registrations?.exit_code ?? null,
          fecha_produccion: batch?.process_date ?? null,
          fecha_recepcion: rec?.exit_receptions?.received_at ? localDate(rec.exit_receptions.received_at) : null,
          panela_kg: batch?.panela_kg ?? null,
          confitillo_kg: batch?.confitillo_kg ?? null,
          kg: inp.kg,
          pct: pb.totalInputKg > 0 ? inp.kg / pb.totalInputKg * 100 : null,
          humedad: ev?.humidity_pct ?? null,
          impurezas: ev?.impurities_pct ?? null,
          color: ev?.color ?? null,
          aspecto: ev?.appearance ?? null,
          saco: ev?.sack_condition ?? null,
          obs: ev?.notes ?? null,
          certs: batch?.id ? (ctx.certsByBatch[batch.id] ?? []) : [],
        }
      })
      .sort((a, b) => (a.producer_name ?? '').localeCompare(b.producer_name ?? '')),
  }))
  return { blocks, certNames }
}

function mermaPct(proc, totalInputKg) {
  return totalInputKg > 0 ? Number(proc.merma_kg) / totalInputKg * 100 : null
}

export function buildPrintHTMLOrigenMateriaPrima(cooperative, order, containerNumber, { blocks, certNames }, firmantes) {
  const LOTE_LABEL = getLoteLabel(cooperative, order)
  const certText = certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : '—'

  const blocksHTML = blocks.map(b => {
    const procHTML = b.proc ? `
      <div class="formato-meta" style="margin:4px 0 6px">
        <div><span class="meta-label">Total homogenizado:</span> ${fmtNum(b.totalInputKg, 1)} kg</div>
        <div><span class="meta-label">Panela tamizada:</span> ${fmtNum(b.proc.tamizada_kg, 1)} kg</div>
        <div><span class="meta-label">Reproceso:</span> ${fmtNum(b.proc.reproceso_kg, 1)} kg</div>
        <div><span class="meta-label">Descarte:</span> ${fmtNum(b.proc.descarte_kg, 1)} kg</div>
        <div><span class="meta-label">Merma:</span> ${fmtNum(b.proc.merma_kg, 1)} kg (${fmtNum(mermaPct(b.proc, b.totalInputKg), 1)}%)</div>
        <div><span class="meta-label">Fecha procesado:</span> ${fmtDate(localDate(b.proc.processed_at))}</div>
      </div>` : ''

    const rowsHTML = b.rows.length === 0
      ? '<tr><td colspan="17" style="text-align:center">Sin lotes de campo asignados</td></tr>'
      : b.rows.map(r => `
        <tr>
          <td>${escapeHtml(r.lote_campo) ?? '—'}</td>
          <td>${escapeHtml(r.producer_name) ?? '—'}</td>
          <td>${escapeHtml(r.dni) ?? '—'}</td>
          <td>${escapeHtml(r.module_name) ?? '—'}</td>
          <td style="font-size:9px">${escapeHtml(r.guia) ?? '—'}</td>
          <td>${fmtDate(r.fecha_produccion)}</td>
          <td>${fmtDate(r.fecha_recepcion)}</td>
          <td style="text-align:right">${fmtNum(r.panela_kg, 1)}</td>
          <td style="text-align:right">${fmtNum(r.confitillo_kg, 1)}</td>
          <td style="text-align:right;font-weight:700">${fmtNum(r.kg, 1)}</td>
          <td style="text-align:right">${fmtNum(r.pct, 1)}</td>
          <td style="text-align:center">${fmtNum(r.humedad)}</td>
          <td style="text-align:center">${fmtNum(r.impurezas)}</td>
          <td>${escapeHtml(r.color) ?? '—'}</td>
          <td>${escapeHtml(r.aspecto) ?? '—'}</td>
          <td>${escapeHtml(r.saco) ?? '—'}</td>
          <td style="font-size:9px">${escapeHtml(r.certs.join(', ')) || '—'}${r.obs ? `<br/><i>Obs: ${escapeHtml(r.obs)}</i>` : ''}</td>
        </tr>`).join('')

    return `
      <div class="lote-block">
        <div class="lote-separator"><strong>${escapeHtml(LOTE_LABEL)} ${escapeHtml(b.label) ?? '—'}</strong>${b.brand ? ` — ${escapeHtml(b.brand)}` : ''} · ${b.rows.length} lote(s) de campo · ${fmtNum(b.totalInputKg, 1)} kg</div>
        ${procHTML}
        <table class="formato-table">
          <thead>
            <tr>
              <th rowspan="2">Lote de campo</th>
              <th rowspan="2" style="text-align:left">Productor</th>
              <th rowspan="2">DNI</th>
              <th rowspan="2">Módulo</th>
              <th rowspan="2">Guía</th>
              <th rowspan="2">Fecha producción</th>
              <th rowspan="2">Fecha recepción</th>
              <th colspan="2">Producción del lote (kg)</th>
              <th colspan="2">Aporte a este lote</th>
              <th colspan="5">Evaluación de calidad en recepción</th>
              <th rowspan="2">Certificaciones</th>
            </tr>
            <tr>
              <th>Panela</th><th>Confitillo</th>
              <th>Kg</th><th>%</th>
              <th>% Hum.</th><th>% Imp.</th><th>Color</th><th>Aspecto</th><th>Cond. saco</th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('origen_materia_prima', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
    .formato-table th { font-size: 8px; padding: 3px; }
    .formato-table td { font-size: 9px; }
  </style>
</head>
<body>
  ${buildOrdenHeaderHTML(cooperative, order, certText, FORMAT_TITLE_ORIGEN_MATERIA_PRIMA)}
  ${blocks.length > 0 ? blocksHTML : `<p style="margin-top:12px">La orden no tiene ${escapeHtml(LOTE_LABEL.toLowerCase())}s registrados.</p>`}
  <div class="formato-firmas">${buildFirmasHTML(firmantes)}</div>
</body>
</html>`
}

export function origenMateriaPrimaExcel(cooperative, order, containerNumber, { blocks, certNames }) {
  const LOTE_LABEL = getLoteLabel(cooperative, order)
  const certText = certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : ''
  const header = [
    [FORMAT_TITLE_ORIGEN_MATERIA_PRIMA],
    ...containerExcelRows(order),
    ['Nº de venta:', order?.sale_number ?? ''],
    ['Producto:', order?.product ?? ''],
    ['Nº orden producción:', order?.client_order_number ?? order?.order_code ?? ''],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    ['Certificación:', certText],
    [],
  ]

  const detalle = [
    ...header,
    [LOTE_LABEL, 'Lote de campo', 'Productor', 'DNI', 'Módulo', 'Guía', 'Fecha producción', 'Fecha recepción',
      'Panela lote campo (kg)', 'Confitillo lote campo (kg)', 'Kg aportados', '% del lote',
      '% Humedad', '% Impurezas', 'Color', 'Aspecto', 'Condición saco', 'Observación', 'Certificaciones'],
  ]
  for (const b of blocks) {
    for (const r of b.rows) {
      detalle.push([
        b.label ?? '', r.lote_campo ?? '', r.producer_name ?? '', r.dni ?? '', r.module_name ?? '', r.guia ?? '',
        r.fecha_produccion ?? '', r.fecha_recepcion ?? '', r.panela_kg ?? '', r.confitillo_kg ?? '',
        Number(r.kg.toFixed(2)), r.pct != null ? Number(r.pct.toFixed(1)) : '',
        r.humedad ?? '', r.impurezas ?? '', r.color ?? '', r.aspecto ?? '', r.saco ?? '', r.obs ?? '', r.certs.join(', '),
      ])
    }
  }

  const resultado = [
    ...header,
    [LOTE_LABEL, 'Marca', 'Lotes de campo', 'Total homogenizado (kg)', 'Panela tamizada (kg)', 'Reproceso (kg)', 'Descarte (kg)', 'Merma (kg)', 'Merma (%)', 'Fecha procesado'],
    ...blocks.map(b => [
      b.label ?? '', b.brand ?? '', b.rows.length, Number(b.totalInputKg.toFixed(2)),
      b.proc ? Number(Number(b.proc.tamizada_kg).toFixed(2)) : '',
      b.proc ? Number(b.proc.reproceso_kg.toFixed(2)) : '',
      b.proc ? Number(b.proc.descarte_kg.toFixed(2)) : '',
      b.proc ? Number(b.proc.merma_kg.toFixed(2)) : '',
      b.proc && mermaPct(b.proc, b.totalInputKg) != null ? Number(mermaPct(b.proc, b.totalInputKg).toFixed(1)) : '',
      localDate(b.proc?.processed_at) ?? '',
    ]),
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalle), 'Origen por lote de campo')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resultado), `Resultado por ${LOTE_LABEL}`.slice(0, 31))
  XLSX.writeFile(wb, `${quickDocFileName('origen_materia_prima', order, containerNumber)}.xlsx`)
}
