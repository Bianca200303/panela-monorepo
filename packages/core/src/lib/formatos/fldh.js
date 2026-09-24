import { PRINT_STYLES, fmtDate, fmtDateTime, buildFirmasHTML } from './shared'

export const FORMAT_TYPE_FLDH  = 'FLDH'
export const FORMAT_TITLE_FLDH = 'FORMATO DE LIMPIEZA Y DESINFECCIÓN'

export function buildPrintHTMLFldh(cooperative, formatCode, moduleName, dateFrom, dateTo, emittedAt, records, firmantes) {
  const firmasHTML  = buildFirmasHTML(firmantes)
  const emisionDate = emittedAt ? fmtDateTime(emittedAt) : '—'

  const ALL_AREAS = [
    'reception_milling', 'thermal_treatment', 'homogenization_packaging',
    'warehouses', 'changing_rooms', 'restrooms', 'cleaning_equipment', 'reservoir',
  ]
  const AREA_LABEL = {
    reception_milling:        'Recepción, molienda y secado',
    thermal_treatment:        'Tratamiento térmico',
    homogenization_packaging: 'Homogenizado, tamizado y envasado',
    warehouses:               'Almacenes',
    changing_rooms:           'Vestuarios',
    restrooms:                'Servicios higiénicos',
    cleaning_equipment:       'Implementos de limpieza',
    reservoir:                'Reservorio',
  }
  const T_SHORT  = { daily: 'D', general: 'G', deep: 'P' }
  const T_COLOR  = { daily: '#1565C0', general: '#E65100', deep: '#6A1B9A' }
  const T_BG     = { daily: '#dbeafe', general: '#ffedd5', deep: '#f3e8ff' }

  // All calendar days in the period
  const days = []
  for (let d = new Date(dateFrom + 'T00:00:00'); d <= new Date(dateTo + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().split('T')[0])
  }

  // Lookup by date
  const byDate = {}
  records.forEach(r => { byDate[r.cleaning_date] = r })

  // Column headers: day number + type badges
  const colHeaders = days.map(date => {
    const s   = byDate[date]
    const day = date.split('-')[2]
    if (!s) return `<th style="background:#f5f5f5;color:#bbb;font-size:8px;padding:2px 0;text-align:center;width:24px;min-width:24px">${day}</th>`
    const badges = (s.cleaning_types ?? []).map(t =>
      `<span style="display:block;background:${T_BG[t]};color:${T_COLOR[t]};font-weight:800;font-size:7px;border:1px solid ${T_COLOR[t]};border-radius:2px;padding:0 2px;line-height:1.5;margin-top:1px">${T_SHORT[t] ?? t}</span>`
    ).join('')
    return `<th style="background:#fff;font-size:8px;padding:2px 0;text-align:center;width:24px;min-width:24px;vertical-align:bottom"><div style="font-weight:700;color:#111">${day}</div>${badges}</th>`
  }).join('')

  // Area rows
  const areaRows = ALL_AREAS.map(code => {
    const cells = days.map(date => {
      const s = byDate[date]
      if (!s) return `<td style="background:#f9f9f9;border:1px solid #e5e5e5"></td>`
      const hit = (s.areas ?? []).includes(code)
      return hit
        ? `<td style="text-align:center;background:#f0fdf4;border:1px solid #e5e5e5;color:#2d6a4f;font-weight:900;font-size:11px">✓</td>`
        : `<td style="background:#fff;border:1px solid #e5e5e5;color:#fca5a5;text-align:center;font-size:9px">✗</td>`
    }).join('')
    return `<tr><td style="font-size:9px;padding:3px 5px;border:1px solid #e5e5e5;white-space:nowrap;background:#fafafa">${AREA_LABEL[code]}</td>${cells}</tr>`
  }).join('')

  // Products row
  const prodRow = `<tr style="background:#f5f5f5">
    <td style="font-size:8px;padding:2px 5px;border:1px solid #e5e5e5;font-weight:600;color:#555">Productos</td>
    ${days.map(date => {
      const s = byDate[date]
      if (!s) return `<td style="background:#f5f5f5;border:1px solid #e5e5e5"></td>`
      const p = [s.usesChlorine && 'Cl', s.usesDetergent && 'Det', s.usesOther && 'Otro'].filter(Boolean).join('+')
      return `<td style="text-align:center;font-size:7px;padding:1px;border:1px solid #e5e5e5;color:#555">${p}</td>`
    }).join('')}
  </tr>`

  const countDiaria   = records.filter(r => (r.cleaning_types ?? []).includes('daily')).length
  const countGeneral  = records.filter(r => (r.cleaning_types ?? []).includes('general')).length
  const countProfunda = records.filter(r => (r.cleaning_types ?? []).includes('deep')).length
  const totalPuntos   = records.reduce((s, r) => s + (r.totalPoints ?? 0), 0)

  const legend = ['daily','general','deep'].map(t =>
    `<span style="background:${T_BG[t]};color:${T_COLOR[t]};font-weight:800;border:1px solid ${T_COLOR[t]};border-radius:2px;padding:0 4px;font-size:9px">${T_SHORT[t]}</span> ${t === 'daily' ? 'Diaria' : t === 'general' ? 'General' : 'Profunda'}`
  ).join(' &nbsp; ')

  return `<!DOCTYPE html><html lang="es">
<head><meta charset="UTF-8"><title>${FORMAT_TITLE_FLDH}</title>
  <style>${PRINT_STYLES} @page{size:A4 landscape;margin:8mm} body{font-size:10px}</style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:6px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase">${cooperative?.name ?? ''}</div>
      <div style="font-size:13px;font-weight:800;margin-top:3px;text-transform:uppercase">${FORMAT_TITLE_FLDH}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Código:</span> <strong style="font-family:monospace">${formatCode ?? '(borrador)'}</strong></div>
      <div><span class="meta-label">Fecha de emisión:</span> ${emisionDate}</div>
      <div><span class="meta-label">Módulo:</span> ${moduleName}</div>
      <div><span class="meta-label">Período:</span> ${fmtDate(dateFrom)} — ${fmtDate(dateTo)}</div>
    </div>
  </div>
  <div style="margin-top:8px;overflow-x:auto">
    <table style="border-collapse:collapse;table-layout:fixed;width:100%">
      <colgroup>
        <col style="width:145px">
        ${days.map(() => '<col style="width:24px">').join('')}
      </colgroup>
      <thead>
        <tr>
          <th style="font-size:9px;padding:3px 5px;text-align:left;background:#f0f0f0;border:1px solid #ddd">Área</th>
          ${colHeaders}
        </tr>
      </thead>
      <tbody>
        ${areaRows}
        ${prodRow}
      </tbody>
    </table>
  </div>
  <div style="margin-top:6px;padding:5px 8px;background:#f0f0f0;border:1px solid #ccc;font-size:10px;display:flex;gap:20px;flex-wrap:wrap;align-items:center">
    <span><strong>Días con registro:</strong> ${records.length} / ${days.length}</span>
    <span><strong style="color:#1565C0">D Diaria:</strong> ${countDiaria}</span>
    <span><strong style="color:#E65100">G General:</strong> ${countGeneral}</span>
    <span><strong style="color:#6A1B9A">P Profunda:</strong> ${countProfunda}</span>
    <span><strong>Puntos totales:</strong> ${totalPuntos}</span>
    <span style="margin-left:auto">${legend}</span>
  </div>
  <div class="formato-firmas">${firmasHTML}</div>
</body></html>`
}
