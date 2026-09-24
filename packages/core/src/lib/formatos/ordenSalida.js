import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { loteKg, isOrderNacional } from '../loteHelpers'
import { PRINT_STYLES, metaRow, transportRow, resolveContainerContext, escapeHtml } from './shared'

export const FORMAT_TITLE_ORDEN_SALIDA = 'ORDEN DE SALIDA DE PRODUCTOS'

// Formato físico COA-OIM-RG-007: documento de logística, se genera al
// registrar el despacho de un CONTENEDOR (no de una orden ni de un lote --
// un contenedor puede llevar lotes de varias órdenes, cada uno es una fila
// de la tabla de productos). La mayoría de los datos de transporte
// (transportista, conductor, guías, precintos) se completan recién en el
// formulario de despacho -- porque no se conocen antes de ese momento.
export async function fetchOrdenSalidaRows(orders) {
  const batchesWithOrder = orders.flatMap(o => (o.plant_production_batches ?? []).map(b => ({ batch: b, order: o })))
  const batchIds = batchesWithOrder.map(({ batch }) => batch.id)

  const { data: certsData } = batchIds.length > 0
    ? await supabase.from('plant_batch_certs').select('plant_batch_id, batch_certs ( name )').in('plant_batch_id', batchIds)
    : { data: [] }
  const certsByBatch = {}
  ;(certsData ?? []).forEach(c => {
    if (c.batch_certs?.name) (certsByBatch[c.plant_batch_id] ??= []).push(c.batch_certs.name)
  })

  const allCerts = new Set()
  const rows = batchesWithOrder.map(({ batch, order }, idx) => {
    const kg = loteKg(batch)
    ;(certsByBatch[batch.id] ?? []).forEach(c => allCerts.add(c))
    const especificaciones = [
      batch.description || batch.plant_product_catalog?.description || batch.brand,
      batch.packaging_kg ? `X ${batch.packaging_kg} KG` : '',
      order.plant_clients?.name?.toUpperCase(),
      order.market ? `- ${order.market.toUpperCase()}` : '',
    ].filter(Boolean).join(' ')
    return {
      n: idx + 1,
      referencia: order.client_order_number ?? order.order_code,
      especificaciones,
      cantidadKg: kg,
      pallets: batch.pallet_count ?? 0,
      qq: kg / 50,
      tm: kg / 1000,
    }
  })

  const totals = rows.reduce((acc, r) => ({
    cantidadKg: acc.cantidadKg + r.cantidadKg,
    pallets: acc.pallets + r.pallets,
    qq: acc.qq + r.qq,
    tm: acc.tm + r.tm,
  }), { cantidadKg: 0, pallets: 0, qq: 0, tm: 0 })
  totals.certs = [...allCerts].join(' - ') || null

  return { rows, totals }
}

// esExportacion: se deriva de order.sale_type (isOrderNacional,
// loteHelpers.js) -- no hay selector de tipo en este documento, no hace
// falta preguntarlo porque el dato ya existe en la orden real. NUNCA de si
// el contenedor tiene o no booking cargado (ver [[project_despacho_nacional_caes]]
// -- ese campo puede simplemente no estar lleno todavía en una Exportación real).
function esOrdenExportacion(cooperative, orders) {
  return !isOrderNacional(cooperative, orders?.[0])
}

