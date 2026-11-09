import { supabase } from '../supabase'
import { escapeHtml, fmtDate } from './shared'
import { fetchFieldContextForOrder, buildCampoDocHTML, campoSinRegistrosHTML, campoLoteHeaderHTML, campoExcelHeader, writeCampoExcel, producerName } from './campoOrden'

export const FORMAT_TITLE_FQD = 'FORMATO DE QUEJAS Y DEVOLUCIONES'

// Cuerpo del FQD (datos de la devolución), compartido entre la versión
// emitida de Reportes y la versión por orden de abajo.
export function buildFqdBodyHTML(ret) {
  const quantityText = ret.quantity_sacks > 0
    ? `${ret.quantity_sacks} Sacos (${Number(ret.quantity_kg).toFixed(2)} kg)`
    : `${Number(ret.quantity_kg).toFixed(2)} kg`
  return `<div class="section-label" style="margin-top:14px">Datos de la devolución</div>
  <table class="formato-table">
    <tbody>
      <tr>
        <td style="font-weight:600;width:180px">Cliente</td>
        <td>${escapeHtml(ret.client_name) ?? '—'}</td>
      </tr>
      <tr>
        <td style="font-weight:600">Fecha de devolución</td>
        <td>${fmtDate(ret.return_date)}</td>
      </tr>
      <tr>
        <td style="font-weight:600">Cantidad devuelta</td>
        <td>${quantityText}</td>
      </tr>
      <tr>
        <td style="font-weight:600;vertical-align:top">Causa de la devolución</td>
        <td style="font-size:10px">${escapeHtml(ret.return_reason) ?? '—'}</td>
      </tr>
      ${ret.observations ? `<tr>
        <td style="font-weight:600;vertical-align:top">Observaciones</td>
        <td style="font-size:10px">${escapeHtml(ret.observations)}</td>
      </tr>` : ''}
    </tbody>
  </table>`
}

// ── Versión por ORDEN (pestaña Campo de Documentos) ─────────────────────────
// Devoluciones registradas sobre los lotes de campo de la orden, un bloque
// por devolución.
export async function fetchFqdOrdenData(cooperative, order) {
  const ctx = await fetchFieldContextForOrder(cooperative, order)
  if (ctx.prodBatchIds.length === 0) return { certNames: ctx.certNames, devoluciones: [] }

  const { data, error } = await supabase
    .from('product_returns')
    .select('id, production_batch_id, client_name, return_date, quantity_kg, quantity_sacks, return_reason, observations')
    .in('production_batch_id', ctx.prodBatchIds)
    .eq('cooperative_id', cooperative.id)
    .order('return_date')
  if (error) throw new Error(error.message)

  const batchById = {}
  for (const ei of Object.values(ctx.exitItems)) if (ei.production_batches) batchById[ei.production_batches.id] = ei.production_batches
  const devoluciones = (data ?? []).map(ret => ({ ret, batch: batchById[ret.production_batch_id] }))
  return { certNames: ctx.certNames, devoluciones }
}

export function fqdOrdenPdf(cooperative, order, containerNumber, { certNames, devoluciones }, firmantes) {
  return buildCampoDocHTML(cooperative, order, containerNumber, {
    key: 'fqd',
    title: FORMAT_TITLE_FQD,
    certNames,
    firmantes,
    body: devoluciones.length > 0
      ? devoluciones.map(d => `<div class="lote-block">${campoLoteHeaderHTML(d.batch)}${buildFqdBodyHTML(d.ret)}</div>`).join('')
      : campoSinRegistrosHTML('No hay quejas ni devoluciones registradas para los lotes de campo de esta orden.'),
  })
}

export function fqdOrdenExcel(cooperative, order, containerNumber, { certNames, devoluciones }) {
  const rows = [...campoExcelHeader(order, certNames, FORMAT_TITLE_FQD), [
    'Lote de campo', 'Productor', 'Módulo', 'F. proceso', 'Cliente', 'Fecha de devolución', 'Sacos', 'Kg', 'Causa de la devolución', 'Observaciones',
  ]]
  for (const { ret, batch } of devoluciones) {
    rows.push([
      batch?.batch_code ?? '', producerName(batch?.producers), batch?.producers?.coop_modules?.name ?? '', batch?.process_date ?? '',
      ret.client_name ?? '', ret.return_date ?? '', ret.quantity_sacks ?? '', ret.quantity_kg ?? '', ret.return_reason ?? '', ret.observations ?? '',
    ])
  }
  writeCampoExcel('fqd', order, containerNumber, [['Quejas y devoluciones', rows]])
}
