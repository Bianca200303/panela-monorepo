import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { PRINT_STYLES, fmtNum, enrichRawMaterialEntries, quickDocFileName, escapeHtml } from './shared'
import { getLoteLabel } from '../labels'
import { loteBunques } from '../loteHelpers'

export const FORMAT_TITLE_REGISTRO_TRAZABILIDAD = 'REGISTRO DE TRAZABILIDAD'

// No es un "formato" oficial con código correlativo -- es un documento
// rápido de descargar por orden, un renglón por cada combinación (lote de
// campo, lote de envasado) que se usó en los bunques de esta orden -- si un
// mismo lote de campo alimentó dos lotes de envasado distintos, son DOS
// renglones (con su columna "Lote" propia), nunca se suman en uno solo -- se
// pierde de dónde salió cada kg. "Status Certificación" y "Asociación" son
// específicos de la cooperativa que trackea certificación (ver
// COOPERATIVE.features.certificacion) -- esas 2 columnas se ocultan solas
// si no aplica.

export function buildRegistroTrazabilidadRows(rawRows, kgPerQuintal) {
  return rawRows.map(r => ({
    ...r,
    kg_seca:   r.appearance === 'seca'   ? r.kg : 0,
    kg_suelta: r.appearance === 'suelta' ? r.kg : 0,
    kg_cerosa: r.appearance === 'cerosa' ? r.kg : 0,
    qq: kgPerQuintal > 0 ? r.kg / kgPerQuintal : 0,
  }))
}

// Exportado: también lo usa Resumen de Trazabilidad (mismo dato de materia
// prima de la orden, filtrado luego por lote).
export async function fetchRawMaterialInputsForOrder(orderId) {
  const { data: batches, error: batchesErr } = await supabase
    .from('plant_production_batches')
    .select('id, batch_code, client_batch_number')
    .eq('order_id', orderId)
  if (batchesErr) throw new Error(batchesErr.message)
  if ((batches ?? []).length === 0) return []

  const batchLabel = {}
  for (const b of batches) batchLabel[b.id] = b.client_batch_number || b.batch_code
  const batchIds = batches.map(b => b.id)

  // Desde la Fase 2 de la reingeniería de bunques un bunque se reparte a
  // lotes por la tabla de asignaciones (no por dueño único) -- se le
  // atribuye a cada lote la porción proporcional de insumos según su parte
  // de los kg tamizados totales del bunque (allocated_kg / bunque.tamizada_kg).
  const { data: allocations, error: allocErr } = await supabase
    .from('plant_bunque_batch_allocations')
    .select('plant_batch_id, kg, bunque:plant_batch_bunques ( tamizada_kg, plant_homogenization_inputs ( source_exit_item_id, quantity_kg ) )')
    .in('plant_batch_id', batchIds)
  if (allocErr) throw new Error(allocErr.message)

  // Agrupa por (fuente, lote de envasado) -- distinto lote = renglón
  // distinto, aunque la fuente (lote de campo) sea la misma.
  const rowsByKey = {}
  for (const alloc of allocations ?? []) {
    const bunque = alloc.bunque
    if (!bunque) continue
    const tam = Number(bunque.tamizada_kg ?? 0)
    const share = tam > 0 ? Number(alloc.kg) / tam : 0
    const label = batchLabel[alloc.plant_batch_id]
    for (const inp of bunque.plant_homogenization_inputs ?? []) {
      const key = `${inp.source_exit_item_id}::${alloc.plant_batch_id}`
      if (!rowsByKey[key]) {
        rowsByKey[key] = { exit_item_id: inp.source_exit_item_id, lote_envasado: label, kg: 0 }
      }
      rowsByKey[key].kg += Number(inp.quantity_kg) * share
    }
  }

  const enriched = await enrichRawMaterialEntries(Object.values(rowsByKey))
  return enriched.sort((a, b) => (a.producer_name ?? '').localeCompare(b.producer_name ?? '') || (a.lote_envasado ?? '').localeCompare(b.lote_envasado ?? ''))
}

