import { PRINT_STYLES, fmtDate, escapeHtml } from './shared'

export const FORMAT_TYPE_FCPO  = 'FCPO'
export const FORMAT_TITLE_FCPO = 'FORMATO DE CONTROL DE PERSONAL OPERARIO'

export const WORK_AREA_LABELS = {
  M:   'Molienda',
  H:   'Hornilla',
  TT:  'Tratamiento Térmico',
  TEA: 'Taller de Empaque y Almacén',
  rr:  'Otros',
}

const FCPO_CRITERIA = [
  { key: 'uniform_complete',  label: 'Uniforme completo' },
  { key: 'no_makeup',         label: 'Sin maquillaje' },
  { key: 'nails_short_clean', label: 'Uñas cortas limpias' },
  { key: 'nails_no_polish',   label: 'Uñas no esmaltadas' },
  { key: 'hands_clean',       label: 'Manos limpias' },
  { key: 'no_jewelry',        label: 'Sin joyas / accesorios' },
  { key: 'hair_covered',      label: 'Cabello cubierto' },
  { key: 'no_beard',          label: 'Sin barba' },
  { key: 'no_wounds',         label: 'Sin heridas / cortes' },
]

export function buildPrintHTMLFcpo(cooperative, formatCode, emittedAt, batch, producer, areas, firmantes) {
  const emisionDate = emittedAt
    ? new Date(emittedAt).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '___/___/______'

  const producerName = producer ? escapeHtml(`${producer.first_name} ${producer.last_name}`) : '—'
  const moduleName   = producer?.coop_modules?.name ?? '—'

  const totalWorkers   = areas.reduce((s, a) => s + (a.items?.length ?? 0), 0)
  const totalCriteria  = totalWorkers * FCPO_CRITERIA.length
  const totalCompliant = areas.reduce((s, a) =>
    s + (a.items ?? []).reduce((si, w) =>
      si + FCPO_CRITERIA.filter(c => w[c.key]).length, 0), 0)
  const pctCumple = totalCriteria > 0 ? (totalCompliant / totalCriteria * 100).toFixed(1) : '—'

  const areaBlocks = areas.map(area => {
    const areaLabel = WORK_AREA_LABELS[area.work_area] ?? area.work_area
    const workers   = area.items ?? []
    const criteriaHeaders = FCPO_CRITERIA.map(c =>
      `<th style="font-size:9px;white-space:nowrap;writing-mode:vertical-rl;transform:rotate(180deg);padding:4px 2px;max-height:80px">${c.label}</th>`
    ).join('')
    const workerRows = workers.length > 0
      ? workers.map((w, i) => {
          const cells = FCPO_CRITERIA.map(c =>
            `<td style="text-align:center;font-weight:700;color:${w[c.key] ? '#166534' : '#991b1b'}">${w[c.key] ? '✓' : '✗'}</td>`
          ).join('')
          const nonCompliant = FCPO_CRITERIA.filter(c => !w[c.key]).map(c => c.label)
          return `<tr>
            <td style="text-align:center">${i + 1}</td>
            <td>${w.worker_name ?? '—'}</td>
            ${cells}
            <td style="font-size:9px;color:#555">${nonCompliant.length > 0 ? nonCompliant.join(', ') : '—'}</td>
          </tr>`
        }).join('')
      : `<tr><td colspan="${FCPO_CRITERIA.length + 3}" style="text-align:center;color:#999;font-style:italic">Sin trabajadores registrados</td></tr>`

    const areaTotal     = workers.length * FCPO_CRITERIA.length
    const areaCompliant = workers.reduce((s, w) => s + FCPO_CRITERIA.filter(c => w[c.key]).length, 0)
    const areaPct       = areaTotal > 0 ? (areaCompliant / areaTotal * 100).toFixed(0) : '—'

    return `
      <div class="section-label" style="margin-top:14px">Área: ${areaLabel.toUpperCase()}</div>
      <table class="formato-table">
        <thead>
          <tr>
            <th style="width:28px">#</th>
            <th style="text-align:left;min-width:120px">Nombre del trabajador</th>
            ${criteriaHeaders}
            <th style="font-size:9px;min-width:80px">No conformidades</th>
          </tr>
        </thead>
        <tbody>${workerRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="font-weight:700;font-size:10px">Cumplimiento del área</td>
            <td colspan="${FCPO_CRITERIA.length}" style="text-align:center;font-weight:700;color:${Number(areaPct) >= 90 ? '#166534' : '#991b1b'}">${areaPct}%</td>
            <td style="text-align:center;font-size:10px">${workers.length} trabajador(es)</td>
          </tr>
        </tfoot>
      </table>
      ${area.observations ? `<div style="font-size:10px;margin-top:3px;color:#555"><strong>Obs. área:</strong> ${escapeHtml(area.observations)}</div>` : ''}
    `
  }).join('')

  const firmasHTML = (() => {
    if (firmantes?.length > 0) {
      return firmantes.map(f => `
        <div class="firma-bloque">
          <div class="firma-linea"></div>
          <div class="firma-nombre">${escapeHtml(f.nombre) || '_______________________'}</div>
          <div class="firma-cargo">${escapeHtml(f.cargo) || 'Responsable'}</div>
        </div>`).join('')
    }
    return `<div class="firma-bloque"><div class="firma-linea"></div><div class="firma-nombre">_______________________</div><div class="firma-cargo">Responsable</div></div>`
  })()

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${formatCode ?? FORMAT_TYPE_FCPO}</title>
  <style>
    ${PRINT_STYLES}
    .formato-table th { vertical-align: bottom; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${cooperative?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_FCPO}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Código:</span> <strong>${formatCode ?? '(borrador)'}</strong></div>
      <div><span class="meta-label">Fecha de emisión:</span> ${emisionDate}</div>
      <div><span class="meta-label">Lote de campo:</span> ${batch?.batch_code ?? '—'}</div>
      <div><span class="meta-label">Fecha de proceso:</span> ${fmtDate(batch?.process_date)}</div>
      <div><span class="meta-label">Productor:</span> ${producerName}</div>
      <div><span class="meta-label">Módulo:</span> ${moduleName}</div>
    </div>
  </div>

  ${areaBlocks}

  <div style="margin-top:12px;padding:6px 8px;background:#f0f0f0;border:1px solid #ccc;font-size:11px;display:flex;gap:32px">
    <span><strong>Total trabajadores evaluados:</strong> ${totalWorkers}</span>
    <span><strong>Total criterios:</strong> ${FCPO_CRITERIA.length} por trabajador</span>
    <span><strong>Cumplimiento global:</strong> <strong style="color:${Number(pctCumple) >= 90 ? '#166534' : '#991b1b'}">${pctCumple}%</strong></span>
  </div>

  <div class="formato-firmas">${firmasHTML}</div>
</body>
</html>`
}
