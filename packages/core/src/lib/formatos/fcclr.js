import { PRINT_STYLES, fmtDate, buildFirmasHTML, escapeHtml } from './shared'

export const FORMAT_TYPE_FCCLR  = 'FCCLR'
export const FORMAT_TITLE_FCCLR = 'FORMATO DE CONTROL DE CLORO LIBRE RESIDUAL'

export function buildPrintHTMLFcclr(cooperative, formatCode, moduleName, dateFrom, dateTo, emittedAt, records, firmantes) {
  const emisionDate = emittedAt
    ? new Date(emittedAt).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '___/___/______'
  const firmasHTML = buildFirmasHTML(firmantes ?? [])

  const SAFE_MIN = 0.5
  const SAFE_MAX = 2.0
  const fmtTime  = t => t ? String(t).substring(0, 5) : '—'

  // Celda que muestra valor + indicador de estado juntos
  const measureCell = v => {
    if (v == null) return '<td style="text-align:center;color:#999">—</td>'
    const n = Number(v)
    const safe = n >= SAFE_MIN && n <= SAFE_MAX
    const color = safe ? '#166534' : '#b45309'
    const bg    = safe ? '' : ';background:#fff7ed'
    const icon  = safe ? '✓' : '⚠'
    return `<td style="text-align:center;font-weight:700;color:${color}${bg}">${n.toFixed(2)} ppm ${icon}</td>`
  }

  const rows = records.length > 0
    ? records.map((r, i) => `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="white-space:nowrap">${fmtDate(r.control_date)}</td>
        <td style="text-align:center">${fmtTime(r.control_time)}</td>
        ${measureCell(r.measurement_point_1)}
        ${measureCell(r.measurement_point_2)}
        <td style="font-size:10px">${r.corrective_actions ?? '—'}</td>
        <td style="font-size:10px">${escapeHtml(r.observations) ?? '—'}</td>
        <td style="font-size:10px">${r.responsible_person ?? '—'}</td>
      </tr>`).join('')
    : `<tr><td colspan="8" style="text-align:center;color:#999;font-style:italic;padding:14px">Sin registros en el período</td></tr>`

  const withM1 = records.filter(r => r.measurement_point_1 != null)
  const withM2 = records.filter(r => r.measurement_point_2 != null)
  const avgM1  = withM1.length > 0 ? withM1.reduce((s, r) => s + Number(r.measurement_point_1), 0) / withM1.length : null
  const avgM2  = withM2.length > 0 ? withM2.reduce((s, r) => s + Number(r.measurement_point_2), 0) / withM2.length : null
  const totalReadings = withM1.length + withM2.length
  const safeReadings  = withM1.filter(r => { const n = Number(r.measurement_point_1); return n >= SAFE_MIN && n <= SAFE_MAX }).length
                      + withM2.filter(r => { const n = Number(r.measurement_point_2); return n >= SAFE_MIN && n <= SAFE_MAX }).length
  const pctCumple = totalReadings > 0 ? (safeReadings / totalReadings * 100).toFixed(1) : '—'

  const tfoot = records.length > 0 ? `
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right;font-weight:700;font-size:10px">PROMEDIO</td>
        <td style="text-align:center;font-weight:700">${avgM1 != null ? avgM1.toFixed(2) + ' ppm' : '—'}</td>
        <td style="text-align:center;font-weight:700">${avgM2 != null ? avgM2.toFixed(2) + ' ppm' : '—'}</td>
        <td colspan="3"></td>
      </tr>
    </tfoot>` : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${formatCode ?? FORMAT_TYPE_FCCLR}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${cooperative?.name ?? ''}</div>
      <div style="font-size:14px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_FCCLR}</div>
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
          <th>N°</th><th>Fecha</th><th>Hora</th>
          <th>M1 — Sanitización (ppm)</th>
          <th>M2 — Proceso/Tamizado (ppm)</th>
          <th>Acciones correctivas</th><th>Observaciones</th><th>Responsable</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      ${tfoot}
    </table>
  </div>

  <div style="margin-top:10px;padding:6px 8px;background:#f0f0f0;border:1px solid #ccc;font-size:11px;display:flex;gap:32px">
    <span><strong>Total mediciones:</strong> ${records.length}</span>
    <span><strong>Rango seguro:</strong> ${SAFE_MIN}–${SAFE_MAX} ppm</span>
    <span><strong>Cumplimiento:</strong> <strong style="color:${Number(pctCumple) >= 90 ? '#166534' : '#b45309'}">${pctCumple}%</strong></span>
  </div>

  <div class="formato-firmas">${firmasHTML}</div>
</body>
</html>`
}
