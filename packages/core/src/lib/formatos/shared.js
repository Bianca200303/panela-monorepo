import { supabase } from '../supabase'

// Antes era una constante calculada al importar el módulo (leía COOPERATIVE
// de lib/config, que ya no existe en core) -- ahora es una función del
// `cooperative` activo, para que cada app se lo pase explícito.
export function getCoopCode(cooperative) {
  return (cooperative?.code ?? 'ORG').slice(0, 4).toUpperCase()
}

// Los documentos se arman como HTML crudo (document.write / iframe srcDoc),
// así que cualquier campo de texto libre que venga de un formulario (nombre
// de productor/firmante/cliente, observaciones, etc.) tiene que pasar por
// acá antes de interpolarse -- si no, un dato guardado con "<img onerror=...>"
// ejecutaría al abrirse el documento. No usar en valores que ya son HTML
// armado por el propio código (ej. bloques de <tr>/<div> ya generados).
export function escapeHtml(value) {
  if (value == null) return value
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtNum(n, dec = 2) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toFixed(dec)
}

// Identificador de archivo para los documentos rápidos: contenedor-orden de
// producción, nunca el código interno (order_code) -- ese código no dice
// nada afuera del sistema, mientras que contenedor + n° de orden es lo que
// el cliente/planta reconoce. Se sanea para que sirva como nombre de
// archivo (sin espacios ni separadores de ruta).
export function docFileId(order, containerNumber) {
  const orderNum = order?.client_order_number ?? order?.order_code ?? 'orden'
  return `${containerNumber ?? 'SN'}-${orderNum}`
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')
}

// Número + nombre completo de cada Documento rápido, igual que el PDF físico
// de referencia (ej. "12.- CONTROL DEL PROGRAMA DE LIMPIEZA Y SANITIZACIÓN
// DE AMBIENTES.pdf") -- para que el archivo descargado (PDF y Excel) se
// llame igual que el papel, en vez del nombre interno en snake_case. Los
// títulos son literales (no referencian FORMAT_TITLE_* de cada documento)
// a propósito: tres de los doce ya difieren un poco del encabezado interno
// del documento (05 y 09 dicen "DE"/"REGISTRO DE..." en el papel donde el
// encabezado usa otra palabra) -- son dos cosas relacionadas pero distintas,
// no una sola fuente de verdad.
const QUICK_DOC_FILE_LABELS = {
  orden_produccion:               { number: '01', title: 'ORDEN DE PRODUCCIÓN' },
  registro_trazabilidad:          { number: '02', title: 'REGISTRO DE TRAZABILIDAD' },
  registro_homogenizado_tamizado: { number: '05', title: 'REGISTRO DE HOMOGENIZADO Y TAMIZADO' },
  control_envasado:               { number: '06', title: 'CONTROL DE ENVASADO' },
  control_calidad_lote:           { number: '08', title: 'CONTROL DE CALIDAD POR LOTE' },
  inspeccion_cuerpos_extranos:    { number: '09', title: 'CONTROL DE CUERPOS EXTRAÑOS' },
  control_salud_higiene_personal: { number: '11', title: 'CONTROL DE SALUD E HIGIENE DEL PERSONAL' },
  control_limpieza_ambientes:     { number: '12', title: 'CONTROL DEL PROGRAMA DE LIMPIEZA Y SANITIZACIÓN DE AMBIENTES' },
  control_limpieza_equipos:       { number: '13', title: 'CONTROL DEL PROGRAMA DE LIMPIEZA Y SANITIZACIÓN DE EQUIPOS - UTENSILIOS' },
  control_verificacion_limpieza:  { number: '14', title: 'VERIFICACIÓN DEL PROGRAMA DE LIMPIEZA Y SANITIZACIÓN' },
  control_cloro_residual:         { number: '15', title: 'CONTROL DE CLORO RESIDUAL' },
  control_plagas:                 { number: '16', title: 'CONTROL DE PLAGAS' },
  // Documentos que solo existen para CAES (ver COOPERATIVE.features), sin
  // número en la serie física numerada de Norandino -- título sin prefijo.
  control_limpieza_general:       { number: null, title: 'CONTROL DE LIMPIEZA' },
  control_cloro_residual_caes:    { number: null, title: 'CONTROL DE CONSUMO DE CLORO Y VERIFICACIÓN DE CLORO RESIDUAL' },
  control_higiene_personal_caes:  { number: null, title: 'CONTROL DE HIGIENE DEL PERSONAL' },
  control_plagas_caes:            { number: null, title: 'CONTROL DE ROEDORES E INSECTOS' },
  monitoreo_tamizado_caes:        { number: null, title: 'MONITOREO Y VERIFICACIÓN DEL TAMIZADO (PCC)' },
  sellado_envasado_caes:          { number: null, title: 'CONTROL DE SELLADO, ENVASADO Y EMPAQUE DE PRODUCTO TERMINADO' },
  hermeticidad_envases_caes:      { number: null, title: 'CONTROL DE HERMETICIDAD DE ENVASES' },
  calibracion_balanzas_caes:      { number: null, title: 'VERIFICACIÓN INTERNA DE CALIBRACIÓN DE BALANZAS' },
  temp_humedad_ambientes_caes:    { number: null, title: 'CONTROL DE TEMPERATURA Y HUMEDAD DE AMBIENTES' },
  lavado_manos_caes:              { number: null, title: 'LAVADO DE MANOS EN LA OPERACIÓN DE TAMIZADO' },
  preparacion_soluciones_caes:    { number: null, title: 'CONTROL DE PREPARACIÓN DE SOLUCIONES' },
  manejo_residuos_caes:           { number: null, title: 'MANEJO DE RESIDUOS' },
}

