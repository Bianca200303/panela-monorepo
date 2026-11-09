import { supabase } from '../supabase'
import { escapeHtml, fmtDate, fmtNum } from './shared'
import { fetchFieldContextForOrder, buildCampoDocHTML, campoSinRegistrosHTML, campoExcelHeader, writeCampoExcel, producerName } from './campoOrden'

export const FORMAT_TITLE_FCMPTPH = 'FORMATO DE CONTROL DE MATERIA PRIMA, PRODUCCIÓN, pH Y TEMPERATURA'

function buildLoteBlocksHTML(batches, allCerts) {
  const certHeaders = allCerts.length > 0
    ? allCerts.map(c => `<th style="font-size:10px;white-space:nowrap">${escapeHtml(c.name)}</th>`).join('')
    : '<th>—</th>'

  return batches.map(b => {
    const certIds = new Set((b.production_batch_certs ?? []).map(pc => pc.batch_certs?.id).filter(Boolean))
    const plotText = b.plots ? escapeHtml(`${b.plots.name} (${b.plots.code})`) : '—'
    const producerName = b.producers ? escapeHtml(`${b.producers.first_name} ${b.producers.last_name}`) : '—'
    const condicion = b.producers?.is_member ? '✓ SOCIO' : '✓ NO SOCIO'
    const certCells = allCerts.length > 0
      ? allCerts.map(c => `<td style="text-align:center">${certIds.has(c.id) ? '✓' : ''}</td>`).join('')
      : '<td></td>'

    const phRows = (b.ph_controls ?? []).map((p, i) => `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td style="white-space:nowrap">${fmtDate(p.record_date?.split?.('T')?.[0] ?? p.record_date)}</td>
      <td>${p.regulator_type ?? '—'}</td>
      <td style="text-align:right">${p.regulator_quantity_value ?? '—'}</td>
      <td>${p.regulator_quantity_unit ?? '—'}</td>
      <td style="text-align:center">${fmtNum(p.ph_initial)}</td>
      <td style="text-align:center">${fmtNum(p.ph_final)}</td>
      <td style="text-align:center">${p.brix != null ? fmtNum(p.brix) + '°Bx' : '—'}</td>
      <td style="font-size:10px">${p.corrective_action ?? '—'}</td>
    </tr>`).join('')

    const tempRows = (b.temperatures ?? []).map(t => `<tr>
      <td style="text-align:center">${t.sequence_number}</td>
      <td style="text-align:center">${fmtNum(t.temperature)} °C</td>
    </tr>`).join('')

    return `<div class="lote-block">
      <div class="lote-separator">
        <strong>${b.batch_code ?? '—'}</strong> · ${producerName} · F. Proceso: ${fmtDate(b.process_date)}
      </div>

      <div class="section-label">Datos de producción</div>
      <table class="formato-table">
        <thead>
          <tr>
            <th rowspan="2">Productor</th>
            <th rowspan="2">Condición</th>
            <th rowspan="2">Parcela</th>
            <th rowspan="2">F. Corte</th>
            <th colspan="${allCerts.length || 1}" style="text-align:center">Calidad de la caña</th>
            <th rowspan="2">Caña (kg)</th>
            <th rowspan="2">F. Proceso</th>
            <th rowspan="2">Jugo (L)</th>
            <th rowspan="2">Panela (kg)</th>
            <th rowspan="2">Confitillo (kg)</th>
            <th rowspan="2">Rendim. %</th>
            <th rowspan="2">Observaciones</th>
          </tr>
          <tr>${certHeaders}</tr>
        </thead>
        <tbody>
          <tr>
            <td>${producerName}</td>
            <td style="white-space:nowrap;font-size:10px">${condicion}</td>
            <td style="font-size:10px">${plotText}</td>
            <td style="white-space:nowrap">${fmtDate(b.harvest_date)}</td>
            ${certCells}
            <td style="text-align:right">${fmtNum(b.cane_kg)}</td>
            <td style="white-space:nowrap">${fmtDate(b.process_date)}</td>
            <td style="text-align:right">${fmtNum(b.juice_liters)}</td>
            <td style="text-align:right">${fmtNum(b.panela_kg)}</td>
            <td style="text-align:right">${fmtNum(b.confitillo_kg)}</td>
            <td style="text-align:right">${fmtNum(b.efficiency_percentage)}</td>
            <td style="font-size:10px">${escapeHtml(b.observations) ?? ''}</td>
          </tr>
        </tbody>
      </table>

      <div style="display:flex;gap:24px;margin-top:5px;font-size:11px;padding:4px 6px;background:#f5f5f5;border:1px solid #ddd;border-top:none">
        <span><strong>Densidad caña:</strong> ${b.cane_density != null ? fmtNum(b.cane_density, 3) + ' kg/L' : '—'}</span>
        <span><strong>% Extracción:</strong> ${b.porcentaje_extraccion != null ? fmtNum(b.porcentaje_extraccion) + '%' : '—'}</span>
        <span><strong>% Cachaza:</strong> ${b.cachaza_percentage != null ? fmtNum(b.cachaza_percentage) + '%' : '—'}</span>
      </div>

      <div class="section-label">Control de pH</div>
      <table class="formato-table">
        <thead>
          <tr>
            <th>#</th><th>Fecha</th><th>Regulador</th><th>Cantidad</th><th>Unidad</th>
            <th>pH sin regular</th><th>pH regulado</th><th>Brix</th><th>Acción correctiva</th>
          </tr>
        </thead>
        <tbody>${phRows || '<tr><td colspan="9" style="text-align:center;color:#999">Sin registros</td></tr>'}</tbody>
      </table>

      <div class="section-label">Control de temperatura</div>
      <table class="formato-table" style="max-width:300px">
        <thead><tr><th>Batch #</th><th>Temperatura (°C)</th></tr></thead>
        <tbody>${tempRows || '<tr><td colspan="2" style="text-align:center;color:#999">Sin registros</td></tr>'}</tbody>
      </table>
    </div>`
  }).join('<hr style="border:none;border-top:2px dashed #ccc;margin:20px 0">')
}

