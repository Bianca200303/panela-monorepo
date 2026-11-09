import { fmtDate } from './shared'
import { buildCampoDocHTML, campoExcelHeader, writeCampoExcel, fetchCampoModuloRecords, campoModulosBodyHTML } from './campoOrden'

export const FORMAT_TITLE_FMEH = 'FORMATO DE MANTENIMIENTO DE EQUIPOS Y HORNILLAS'

// Cuerpo del formato (sin el encabezado de emisión), compartido entre la
// versión emitida de Reportes y la versión por orden (pestaña Campo).
export function buildFmehBodyHTML(records) {

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

  return `  <div style="margin-top:10px;overflow-x:auto">
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
  </div>`
}

// ── Versión por ORDEN (pestaña Campo de Documentos) ─────────────────────────
// Por módulo, los mantenimientos del MES (o meses) de producción de los
// lotes de campo de la orden.
export function fetchFmehOrdenData(cooperative, order) {
  return fetchCampoModuloRecords(cooperative, order, {
    table: 'equipment_maintenance_records',
    select: 'id, maintenance_date, equipment_name, maintenance_type, maintenance_cause, materials_used, duration_hours, responsible_person',
    dateCol: 'maintenance_date',
    mode: 'mes',
  })
}

export function fmehOrdenPdf(cooperative, order, containerNumber, data, firmantes) {
  return buildCampoDocHTML(cooperative, order, containerNumber, {
    key: 'fmeh', title: FORMAT_TITLE_FMEH, certNames: data.certNames, firmantes,
    body: campoModulosBodyHTML(data, m => buildFmehBodyHTML(m.records), 'Sin mantenimientos registrados en el período.'),
  })
}

export function fmehOrdenExcel(cooperative, order, containerNumber, data) {
  const rows = [...campoExcelHeader(order, data.certNames, FORMAT_TITLE_FMEH),
    ['Módulo', 'Fecha', 'Equipo / Hornilla', 'Tipo', 'Causa del mantenimiento', 'Materiales / Repuestos', 'Duración (h)', 'Responsable']]
  for (const m of data.modulos) for (const r of m.records) {
    rows.push([m.name, r.maintenance_date, r.equipment_name ?? '',
      r.maintenance_type === 'P' ? 'Preventivo' : r.maintenance_type === 'C' ? 'Correctivo' : (r.maintenance_type ?? ''),
      r.maintenance_cause ?? '', r.materials_used ?? '', r.duration_hours ?? '', r.responsible_person ?? ''])
  }
  writeCampoExcel('fmeh', order, containerNumber, [['Mantenimiento de equipos', rows]])
}