// packingListNacional: registro de plant_packing_list_nacional_caes del
// contenedor (o null si es Exportación / todavía no se inició) -- de ahí
// sale la guía de remisión para Nacional, ya no de
// plant_containers.extra_data (esos campos se eliminaron del formulario de
// contenedor, ver migración 20260916140000).
export function buildPrintHTMLOrdenSalida(cooperative, container, dispatch, orders, rows, totals, carga, packingListNacional) {
  const extra = dispatch?.extra_data ?? {}
  const coopName = cooperative?.name ?? ''
  const ruc = cooperative?.ruc
  const saleNumbers = [...new Set((orders ?? []).map(o => o.sale_number).filter(Boolean))]
  const esExportacion = esOrdenExportacion(cooperative, orders)
  const guiaRemision = packingListNacional?.guia_tramo_interno || packingListNacional?.guia_tramo_final || null

  const rowsHTML = rows.map(r => `<tr>
    <td style="text-align:center">${r.n}</td>
    <td style="text-align:center">${r.referencia ?? '—'}</td>
    <td>${r.especificaciones}</td>
    <td style="text-align:right">${r.cantidadKg.toFixed(2)}</td>
    <td style="text-align:center">KGs</td>
    <td style="text-align:center">${r.pallets ?? 0}</td>
    <td style="text-align:right">${r.qq.toFixed(2)}</td>
    <td style="text-align:right">${r.tm.toFixed(2)}</td>
    <td style="text-align:right">${r.cantidadKg.toFixed(2)}</td>
  </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Orden_Salida_Productos_${(dispatch?.dispatch_code ?? container?.container_number ?? 'SN').replace(/[\\/:*?"<>|]/g, '-')}</title>
  <style>
    ${PRINT_STYLES}
    .formato-table th { font-size: 9px; }
    .formato-table td { font-size: 10px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${coopName}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_ORDEN_SALIDA}</div>
    </div>
    <div class="formato-meta">
      ${metaRow('RUC', ruc)}
      ${metaRow('N° de documento', extra.documento_number)}
      ${metaRow('Fecha', dispatch?.dispatch_date ? new Date(`${dispatch.dispatch_date}T00:00:00`).toLocaleDateString('es-PE') : '—')}
      ${metaRow('Vendedor / Exportador', coopName)}
      ${metaRow('Guía Remisión Cliente', extra.guia_remision_cliente)}
      ${metaRow('Autorizado por', extra.autorizado_por)}
      ${metaRow('Destino / Puerto', container?.destination_port)}
    </div>
  </div>

  ${dispatch?.temperature_at_load != null || dispatch?.humidity_at_load != null ? `<p style="font-size:9px;margin:4px 0 0;color:#555">
    Informativo -- ${dispatch?.temperature_at_load != null ? `Temperatura al cargar: ${dispatch.temperature_at_load}°C` : ''}${dispatch?.temperature_at_load != null && dispatch?.humidity_at_load != null ? ' · ' : ''}${dispatch?.humidity_at_load != null ? `Humedad relativa al cargar: ${dispatch.humidity_at_load}%` : ''}
  </p>` : ''}

  <div class="formato-header" style="padding:0">
    <div style="font-size:11px;font-weight:700;padding:5px 8px;text-transform:uppercase;border-bottom:1px solid #333">Control y verificación de transporte</div>
    <table class="formato-table" style="width:100%;margin-top:0;border-top:none">
      <tbody>
        ${transportRow(['Empresa de transporte', extra.empresa_transporte], ['G.R transportista', extra.guia_remision_transportista], ['Nombre de conductor', extra.nombre_conductor])}
        ${esExportacion
          ? transportRow(['N° Contenedor', container?.container_number], ['N° Booking', container?.booking_number], ['Certificación del producto', totals.certs])
          : transportRow(['Guía de Remisión', guiaRemision], ['Certificación del producto', totals.certs])}
        ${transportRow([cooperative?.features?.precintoPropioLabel ?? 'Precinto propio', carga?.precinto_norandino], ['Precinto de Aduana', container?.seal_number], ['Otro precinto', extra.otro_precinto])}
      </tbody>
    </table>
  </div>

  <p style="font-size:11px;font-weight:700;margin:10px 0 4px">Se entrega los siguientes productos:</p>
  <table class="formato-table" style="width:100%">
    <thead><tr>
      <th>N°</th><th>Referencia<br/>(N° Venta, OP)</th><th style="text-align:left">Especificaciones del producto</th>
      <th>Cantidad</th><th>Unidad de<br/>medida</th><th>Pallets</th><th>QQ</th><th>TM</th><th>Total Kg Neto</th>
    </tr></thead>
    <tbody>${rowsHTML}</tbody>
    <tfoot><tr>
      <td colspan="3" style="text-align:right">TOTAL:</td>
      <td style="text-align:right">${totals.cantidadKg.toFixed(2)}</td>
      <td></td>
      <td style="text-align:right">${totals.pallets}</td>
      <td style="text-align:right">${totals.qq.toFixed(2)}</td>
      <td style="text-align:right">${totals.tm.toFixed(2)}</td>
      <td style="text-align:right">${totals.cantidadKg.toFixed(2)}</td>
    </tr></tfoot>
  </table>
  <p style="font-size:9px;margin:4px 0 0;color:#555">
    Documento interno, no tiene valor como Guía de remisión. Leyenda: QQ: quintales (1 QQ panela = 50Kg), TM: toneladas métricas.
  </p>

  ${dispatch?.notes || saleNumbers.length > 0 ? `<p style="font-size:11px;margin:10px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(dispatch?.notes) ?? ''}${saleNumbers.length > 0 ? `${dispatch?.notes ? ' · ' : ''}Venta: ${saleNumbers.join(', ')}` : ''}</p>` : ''}

  <div class="formato-firmas" style="margin-top:50px">
    <div class="firma-bloque">
      <div class="firma-linea"></div>
      <div class="firma-nombre">SELLO Y FIRMA RESPONSABLE DE DESPACHO</div>
    </div>
    <div class="firma-bloque">
      <div class="firma-linea"></div>
      <div class="firma-nombre">V.B° JEFE DE PLANTA</div>
    </div>
  </div>
</body>
</html>`
}

export function ordenSalidaPdf(cooperative, container, dispatch, orders, rows, totals, carga, packingListNacional) {
  return buildPrintHTMLOrdenSalida(cooperative, container, dispatch, orders, rows, totals, carga, packingListNacional)
}

export function ordenSalidaExcel(cooperative, container, dispatch, orders, rows, totals, carga, packingListNacional) {
  const extra = dispatch?.extra_data ?? {}
  const esExportacion = esOrdenExportacion(cooperative, orders)
  const guiaRemision = packingListNacional?.guia_tramo_interno || packingListNacional?.guia_tramo_final || ''
  const aoa = [
    ['ORDEN DE SALIDA DE PRODUCTOS'],
    ['RUC:', cooperative?.ruc ?? ''],
    ['N° de documento:', extra.documento_number ?? ''],
    ['Fecha:', dispatch?.dispatch_date ?? ''],
    ['Guía Remisión Cliente:', extra.guia_remision_cliente ?? ''],
    ['Autorizado por:', extra.autorizado_por ?? ''],
    ['Destino / Puerto:', container?.destination_port ?? ''],
    ['Temperatura al cargar (°C) [informativo]:', dispatch?.temperature_at_load ?? ''],
    ['Humedad relativa al cargar (%) [informativo]:', dispatch?.humidity_at_load ?? ''],
    [],
    ['Empresa de transporte:', extra.empresa_transporte ?? ''],
    ['G.R. transportista:', extra.guia_remision_transportista ?? ''],
    ['Nombre de conductor:', extra.nombre_conductor ?? ''],
    ...(esExportacion ? [
      ['N° Contenedor:', container?.container_number ?? ''],
      ['N° Booking:', container?.booking_number ?? ''],
    ] : [
      ['Guía de Remisión:', guiaRemision],
    ]),
    ['Certificación:', totals.certs ?? ''],
    [`${cooperative?.features?.precintoPropioLabel ?? 'Precinto propio'}:`, carga?.precinto_norandino ?? ''],
    ['Precinto de Aduana:', container?.seal_number ?? ''],
    ['Otro precinto:', extra.otro_precinto ?? ''],
    [],
    ['N°', 'Referencia (N° Venta, OP)', 'Especificaciones del producto', 'Cantidad', 'Unidad', 'Pallets', 'QQ', 'TM', 'Total Kg Neto'],
    ...rows.map(r => [r.n, r.referencia, r.especificaciones, r.cantidadKg, 'KGs', r.pallets, r.qq, r.tm, r.cantidadKg]),
    ['', '', 'TOTAL', totals.cantidadKg, '', totals.pallets, totals.qq, totals.tm, totals.cantidadKg],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Orden Salida')
  const fileId = (dispatch?.dispatch_code ?? container?.container_number ?? 'SN').replace(/[\\/:*?"<>|]/g, '-')
  XLSX.writeFile(wb, `Orden_Salida_Productos_${fileId}.xlsx`)
}

// Puente orden → contenedor para el modal "Documentos" de una orden: Orden
// de Salida es un documento por CONTENEDOR, pero el modal solo tiene la
// orden -- se resuelve a partir de order.container_id para ofrecerlo
// también desde ahí, sin duplicar la mecánica del modal por contenedor.
export async function fetchOrdenSalidaQuickDoc(cooperative, order) {
  const { container, ordersInContainer } = await resolveContainerContext(cooperative, order)
  const { data: dispatch } = await supabase
    .from('plant_dispatches')
    .select('*')
    .eq('container_id', container.id)
    .maybeSingle()
  if (!dispatch) {
    throw new Error('Todavía no se registró el despacho de este contenedor (se registra en Embarque).')
  }
  const { data: carga } = await supabase
    .from('plant_container_loadings')
    .select('*')
    .eq('container_id', container.id)
    .maybeSingle()
  // Solo aplica a Nacional (ver isOrderNacional) -- para Exportación esta
  // tabla nunca tiene fila para este contenedor, queda null sin pedirlo.
  const { data: packingListNacional } = isOrderNacional(cooperative, ordersInContainer[0])
    ? await supabase.from('plant_packing_list_nacional_caes').select('*').eq('container_id', container.id).maybeSingle()
    : { data: null }
  const { rows, totals } = await fetchOrdenSalidaRows(ordersInContainer)
  return { container, dispatch, orders: ordersInContainer, rows, totals, carga, packingListNacional }
}

export function ordenSalidaQuickDocPdf(cooperative, order, containerNumber, data) {
  return ordenSalidaPdf(cooperative, data.container, data.dispatch, data.orders, data.rows, data.totals, data.carga, data.packingListNacional)
}

export function ordenSalidaQuickDocExcel(cooperative, order, containerNumber, data) {
  ordenSalidaExcel(cooperative, data.container, data.dispatch, data.orders, data.rows, data.totals, data.carga, data.packingListNacional)
}
