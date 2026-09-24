import { PRINT_STYLES, fmtDate, fmtDateTime, buildFirmasHTML, escapeHtml } from './shared'

export const FORMAT_TYPE_FIAE  = 'FIAE'
export const FORMAT_TITLE_FIAE = 'FORMATO DE INSPECCIÓN DE AMBIENTES, EQUIPO Y PERSONAL'

const FIAE_AREA_ORDER = [
  'reception_milling', 'thermal_treatment', 'sieving_packing',
  'warehouses', 'dressing_rooms', 'restrooms', 'cleaning_implements', 'reservoir',
]
const FIAE_AREA_LABELS = {
  reception_milling:   'Recepción de Materia Prima — Molienda — Secado de Bagazo',
  thermal_treatment:   'Tratamiento Térmico',
  sieving_packing:     'Tamizado y Envasado',
  warehouses:          'Almacenes',
  dressing_rooms:      'Vestuarios',
  restrooms:           'Servicios Higiénicos',
  cleaning_implements: 'Implementos de Limpieza',
  reservoir:           'Reservorio',
}

export function buildPrintHTMLFiae(cooperative, formatCode, moduleName, inspectionDate, emittedAt, items, firmantes) {
  const firmasHTML  = buildFirmasHTML(firmantes)
  const emisionDate = emittedAt ? fmtDateTime(emittedAt) : '—'

  const byArea = {}
  ;(items ?? []).forEach(it => {
    if (!byArea[it.area_code]) byArea[it.area_code] = []
    byArea[it.area_code].push(it)
  })

  const totalItems  = items?.length ?? 0
  const conformes   = (items ?? []).filter(i => i.condition === 'compliant').length
  const noConformes = totalItems - conformes
  const pct = totalItems > 0 ? Math.round(conformes / totalItems * 100) : 0

  const areaSections = FIAE_AREA_ORDER
    .filter(code => byArea[code]?.length > 0)
    .map((code, aIdx) => {
      const label = FIAE_AREA_LABELS[code] ?? code
      const rows = byArea[code].map((it, i) => {
        const ok = it.condition === 'compliant'
        const stateColor = ok ? '#166534' : '#dc2626'
        return `<tr>
          <td style="text-align:center;width:30px">${i + 1}</td>
          <td>${it.item_description ?? it.item_code}</td>
          <td style="text-align:center;font-size:15px;color:${stateColor}">${ok ? '✓' : '✗'}</td>
          <td style="text-align:center;font-weight:700;color:${stateColor}">${ok ? 'Conforme' : 'No Conforme'}</td>
          <td style="font-size:10px">${it.corrective_actions ?? '—'}</td>
          <td style="font-size:10px">${escapeHtml(it.observations) ?? '—'}</td>
        </tr>`
      }).join('')
      return `<div style="margin-bottom:8px">
        <div style="background:#374151;color:#fff;padding:4px 8px;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">
          ${aIdx + 1}. ${label}
        </div>
        <table class="formato-table">
          <thead>
            <tr><th>N°</th><th style="text-align:left;min-width:160px">Ítem</th>
              <th style="width:30px"></th><th>Estado</th>
              <th>Acciones correctivas</th><th>Observaciones</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
    }).join('')

  return `<!DOCTYPE html><html lang="es">
<head><meta charset="UTF-8"><title>${FORMAT_TITLE_FIAE}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase">${cooperative?.name ?? ''}</div>
      <div style="font-size:14px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_FIAE}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Código:</span> <strong style="font-family:monospace">${formatCode ?? '(borrador)'}</strong></div>
      <div><span class="meta-label">Fecha de emisión:</span> ${emisionDate}</div>
      <div><span class="meta-label">Módulo:</span> ${moduleName}</div>
      <div><span class="meta-label">Fecha de inspección:</span> ${fmtDate(inspectionDate)}</div>
    </div>
  </div>
  <div style="margin-top:10px">${areaSections}</div>
  <div style="margin-top:8px;padding:6px 8px;background:#f0f0f0;border:1px solid #ccc;font-size:11px;display:flex;gap:32px">
    <span><strong>Total ítems:</strong> ${totalItems}</span>
    <span><strong>Conformes:</strong> <span style="color:#166534;font-weight:700">${conformes}</span></span>
    <span><strong>No Conformes:</strong> <span style="color:#dc2626;font-weight:700">${noConformes}</span></span>
    <span><strong>Cumplimiento:</strong> <strong style="color:${pct >= 90 ? '#166534' : '#b45309'}">${pct}%</strong></span>
  </div>
  <div class="formato-firmas">${firmasHTML}</div>
</body></html>`
}