// ── Versión por ORDEN (pestaña Campo de Documentos) ─────────────────────────
// Los lotes de campo que alimentaron la orden (ver campoOrden.js), con el
// mismo cuerpo que la versión por módulo/período de Reportes. Las columnas
// de certificación ("Calidad de la caña") son el catálogo completo de la
// cooperativa, igual que en Reportes.
export async function fetchFcmtphOrdenData(cooperative, order) {
  const ctx = await fetchFieldContextForOrder(cooperative, order)
  if (ctx.prodBatchIds.length === 0) return { certNames: ctx.certNames, batches: [], allCerts: [] }

  const [batchesRes, phRes, tempRes, certsRes] = await Promise.all([
    supabase.from('production_batches')
      .select(`id, batch_code, harvest_date, process_date, cane_kg, juice_liters, panela_kg, confitillo_kg,
        efficiency_percentage, porcentaje_extraccion, cane_density, cachaza_percentage, observations,
        producers ( first_name, last_name, is_member, appagrop_code, coop_modules ( name ) ),
        plots ( name, code ),
        production_batch_certs ( batch_certs ( id, name ) )`)
      .in('id', ctx.prodBatchIds)
      .eq('cooperative_id', cooperative.id)
      .order('process_date'),
    supabase.from('batch_ph_controls')
      .select('production_batch_id, record_date, regulator_type, regulator_quantity_value, regulator_quantity_unit, ph_initial, ph_final, brix, corrective_action')
      .in('production_batch_id', ctx.prodBatchIds)
      .order('record_date'),
    supabase.from('batch_temperatures')
      .select('production_batch_id, temperature, sequence_number')
      .in('production_batch_id', ctx.prodBatchIds)
      .order('sequence_number'),
    supabase.from('batch_certs').select('id, name').eq('cooperative_id', cooperative.id).order('name'),
  ])
  for (const r of [batchesRes, phRes, tempRes, certsRes]) if (r.error) throw new Error(r.error.message)

  const byBatch = rows => {
    const m = {}
    for (const r of rows ?? []) (m[r.production_batch_id] ??= []).push(r)
    return m
  }
  const phByBatch = byBatch(phRes.data)
  const tempByBatch = byBatch(tempRes.data)
  const batches = (batchesRes.data ?? []).map(b => ({
    ...b,
    ph_controls: phByBatch[b.id] ?? [],
    temperatures: tempByBatch[b.id] ?? [],
  }))
  return { certNames: ctx.certNames, batches, allCerts: certsRes.data ?? [] }
}

