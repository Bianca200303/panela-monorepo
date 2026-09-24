import { PRINT_STYLES, fmtDate, fmtDateTime, buildFirmasHTML } from './shared'

export const FORMAT_TYPE_FMEH  = 'FMEH'
export const FORMAT_TITLE_FMEH = 'FORMATO DE MANTENIMIENTO DE EQUIPOS Y HORNILLAS'

export function buildPrintHTMLFmeh(cooperative, formatCode, moduleName, dateFrom, dateTo, emittedAt, records, firmantes) {
  const firmasHTML  = buildFirmasHTML(firmantes)
  const emisionDate = emittedAt ? fmtDateTime(emittedAt) : '—'

  const rows = records.length > 0
    ? records.map((r, i) => {
        const typeLabel = r.maintenance_type === 'P' ? 'Preventivo' : r.maintenance_type === 'C' ? 'Correctivo' : (r.maintenance_type ?? '—')
        const typeColor = r.maintenance_type === 'P' ? '#166534' : '#b45309'
        return `<tr>
          <td style="text-align:center">${i + 1}</td>
          <td style="white-space:nowrap">${fmtDate(r.maintenance_date)}</td>
          <td>${r.equipment_name ?? '—'}</td>
          <td style="text-align:center;font-weight:700;color:${typeColor}">${typeLabel}</td>
          <td style="font-size:10px">${r.maintenance_cause ?? '—'}</td>
          <td style="font-size:10px">${r.materials_used ?? '—'}</td>
          <td style="text-align:center">${r.duration_hours != null ? Number(r.duration_hours).toFixed(1) + ' h' : '—'}</td>
          <td>${r.responsible_person ?? '—'}</td>
        </tr>`
      }).join('')
    : `<tr><td colspan="8" style="text-align:center;color:#999;font-style:italic;padding:14px">Sin registros en el período</td></tr>`

  const totalHours  = records.reduce((s, r) => s + Number(r.duration_hours ?? 0), 0)
  const preventivos = records.filter(r => r.maintenance_type === 'P').length
  const correctivos = records.filter(r => r.maintenance_type === 'C').length

  return `<!DOCTYPE html><html lang="es">
<head><meta charset="UTF-8"><title>${FORMAT_TITLE_FMEH}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase">${cooperative?.name ?? ''}</div>
      <div style="font-size:14px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_FMEH}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Código:</span> <strong style="font-family:monospace">${formatCode ?? '(borrador)'}</strong></div>
      <div><span class="meta-label">Fecha de emisión:</span> ${emisionDate}</div>
      <div><span class="meta-label">Módulo:</span> ${moduleName}</div>
      <div><span class="meta-label">Período:</span> ${fmtDate(dateFrom)} — ${fmtDate(dateTo)}</div>
    </div>
  </div>
  <div style="margin-top:10px;overflow-x:auto">
    <table class="formato-table">
      <thead>
        <tr>
          <th>N°</th><th>Fecha</th><th>Equipo / Hornilla</th><th>Tipo</th>
          <th>Causa del mantenimiento</th><th>Materiales / Repuestos</th>
          <th>Duración</th><th>Responsable</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="margin-top:8px;padding:6px 8px;background:#f0f0f0;border:1px solid #ccc;font-size:11px;display:flex;gap:32px">
    <span><strong>Total registros:</strong> ${records.length}</span>
    <span><strong>Preventivos:</strong> <span style="color:#166534;font-weight:700">${preventivos}</span></span>
    <span><strong>Correctivos:</strong> <span style="color:#b45309;font-weight:700">${correctivos}</span></span>
    <span><strong>Horas totales:</strong> <strong>${totalHours.toFixed(1)} h</strong></span>
  </div>
  <div class="formato-firmas">${firmasHTML}</div>
</body></html>`
}
