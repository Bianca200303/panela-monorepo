import { supabase } from '../supabase'
import { buildCampoDocHTML, campoExcelHeader, writeCampoExcel, fetchCampoModuloRecords, campoModulosBodyHTML } from './campoOrden'

export const FORMAT_TITLE_FLDH = 'FORMATO DE LIMPIEZA Y DESINFECCIÓN'

export const FLDH_ALL_AREAS = [
  'reception_milling', 'thermal_treatment', 'homogenization_packaging',
  'warehouses', 'changing_rooms', 'restrooms', 'cleaning_equipment', 'reservoir',
]
export const FLDH_AREA_LABELS = {
  reception_milling:        'Recepción, molienda y secado',
  thermal_treatment:        'Tratamiento térmico',
  homogenization_packaging: 'Homogenizado, tamizado y envasado',
  warehouses:               'Almacenes',
  changing_rooms:           'Vestuarios',
  restrooms:                'Servicios higiénicos',
  cleaning_equipment:       'Implementos de limpieza',
  reservoir:                'Reservorio',
}

// Cuerpo del formato (sin el encabezado de emisión), compartido entre la
// versión emitida de Reportes y la versión por orden (pestaña Campo).
export function buildFldhBodyHTML(records, days) {
  const T_SHORT  = { daily: 'D', general: 'G', deep: 'P' }
  const T_COLOR  = { daily: '#1565C0', general: '#E65100', deep: '#6A1B9A' }
  const T_BG     = { daily: '#dbeafe', general: '#ffedd5', deep: '#f3e8ff' }

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
  const areaRows = FLDH_ALL_AREAS.map(code => {
    const cells = days.map(date => {
      const s = byDate[date]
      if (!s) return `<td style="background:#f9f9f9;border:1px solid #e5e5e5"></td>`
      const hit = (s.areas ?? []).includes(code)
      return hit
        ? `<td style="text-align:center;background:#f0fdf4;border:1px solid #e5e5e5;color:#2d6a4f;font-weight:900;font-size:11px">✓</td>`
        : `<td style="background:#fff;border:1px solid #e5e5e5;color:#fca5a5;text-align:center;font-size:9px">✗</td>`
    }).join('')
    return `<tr><td style="font-size:9px;padding:3px 5px;border:1px solid #e5e5e5;white-space:nowrap;background:#fafafa">${FLDH_AREA_LABELS[code]}</td>${cells}</tr>`
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

  return `  <div style="margin-top:8px;overflow-x:auto">
    <table style="border-collapse:collapse;table-layout:fixed;width:100%;max-width:${200 + days.length * 30}px">
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
  </div>`
}

// ── Versión por ORDEN (pestaña Campo de Documentos) ─────────────────────────
// Por módulo, las limpiezas de los días exactos de producción; la grilla
// muestra solo esos días (no el mes entero).
export async function fetchFldhOrdenData(cooperative, order) {
  const data = await fetchCampoModuloRecords(cooperative, order, {
    table: 'cleaning_disinfections',
    select: 'id, cleaning_date, cleaning_types, general_observations',
    dateCol: 'cleaning_date',
    mode: 'dia',
  })
  const ids = data.modulos.flatMap(m => m.records.map(r => r.id))
  if (ids.length === 0) return data
  const { data: items, error } = await supabase
    .from('cleaning_disinfection_items')
    .select('cleaning_disinfection_id, area_code, uses_chlorine, uses_detergent, uses_other_product')
    .in('cleaning_disinfection_id', ids)
  if (error) throw new Error(error.message)
  // Misma forma que arma FormatosLimpiezaSection.jsx para buildFldhBodyHTML.
  const withItems = s => {
    const si = (items ?? []).filter(i => i.cleaning_disinfection_id === s.id)
    return {
      ...s,
      areas:         [...new Set(si.map(i => i.area_code))],
      totalPoints:   si.length,
      usesChlorine:  si.some(i => i.uses_chlorine),
      usesDetergent: si.some(i => i.uses_detergent),
      usesOther:     si.some(i => i.uses_other_product),
    }
  }
  return { ...data, modulos: data.modulos.map(m => ({ ...m, records: m.records.map(withItems) })) }
}

export function fldhOrdenPdf(cooperative, order, containerNumber, data, firmantes) {
  return buildCampoDocHTML(cooperative, order, containerNumber, {
    key: 'fldh', title: FORMAT_TITLE_FLDH, certNames: data.certNames, firmantes,
    styles: '@page{size:A4 landscape;margin:8mm}',
    body: campoModulosBodyHTML(data, m => buildFldhBodyHTML(m.records, m.dates), 'Sin limpiezas registradas en las fechas de producción.'),
  })
}

const FLDH_TYPE_LABELS = { daily: 'Diaria', general: 'General', deep: 'Profunda' }

export function fldhOrdenExcel(cooperative, order, containerNumber, data) {
  const rows = [...campoExcelHeader(order, data.certNames, FORMAT_TITLE_FLDH),
    ['Módulo', 'Fecha', 'Tipo de limpieza', 'Áreas limpias', 'Áreas sin limpiar', 'Productos', 'Observaciones']]
  for (const m of data.modulos) for (const r of m.records) {
    rows.push([
      m.name, r.cleaning_date, (r.cleaning_types ?? []).map(t => FLDH_TYPE_LABELS[t] ?? t).join(' + '),
      r.areas.map(a => FLDH_AREA_LABELS[a] ?? a).join(', '),
      FLDH_ALL_AREAS.filter(a => !r.areas.includes(a)).map(a => FLDH_AREA_LABELS[a]).join(', '),
      [r.usesChlorine && 'Cloro', r.usesDetergent && 'Detergente', r.usesOther && 'Otro'].filter(Boolean).join(' + '),
      r.general_observations ?? '',
    ])
  }
  writeCampoExcel('fldh', order, containerNumber, [['Limpieza y desinfección', rows]])
}
