import { PRINT_STYLES, fmtDate, fmtNum, buildFirmasHTML, escapeHtml } from './shared'

export const FORMAT_TYPE_FCMPTPH = 'FCMPTPH'
export const FORMAT_TITLE_FCMPTPH = 'FORMATO DE CONTROL DE MATERIA PRIMA, PRODUCCIÓN, pH Y TEMPERATURA'

function buildLoteBlocksHTML(batches, allCerts) {
  const certHeaders = allCerts.length > 0
    ? allCerts.map(c => `<th style="font-size:10px;white-space:nowrap">${escapeHtml(c.name)}</th>`).join('')
    : '<th>—</th>'

  return batches.map(b => {
    const certIds = new Set((b.production_batch_certs ?? []).map(pc => pc.batch_certs?.id).filter(Boolean))
    const plotText = b.plots ? escapeHtml(`${b.plots.name} (${b.plots.code})`) : '—'
    const producerName = b.producers ? escapeHtml(`${b.producers.first_name} ${b.producers.last_name}`) : '—'
    const condicion = b.producers?.is_member ? '✓ SOCIO' : '✓ NO SOCIO'
    const certCells = allCerts.length > 0
      ? allCerts.map(c => `<td style="text-align:center">${certIds.has(c.id) ? '✓' : ''}</td>`).join('')
      : '<td></td>'

    const phRows = (b.ph_controls ?? []).map((p, i) => `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td style="white-space:nowrap">${fmtDate(p.record_date?.split?.('T')?.[0] ?? p.record_date)}</td>
      <td>${p.regulator_type ?? '—'}</td>
      <td style="text-align:right">${p.regulator_quantity_value ?? '—'}</td>
      <td>${p.regulator_quantity_unit ?? '—'}</td>
      <td style="text-align:center">${fmtNum(p.ph_initial)}</td>
      <td style="text-align:center">${fmtNum(p.ph_final)}</td>
      <td style="text-align:center">${p.brix != null ? fmtNum(p.brix) + '°Bx' : '—'}</td>
      <td style="font-size:10px">${p.corrective_action ?? '—'}</td>
    </tr>`).join('')

    const tempRows = (b.temperatures ?? []).map(t => `<tr>
      <td style="text-align:center">${t.sequence_number}</td>
      <td style="text-align:center">${fmtNum(t.temperature)} °C</td>
    </tr>`).join('')

    return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${b.batch_code ?? '—'}</strong> · ${producerName} · F. Proceso: ${fmtDate(b.process_date)}
      </div>

      <div class="section-label">Datos de producción</div>
      <table class="formato-table">
        <thead>
          <tr>
            <th rowspan="2">Productor</th>
            <th rowspan="2">Condición</th>
            <th rowspan="2">Parcela</th>
            <th rowspan="2">F. Corte</th>
            <th colspan="${allCerts.length || 1}" style="text-align:center">Calidad de la caña</th>
            <th rowspan="2">Caña (kg)</th>
            <th rowspan="2">F. Proceso</th>
            <th rowspan="2">Jugo (L)</th>
            <th rowspan="2">Panela (kg)</th>
            <th rowspan="2">Confitillo (kg)</th>
            <th rowspan="2">Rendim. %</th>
            <th rowspan="2">Observaciones</th>
          </tr>
          <tr>${certHeaders}</tr>
        </thead>
        <tbody>
          <tr>
            <td>${producerName}</td>
            <td style="white-space:nowrap;font-size:10px">${condicion}</td>
            <td style="font-size:10px">${plotText}</td>
            <td style="white-space:nowrap">${fmtDate(b.harvest_date)}</td>
            ${certCells}
            <td style="text-align:right">${fmtNum(b.cane_kg)}</td>
            <td style="white-space:nowrap">${fmtDate(b.process_date)}</td>
            <td style="text-align:right">${fmtNum(b.juice_liters)}</td>
            <td style="text-align:right">${fmtNum(b.panela_kg)}</td>
            <td style="text-align:right">${fmtNum(b.confitillo_kg)}</td>
            <td style="text-align:right">${fmtNum(b.efficiency_percentage)}</td>
            <td style="font-size:10px">${escapeHtml(b.observations) ?? ''}</td>
          </tr>
        </tbody>
      </table>

      <div style="display:flex;gap:24px;margin-top:5px;font-size:11px;padding:4px 6px;background:#f5f5f5;border:1px solid #ddd;border-top:none">
        <span><strong>Densidad caña:</strong> ${b.cane_density != null ? fmtNum(b.cane_density, 3) + ' kg/L' : '—'}</span>
        <span><strong>% Extracción:</strong> ${b.porcentaje_extraccion != null ? fmtNum(b.porcentaje_extraccion) + '%' : '—'}</span>
        <span><strong>% Cachaza:</strong> ${b.cachaza_percentage != null ? fmtNum(b.cachaza_percentage) + '%' : '—'}</span>
      </div>

      <div class="section-label">Control de pH</div>
      <table class="formato-table">
        <thead>
          <tr>
            <th>#</th><th>Fecha</th><th>Regulador</th><th>Cantidad</th><th>Unidad</th>
            <th>pH sin regular</th><th>pH regulado</th><th>Brix</th><th>Acción correctiva</th>
          </tr>
        </thead>
        <tbody>${phRows || '<tr><td colspan="9" style="text-align:center;color:#999">Sin registros</td></tr>'}</tbody>
      </table>

      <div class="section-label">Control de temperatura</div>
      <table class="formato-table" style="max-width:300px">
        <thead><tr><th>Batch #</th><th>Temperatura (°C)</th></tr></thead>
        <tbody>${tempRows || '<tr><td colspan="2" style="text-align:center;color:#999">Sin registros</td></tr>'}</tbody>
      </table>
    </div>`
  }).join('<hr style="border:none;border-top:2px dashed #ccc;margin:20px 0">')
}

export function buildFcmtphBatchesHTML(batches, allCerts) {
  return `<style>${PRINT_STYLES}</style><div>${buildLoteBlocksHTML(batches, allCerts)}</div>`
}

export function buildPrintHTMLFcmtph(cooperative, formatCode, moduleName, dateFrom, dateTo, emittedAt, batches, allCerts, firmantes) {
  const emisionDate = emittedAt
    ? new Date(emittedAt).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '___/___/______'

  const approvalRow = !cooperative?.features?.certificacion
    ? `<div><span class="meta-label">Fecha de aprobación:</span> ___/___/______</div>`
    : ''

  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${formatCode}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${cooperative?.name}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_FCMPTPH}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Código:</span> <strong>${formatCode}</strong></div>
      <div><span class="meta-label">Fecha de emisión:</span> ${emisionDate}</div>
      <div><span class="meta-label">Módulo:</span> ${moduleName}</div>
      <div><span class="meta-label">Período:</span> ${fmtDate(dateFrom)} — ${fmtDate(dateTo)}</div>
      ${approvalRow}
      <div><span class="meta-label">Responsables:</span> ${(firmantes ?? []).map(f => escapeHtml(f.nombre)).filter(Boolean).join(', ') || '—'}</div>
    </div>
  </div>

  ${buildLoteBlocksHTML(batches, allCerts)}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}