// Referencia informativa (NO editable) de la materia prima que alimentó la
// producción de un conjunto de órdenes, agrupada por GUÍA DE REMISIÓN de
// ingreso (exit_registration) -- no por lote de envasado como
// fetchRawMaterialInputsForOrder de arriba -- porque el control de unidad de
// transporte que se llenó en el celular (stowage_transport_inspections) es
// 1 a 1 con esa guía, no con el lote. Usado por
// TransportUnitControlsCaesModal.jsx (CAES) para mostrarle a quien registra
// el tramo de SALIDA de producto terminado qué entró como materia prima,
// sin pretender que ambas guías coincidan (son viajes distintos, ver
// [[project_control_unidad_transporte_caes]]). Los exit_item_id (fuente de
// cada allocation) ya vienen resueltos en orders[].plant_production_batches
// -- por eso no hace falta volver a consultar plant_bunque_batch_allocations
// acá, a diferencia de fetchRawMaterialInputsForOrder.
export async function fetchMateriaPrimaTransporteReferencia(orders) {
  const exitItemIds = [...new Set(
    (orders ?? []).flatMap(o => (o.plant_production_batches ?? [])
      .flatMap(pb => loteBunques(pb).flatMap(b => (b.plant_homogenization_inputs ?? []).map(h => h.source_exit_item_id))))
      .filter(Boolean)
  )]
  if (exitItemIds.length === 0) return []

  const { data: exitItemsData, error: itemsErr } = await supabase
    .from('exit_items')
    .select(`
      id, quantity_kg,
      exit_registrations ( id, exit_code, exit_date, document_number ),
      production_batches ( batch_code, producers ( first_name, last_name ) )
    `)
    .in('id', exitItemIds)
  if (itemsErr) throw new Error(itemsErr.message)

  const exitRegIds = [...new Set((exitItemsData ?? []).map(ei => ei.exit_registrations?.id).filter(Boolean))]
  const { data: stowageData, error: stowageErr } = exitRegIds.length > 0
    ? await supabase
        .from('stowage_transport_inspections')
        .select(`
          id, exit_registration_id, inspection_date, carrier_name, carrier_ruc, carrier_license,
          vehicle_brand, vehicle_plate, vehicle_condition,
          has_spare_tire, has_valid_soat, has_technical_review, has_first_aid_kit, has_fire_extinguisher,
          has_gps, has_cleaning_supplies, floors_clean, walls_clean, ceilings_clean, no_strange_odors,
          tarp_clean, pallets_clean, sack_clean_condition, sack_tied_condition, observations,
          formato_codigo, emitted_at, firmantes
        `)
        .in('exit_registration_id', exitRegIds)
    : { data: [] }
  if (stowageErr) throw new Error(stowageErr.message)
  const stowageByReg = {}
  ;(stowageData ?? []).forEach(s => { stowageByReg[s.exit_registration_id] = s })

  // 1 tarjeta por guía de remisión (exit_registration), con la lista de
  // lotes/productores que llegaron en ese mismo viaje.
  const byReg = new Map()
  for (const ei of exitItemsData ?? []) {
    const er = ei.exit_registrations
    if (!er) continue
    if (!byReg.has(er.id)) {
      byReg.set(er.id, { exitReg: er, stowage: stowageByReg[er.id] ?? null, exitItems: [] })
    }
    byReg.get(er.id).exitItems.push(ei)
  }
  return [...byReg.values()].sort((a, b) => (a.exitReg.exit_date ?? '').localeCompare(b.exitReg.exit_date ?? ''))
}

