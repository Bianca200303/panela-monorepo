import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { PRINT_STYLES, metaRow, transportRow, yesNo, resolveContainerContext, escapeHtml } from './shared'
import { loteLabel } from '../loteHelpers'
import { getLoteLabel } from '../labels'
import { fetchTramos, tramosPorLote, summarizeTramos } from './tramos'

// CAES (venta nacional/exportación): el Packing List de exportación lleva
// además los datos del embarque y las guías de remisión por lote. Todo se
// toma de lo ya registrado -- contenedor (paso 1), carga (paso 2), tramos
// (Control de Unidad de Transporte, único lugar de las guías) y despacho --
// sin pedir nada de nuevo.
function embarqueCaes(cooperative, container, orders, carga, extras) {
  if (!cooperative?.features?.ventaNacionalExportacion) return null
  const ex = container?.extra_data ?? {}
  const porLote = tramosPorLote(extras?.tramos ?? [])
  const batches = orders.flatMap(o => o.plant_production_batches ?? [])
  const join = (a) => [...new Set(a.filter(Boolean))].join(', ')
  return {
    // Placa: dato del camión, se escribe solo en el tramo (puede haber varios camiones).
    placas: summarizeTramos(extras?.tramos ?? []).placas.join(', ') || null,
    meta: [
      ['Exportado por', cooperative?.name],
      ['Destino', join(orders.map(o => o.market))],
      ['Factura', ex.factura_comercial],
      ['Precinto de aduana', ex.precinto_aduana],
      ['Puerto de salida', ex.puerto_salida],
      ['Booking', container?.booking_number],
      ['Naviera', container?.shipping_line],
      ['Nombre de la nave', ex.vessel],
      ['Fecha de ingreso al almacén portuario', extras?.dispatch?.extra_data?.fecha_ingreso_almacen_portuario],
      ['Fecha de carga', carga?.fecha_carga],
    ],
    guias: batches.map(b => {
      const ts = porLote[b.id] ?? []
      return {
        lote: loteLabel(b),
        grCaes: join(ts.map(t => t.guia_remision)) || null,
        grTransp: join(ts.map(t => t.guia_remision_transportista)) || null,
        sinTramo: ts.length === 0,
      }
    }),
  }
}
const fmtIso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v).split('-').reverse().join('/') : v)

export const FORMAT_TITLE_PACKING_LIST = 'PACKING LIST'

