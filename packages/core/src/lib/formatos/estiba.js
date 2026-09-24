import { PRINT_STYLES, fmtDate, escapeHtml } from './shared'

export const FORMAT_TITLE_ESTIBA = 'FORMATO DE INSPECCIÓN DE ESTIBA Y TRANSPORTE'

// cooperative como primer parámetro (antes leía COOPERATIVE del módulo
// lib/config, que ya no existe en core) -- los call sites lo inyectan desde
// useCooperative().
export function buildPrintHTMLEstiba(cooperative, formatCode, emittedAt, exitReg, stowage, exitItems, firmantes) {
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
  const firmas = firmantes?.length > 0
    ? firmantes.map(f => `
    <div class="firma-bloque"><div class="firma-linea"></div>
    <div class="firma-nombre">${escapeHtml(f.nombre)||'_______________________'}</div>
    <div class="firma-cargo">${escapeHtml(f.cargo)||'Responsable'}</div></div>`).join('')
    : `<div class="firma-bloque"><div class="firma-linea"></div><div class="firma-nombre">_______________________</div><div class="firma-cargo">Responsable</div></div>`

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<title>${formatCode}</title><style>${PRINT_STYLES}</style></head><body>
<div class="formato-header">
  <div style="text-align:center;margin-bottom:8px">
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${cooperative?.name??''}</div>
    <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_ESTIBA}</div>
  </div>
  <div class="formato-meta">
    <div><span class="meta-label">Código:</span> <strong>${formatCode}</strong></div>
    <div><span class="meta-label">Fecha emisión:</span> ${emittedAt ? new Date(emittedAt).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'}) : '___/___/______'}</div>
    <div><span class="meta-label">N° Salida:</span> ${exitReg?.exit_code??'—'}</div>
    <div><span class="meta-label">Fecha salida:</span> ${fmtDate(exitReg?.exit_date)}</div>
    <div><span class="meta-label">Fecha inspección:</span> ${fmtDate(stowage.inspection_date)}</div>
    <div><span class="meta-label">Guía remisión:</span> ${exitReg?.document_number??'—'}</div>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;margin-top:10px">
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
</table>`:''}

<div class="formato-firmas">${firmas}</div>
</body></html>`
}
