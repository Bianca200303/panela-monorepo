import { supabase } from '../supabase'
import { escapeHtml, fmtDate, PRINT_STYLES } from './shared'
import { fetchFieldContextForOrder, buildCampoDocHTML, campoSinRegistrosHTML, campoExcelHeader, writeCampoExcel, producerName } from './campoOrden'

export const FORMAT_TITLE_ESTIBA = 'FORMATO DE INSPECCIÓN DE ESTIBA Y TRANSPORTE'

// Cuerpo del FET (transportista, vehículo, checklists, lotes), compartido
// entre la versión emitida de Reportes y la versión por orden de abajo.
export function buildEstibaBodyHTML(stowage, exitItems) {
  const CHECK = (v) => `<span style="color:${v?'#166534':'#991b1b'}">${v?'✓':'✗'}</span>`
  const checks1 = [
    ['Llanta repuesto', stowage.has_spare_tire], ['SOAT vigente', stowage.has_valid_soat],
    ['Revisión técnica', stowage.has_technical_review], ['Botiquín', stowage.has_first_aid_kit],
    ['Extintor', stowage.has_fire_extinguisher], ['GPS', stowage.has_gps],
    ['Útiles limpieza', stowage.has_cleaning_supplies],
  ]
  const checks2 = [
    ['Piso limpio', stowage.floors_clean], ['Paredes limpias', stowage.walls_clean],
    ['Techo limpio', stowage.ceilings_clean], ['Sin olores extraños', stowage.no_strange_odors],
    ['Toldo limpio', stowage.tarp_clean], ['Pallets limpios', stowage.pallets_clean],
  ]
  const checkRow = (items) => items.map(([l,v]) => `<tr><td>${l}</td><td style="text-align:center">${CHECK(v)}</td></tr>`).join('')
  const lotes = (exitItems ?? []).map((ei, i) => `<tr>
    <td style="text-align:center">${i+1}</td>
    <td style="font-family:monospace">${ei.production_batches?.batch_code ?? '—'}</td>
    <td>${ei.production_batches?.producers ? escapeHtml(`${ei.production_batches.producers.first_name} ${ei.production_batches.producers.last_name}`) : '—'}</td>
    <td style="text-align:right">${ei.quantity_kg ?? '—'} kg</td>
  </tr>`).join('')

  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;margin-top:10px">
  <div style="border:1px solid #555;padding:8px 10px">
    <div style="font-weight:700;font-size:11px;text-transform:uppercase;margin-bottom:6px">Datos del transportista</div>
    <div><span class="meta-label">Nombre / Razón social:</span> ${escapeHtml(stowage.carrier_name)}</div>
    ${stowage.carrier_ruc?`<div><span class="meta-label">RUC:</span> ${escapeHtml(stowage.carrier_ruc)}</div>`:''}
    ${stowage.carrier_license?`<div><span class="meta-label">Licencia:</span> ${escapeHtml(stowage.carrier_license)}</div>`:''}
  </div>
  <div style="border:1px solid #555;border-left:none;padding:8px 10px">
    <div style="font-weight:700;font-size:11px;text-transform:uppercase;margin-bottom:6px">Datos del vehículo</div>
    <div><span class="meta-label">Marca / Placa:</span> ${escapeHtml(stowage.vehicle_brand)} · ${escapeHtml(stowage.vehicle_plate)}</div>
    <div><span class="meta-label">Estado de conservación:</span> <strong style="color:${stowage.vehicle_condition==='adequate'?'#166534':'#991b1b'}">${stowage.vehicle_condition==='adequate'?'APTO':'NO APTO'}</strong></div>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;margin-top:-1px">
  <div style="border:1px solid #555;padding:8px 10px">
    <div style="font-weight:700;font-size:11px;text-transform:uppercase;margin-bottom:4px">Checklist del vehículo</div>
    <table class="formato-table"><tbody>${checkRow(checks1)}</tbody></table>
  </div>
  <div style="border:1px solid #555;border-left:none;padding:8px 10px">
    <div style="font-weight:700;font-size:11px;text-transform:uppercase;margin-bottom:4px">Condiciones de limpieza</div>
    <table class="formato-table"><tbody>${checkRow(checks2)}</tbody></table>
    <div style="margin-top:8px;font-weight:700;font-size:11px;text-transform:uppercase;margin-bottom:4px">Condición de sacos</div>
    <table class="formato-table"><tbody>
      <tr><td>Limpieza</td><td><strong>${stowage.sack_clean_condition??'—'}</strong></td></tr>
      <tr><td>Amarrado / cosido</td><td><strong>${stowage.sack_tied_condition??'—'}</strong></td></tr>
    </tbody></table>
  </div>
</div>

${stowage.observations?`<div style="border:1px solid #555;border-top:none;padding:6px 10px;font-size:11px"><span class="meta-label">Observaciones: </span>${escapeHtml(stowage.observations)}</div>`:''}

${lotes?`<div style="font-weight:700;font-size:11px;text-transform:uppercase;margin:12px 0 4px">Lotes de campo incluidos en la salida</div>
<table class="formato-table">
  <thead><tr><th>#</th><th>Lote</th><th>Productor</th><th>Kg</th></tr></thead>
  <tbody>${lotes}</tbody>
</table>`:''}`
}

// Vista de referencia de UNA inspección (sin encabezado de emisión): la usa
// el Control de Unidad de Transporte de CAES para mostrar cómo llegó la
// materia prima de la orden.
export function buildEstibaReferenciaHTML(exitReg, stowage, exitItems) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<title>${FORMAT_TITLE_ESTIBA}</title><style>${PRINT_STYLES}</style></head><body>
${salidaHeaderHTML({ exitReg, stowage })}
${buildEstibaBodyHTML(stowage, exitItems)}
</body></html>`
}

