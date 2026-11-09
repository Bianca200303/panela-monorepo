import { fmtDate } from './shared'
import { buildCampoDocHTML, campoExcelHeader, writeCampoExcel, fetchCampoModuloRecords, campoModulosBodyHTML } from './campoOrden'

export const FORMAT_TITLE_FSEA = 'FORMATO DE SEGUIMIENTO DE ENFERMEDADES Y ACCIDENTES'

// Cuerpo del formato (sin el encabezado de emisión), compartido entre la
// versión emitida de Reportes y la versión por orden (pestaña Campo).
export function buildFseaBodyHTML(incidents) {

  const getActions = (inc) => {
    const acts = []
    if (inc.action_rest)              acts.push('Descanso')
    if (inc.action_medical_attention) acts.push('Atención médica')
    if (inc.action_relocation)        acts.push('Reubicación')
    if (inc.action_medication)        acts.push('Medicación')
    if (inc.action_other)             acts.push(inc.other_action_detail ? `Otro: ${inc.other_action_detail}` : 'Otro')
    return acts.join(', ') || '—'
  }

  const rows = incidents.length > 0
    ? incidents.map((inc, i) => `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="white-space:nowrap">${fmtDate(inc.registration_date)}</td>
        <td>${inc.employee_name ?? '—'}</td>
        <td>${inc.work_area ?? '—'}</td>
        <td style="font-size:10px">${inc.symptoms_description ?? '—'}</td>
        <td style="font-size:10px">${getActions(inc)}</td>
        <td style="text-align:center;white-space:nowrap">${inc.return_date ? fmtDate(inc.return_date) : '—'}</td>
        <td style="text-align:center;font-weight:700;color:${inc.certificate_presented ? '#166534' : '#991b1b'}">${inc.certificate_presented ? 'Sí' : 'No'}</td>
      </tr>`).join('')
    : `<tr><td colspan="8" style="text-align:center;color:#999;font-style:italic;padding:14px">Sin registros en el período</td></tr>`

  const totalCert    = incidents.filter(i => i.certificate_presented).length
  const totalRetorno = incidents.filter(i => i.return_date).length

  return `  <div style="margin-top:10px;overflow-x:auto">
    <table class="formato-table">
      <thead>
        <tr>
          <th>N°</th><th>Fecha</th><th>Empleado/a</th><th>Área de trabajo</th>
          <th>Síntomas / Enfermedad</th><th>Acciones tomadas</th>
          <th>Retorno al trabajo</th><th>Certificado médico</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="margin-top:8px;padding:6px 8px;background:#f0f0f0;border:1px solid #ccc;font-size:11px;display:flex;gap:32px">
    <span><strong>Total incidentes:</strong> ${incidents.length}</span>
    <span><strong>Con certificado médico:</strong> <strong>${totalCert}</strong></span>
    <span><strong>Con retorno registrado:</strong> <strong>${totalRetorno}</strong></span>
  </div>`
}

// ── Versión por ORDEN (pestaña Campo de Documentos) ─────────────────────────
// Por módulo, los incidentes del MES (o meses) de producción de los lotes de
// campo de la orden.
export function fetchFseaOrdenData(cooperative, order) {
  return fetchCampoModuloRecords(cooperative, order, {
    table: 'health_incidents',
    select: `id, registration_date, employee_name, work_area, symptoms_description,
      action_rest, action_medical_attention, action_relocation, action_medication, action_other, other_action_detail,
      return_date, certificate_presented`,
    dateCol: 'registration_date',
    mode: 'mes',
  })
}

export function fseaOrdenPdf(cooperative, order, containerNumber, data, firmantes) {
  return buildCampoDocHTML(cooperative, order, containerNumber, {
    key: 'fsea', title: FORMAT_TITLE_FSEA, certNames: data.certNames, firmantes,
    body: campoModulosBodyHTML(data, m => buildFseaBodyHTML(m.records), 'Sin enfermedades ni accidentes registrados en el período.'),
  })
}

export function fseaOrdenExcel(cooperative, order, containerNumber, data) {
  const acciones = inc => [
    inc.action_rest && 'Descanso', inc.action_medical_attention && 'Atención médica', inc.action_relocation && 'Reubicación',
    inc.action_medication && 'Medicación', inc.action_other && (inc.other_action_detail ? `Otro: ${inc.other_action_detail}` : 'Otro'),
  ].filter(Boolean).join(', ')
  const rows = [...campoExcelHeader(order, data.certNames, FORMAT_TITLE_FSEA),
    ['Módulo', 'Fecha', 'Empleado/a', 'Área de trabajo', 'Síntomas / Enfermedad', 'Acciones tomadas', 'Retorno al trabajo', 'Certificado médico']]
  for (const m of data.modulos) for (const inc of m.records) {
    rows.push([m.name, inc.registration_date, inc.employee_name ?? '', inc.work_area ?? '', inc.symptoms_description ?? '',
      acciones(inc), inc.return_date ?? '', inc.certificate_presented ? 'Sí' : 'No'])
  }
  writeCampoExcel('fsea', order, containerNumber, [['Enfermedades y accidentes', rows]])
}