// Exportado: también lo usa Registro de Homogenizado y Tamizado (mismo dato
// de certificaciones de la orden, distinto documento).
export async function fetchOrderCertNames(orderId) {
  const { data, error } = await supabase
    .from('plant_production_batches')
    .select('plant_batch_certs ( batch_certs ( name ) )')
    .eq('order_id', orderId)
  if (error) throw new Error(error.message)
  const names = new Set()
  for (const pb of data ?? []) {
    for (const pc of pb.plant_batch_certs ?? []) {
      if (pc.batch_certs?.name) names.add(pc.batch_certs.name)
    }
  }
  return [...names]
}

export async function fetchRegistroTrazabilidad(order, kgPerQuintal) {
  const [rawRows, certNames] = await Promise.all([
    fetchRawMaterialInputsForOrder(order.id),
    fetchOrderCertNames(order.id),
  ])
  return { rows: buildRegistroTrazabilidadRows(rawRows, kgPerQuintal), certNames }
}

export function buildPrintHTMLRegistroTrazabilidad(cooperative, order, containerNumber, rows, certNames, firmantes) {
  const LOTE_LABEL = getLoteLabel(cooperative, order)
  const clientName = order?.plant_clients?.name ?? '—'
  const certText = certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : '—'

  const bodyRows = rows.map(r => `
    <tr>
      <td style="text-align:center">${r.bags_count ?? '—'}</td>
      <td style="white-space:nowrap">${escapeHtml(r.dni) ?? '—'}</td>
      <td>${escapeHtml(r.producer_name) ?? '—'}</td>
      <td style="white-space:nowrap;font-size:9px">${escapeHtml(r.guia_remision) ?? '—'}</td>
      <td style="white-space:nowrap;font-size:9px">${escapeHtml(r.comprobante_acopio) ?? '—'}</td>
      <td style="white-space:nowrap">${escapeHtml(r.lote_envasado) ?? '—'}</td>
      <td style="text-align:center">${r.is_member ? 'Hábil' : 'Renuncia'}</td>
      ${cooperative?.features?.certificacion ? `<td style="text-align:center">${escapeHtml(r.cert_status) ?? '—'}</td>` : ''}
      <td>${escapeHtml(r.module_name) ?? '—'}</td>
      <td style="text-align:right">${fmtNum(r.kg_suelta)}</td>
      ${cooperative?.features?.certificacion ? `<td>${escapeHtml(r.module_name) ?? '—'}</td>` : ''}
      <td style="text-align:right;font-weight:700">${fmtNum(r.kg)}</td>
      <td style="text-align:right">${fmtNum(r.qq)}</td>
    </tr>`).join('')

  const totalSuelta = rows.reduce((s, r) => s + r.kg_suelta, 0)
  const totalKg     = rows.reduce((s, r) => s + r.kg, 0)
  const totalQq     = rows.reduce((s, r) => s + r.qq, 0)

  const firmasHTML = (() => {
    if (firmantes?.length > 0) {
      return firmantes.map(f => `
        <div class="firma-bloque">
          <div class="firma-linea"></div>
          <div class="firma-nombre">${f.nombre || '_______________________'}</div>
          <div class="firma-cargo">${f.cargo || 'Responsable'}</div>
        </div>`).join('')
    }
    return `<div class="firma-bloque"><div class="firma-linea"></div><div class="firma-nombre">_______________________</div><div class="firma-cargo">Responsable</div></div>`
  })()

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('registro_trazabilidad', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
    .formato-table th { font-size: 9px; }
    .formato-table td { font-size: 10px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${cooperative?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_REGISTRO_TRAZABILIDAD}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Contenedor N°:</span> ${order?.internal_container_number ?? '—'}</div>
      <div><span class="meta-label">Nº de venta:</span> ${order?.sale_number ?? '—'}</div>
      <div><span class="meta-label">Producto:</span> ${order?.product ?? '—'}</div>
      <div><span class="meta-label">Nº orden producción:</span> ${order?.client_order_number ?? order?.order_code ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
      <div><span class="meta-label">Certificación:</span> ${certText}</div>
    </div>
  </div>

  <table class="formato-table">
    <thead>
      <tr>
        <th>Nro Sacos</th>
        <th>Dni</th>
        <th style="text-align:left">Productor</th>
        <th>GuiaRecep</th>
        <th>Comprobante Acopio</th>
        <th>${LOTE_LABEL}</th>
        <th>Estatus de miembro</th>
        ${cooperative?.features?.certificacion ? '<th>Status Certificación</th>' : ''}
        <th>Módulo</th>
        <th>PanelaSuelta</th>
        ${cooperative?.features?.certificacion ? '<th>Asociación</th>' : ''}
        <th>Total Kg</th>
        <th>Total QQ</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="${cooperative?.features?.certificacion ? 8 : 7}" style="text-align:right">Totales:</td>
        <td></td>
        <td style="text-align:right">${fmtNum(totalSuelta)}</td>
        ${cooperative?.features?.certificacion ? '<td></td>' : ''}
        <td style="text-align:right">${fmtNum(totalKg)}</td>
        <td style="text-align:right">${fmtNum(totalQq)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="formato-firmas">${firmasHTML}</div>
</body>
</html>`
}

export function registroTrazabilidadPdf(cooperative, order, containerNumber, { rows, certNames }, firmantes) {
  return buildPrintHTMLRegistroTrazabilidad(cooperative, order, containerNumber, rows, certNames, firmantes)
}

export function registroTrazabilidadExcel(cooperative, order, containerNumber, { rows, certNames }) {
  const LOTE_LABEL = getLoteLabel(cooperative, order)
  const certText = certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : ''
  const header = [
    ['REGISTRO DE TRAZABILIDAD'],
    ['Contenedor N°:', order?.internal_container_number ?? ''],
    ['Nº de venta:', order?.sale_number ?? ''],
    ['Producto:', order?.product ?? ''],
    ['Nº orden producción:', order?.client_order_number ?? order?.order_code ?? ''],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    ['Certificación:', certText],
    [],
  ]
  const cols = ['Nro Sacos', 'Dni', 'Productor', 'GuiaRecep', 'Comprobante Acopio', LOTE_LABEL, 'Estatus de miembro']
  if (cooperative?.features?.certificacion) cols.push('Status Certificación')
  cols.push('Módulo', 'PanelaSuelta')
  if (cooperative?.features?.certificacion) cols.push('Asociación')
  cols.push('Total Kg', 'Total QQ')

  const dataRows = rows.map(r => {
    const row = [r.bags_count ?? '', r.dni ?? '', r.producer_name ?? '', r.guia_remision ?? '', r.comprobante_acopio ?? '', r.lote_envasado ?? '', r.is_member ? 'Hábil' : 'Renuncia']
    if (cooperative?.features?.certificacion) row.push(r.cert_status ?? '')
    row.push(r.module_name ?? '', r.kg_suelta)
    if (cooperative?.features?.certificacion) row.push(r.module_name ?? '')
    row.push(r.kg, r.qq)
    return row
  })

  // Calculado por posición real de la columna, no un número fijo -- así no
  // se desalinea si algún día se suma o saca una columna del prefijo.
  const prefixCols = cols.indexOf('PanelaSuelta')
  const totalRow = new Array(prefixCols).fill('')
  totalRow[0] = 'Totales:'
  totalRow.push(
    rows.reduce((s, r) => s + r.kg_suelta, 0),
  )
  if (cooperative?.features?.certificacion) totalRow.push('')
  totalRow.push(rows.reduce((s, r) => s + r.kg, 0), rows.reduce((s, r) => s + r.qq, 0))

  const ws = XLSX.utils.aoa_to_sheet([...header, cols, ...dataRows, totalRow])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Registro Trazabilidad')
  XLSX.writeFile(wb, `${quickDocFileName('registro_trazabilidad', order, containerNumber)}.xlsx`)
}
