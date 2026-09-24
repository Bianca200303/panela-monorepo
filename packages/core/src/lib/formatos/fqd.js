import { PRINT_STYLES, fmtDate, buildFirmasHTML, escapeHtml } from './shared'

export const FORMAT_TYPE_FQD  = 'FQD'
export const FORMAT_TITLE_FQD = 'FORMATO DE QUEJAS Y DEVOLUCIONES'

export function buildPrintHTMLFqd(cooperative, formatCode, emittedAt, ret, batch, producer, firmantes) {
  const emisionDate = emittedAt
    ? new Date(emittedAt).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '___/___/______'
  const producerName = producer ? escapeHtml(`${producer.first_name} ${producer.last_name}`) : '—'
  const moduleName   = producer?.coop_modules?.name ?? '—'
  const quantityText = ret.quantity_sacks > 0
    ? `${ret.quantity_sacks} Sacos (${Number(ret.quantity_kg).toFixed(2)} kg)`
    : `${Number(ret.quantity_kg).toFixed(2)} kg`
  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${formatCode ?? FORMAT_TYPE_FQD}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${cooperative?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_FQD}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Código:</span> <strong>${formatCode ?? '(borrador)'}</strong></div>
      <div><span class="meta-label">Fecha de emisión:</span> ${emisionDate}</div>
      <div><span class="meta-label">Lote de campo:</span> ${batch?.batch_code ?? '—'}</div>
      <div><span class="meta-label">Fecha de proceso:</span> ${fmtDate(batch?.process_date)}</div>
      <div><span class="meta-label">Productor:</span> ${producerName}</div>
      <div><span class="meta-label">Módulo:</span> ${moduleName}</div>
    </div>
  </div>

  <div class="section-label" style="margin-top:14px">Datos de la devolución</div>
  <table class="formato-table">
    <tbody>
      <tr>
        <td style="font-weight:600;width:180px">Cliente</td>
        <td>${ret.client_name ?? '—'}</td>
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
  </table>

  <div class="formato-firmas">${firmasHTML}</div>
</body>
</html>`
}
