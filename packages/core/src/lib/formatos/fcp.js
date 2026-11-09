import { escapeHtml, fmtDate } from './shared'
import { buildCampoDocHTML, campoExcelHeader, writeCampoExcel, fetchCampoModuloRecords, campoModulosBodyHTML } from './campoOrden'

export const FORMAT_TITLE_FCP = 'FORMATO DE CONTROL DE PLAGAS'

// Cuerpo del formato (sin el encabezado de emisión), compartido entre la
// versión emitida de Reportes y la versión por orden (pestaña Campo).
export function buildFcpBodyHTML(pestControls) {

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

  return `  <div style="margin-top:10px">${body}</div>
  <div style="margin-top:8px;padding:6px 8px;background:#f0f0f0;border:1px solid #ccc;font-size:11px;display:flex;gap:32px">
    <span><strong>Registros:</strong> ${pestControls?.length ?? 0}</span>
    <span><strong>Con cebos:</strong> ${baitEntries.length}</span>
    <span><strong>Con insectos:</strong> ${insectEntries.length}</span>
  </div>`
}

// ── Versión por ORDEN (pestaña Campo de Documentos) ─────────────────────────
// Por módulo, los controles del MES (o meses) de producción de los lotes de
// campo de la orden -- no se registran a diario.
export function fetchFcpOrdenData(cooperative, order) {
  return fetchCampoModuloRecords(cooperative, order, {
    table: 'pest_controls',
    select: `id, control_date,
      pest_control_bait_records   ( id, product_name, quantity, unit, bait_stations, bait_observations ),
      pest_control_insect_records ( id, product_name, quantity, unit, insect_data )`,
    dateCol: 'control_date',
    mode: 'mes',
  })
}

export function fcpOrdenPdf(cooperative, order, containerNumber, data, firmantes) {
  return buildCampoDocHTML(cooperative, order, containerNumber, {
    key: 'fcp', title: FORMAT_TITLE_FCP, certNames: data.certNames, firmantes,
    body: campoModulosBodyHTML(data, m => buildFcpBodyHTML(m.records), 'Sin controles de plagas en el período.'),
  })
}

export function fcpOrdenExcel(cooperative, order, containerNumber, data) {
  const header = campoExcelHeader(order, data.certNames, FORMAT_TITLE_FCP)
  const cebos = [...header, ['Módulo', 'Fecha', 'Producto', 'Cantidad', 'Unidad', 'N° Estación', '¿Comió?', 'Observaciones']]
  const insectos = [...header, ['Módulo', 'Fecha', 'Producto', 'Cantidad', 'Unidad', 'Área', 'Moscas', 'Abejas', 'Hormigas', 'Cucarachas', 'Observaciones']]
  for (const m of data.modulos) for (const pc of m.records) {
    for (const b of pc.pest_control_bait_records ?? []) {
      const stations = b.bait_stations?.length ? b.bait_stations : [null]
      for (const s of stations) {
        cebos.push([m.name, pc.control_date, b.product_name ?? '', b.quantity ?? '', b.unit ?? '', s?.station_number ?? '', s ? (s.ate ? 'Sí' : 'No') : '', b.bait_observations ?? ''])
      }
    }
    for (const ins of pc.pest_control_insect_records ?? []) {
      const rows = ins.insect_data?.length ? ins.insect_data : [null]
      for (const d of rows) {
        insectos.push([m.name, pc.control_date, ins.product_name ?? '', ins.quantity ?? '', ins.unit ?? '', d?.area ?? '',
          d?.flies ?? '', d?.bees ?? '', d?.ants ?? '', d?.cockroaches ?? '', d?.observations ?? ''])
      }
    }
  }
  writeCampoExcel('fcp', order, containerNumber, [['Control de cebos', cebos], ['Control de insectos', insectos]])
}