// Formato físico COA-GCA-RG-001: detalle pallet por pallet de la carga de un
// contenedor, más inspección del vehículo/contenedor, verificación del
// producto y personas presentes en el embarque. Se arma a partir del
// registro de "Registrar carga" (plant_container_loadings +
// plant_container_loading_pallets + plant_container_loading_people) -- un
// paso distinto de "Registrar despacho" (Orden de Salida). No hace falta
// cruzar nada más, solo traer sus pallets y personas.
export async function fetchPackingListData(container) {
  const { data: carga } = await supabase
    .from('plant_container_loadings')
    .select('*')
    .eq('container_id', container.id)
    .maybeSingle()
  if (!carga) return { carga: null, pallets: [], people: [] }

  const [{ data: pallets }, { data: people }] = await Promise.all([
    supabase
      .from('plant_container_loading_pallets')
      .select('*, plant_production_batches ( client_batch_number, batch_code, brand )')
      .eq('loading_id', carga.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('plant_container_loading_people')
      .select('*')
      .eq('loading_id', carga.id)
      .order('created_at', { ascending: true }),
  ])

  return { carga, pallets: pallets ?? [], people: people ?? [] }
}

export function buildPrintHTMLPackingList(cooperative, container, orders, carga, pallets, people, extras = {}) {
  const caes = embarqueCaes(cooperative, container, orders, carga, extras)
  const LOTE_LABEL = getLoteLabel(cooperative, orders[0])
  const coopName = cooperative?.name ?? ''
  const clientNames = [...new Set(orders.map(o => o.plant_clients?.name).filter(Boolean))].join(', ')
  const opNumbers = [...new Set(orders.map(o => o.client_order_number ?? o.order_code).filter(Boolean))].join(', ')
  const saleNumbers = [...new Set(orders.map(o => o.sale_number).filter(Boolean))].join(', ')
  const weightKg = (carga?.tara_kg != null && carga?.payload_kg != null) ? (Number(carga.tara_kg) + Number(carga.payload_kg)) : null

  // Lado real elegido al cargar cada pallet (ver ContainerLoadingModal.jsx)
  // -- ya no se parte la lista a la mitad. Pallets sin lado (cargados antes
  // de que existiera este campo) se reparten alternados para no perderlos
  // del documento, en vez de quedar afuera.
  const leftPallets = pallets.filter(p => p.lado === 'izquierda')
  const rightPallets = pallets.filter(p => p.lado === 'derecha')
  pallets.filter(p => p.lado !== 'izquierda' && p.lado !== 'derecha')
    .forEach((p, i) => (i % 2 === 0 ? leftPallets : rightPallets).push(p))
  const palletRowsHTML = (list) => list.map((p, i) => `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td style="text-align:center">${p.pallet_number}</td>
      <td style="text-align:center">${p.boxes_count ?? ''}</td>
      <td style="text-align:center">${p.plant_production_batches ? (p.plant_production_batches.client_batch_number || p.plant_production_batches.batch_code) : ''}</td>
      <td>${p.plant_production_batches?.brand ?? ''}</td>
      <td style="text-align:center">${p.humidity_pct ?? ''}</td>
    </tr>`).join('')
  const palletTable = (list, title) => `<p style="font-size:10px;font-weight:700;margin:0 0 3px">${title}</p><table class="formato-table" style="width:100%">
    <thead><tr><th>N°</th><th>N° pallet</th><th>N° cajas</th><th>${LOTE_LABEL}</th><th style="text-align:left">Producto</th><th>% H-P</th></tr></thead>
    <tbody>${palletRowsHTML(list)}</tbody>
  </table>`

  const peopleRows = people.map((p, i) => `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${escapeHtml(p.full_name)}</td>
      <td style="text-align:center">${escapeHtml(p.dni) ?? ''}</td>
      <td></td>
      <td style="text-align:center">${escapeHtml(p.role_label) ?? ''}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Packing_List_${(carga?.documento_number ?? container?.container_number ?? 'SN').replace(/[\\/:*?"<>|]/g, '-')}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
    .formato-table th { font-size: 8px; }
    .formato-table td { font-size: 9px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${coopName}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_PACKING_LIST}</div>
    </div>
    <div class="formato-meta">
      ${metaRow('N° de documento', carga?.documento_number)}
      ${metaRow('N° Contenedor', container?.container_number)}
      ${metaRow(caes ? 'Importado por' : 'Comprador / Importador', clientNames)}
      ${caes ? caes.meta.map(([l, v]) => metaRow(l, fmtIso(v))).join('') : metaRow('Destino / Puerto', container?.destination_port)}
      ${metaRow('OP', opNumbers)}
      ${metaRow('N° venta', saleNumbers)}
    </div>
    <table class="formato-table" style="width:100%;margin-top:6px">
      <tbody>
        ${transportRow(['Tara (kg)', carga?.tara_kg], ['Payload (kg)', carga?.payload_kg], ['Weight (kg)', weightKg])}
        ${caes
          ? transportRow(['Placa (camión / carreta)', caes.placas])
          : transportRow(['Placa de camión', carga?.placa_camion], ['Placa de carreta', carga?.placa_carreta])}
        ${transportRow(['Precinto Inicial', carga?.precinto_inicial], ['Precinto de Línea', carga?.precinto_linea], ['Hora Inicio', carga?.hora_inicio])}
        ${transportRow(['Precinto Final', container?.seal_number], [cooperative?.features?.precintoPropioLabel ?? 'Precinto propio', carga?.precinto_norandino], ['Hora Fin', carga?.hora_fin])}
      </tbody>
    </table>
  </div>

  ${caes ? `
  <p style="font-size:11px;font-weight:700;margin:10px 0 4px">Guías de remisión por ${LOTE_LABEL.toLowerCase()}</p>
  <table class="formato-table" style="width:100%">
    <thead><tr><th>${LOTE_LABEL}</th><th>GR CAES</th><th>GR transportista</th></tr></thead>
    <tbody>${caes.guias.map(g => `<tr>
      <td style="text-align:center">${escapeHtml(g.lote) ?? '—'}</td>
      <td style="text-align:center">${g.sinTramo ? 'Sin guía asignada' : (escapeHtml(g.grCaes) ?? '—')}</td>
      <td style="text-align:center">${g.sinTramo ? 'Sin guía asignada' : (escapeHtml(g.grTransp) ?? 'Pendiente')}</td>
    </tr>`).join('') || '<tr><td colspan="3" style="text-align:center">Sin lotes</td></tr>'}</tbody>
  </table>` : ''}

  ${cooperative?.features?.pallets ? `
  <p style="font-size:11px;font-weight:700;margin:10px 0 4px">Packing List</p>
  <div style="display:flex;gap:10px">
    <div style="flex:1">${palletTable(leftPallets, 'Izquierda')}</div>
    <div style="flex:1">${palletTable(rightPallets, 'Derecha')}</div>
  </div>` : ''}

  <div style="display:flex;gap:10px;margin-top:10px">
    <div style="flex:1">
      <p style="font-size:10px;font-weight:700;margin:0 0 4px">Control y verificación del vehículo contenedor</p>
      <table class="formato-table" style="width:100%">
        <tbody>
          ${transportRow(['Limpio', yesNo(carga?.limpio)], ['Contenedor forrado', yesNo(carga?.contenedor_forrado)])}
          ${transportRow(['Abolladuras internas', `${yesNo(carga?.abolladuras_internas)}${carga?.abolladuras_internas_cant != null ? ` (${carga.abolladuras_internas_cant})` : ''}`], ['Correcto forrado', yesNo(carga?.correcto_forrado)])}
          ${transportRow(['Abolladuras externas', `${yesNo(carga?.abolladuras_externas)}${carga?.abolladuras_externas_cant != null ? ` (${carga.abolladuras_externas_cant})` : ''}`], ['Libre de olores extraños', yesNo(carga?.libre_olores)])}
          ${transportRow(['Libre de evidencia de plagas', yesNo(carga?.libre_plagas)], ['', ''])}
        </tbody>
      </table>
      <p style="font-size:9px;margin:4px 0 0">Parte Interna: ${escapeHtml(carga?.observaciones_parte_interna) ?? '—'}</p>
      <p style="font-size:9px;margin:2px 0 0">Parte Externa: ${escapeHtml(carga?.observaciones_parte_externa) ?? '—'}</p>
    </div>
    <div style="flex:1">
      <p style="font-size:10px;font-weight:700;margin:0 0 4px">Control y verificación del producto</p>
      <table class="formato-table" style="width:100%">
        <tbody>
          ${transportRow(['Envases limpios', yesNo(carga?.envases_limpios)], ['Correcto etiquetado y/o rotulado', yesNo(carga?.etiquetado_correcto)])}
          ${transportRow(['Peso correcto', yesNo(carga?.peso_correcto)], ['Cierre / sellado adecuado', yesNo(carga?.cierre_sellado_adecuado)])}
        </tbody>
      </table>
      <p style="font-size:9px;margin:4px 0 0"><strong>Acción Correctiva:</strong> ${carga?.accion_correctiva ?? '—'}</p>
    </div>
  </div>

  <p style="font-size:11px;font-weight:700;margin:10px 0 4px">Personas presentes en el embarque</p>
  <table class="formato-table" style="width:100%">
    <thead><tr><th>N°</th><th style="text-align:left">Nombres y Apellidos</th><th>DNI</th><th>Firma</th><th>Función</th></tr></thead>
    <tbody>${peopleRows}</tbody>
  </table>

  ${carga?.final_observations ? `<p style="font-size:11px;margin:10px 0 0"><span class="meta-label">Observaciones:</span> ${escapeHtml(carga.final_observations)}</p>` : ''}
</body>
</html>`
}

export function packingListPdf(cooperative, container, orders, carga, pallets, people, extras = {}) {
  return buildPrintHTMLPackingList(cooperative, container, orders, carga, pallets, people, extras)
}

export function packingListExcel(cooperative, container, orders, carga, pallets, people, extras = {}) {
  const caes = embarqueCaes(cooperative, container, orders, carga, extras)
  const LOTE_LABEL = getLoteLabel(cooperative, orders[0])
  const clientNames = [...new Set(orders.map(o => o.plant_clients?.name).filter(Boolean))].join(', ')
  const opNumbers = [...new Set(orders.map(o => o.client_order_number ?? o.order_code).filter(Boolean))].join(', ')
  const saleNumbers = [...new Set(orders.map(o => o.sale_number).filter(Boolean))].join(', ')
  const weightKg = (carga?.tara_kg != null && carga?.payload_kg != null) ? (Number(carga.tara_kg) + Number(carga.payload_kg)) : ''

  const aoa = [
    ['PACKING LIST'],
    ['N° de documento:', carga?.documento_number ?? ''],
    ['N° Contenedor:', container?.container_number ?? ''],
    [caes ? 'Importado por:' : 'Comprador / Importador:', clientNames],
    ...(caes ? caes.meta.map(([l, v]) => [`${l}:`, fmtIso(v) ?? '']) : [['Destino / Puerto:', container?.destination_port ?? '']]),
    ['OP:', opNumbers],
    ['N° venta:', saleNumbers],
    [],
    ['Tara (kg):', carga?.tara_kg ?? '', 'Payload (kg):', carga?.payload_kg ?? '', 'Weight (kg):', weightKg],
    caes ? ['Placa (camión / carreta):', caes.placas ?? ''] : ['Placa camión:', carga?.placa_camion ?? '', 'Placa carreta:', carga?.placa_carreta ?? ''],
    ['Precinto Inicial:', carga?.precinto_inicial ?? '', 'Precinto de Línea:', carga?.precinto_linea ?? '', 'Hora Inicio:', carga?.hora_inicio ?? ''],
    ['Precinto Final:', container?.seal_number ?? '', `${cooperative?.features?.precintoPropioLabel ?? 'Precinto propio'}:`, carga?.precinto_norandino ?? '', 'Hora Fin:', carga?.hora_fin ?? ''],
    [],
    ...(caes ? [
      [`Guías de remisión por ${LOTE_LABEL.toLowerCase()}`],
      [LOTE_LABEL, 'GR CAES', 'GR transportista'],
      ...caes.guias.map(g => [g.lote ?? '', g.sinTramo ? 'Sin guía asignada' : (g.grCaes ?? ''), g.sinTramo ? 'Sin guía asignada' : (g.grTransp ?? 'Pendiente')]),
      [],
    ] : []),
    ...(cooperative?.features?.pallets ? [
      ['N°', 'N° pallet', 'Lado', 'N° cajas', LOTE_LABEL, 'Producto', '% H-P'],
      ...pallets.map((p, i) => [i + 1, p.pallet_number, p.lado === 'izquierda' ? 'Izquierda' : p.lado === 'derecha' ? 'Derecha' : '', p.boxes_count ?? '', p.plant_production_batches ? loteLabel(p.plant_production_batches) : '', p.plant_production_batches?.brand ?? '', p.humidity_pct ?? '']),
      [],
    ] : []),
    ['Control y verificación del vehículo contenedor'],
    ['Limpio', carga?.limpio === true ? 'SI' : carga?.limpio === false ? 'NO' : '', 'Contenedor forrado', carga?.contenedor_forrado === true ? 'SI' : carga?.contenedor_forrado === false ? 'NO' : ''],
    ['Abolladuras internas', carga?.abolladuras_internas === true ? 'SI' : carga?.abolladuras_internas === false ? 'NO' : '', 'Correcto forrado', carga?.correcto_forrado === true ? 'SI' : carga?.correcto_forrado === false ? 'NO' : ''],
    ['Abolladuras externas', carga?.abolladuras_externas === true ? 'SI' : carga?.abolladuras_externas === false ? 'NO' : '', 'Libre de olores extraños', carga?.libre_olores === true ? 'SI' : carga?.libre_olores === false ? 'NO' : ''],
    ['Libre de evidencia de plagas', carga?.libre_plagas === true ? 'SI' : carga?.libre_plagas === false ? 'NO' : ''],
    ['Parte Interna:', carga?.observaciones_parte_interna ?? ''],
    ['Parte Externa:', carga?.observaciones_parte_externa ?? ''],
    [],
    ['Control y verificación del producto'],
    ['Envases limpios', carga?.envases_limpios === true ? 'SI' : carga?.envases_limpios === false ? 'NO' : '', 'Correcto etiquetado y/o rotulado', carga?.etiquetado_correcto === true ? 'SI' : carga?.etiquetado_correcto === false ? 'NO' : ''],
    ['Peso correcto', carga?.peso_correcto === true ? 'SI' : carga?.peso_correcto === false ? 'NO' : '', 'Cierre / sellado adecuado', carga?.cierre_sellado_adecuado === true ? 'SI' : carga?.cierre_sellado_adecuado === false ? 'NO' : ''],
    ['Acción Correctiva:', carga?.accion_correctiva ?? ''],
    [],
    ['Personas presentes en el embarque'],
    ['Nombres y Apellidos', 'DNI', 'Función'],
    ...people.map(p => [p.full_name, p.dni ?? '', p.role_label ?? '']),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Packing List')
  const fileId = (carga?.documento_number ?? container?.container_number ?? 'SN').replace(/[\\/:*?"<>|]/g, '-')
  XLSX.writeFile(wb, `Packing_List_${fileId}.xlsx`)
}

// Puente orden → contenedor para el modal "Documentos" de una orden:
// Packing List es un documento por CONTENEDOR, pero el modal solo tiene la
// orden -- se resuelve a partir de order.container_id para ofrecerlo
// también desde ahí.
export async function fetchPackingListQuickDoc(cooperative, order) {
  const { container, ordersInContainer } = await resolveContainerContext(cooperative, order)
  const { carga, pallets, people } = await fetchPackingListData(container)
  if (!carga) {
    throw new Error('Todavía no se registró la carga de este contenedor (Packing List, se registra en Embarque).')
  }
  // CAES: guías (de los tramos) y fecha de ingreso al almacén portuario (del despacho).
  const caes = !!cooperative?.features?.ventaNacionalExportacion
  const tramos = caes ? await fetchTramos(container.id) : []
  const { data: dispatch } = caes
    ? await supabase.from('plant_dispatches').select('extra_data').eq('container_id', container.id).maybeSingle()
    : { data: null }
  return { container, orders: ordersInContainer, carga, pallets, people, extras: { tramos, dispatch } }
}

export function packingListQuickDocPdf(cooperative, order, containerNumber, data) {
  return packingListPdf(cooperative, data.container, data.orders, data.carga, data.pallets, data.people, data.extras)
}

export function packingListQuickDocExcel(cooperative, order, containerNumber, data) {
  packingListExcel(cooperative, data.container, data.orders, data.carga, data.pallets, data.people, data.extras)
}
