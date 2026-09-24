import { PRINT_STYLES, fmtDate, fmtDateTime, buildFirmasHTML } from './shared'

export const FORMAT_TYPE_FSEA  = 'FSEA'
export const FORMAT_TITLE_FSEA = 'FORMATO DE SEGUIMIENTO DE ENFERMEDADES Y ACCIDENTES'

export function buildPrintHTMLFsea(cooperative, formatCode, moduleName, dateFrom, dateTo, emittedAt, incidents, firmantes) {
  const firmasHTML  = buildFirmasHTML(firmantes)
  const emisionDate = emittedAt ? fmtDateTime(emittedAt) : '—'

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

  return `<!DOCTYPE html><html lang="es">
<head><meta charset="UTF-8"><title>${FORMAT_TITLE_FSEA}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase">${cooperative?.name ?? ''}</div>
      <div style="font-size:14px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_FSEA}</div>
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
  </div>
  <div class="formato-firmas">${firmasHTML}</div>
</body></html>`
}
