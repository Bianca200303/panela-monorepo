import { escapeHtml, fmtDate } from './shared'
import { buildCampoDocHTML, campoExcelHeader, writeCampoExcel, fetchCampoModuloRecords, campoModulosBodyHTML } from './campoOrden'

export const FORMAT_TITLE_FCCLR = 'FORMATO DE CONTROL DE CLORO LIBRE RESIDUAL'

// Cuerpo del formato (sin el encabezado de emisión), compartido entre la
// versión emitida de Reportes y la versión por orden (pestaña Campo).
export function buildFcclrBodyHTML(records) {

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

  return `
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
  </div>`
}

// ── Versión por ORDEN (pestaña Campo de Documentos) ─────────────────────────
// Por módulo, las mediciones de los días exactos de producción de los lotes
// de campo de la orden (ver fetchCampoModuloRecords en campoOrden.js).
export function fetchFcclrOrdenData(cooperative, order) {
  return fetchCampoModuloRecords(cooperative, order, {
    table: 'chlorine_residual_controls',
    select: 'id, control_date, control_time, measurement_point_1, measurement_point_2, corrective_actions, observations, responsible_person',
    dateCol: 'control_date',
    mode: 'dia',
    orderBy: ['control_time'],
  })
}

export function fcclrOrdenPdf(cooperative, order, containerNumber, data, firmantes) {
  return buildCampoDocHTML(cooperative, order, containerNumber, {
    key: 'fcclr', title: FORMAT_TITLE_FCCLR, certNames: data.certNames, firmantes,
    body: campoModulosBodyHTML(data, m => buildFcclrBodyHTML(m.records), 'Sin mediciones de cloro en las fechas de producción.'),
  })
}

export function fcclrOrdenExcel(cooperative, order, containerNumber, data) {
  const rows = [...campoExcelHeader(order, data.certNames, FORMAT_TITLE_FCCLR),
    ['Módulo', 'Fecha', 'Hora', 'M1 — Sanitización (ppm)', 'M2 — Proceso/Tamizado (ppm)', 'Acciones correctivas', 'Observaciones', 'Responsable']]
  for (const m of data.modulos) for (const r of m.records) {
    rows.push([m.name, r.control_date, r.control_time?.slice(0, 5) ?? '', r.measurement_point_1 ?? '', r.measurement_point_2 ?? '', r.corrective_actions ?? '', r.observations ?? '', r.responsible_person ?? ''])
  }
  writeCampoExcel('fcclr', order, containerNumber, [['Cloro libre residual', rows]])
}
