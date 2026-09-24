import { PRINT_STYLES, fmtDate, fmtDateTime, buildFirmasHTML, escapeHtml } from './shared'

export const FORMAT_TYPE_FCP  = 'FCP'
export const FORMAT_TITLE_FCP = 'FORMATO DE CONTROL DE PLAGAS'

export function buildPrintHTMLFcp(cooperative, formatCode, moduleName, dateFrom, dateTo, emittedAt, pestControls, firmantes) {
  const firmasHTML  = buildFirmasHTML(firmantes)
  const emisionDate = emittedAt ? fmtDateTime(emittedAt) : '—'

  const baitEntries   = []
  const insectEntries = []
  ;(pestControls ?? []).forEach(pc => {
    ;(pc.pest_control_bait_records ?? []).forEach(b => baitEntries.push({ date: pc.control_date, ...b }))
    ;(pc.pest_control_insect_records ?? []).forEach(ins => insectEntries.push({ date: pc.control_date, ...ins }))
  })

  const baitSection = baitEntries.length === 0 ? '' : (() => {
    const bodyRows = baitEntries.map(b => {
      const stations = b.bait_stations ?? []
      if (!stations.length) return `<tr>
        <td style="white-space:nowrap">${fmtDate(b.date)}</td>
        <td>${escapeHtml(b.product_name) ?? '—'}</td>
        <td style="text-align:center">${b.quantity ?? '—'} ${b.unit ?? ''}</td>
        <td>—</td><td>—</td>
        <td style="font-size:10px">${escapeHtml(b.bait_observations) ?? '—'}</td></tr>`
      return stations.map((s, i) => `<tr>
        ${i === 0 ? `<td rowspan="${stations.length}" style="white-space:nowrap">${fmtDate(b.date)}</td>
          <td rowspan="${stations.length}">${escapeHtml(b.product_name) ?? '—'}</td>
          <td rowspan="${stations.length}" style="text-align:center">${b.quantity ?? '—'} ${b.unit ?? ''}</td>` : ''}
        <td style="text-align:center">${s.station_number}</td>
        <td style="text-align:center;font-weight:700;color:${s.ate ? '#dc2626' : '#166534'}">${s.ate ? 'Sí ✗' : 'No ✓'}</td>
        ${i === 0 ? `<td rowspan="${stations.length}" style="font-size:10px">${escapeHtml(b.bait_observations) ?? '—'}</td>` : ''}
      </tr>`).join('')
    }).join('')
    return `<div style="margin-bottom:10px">
      <div style="background:#374151;color:#fff;padding:4px 8px;font-weight:700;font-size:10px;text-transform:uppercase">
        I. Control de Cebos
      </div>
      <table class="formato-table">
        <thead><tr>
          <th>Fecha</th><th>Producto</th><th>Cantidad</th>
          <th>N° Estación</th><th>¿Comió?</th><th>Observaciones</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`
  })()

  const insectSection = insectEntries.length === 0 ? '' : (() => {
    const bodyRows = insectEntries.map(ins => {
      const data = ins.insect_data ?? []
      if (!data.length) return `<tr>
        <td style="white-space:nowrap">${fmtDate(ins.date)}</td>
        <td>${ins.product_name ?? '—'}</td>
        <td style="text-align:center">${ins.quantity ?? '—'} ${ins.unit ?? ''}</td>
        <td colspan="5">—</td></tr>`
      return data.map((d, i) => `<tr>
        ${i === 0 ? `<td rowspan="${data.length}" style="white-space:nowrap">${fmtDate(ins.date)}</td>
          <td rowspan="${data.length}">${ins.product_name ?? '—'}</td>
          <td rowspan="${data.length}" style="text-align:center">${ins.quantity ?? '—'} ${ins.unit ?? ''}</td>` : ''}
        <td>${d.area ?? '—'}</td>
        <td style="text-align:center">${d.flies ?? 0}</td>
        <td style="text-align:center">${d.bees ?? 0}</td>
        <td style="text-align:center">${d.ants ?? 0}</td>
        <td style="text-align:center">${d.cockroaches ?? 0}</td>
        <td style="font-size:10px">${escapeHtml(d.observations) ?? '—'}</td>
      </tr>`).join('')
    }).join('')
    return `<div style="margin-bottom:10px">
      <div style="background:#374151;color:#fff;padding:4px 8px;font-weight:700;font-size:10px;text-transform:uppercase">
        II. Control de Insectos
      </div>
      <table class="formato-table">
        <thead><tr>
          <th>Fecha</th><th>Producto</th><th>Cantidad</th>
          <th>Área</th><th>Moscas</th><th>Abejas</th><th>Hormigas</th><th>Cucarachas</th><th>Observaciones</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`
  })()

  const body = (baitSection || insectSection)
    ? baitSection + insectSection
    : '<p style="color:#999;text-align:center;padding:20px">Sin registros en este período</p>'

  return `<!DOCTYPE html><html lang="es">
<head><meta charset="UTF-8"><title>${FORMAT_TITLE_FCP}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase">${cooperative?.name ?? ''}</div>
      <div style="font-size:14px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_FCP}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Código:</span> <strong style="font-family:monospace">${formatCode ?? '(borrador)'}</strong></div>
      <div><span class="meta-label">Fecha de emisión:</span> ${emisionDate}</div>
      <div><span class="meta-label">Módulo:</span> ${moduleName}</div>
      <div><span class="meta-label">Período:</span> ${fmtDate(dateFrom)} — ${fmtDate(dateTo)}</div>
    </div>
  </div>
  <div style="margin-top:10px">${body}</div>
  <div style="margin-top:8px;padding:6px 8px;background:#f0f0f0;border:1px solid #ccc;font-size:11px;display:flex;gap:32px">
    <span><strong>Registros:</strong> ${pestControls?.length ?? 0}</span>
    <span><strong>Con cebos:</strong> ${baitEntries.length}</span>
    <span><strong>Con insectos:</strong> ${insectEntries.length}</span>
  </div>
  <div class="formato-firmas">${firmasHTML}</div>
</body></html>`
}
