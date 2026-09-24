import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { loteLabel, loteKg, PACKAGING_TYPE_LABELS } from '@panela/core/lib/loteHelpers'
import { PRINT_STYLES, metaRow, fmtDate, fmtNum, resolveContainerContext, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_PACKING_LIST_NACIONAL_CAES = 'PACKING LIST-NACIONAL'

// Formato físico CAESP-PP-BPM-RE-CPR-006 (el código real del papel dice
// CPR-006, no CPR-008 como se asumió en una sesión anterior) -- SOLO CAES,
// ver COOPERATIVE.features.ventaNacionalExportacion en config.js. A
// diferencia del "Packing List" de exportación (packingList.js: pallets,
// inspección de vehículo/contenedor, personas presentes -- viene de
// "Registrar carga", plant_container_loadings), el de venta nacional es
// mucho más simple: Factura + Guías de Remisión + una fila por lote, sin
// pallets ni contenedor real. Encontrado leyendo "ejercicio de trazabilidad
// nacional completo.pdf" (raíz del repo) -- ver
// [[project_despacho_nacional_caes]].
//
// packingListNumero/guías ya NO viven en plant_containers.extra_data --
// se movieron a plant_packing_list_nacional_caes (registro propio,
// bloqueable, 1 por contenedor -- ver PackingListNacionalCaesModal.jsx y
// migración 20260916120000), mismo patrón que el Packing List real de
// exportación (plant_container_loadings). factura_comercial y
// certificado_transaccion SÍ siguen en extra_data -- son datos de la
// venta, no del Packing List en sí, y aplican también a Exportación.
export async function fetchPackingListNacionalCaesData(container, orders) {
  const { data: packingList } = await supabase
    .from('plant_packing_list_nacional_caes')
    .select('packing_list_numero, guia_tramo_interno, guia_tramo_final')
    .eq('container_id', container.id)
    .maybeSingle()

  const orderIds = (orders ?? []).map(o => o.id)
  const { data: batches } = orderIds.length > 0
    ? await supabase
        .from('plant_production_batches')
        .select('id, order_id, client_batch_number, batch_code, packaging_type, packaging_count, packaging_kg, envasado_registered_at, best_before_date')
        .in('order_id', orderIds)
        .order('envasado_registered_at')
    : { data: [] }

  const rows = (batches ?? []).map((b, idx) => ({
    n: idx + 1,
    // envasado_registered_at es timestamptz -- fmtDate espera "YYYY-MM-DD",
    // pasarle el timestamp completo da "Invalid Date" (mismo motivo que
    // resumenTrazabilidad.js recorta calidad_registered_at/envasado_registered_at).
    fechaProduccion: b.envasado_registered_at?.slice(0, 10) ?? null,
    lote: loteLabel(b),
    kg: loteKg(b),
    unidades: b.packaging_count,
    tipoUnidad: PACKAGING_TYPE_LABELS[b.packaging_type] ?? b.packaging_type ?? '—',
  }))
  const totalKg = rows.reduce((s, r) => s + r.kg, 0)
  const totalUnidades = rows.reduce((s, r) => s + Number(r.unidades ?? 0), 0)

  const clientName = (orders ?? [])[0]?.plant_clients?.name ?? null
  // Fecha de vencimiento: una sola fecha en el encabezado del papel real,
  // aunque haya varios lotes -- se toma la del primero (lo normal es 1 lote
  // por contenedor nacional, a diferencia de exportación).
  const fechaVencimiento = (batches ?? [])[0]?.best_before_date ?? null

  return {
    container,
    packingListNumero: packingList?.packing_list_numero ?? null,
    facturaComercial: container?.extra_data?.factura_comercial ?? null,
    // Header = tramo final (a destino); fila de tabla = tramo interno
    // (Montero -> ciudad) -- coincide con cómo el papel real separa ambas
    // guías.
    guiaTramoFinal: packingList?.guia_tramo_final ?? null,
    guiaTramoInterno: packingList?.guia_tramo_interno ?? null,
    clientName,
    fechaVencimiento,
    rows,
    totalKg,
    totalUnidades,
  }
}

export function buildPrintHTMLPackingListNacionalCaes(data) {
  const { container, packingListNumero, facturaComercial, guiaTramoFinal, guiaTramoInterno, clientName, fechaVencimiento, rows, totalKg, totalUnidades } = data
  const coopName = COOPERATIVE?.name ?? ''

  const rowsHTML = rows.map(r => `<tr>
      <td style="text-align:center">${r.n}</td>
      <td style="text-align:center">${r.fechaProduccion ? fmtDate(r.fechaProduccion) : '—'}</td>
      <td style="text-align:center">${escapeHtml(r.lote) ?? '—'}</td>
      <td style="text-align:right">${fmtNum(r.kg)}</td>
      <td style="text-align:center">${r.unidades ?? ''}</td>
      <td>${escapeHtml(r.tipoUnidad)}</td>
      <td style="text-align:center">${escapeHtml(guiaTramoInterno) ?? '—'}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Packing_List_Nacional_${(packingListNumero ?? container?.container_number ?? 'SN').replace(/[\\/:*?"<>|]/g, '-')}</title>
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
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_PACKING_LIST_NACIONAL_CAES}</div>
    </div>
    <div class="formato-meta">
      ${metaRow('N° de documento', packingListNumero)}
      ${metaRow('Factura de Venta', facturaComercial)}
      ${metaRow('Cliente', clientName)}
      ${metaRow('Guía de Remisión (a destino)', guiaTramoFinal)}
      ${metaRow('Fecha de Vencimiento', fechaVencimiento ? fmtDate(fechaVencimiento) : null)}
    </div>
  </div>

  <table class="formato-table" style="width:100%">
    <thead><tr>
      <th>N°</th><th>Fecha de<br/>Producción</th><th>N° Lote</th><th>Cantidad (kg)</th>
      <th>Unidades</th><th style="text-align:left">Tipo de Unidad</th><th>Guía de Remisión<br/>(Montero → destino)</th>
    </tr></thead>
    <tbody>${rowsHTML || '<tr><td colspan="7" style="text-align:center">Sin lotes en este contenedor</td></tr>'}</tbody>
    <tfoot><tr>
      <td colspan="3" style="text-align:right">TOTAL:</td>
      <td style="text-align:right">${fmtNum(totalKg)}</td>
      <td style="text-align:center">${totalUnidades}</td>
      <td colspan="2"></td>
    </tr></tfoot>
  </table>
  <p style="font-size:9px;margin:4px 0 0;color:#555">Total Peso Neto (kg): ${fmtNum(totalKg)}</p>

  <div class="formato-firmas" style="margin-top:50px">
    <div class="firma-bloque">
      <div class="firma-linea"></div>
      <div class="firma-nombre">RESPONSABLE</div>
      <div class="firma-cargo">Apellidos y Nombres / Fecha</div>
    </div>
  </div>
</body>
</html>`
}

export function packingListNacionalCaesPdf(data) {
  return buildPrintHTMLPackingListNacionalCaes(data)
}

export function packingListNacionalCaesExcel(data) {
  const { container, packingListNumero, facturaComercial, guiaTramoFinal, guiaTramoInterno, clientName, fechaVencimiento, rows, totalKg, totalUnidades } = data
  const aoa = [
    [FORMAT_TITLE_PACKING_LIST_NACIONAL_CAES],
    ['N° de documento:', packingListNumero ?? ''],
    ['Factura de Venta:', facturaComercial ?? ''],
    ['Cliente:', clientName ?? ''],
    ['Guía de Remisión (a destino):', guiaTramoFinal ?? ''],
    ['Fecha de Vencimiento:', fechaVencimiento ?? ''],
    [],
    ['N°', 'Fecha de Producción', 'N° Lote', 'Cantidad (kg)', 'Unidades', 'Tipo de Unidad', 'Guía de Remisión (Montero → destino)'],
    ...rows.map(r => [r.n, r.fechaProduccion ?? '', r.lote, Number(r.kg).toFixed(2), r.unidades ?? '', r.tipoUnidad, guiaTramoInterno ?? '']),
    ['', '', 'TOTAL', Number(totalKg).toFixed(2), totalUnidades, '', ''],
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Packing List Nacional')
  const fileId = (packingListNumero ?? container?.container_number ?? 'SN').replace(/[\\/:*?"<>|]/g, '-')
  XLSX.writeFile(wb, `Packing_List_Nacional_${fileId}.xlsx`)
}

// Puente orden → contenedor para el modal "Documentos" de una orden --
// mismo criterio que ordenSalida.js/packingList.js. Este documento solo
// aplica a ventas nacionales (sin booking) -- una orden de exportación usa
// el "Packing List" real (pallets/contenedor). Se valida acá en vez de
// gatear la entrada entera de QUICK_DOCS, mismo criterio que usa
// fetchOrdenSalidaQuickDoc para "todavía no hay despacho".
export async function fetchPackingListNacionalCaesQuickDoc(order) {
  const { container, ordersInContainer } = await resolveContainerContext(COOPERATIVE, order)
  if (container?.booking_number) {
    throw new Error('Esta orden es de exportación (tiene N° Booking) -- use "Packing List" en vez de "Packing List-Nacional".')
  }
  return fetchPackingListNacionalCaesData(container, ordersInContainer)
}

export function packingListNacionalCaesQuickDocPdf(order, containerNumber, data) {
  return packingListNacionalCaesPdf(data)
}

export function packingListNacionalCaesQuickDocExcel(order, containerNumber, data) {
  packingListNacionalCaesExcel(data)
}