// ── Versión por ORDEN (pestaña Campo de Documentos) ─────────────────────────
// Una inspección por guía de salida (exit_registration) que trajo lotes de
// campo a esta orden. "Lotes incluidos" lista solo los de esa guía que
// entraron a la orden, con los kg de la guía (no los usados en la orden --
// esos están en Origen de la Materia Prima).
const STOWAGE_SELECT = `id, exit_registration_id, inspection_date, carrier_name, carrier_ruc, carrier_license,
  vehicle_brand, vehicle_plate, vehicle_condition, has_spare_tire, has_valid_soat, has_technical_review,
  has_first_aid_kit, has_fire_extinguisher, has_gps, has_cleaning_supplies, floors_clean, walls_clean,
  ceilings_clean, no_strange_odors, tarp_clean, pallets_clean, sack_clean_condition, sack_tied_condition, observations`

export async function fetchEstibaOrdenData(cooperative, order) {
  const ctx = await fetchFieldContextForOrder(cooperative, order)
  if (ctx.exitRegIds.length === 0) return { certNames: ctx.certNames, salidas: [] }

  const { data, error } = await supabase
    .from('stowage_transport_inspections')
    .select(STOWAGE_SELECT)
    .in('exit_registration_id', ctx.exitRegIds)
    .eq('cooperative_id', cooperative.id)
  if (error) throw new Error(error.message)

  const items = Object.values(ctx.exitItems)
  const salidas = (data ?? []).map(stowage => {
    const exitItems = items.filter(ei => ei.exit_registrations?.id === stowage.exit_registration_id)
    return { stowage, exitReg: exitItems[0]?.exit_registrations ?? null, exitItems }
  }).sort((a, b) => (a.exitReg?.exit_date ?? '').localeCompare(b.exitReg?.exit_date ?? ''))
  return { certNames: ctx.certNames, salidas }
}

function salidaHeaderHTML({ exitReg, stowage }) {
  return `<div class="lote-separator">
    <strong>Salida ${escapeHtml(exitReg?.exit_code) ?? '—'}</strong> · Guía de remisión: ${escapeHtml(exitReg?.document_number) ?? '—'}
    · Fecha salida: ${fmtDate(exitReg?.exit_date)} · Fecha inspección: ${fmtDate(stowage.inspection_date)}
  </div>`
}

export function estibaOrdenPdf(cooperative, order, containerNumber, { certNames, salidas }, firmantes) {
  return buildCampoDocHTML(cooperative, order, containerNumber, {
    key: 'fet',
    title: FORMAT_TITLE_ESTIBA,
    certNames,
    firmantes,
    body: salidas.length > 0
      ? salidas.map(s => `<div class="lote-block">${salidaHeaderHTML(s)}${buildEstibaBodyHTML(s.stowage, s.exitItems)}</div>`).join('')
      : campoSinRegistrosHTML('Ninguna guía de salida de los lotes de campo de esta orden tiene inspección de estiba registrada.'),
  })
}

const yn = v => v ? '✓' : '✗'

export function estibaOrdenExcel(cooperative, order, containerNumber, { certNames, salidas }) {
  const header = campoExcelHeader(order, certNames, FORMAT_TITLE_ESTIBA)
  const inspecciones = [...header, [
    'N° Salida', 'Guía remisión', 'Fecha salida', 'Fecha inspección', 'Transportista', 'RUC', 'Licencia', 'Marca', 'Placa', 'Estado vehículo',
    'Llanta repuesto', 'SOAT vigente', 'Revisión técnica', 'Botiquín', 'Extintor', 'GPS', 'Útiles limpieza',
    'Piso limpio', 'Paredes limpias', 'Techo limpio', 'Sin olores extraños', 'Toldo limpio', 'Pallets limpios',
    'Sacos: limpieza', 'Sacos: amarrado/cosido', 'Observaciones',
  ]]
  const lotes = [...header, ['N° Salida', 'Lote de campo', 'Productor', 'Kg']]
  for (const { exitReg, stowage: s, exitItems } of salidas) {
    inspecciones.push([
      exitReg?.exit_code ?? '', exitReg?.document_number ?? '', exitReg?.exit_date ?? '', s.inspection_date ?? '',
      s.carrier_name ?? '', s.carrier_ruc ?? '', s.carrier_license ?? '', s.vehicle_brand ?? '', s.vehicle_plate ?? '',
      s.vehicle_condition === 'adequate' ? 'Apto' : 'No apto',
      yn(s.has_spare_tire), yn(s.has_valid_soat), yn(s.has_technical_review), yn(s.has_first_aid_kit),
      yn(s.has_fire_extinguisher), yn(s.has_gps), yn(s.has_cleaning_supplies),
      yn(s.floors_clean), yn(s.walls_clean), yn(s.ceilings_clean), yn(s.no_strange_odors), yn(s.tarp_clean), yn(s.pallets_clean),
      s.sack_clean_condition ?? '', s.sack_tied_condition ?? '', s.observations ?? '',
    ])
    for (const ei of exitItems) {
      lotes.push([exitReg?.exit_code ?? '', ei.production_batches?.batch_code ?? '', producerName(ei.production_batches?.producers), ei.quantity_kg ?? ''])
    }
  }
  writeCampoExcel('fet', order, containerNumber, [['Inspecciones', inspecciones], ['Lotes incluidos', lotes]])
}