// El nombre de un documento puede depender de la orden (ej. CAES: "Control
// de Calidad por Lote nacional/de exportación") -- en ese caso `label` es
// una función (order) => string en vez de un texto fijo.
export function quickDocLabel(doc, order) {
  return typeof doc.label === 'function' ? doc.label(order) : doc.label
}

export function quickDocFileName(key, order, containerNumber) {
  const entry = QUICK_DOC_FILE_LABELS[key]
  const prefix = entry ? (entry.number ? `${entry.number}.- ${entry.title}` : entry.title) : key
  return `${prefix} - ${docFileId(order, containerNumber)}`.replace(/[\\/:*?"<>|]/g, '-')
}

export const PRINT_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 16px; }
  .formato-header { border: 1px solid #333; padding: 10px 14px; margin-bottom: 8px; }
  .formato-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-top: 8px; font-size: 12px; }
  .meta-label { font-weight: 600; }
  .formato-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
  .formato-table th, .formato-table td { border: 1px solid #555; padding: 3px 5px; vertical-align: middle; }
  .formato-table th { background: #e8e8e8; font-weight: 700; font-size: 10px; text-align: center; }
  .formato-table tfoot td { background: #f0f0f0; font-weight: 700; }
  .formato-firmas { display: flex; gap: 40px; margin-top: 40px; flex-wrap: wrap; }
  .firma-bloque { flex: 1; min-width: 160px; text-align: center; }
  .firma-linea { border-top: 1px solid #333; margin-bottom: 4px; }
  .firma-nombre { font-weight: 600; font-size: 11px; }
  .firma-cargo { font-size: 10px; color: #555; }
  .lote-block { margin-bottom: 24px; }
  .lote-separator { background: #f0f0f0; border-left: 4px solid #444; padding: 6px 10px; margin-bottom: 6px; font-size: 12px; }
  .section-label { font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #444; margin: 8px 0 3px; }
  textarea { display: none; }
`

export function buildFirmasHTML(firmantes) {
  if (firmantes === null) return ''
  if (firmantes?.length > 0) {
    return firmantes.map(f => `
      <div class="firma-bloque">
        <div class="firma-linea"></div>
        <div class="firma-nombre">${escapeHtml(f.nombre) || '_______________________'}</div>
        <div class="firma-cargo">${escapeHtml(f.cargo) || 'Responsable'}</div>
      </div>`).join('')
  }
  return `<div class="firma-bloque">
    <div class="firma-linea"></div>
    <div class="firma-nombre">_______________________</div>
    <div class="firma-cargo">Responsable</div>
  </div>`
}

// Encabezado común a los documentos "por orden/contenedor" (Orden de
// Producción, Control de Calidad por Lote): logo/nombre de cooperativa +
// metadatos de la orden (contenedor, venta, cliente, certificación, fechas
// de proceso). `title` es el título propio de cada documento.
// cooperative como primer parámetro (antes leía COOPERATIVE del módulo
// lib/config, que ya no existe en core) -- los call sites (bucket 1/2/3,
// pendientes de migrar) tienen que empezar a pasarlo.
export function buildOrdenHeaderHTML(cooperative, order, certText, title) {
  const clientName = escapeHtml(order?.plant_clients?.name) ?? '—'
  return `<div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${escapeHtml(cooperative?.name) ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${escapeHtml(title)}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Contenedor N°:</span> ${escapeHtml(order?.internal_container_number) ?? '—'}</div>
      <div><span class="meta-label">Nº de venta:</span> ${escapeHtml(order?.sale_number) ?? '—'}</div>
      <div><span class="meta-label">Producto:</span> ${escapeHtml(order?.product) ?? '—'}</div>
      <div><span class="meta-label">Nº orden producción:</span> ${escapeHtml(order?.client_order_number ?? order?.order_code) ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
      <div><span class="meta-label">Certificación:</span> ${escapeHtml(certText)}</div>
      <div><span class="meta-label">Fecha inicio tamizado:</span> ${fmtDate(order?.tamizado_fecha_inicio)}</div>
      <div><span class="meta-label">Fecha final tamizado:</span> ${fmtDate(order?.tamizado_fecha_fin)}</div>
      <div><span class="meta-label">Fecha inicio envasado:</span> ${fmtDate(order?.envasado_fecha_inicio)}</div>
      <div><span class="meta-label">Fecha final envasado:</span> ${fmtDate(order?.envasado_fecha_fin)}</div>
      <div><span class="meta-label">Fecha de envío:</span> ${fmtDate(order?.fecha_envio)}</div>
    </div>
  </div>`
}

// Toma entries [{ exit_item_id, kg, ...extra }] (kg ya agrupado por quien
// llama) y les suma los datos de productor/guía/apariencia/certificación,
// consultando exit_items una sola vez para todos. Compartido entre Registro
// de Trazabilidad (agrupa por fuente+lote de envasado) y Registro de
// Homogenizado y Tamizado (agrupa por fuente+bunque) -- ambos arman "un
// renglón por productor" a partir del mismo dato base
// (plant_homogenization_inputs), solo cambia el nivel de agrupación.
export async function enrichRawMaterialEntries(entries) {
  if (entries.length === 0) return []

  const exitItemIds = [...new Set(entries.map(e => e.exit_item_id))]
  const { data: items, error: itemsErr } = await supabase
    .from('exit_items')
    .select(`
      id, bags_count, item_document_number,
      exit_registrations ( document_number ),
      production_batches ( process_date, producers ( dni, first_name, last_name, is_member, coop_modules ( name ) ) ),
      exit_reception_items ( cert_status, quantity_kg_received, exit_receptions ( received_at ) ),
      quality_evaluations ( appearance )
    `)
    .in('id', exitItemIds)
  if (itemsErr) throw new Error(itemsErr.message)

  return entries.map(e => {
    const item = (items ?? []).find(i => i.id === e.exit_item_id)
    const producer = item?.production_batches?.producers
    // Sacos usados en ESTE renglón = a prorrata de cuánto de lo recibido
    // (quantity_kg_received, el total real de esa recepción, no solo lo
    // que se usó en esta orden) representa el kg de este renglón puntual.
    // bags_count no se desglosa por lote de envasado ni por bunque en
    // ningún lado del sistema, así que esto sigue siendo una aproximación
    // -- pero calculada contra el total recibido real, no contra un total
    // parcial.
    const totalReceivedKg = Number(item?.exit_reception_items?.quantity_kg_received ?? 0)
    const bagsShare = item?.bags_count != null && totalReceivedKg > 0
      ? Math.round((e.kg / totalReceivedKg) * Number(item.bags_count))
      : null
    return {
      ...e,
      bags_count: bagsShare,
      dni: producer?.dni ?? null,
      producer_name: producer ? `${producer.first_name} ${producer.last_name}` : null,
      is_member: producer?.is_member ?? true,
      module_name: producer?.coop_modules?.name ?? null,
      guia_remision: item?.exit_registrations?.document_number ?? null,
      comprobante_acopio: item?.item_document_number ?? null,
      // exit_item_id es UNIQUE tanto en exit_reception_items como en
      // quality_evaluations -- son relaciones 1 a 1, PostgREST las trae
      // como objeto directo, no como array.
      cert_status: item?.exit_reception_items?.cert_status ?? null,
      appearance: item?.quality_evaluations?.appearance ?? null,
      fecha_produccion: item?.production_batches?.process_date ?? null,
      // received_at es timestamptz (fecha+hora) -- se recorta a solo fecha
      // porque el resto del sistema (fmtDate) espera fechas simples "YYYY-MM-DD";
      // pasarle el timestamp completo daba "Fecha inválida" en el PDF.
      fecha_acopio: item?.exit_reception_items?.exit_receptions?.received_at?.slice(0, 10) ?? null,
    }
  })
}

export const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// Los registros MENSUALES (Limpieza de Ambientes, Limpieza de Equipos) son
// independientes de cualquier orden -- 1 control por (año, mes). Para armar
// el documento de una orden se cruzan por mes los controles cuyo (año, mes)
// cae dentro del rango de trabajo de esa orden
// (tamizado_fecha_inicio..envasado_fecha_fin).
export function monthsBetween(fechaDesde, fechaHasta) {
  const start = new Date(`${fechaDesde}T00:00:00`)
  const end = new Date(`${fechaHasta}T00:00:00`)
  const months = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= endMonth) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 })
    cur.setMonth(cur.getMonth() + 1)
  }
  return months
}

// Igual que monthsBetween pero día por día -- para cruzar registros
// MENSUALES CON GRILLA POR DÍA (ej. Higiene del Personal CAES: persona ×
// ítem × día) contra el rango exacto de trabajo de una orden, y así poder
// mostrar cómo estuvo el control justo el/los día(s) en que se produjo,
// no solo "existió un control ese mes".
export function datesBetween(fechaDesde, fechaHasta) {
  const start = new Date(`${fechaDesde}T00:00:00`)
  const end = new Date(`${fechaHasta}T00:00:00`)
  const dates = []
  const cur = new Date(start)
  while (cur <= end) {
    dates.push({ year: cur.getFullYear(), month: cur.getMonth() + 1, day: cur.getDate(), iso: cur.toISOString().slice(0, 10) })
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

export function metaRow(label, value) {
  return `<div><span class="meta-label">${escapeHtml(label)}:</span> ${escapeHtml(value) ?? '—'}</div>`
}

// Fila de la tabla "Control y verificación de transporte": pares
// etiqueta/valor con borde, calcando la grilla del papel físico real (en vez
// del listado simple de "etiqueta: valor" que se usa en el resto del
// documento). Compartida entre Orden de Salida y Packing List.
export function transportRow(...pairs) {
  const cells = pairs.map(([label, value]) => `
    <td style="background:#f0f0f0;font-weight:700;font-size:10px;white-space:nowrap;width:14%">${escapeHtml(label)}:</td>
    <td style="font-size:10px">${escapeHtml(value) ?? ''}</td>
  `).join('')
  return `<tr>${cells}</tr>`
}

export function yesNo(v) {
  if (v === true) return 'SI'
  if (v === false) return 'NO'
  return '—'
}

// Solo para los botones "Imprimir" del historial -- abre el diálogo real de
// impresión del navegador (elegir impresora, no solo "Guardar como PDF").
// Para descargar un documento directo como PDF (botones "Descargar
// PDF"/"Exportar PDF") usar downloadPdfDocument() (lib/pdfDownload.js).
export function openPrintWindow(html) {
  const win = window.open('', '_blank', 'width=1000,height=700')
  win.document.write(html)
  win.document.close()
  win.focus()
  win.print()
  win.close()
}

// Orden de Salida y Packing List son documentos por CONTENEDOR, pero el
// modal "Documentos" de una orden solo tiene la orden, no el contenedor ya
// resuelto -- esto resuelve a partir de order.container_id para poder
// ofrecerlos también desde ahí. Si la orden todavía no llegó a Embarque
// (sin contenedor) se corta con un mensaje claro.
// cooperative como primer parámetro (antes leía COOPERATIVE del módulo
// lib/config, que ya no existe en core) -- los call sites (bucket 1/2/3,
// pendientes de migrar) tienen que empezar a pasarlo.
export async function resolveContainerContext(cooperative, order) {
  if (!order.container_id) {
    throw new Error('Esta orden todavía no tiene un contenedor asignado (se asigna en Embarque).')
  }
  const [{ data: container }, { data: ordersInContainer }] = await Promise.all([
    supabase.from('plant_containers').select('*').eq('id', order.container_id).single(),
    supabase.from('plant_orders')
      .select(`
        id, order_code, market, client_order_number, sale_number,
        plant_clients ( name ),
        plant_production_batches ( id, description, brand, packaging_count, packaging_kg, pallet_count,
          plant_product_catalog ( description )
        )
      `)
      .eq('container_id', order.container_id)
      .eq('cooperative_id', cooperative.id),
  ])
  return { container, ordersInContainer: ordersInContainer ?? [] }
}