export function fcmtphOrdenPdf(cooperative, order, containerNumber, { certNames, batches, allCerts }, firmantes) {
  return buildCampoDocHTML(cooperative, order, containerNumber, {
    key: 'fcmptph',
    title: FORMAT_TITLE_FCMPTPH,
    certNames,
    firmantes,
    body: batches.length > 0
      ? buildLoteBlocksHTML(batches, allCerts)
      : campoSinRegistrosHTML('La orden no tiene lotes de campo asignados.'),
  })
}

export function fcmtphOrdenExcel(cooperative, order, containerNumber, { certNames, batches, allCerts }) {
  const header = campoExcelHeader(order, certNames, FORMAT_TITLE_FCMPTPH)
  const produccion = [...header, [
    'Lote de campo', 'Productor', 'Condición', 'Módulo', 'Parcela', 'F. Corte', ...allCerts.map(c => c.name),
    'Caña (kg)', 'F. Proceso', 'Jugo (L)', 'Panela (kg)', 'Confitillo (kg)', 'Rendim. %',
    'Densidad caña (kg/L)', '% Extracción', '% Cachaza', 'Observaciones',
  ]]
  const ph = [...header, ['Lote de campo', '#', 'Fecha', 'Regulador', 'Cantidad', 'Unidad', 'pH sin regular', 'pH regulado', 'Brix', 'Acción correctiva']]
  const temp = [...header, ['Lote de campo', 'Batch #', 'Temperatura (°C)']]
  for (const b of batches) {
    const certIds = new Set((b.production_batch_certs ?? []).map(pc => pc.batch_certs?.id).filter(Boolean))
    produccion.push([
      b.batch_code ?? '', producerName(b.producers), b.producers?.is_member ? 'Socio' : 'No socio',
      b.producers?.coop_modules?.name ?? '', b.plots ? `${b.plots.name} (${b.plots.code})` : '', b.harvest_date ?? '',
      ...allCerts.map(c => certIds.has(c.id) ? '✓' : ''),
      b.cane_kg ?? '', b.process_date ?? '', b.juice_liters ?? '', b.panela_kg ?? '', b.confitillo_kg ?? '', b.efficiency_percentage ?? '',
      b.cane_density ?? '', b.porcentaje_extraccion ?? '', b.cachaza_percentage ?? '', b.observations ?? '',
    ])
    b.ph_controls.forEach((p, i) => ph.push([
      b.batch_code ?? '', i + 1, p.record_date?.slice(0, 10) ?? '', p.regulator_type ?? '', p.regulator_quantity_value ?? '',
      p.regulator_quantity_unit ?? '', p.ph_initial ?? '', p.ph_final ?? '', p.brix ?? '', p.corrective_action ?? '',
    ]))
    b.temperatures.forEach(t => temp.push([b.batch_code ?? '', t.sequence_number, t.temperature]))
  }
  writeCampoExcel('fcmptph', order, containerNumber, [['Producción', produccion], ['Control de pH', ph], ['Control de temperatura', temp]])
}
