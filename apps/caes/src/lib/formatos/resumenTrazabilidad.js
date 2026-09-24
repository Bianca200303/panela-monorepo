import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { loteLabel, loteKg, packagingLabel } from '@panela/core/lib/loteHelpers'
import { PRINT_STYLES, fmtDate, fmtNum, buildFirmasHTML, quickDocFileName, resolveContainerContext, escapeHtml } from '@panela/core/lib/formatos/shared'
import { getLoteLabel, getLoteLabelLower } from '@panela/core/lib/labels'

const LOTE_LABEL = getLoteLabel(COOPERATIVE)
const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
import { fetchRawMaterialInputsForOrder, fetchOrderCertNames } from '@panela/core/lib/formatos/registroTrazabilidad'
import { fetchControlHigienePersonalCaesData, HYGIENE_CAES_TURNOS, HYGIENE_CAES_ITEMS } from './higienePersonalCaes'
import { fetchControlVerificacionLimpiezaData } from '@panela/core/lib/formatos/verificacionLimpieza'
import { fetchControlCloroResidualCaesData, CLORO_CAES_MIN_PPM, CLORO_CAES_MAX_PPM } from './cloroResidualCaes'
import { fetchControlPlagasCaesData } from './controlPlagasCaes'
import { fetchControlLimpiezaGeneralData } from './limpiezaGeneral'
import { fetchTransportUnitControlsCaesData } from './transportUnitControlsCaes'

export const FORMAT_TITLE_RESUMEN_TRAZABILIDAD = 'RESUMEN DE TRAZABILIDAD'

// Copia SOLO CAES de este documento (originalmente compartido, ver plan de
// migración a monorepo) -- CAES siempre usa higieneGrillaMensual,
// cloroPreparacionMonitoreo, plagasEventosMensuales, limpiezaUnificada y
// controlesPlantaCAES en true, así que se sacaron los ternarios/ramas de
// Norandino (que ya no existen en esta app) y se dejó directo la rama CAES.
//
// Resumen POR LOTE (no por orden) de datos que ya existen en otros controles
// del sistema. Las 4 referencias (higiene, verificación de limpieza, cloro
// residual, plagas) muestran solo la FECHA del control más reciente dentro
// del rango de la orden -- esos 4 controles no tienen un código de formato
// propio cargado en el sistema, así que no se inventa uno.
//
// A diferencia de todo lo demás (siempre por ORDEN), este documento es por
// LOTE: la fecha de producción, el análisis de calidad y la materia prima
// pueden variar entre lotes de una misma orden, así que "por orden" pierde
// trazabilidad apenas hay más de un lote. Si la orden tiene más de un lote,
// el modal pide elegir cuál se está trazando (needsLoteSelector, ver
// QuickDocsModal.jsx) -- con un solo lote se autoselecciona sin pedir nada.
//
// CAES tiene DOS formatos físicos de referencia para esto -- "Ejercicio de
// Trazabilidad Nacional" (CAESP-PP-BPM-RE-TRA-002) y "...de Exportación"
// (CAESP-CC-PP-BPM-RE-EJT-003) -- casi iguales pero el nacional no lleva
// BL/Certificado de Origen/Carta de Rendimiento del Azúcar (son de embarque
// marítimo, no aplican a una venta dentro de Perú) y nombra distinto los
// tramos de transporte (Piura-Lima en vez de Paita-puerto). El tipo se lee
// de plant_orders.sale_type ('nacional' | 'exportacion'), elegido al crear
// la orden (ver OrdenesPage.jsx). needsTipoSelector (QuickDocsModal.jsx)
// solo pregunta como fallback en órdenes viejas que quedaron sin ese campo.
export async function fetchResumenTrazabilidadData(order, kgPerQuintal, selectedBatch, tipo) {
  const batches = order?.plant_production_batches ?? []
  const batch = selectedBatch ?? batches[0]
  if (!batch) throw new Error('Esta orden no tiene lotes registrados.')

  // El lote se busca antes que todo lo demás -- varios controles (ver más
  // abajo) se cruzan por la fecha EXACTA de producción del lote
  // (envasado_registered_at), no por el rango de trabajo de la orden, así
  // que hace falta esa fecha antes de armar el resto de las consultas.
  const { data: batchData, error: batchError } = await supabase
    .from('plant_production_batches')
    .select('id, calidad_humedad_pct, calidad_impurezas_pct, calidad_registered_at, envasado_registered_at, liberacion_formato_codigo')
    .eq('id', batch.id)
    .single()
  if (batchError) throw new Error(batchError.message)

  // calidad_registered_at/envasado_registered_at son timestamptz -- se
  // recortan a solo fecha (fmtDate espera "YYYY-MM-DD", pasarle el
  // timestamp completo da "Fecha inválida").
  const fechaProduccionLote = batchData?.envasado_registered_at?.slice(0, 10) ?? null
  const fechaLiberacion = batchData?.calidad_registered_at?.slice(0, 10) ?? null

  const fechaDesde = order?.tamizado_fecha_inicio ?? order?.envasado_fecha_inicio
    ?? order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin ?? null
  const fechaHasta = order?.envasado_fecha_fin ?? order?.tamizado_fecha_fin
    ?? order?.envasado_fecha_inicio ?? order?.tamizado_fecha_inicio ?? null
  // Rango amplio (desde que se armó el lote hasta que se despachó) -- solo
  // para Control de Plagas, que puede coincidir en cualquier momento de ese
  // ciclo completo, no solo el día exacto de producción (a diferencia de
  // Higiene/Cloro/Limpieza/Temp-Humedad, que sí exigen la fecha exacta --
  // ver [[project_resumen_trazabilidad_fechas_por_control]]). Si la orden
  // todavía no tiene fecha de despacho (no se despachó), cae de respaldo en
  // fechaHasta (fin de envasado) en vez de quedar abierto, para que el
  // reporte generado ANTES del despacho no muestre todo vacío.
  const fechaHastaDespacho = order?.fecha_envio ?? fechaHasta

  // Nacional NUNCA pasa por "Registrar carga" (esa tabla es 100% de
  // exportación) -- su N° de Packing List vive en su propio registro
  // (plant_packing_list_nacional_caes, ver PackingListNacionalCaesModal.jsx
  // y migración 20260916120000). Antes esto se leía siempre de
  // plant_container_loadings sin importar el tipo -- para Nacional esa
  // tabla nunca tiene fila, así que el N° de Packing List quedaba siempre
  // en blanco en el resumen (bug corregido acá).
  const esExportacionFetch = (tipo ?? 'exportacion') === 'exportacion'
  const [materiaPrimaAll, higiene, verificacion, cloro, plagas, limpiezaGeneral, containerCtx, cargaRes, certNames, selladoEnvasadoRes, tempHumedadAlmacenRes, transportRes, dispatchRes] = await Promise.all([
    fetchRawMaterialInputsForOrder(order.id),
    fetchControlHigienePersonalCaesData(order, { desde: fechaProduccionLote, hasta: fechaProduccionLote }),
    fetchControlVerificacionLimpiezaData(COOPERATIVE, order, { desde: fechaDesde, hasta: fechaHastaDespacho }),
    fetchControlCloroResidualCaesData(order, { desde: fechaProduccionLote, hasta: fechaProduccionLote }),
    fetchControlPlagasCaesData(order, { desde: fechaDesde, hasta: fechaHastaDespacho }),
    fetchControlLimpiezaGeneralData(order, { desde: fechaProduccionLote, hasta: fechaProduccionLote }),
    order?.container_id ? resolveContainerContext(COOPERATIVE, order) : Promise.resolve(null),
    !order?.container_id
      ? Promise.resolve({ data: null })
      : esExportacionFetch
        // El N° de Packing List de exportación ya existe en el sistema (se
        // carga en "Registrar carga" del contenedor, en Embarque).
        ? supabase.from('plant_container_loadings').select('documento_number').eq('container_id', order.container_id).maybeSingle()
        : supabase.from('plant_packing_list_nacional_caes').select('packing_list_numero').eq('container_id', order.container_id).maybeSingle()
          .then(({ data }) => ({ data: data ? { documento_number: data.packing_list_numero } : null })),
    fetchOrderCertNames(order.id),
    // "Control de Sellado, Envasado y Empaque" del papel de CAES (Fase 2,
    // CPR-003), con plant_batch_id real (ver
    // 20260913280000_add_plant_batch_id_sellado_envasado_caes.sql, el
    // control pasó a ser una acción por lote en Órdenes) -- se cruza por
    // ESE lote exacto.
    supabase.from('plant_packaging_seal_control_caes').select('control_date, formato_codigo').eq('plant_batch_id', batch.id).order('control_date', { ascending: false }).limit(1).maybeSingle(),
    // Temperatura/Humedad de "Almacén de Producto Terminado" -- se lee
    // directo de Control de Temperatura y Humedad de Ambientes (RMP-003),
    // exigiendo la fecha EXACTA de producción del lote (no un rango, ver
    // [[project_resumen_trazabilidad_fechas_por_control]]). ("Control de
    // Almacén", que antes guardaba esto por su cuenta, se eliminó por
    // completo -- migración 20260919100000 -- por duplicar este mismo dato
    // con menos precisión.)
    fechaProduccionLote
      ? supabase
          .from('plant_temp_humidity_control_caes')
          .select('control_date, t_promedio, hr_promedio')
          .eq('ubicacion', 'Almacén de Producto Terminado')
          .eq('control_date', fechaProduccionLote)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Control de Unidad de Transporte (CUT) -- N registros por contenedor,
    // aplica a Nacional y Exportación (ver [[project_despacho_nacional_caes]]
    // y migración 20260916130000). Reemplaza los 2 campos fijos
    // transporte_tramo1/2_codigo que vivían como texto suelto sin ningún
    // control real detrás.
    order?.container_id
      ? fetchTransportUnitControlsCaesData({ id: order.container_id })
      : Promise.resolve({ controls: [] }),
    // Temperatura/humedad al cargar el despacho -- puramente informativo
    // (no forma parte del papel físico), se agrega a pedido del usuario
    // para no perder el dato que ya se carga en "Registrar despacho" y que
    // hasta ahora no se mostraba en ningún documento.
    order?.container_id
      ? supabase.from('plant_dispatches').select('temperature_at_load, humidity_at_load').eq('container_id', order.container_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const loteLbl = loteLabel(batch)
  const materiaPrima = materiaPrimaAll.filter(r => r.lote_envasado === loteLbl)

  // El transporte de materia prima (centro de proceso -> planta de
  // envasado) no tiene tabla propia -- pero sus fechas de acopio y guías de
  // remisión ya están en la propia materia prima del lote (una por
  // productor/viaje), así que se derivan de ahí en vez de inventar un
  // rango único que la propia hoja de CAES muestra como varias fechas.
  const materiaPrimaGuiasByKey = new Map()
  for (const r of materiaPrima) {
    if (!r.fecha_acopio && !r.guia_remision) continue
    const key = `${r.fecha_acopio ?? ''}|${r.guia_remision ?? ''}`
    if (!materiaPrimaGuiasByKey.has(key)) {
      materiaPrimaGuiasByKey.set(key, { fecha_acopio: r.fecha_acopio, guia_remision: r.guia_remision })
    }
  }
  const materiaPrimaGuias = [...materiaPrimaGuiasByKey.values()]
    .sort((a, b) => (a.fecha_acopio ?? '').localeCompare(b.fecha_acopio ?? ''))

  const lastBlock = (blocks, dateField) => {
    if (blocks.length === 0) return null
    return [...blocks].sort((a, b) => (a[dateField] ?? '').localeCompare(b[dateField] ?? '')).slice(-1)[0]
  }

  // Colaboradores presentes: el papel lista los nombres del control de
  // higiene, no solo su fecha. CAES es 1 control por mes+turno con una
  // grilla persona×ítem×día, con la fecha EXACTA de producción del lote (no
  // un rango, ver [[project_resumen_trazabilidad_fechas_por_control]]) --
  // puede tener registro de Mañana Y Tarde ese mismo día. bloquesHigiene
  // arma UNA tablita por turno (cada uno con su propio código de formato,
  // pueden diferir) en vez de fusionar los colaboradores de ambos turnos en
  // una sola lista sin diferenciar de cuál turno vino cada quien.
  let ultimoBloqueHigiene = null
  let colaboradoresHigiene = []
  let higieneIncidencias = []
  const bloquesHigiene = []
  if (fechaProduccionLote) {
    const [prodYear, prodMonth, prodDay] = fechaProduccionLote.split('-').map(Number)
    const nombres = new Set()
    const incidents = []
    const turnosConDatos = []
    const codigosConDatos = []
    for (const block of higiene.blocks.filter(b => b.year === prodYear && b.month === prodMonth)) {
      let turnoHasData = false
      const colaboradoresTurno = []
      for (const person of block.persons) {
        const itemsNoCorrecto = []
        let personaHasData = false
        for (const item of HYGIENE_CAES_ITEMS) {
          const status = person.checksByItem?.[item.code]?.[prodDay]
          if (status) { turnoHasData = true; personaHasData = true; nombres.add(person.name) }
          if (status === 'no_correcto') { incidents.push(`${person.name} (${item.label})`); itemsNoCorrecto.push(item.label) }
        }
        if (personaHasData) colaboradoresTurno.push({ name: person.name, itemsNoCorrecto })
      }
      if (turnoHasData) {
        turnosConDatos.push(block.turno)
        if (block.formatoCodigo) codigosConDatos.push(block.formatoCodigo)
        bloquesHigiene.push({
          turnoLabel: HYGIENE_CAES_TURNOS[block.turno] ?? block.turno,
          codigo: block.formatoCodigo ?? null,
          colaboradores: colaboradoresTurno,
        })
      }
    }
    higieneIncidencias = incidents
    ultimoBloqueHigiene = turnosConDatos.length > 0
      ? {
          fecha: fechaProduccionLote,
          fechaLabel: `${fmtDate(fechaProduccionLote)} (${turnosConDatos.map(t => HYGIENE_CAES_TURNOS[t] ?? t).join(' y ')})`
            + (higieneIncidencias.length > 0 ? ' — CON INCIDENCIAS' : ' — CORRECTO'),
          codigo: codigosConDatos.length > 0 ? codigosConDatos.join(' / ') : null,
        }
      : null
    colaboradoresHigiene = [...nombres]
  }

  // Control de Limpieza (HYS-001, CAES) -- mismo criterio que Higiene: fecha
  // EXACTA de producción del lote (acá no hay turno, un solo registro
  // mensual).
  let controlLimpieza = null
  if (fechaProduccionLote) {
    const [prodYear, prodMonth, prodDay] = fechaProduccionLote.split('-').map(Number)
    const bloqueMes = limpiezaGeneral.blocks.find(b => b.year === prodYear && b.month === prodMonth)
    if (bloqueMes) {
      let hasData = false
      let noCorrecto = false
      for (const byItem of Object.values(bloqueMes.checksByCell)) {
        for (const byDay of Object.values(byItem)) {
          const status = byDay[prodDay]
          if (status) hasData = true
          if (status === 'no_correcto') noCorrecto = true
        }
      }
      controlLimpieza = hasData
        ? { fecha: fechaProduccionLote, fechaLabel: `${fmtDate(fechaProduccionLote)}${noCorrecto ? ' — CON INCIDENCIAS' : ' — CORRECTO'}`, codigo: bloqueMes.formatoCodigo ?? null }
        : null
    }
  }

  // Plagas en el papel son 2 controles separados con su propia fecha
  // (Monitoreo Trampas Mecánicas, Monitoreo Insectocutores). CAES es un
  // registro MENSUAL con listas de eventos con fecha propia
  // (rodentEvents/insectEvents) -- el papel real de CAES no tiene un 3er
  // control de "ambientes/equipo/personal" aparte (el "Resumen"/"Ejercicio
  // de Trazabilidad" de CAES solo trae 4 códigos de referencia: HYS-01,
  // HYS-02, y los 2 de plagas). HYS-02 ya lo cubre la referencia
  // "Inspección de Ambientes, Equipos y Personal" de abajo.
  const lastEventRef = (blocks, eventsField) => {
    const monthsConEventos = blocks.filter(b => (b[eventsField] ?? []).length > 0)
    const ultimoMes = [...monthsConEventos].sort((a, b) => (a.year - b.year) || (a.month - b.month)).slice(-1)[0]
    if (!ultimoMes) return null
    const ultimoEvento = [...ultimoMes[eventsField]].sort((a, b) => (a.event_date ?? '').localeCompare(b.event_date ?? '')).slice(-1)[0]
    return { fecha: ultimoEvento?.event_date ?? null, codigo: ultimoMes.codigo ?? null }
  }
  const bloqueTrampasMecanicas = lastEventRef(plagas.blocks, 'rodentEvents')
  const bloqueInsectocutores = lastEventRef(plagas.blocks, 'insectEvents')

  // Control de Agua -- ya NO es un control aparte ("Control de Almacén" se
  // eliminó por completo, migración 20260919100000): es el mismo Monitoreo
  // de Cloro Residual de CAES que ya se trae en `cloro` más arriba, mismo
  // bloque (más reciente en el rango) que usa referencias.cloroResidual.
  const ultimoBloqueCloroCaes = lastBlock(cloro.blocks, 'controlDate')
  const controlAgua = ultimoBloqueCloroCaes
    ? { codigo: ultimoBloqueCloroCaes.codigo, fecha: ultimoBloqueCloroCaes.controlDate, eventos: ultimoBloqueCloroCaes.monitoringEvents ?? [] }
    : null

  // Temperatura/Humedad de "Almacén de Producto Terminado" -- ver comentario
  // en el fetch de tempHumedadAlmacenRes más arriba.
  const tempHumedadAlmacen = tempHumedadAlmacenRes?.data
    ? {
        fecha: tempHumedadAlmacenRes.data.control_date,
        temperaturaC: tempHumedadAlmacenRes.data.t_promedio,
        humedadPct: tempHumedadAlmacenRes.data.hr_promedio,
      }
    : null

  return {
    tipo: tipo ?? 'exportacion',
    batch: { ...batch, ...batchData, envasado_registered_at: fechaProduccionLote },
    fechaProduccionLote,
    materiaPrima,
    materiaPrimaGuias,
    container: containerCtx?.container ?? null,
    packingListNumero: cargaRes?.data?.documento_number ?? null,
    transportControls: transportRes?.controls ?? [],
    despachoTemperaturaC: dispatchRes?.data?.temperature_at_load ?? null,
    despachoHumedadPct: dispatchRes?.data?.humidity_at_load ?? null,
    controlAgua,
    tempHumedadAlmacen,
    certNames,
    fechaDesde,
    fechaHasta,
    colaboradoresHigiene,
    higieneIncidencias,
    bloquesHigiene,
    referencias: {
      higiene:                     ultimoBloqueHigiene,
      verificacionLimpieza:        (() => { const b = lastBlock(verificacion.blocks, 'controlDate'); return b ? { fecha: b.controlDate, codigo: b.codigo ?? null } : null })(),
      cloroResidual:               (() => { const b = lastBlock(cloro.blocks, 'controlDate'); return b ? { fecha: b.controlDate, codigo: b.codigo ?? null } : null })(),
      monitoreoTrampasMecanicas:   bloqueTrampasMecanicas,
      monitoreoInsectocutores:     bloqueInsectocutores,
      controlLimpieza,
      // ver 20260921100000_add_codigo_to_remaining_caes_controls.sql.
      liberacionProductoTerminado: { fecha: fechaLiberacion, codigo: batchData?.liberacion_formato_codigo ?? null },
      selladoEnvasadoEmpaque:      { fecha: selladoEnvasadoRes?.data?.control_date ?? null, codigo: selladoEnvasadoRes?.data?.formato_codigo ?? null },
    },
  }
}

// data.tipo ('nacional' | 'exportacion') decide qué campos mostrar: CAES
// tiene dos formatos físicos distintos y el nacional no lleva BL/certificado
// de origen/carta de rendimiento del azúcar (son de embarque marítimo).
export function buildPrintHTMLResumenTrazabilidad(order, containerNumber, data, firmantes) {
  const { batch, materiaPrima, materiaPrimaGuias, container, referencias, tipo, packingListNumero, transportControls, certNames, bloquesHigiene, controlAgua, tempHumedadAlmacen, despachoTemperaturaC, despachoHumedadPct } = data
  const esExportacion = tipo === 'exportacion'
  const clientName = escapeHtml(order?.plant_clients?.name) ?? '—'
  const certText = certNames?.length > 0 ? escapeHtml(certNames.join(' - ').toUpperCase()) : '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  // Encabezado en formato "caja" (Registro/Código/Área + logo), calcado del
  // papel físico real de CAES para este mismo documento -- "Trazabilidad
  // Nacional" (CAESP-PP-BPM-RE-TRA-002) / "...Exportación"
  // (CAESP-CC-PP-BPM-RE-EJT-003), Área "Control de Calidad". Sin Fecha de
  // Revisión/Aprobación: esos campos son control documental del formato
  // físico en sí (cuándo CAES lo revisó/aprobó la última vez), no un dato
  // que este sistema pueda mantener al día -- mostrarlos fijos ("Marzo
  // 2025") quedaría desactualizado en cuanto CAES revise el papel de
  // nuevo, así que se sacaron en vez de arriesgar un dato viejo.
  const headerTitulo = `TRAZABILIDAD ${esExportacion ? 'EXPORTACIÓN' : 'NACIONAL'}`
  const headerCodigo = esExportacion ? 'CAESP-CC-PP-BPM-RE-EJT-003' : 'CAESP-PP-BPM-RE-TRA-002'
  const headerArea = 'CONTROL DE CALIDAD'
  const verificacionLimpiezaLabel = COOPERATIVE?.features?.verificacionLimpiezaLabel
    ? `${COOPERATIVE.features.verificacionLimpiezaLabel} (Limpieza)`
    : 'Inspección de Ambientes, Equipos y Personal (Limpieza)'

  const materiaPrimaRows = (materiaPrima ?? []).map(r => `
    <tr>
      <td>${escapeHtml(r.producer_name) ?? '—'}</td>
      <td style="text-align:right">${fmtNum(r.kg)}</td>
      <td style="text-align:center">${fmtDate(r.fecha_produccion)}</td>
      <td style="text-align:center">${fmtDate(r.fecha_acopio)}</td>
      <td style="white-space:nowrap;font-size:9px">${escapeHtml(r.guia_remision) ?? '—'}</td>
      <td style="white-space:nowrap;font-size:9px">${escapeHtml(r.comprobante_acopio) ?? '—'}</td>
    </tr>`).join('')
  const totalMateriaPrimaKg = (materiaPrima ?? []).reduce((s, r) => s + Number(r.kg ?? 0), 0)
  const materiaPrimaGuiasTexto = (materiaPrimaGuias ?? []).length > 0
    ? materiaPrimaGuias.map(g => `${escapeHtml(g.guia_remision) ?? '—'}${g.fecha_acopio ? ` (${fmtDate(g.fecha_acopio)})` : ''}`).join(', ')
    : 'Sin registro'

  // El papel real de CAES (Ejercicio de Trazabilidad Nacional/Exportación)
  // agrupa varios controles de a pares, en cuadros lado a lado (ej. "Control
  // y Liberación de Producto Terminado" junto a "Control de Sellado,
  // Envasado y Empaque"; "Control de Limpieza" junto a "Inspección de
  // Ambientes, Equipo y Personal"; los 2 controles de Plagas entre sí) --
  // estos dos helpers arman esa misma disposición en vez de una lista larga
  // de filas sueltas.
  const codigoFechaBox = (title, ref, extra = '') => `
    <table class="formato-table" style="width:100%;height:100%">
      <tbody>
        <tr><td colspan="2" style="background:#eef2f7;font-weight:800;font-size:9px;text-transform:uppercase">${title}</td></tr>
        <tr><td class="meta-label" style="width:40%">Código</td><td style="font-family:monospace">${ref?.codigo ?? '—'}</td></tr>
        <tr><td class="meta-label">Fecha</td><td>${ref?.fechaLabel ?? (ref?.fecha ? `${fmtDate(ref.fecha)}${extra}` : 'Sin registro en el período')}</td></tr>
      </tbody>
    </table>`
  const sideBySide = (boxA, boxB) => `
    <div style="display:flex;gap:8px;margin-top:4px;align-items:stretch">
      ${boxA ? `<div style="flex:1">${boxA}</div>` : ''}
      ${boxB ? `<div style="flex:1">${boxB}</div>` : ''}
    </div>`

  // Cada tramo real de transporte (Montero -> Piura, Piura -> destino
  // final, y cualquier tramo adicional que haya ocurrido -- no siempre son
  // exactamente 2, ver [[project_despacho_nacional_caes]]) es un registro
  // propio de Control de Unidad de Transporte (CUT), no un campo fijo --
  // se listan todos los que existan para este contenedor, en orden de
  // fecha. "Código de Control" es siempre el mismo código de formato fijo
  // (CAESP-PP-BPM-RE-CUT-001) -- lo que distingue cada instancia es su
  // fecha, igual que el papel real.
  const transporteRow = (control) => `
    <tr><td>${escapeHtml(control.lugar_partida) ?? '—'} → ${escapeHtml(control.lugar_destino) ?? '—'}</td>
        <td style="font-family:monospace;font-size:9px">CAESP-PP-BPM-RE-CUT-001</td>
        <td>${fmtDate(control.control_date)}</td>
        <td style="font-size:9px">${escapeHtml(control.guia_remision) ?? '—'}</td></tr>`

  // Filas del Control de Agua -- son los mismos monitoringEvents del bloque
  // de Cloro Residual CAES (ver controlAgua más arriba), mismo criterio de
  // resaltado fuera de rango que su propio documento (cloroResidualCaes.js).
  const aguaMonitoreoRow = (ev) => {
    const belowLimit = ev.result_ppm != null && (ev.result_ppm < CLORO_CAES_MIN_PPM || ev.result_ppm > CLORO_CAES_MAX_PPM)
    return `
    <tr><td style="text-align:center">${ev.event_time ?? '—'}</td>
        <td>${escapeHtml(ev.sampling_point) ?? ''}</td>
        <td style="text-align:right;font-weight:700;color:${belowLimit ? '#991b1b' : '#111'}">${ev.result_ppm != null ? fmtNum(ev.result_ppm) : '—'}</td>
        <td>${escapeHtml(ev.responsable_medicion) ?? ''}</td>
        <td>${escapeHtml(ev.corrective_action) ?? ''}</td></tr>`
  }

  // Una tabla por turno (Mañana/Tarde pueden traer código de formato
  // distinto, ver bloquesHigiene en fetchResumenTrazabilidadData) -- el
  // código va DENTRO del cuadro, como primera fila destacada, para que no
  // se pierda de vista cuál control respalda a cada lista de colaboradores.
  const bloqueHigieneHTML = (bloque) => `
    <table class="formato-table" style="width:100%;margin-bottom:6px">
      <tbody>
        <tr style="background:#eef2f7">
          <td colspan="2" style="font-size:11px;font-weight:800;padding:4px 6px">
            Turno: ${escapeHtml(bloque.turnoLabel)} &nbsp;·&nbsp; Código: <span style="font-family:monospace">${escapeHtml(bloque.codigo) ?? 'Sin código'}</span>
          </td>
        </tr>
        <tr><th style="text-align:left">Nombre</th><th style="text-align:left">Estado</th></tr>
        ${bloque.colaboradores.length === 0
          ? '<tr><td colspan="2" style="text-align:center">Sin colaboradores registrados</td></tr>'
          : bloque.colaboradores.map(c => `
        <tr><td>${escapeHtml(c.name)}</td>
            <td${c.itemsNoCorrecto.length > 0 ? ' style="color:#991b1b;font-weight:700"' : ''}>${c.itemsNoCorrecto.length > 0 ? `No correcto (${escapeHtml(c.itemsNoCorrecto.join(', '))})` : 'Correcto'}</td></tr>`).join('')}
      </tbody>
    </table>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('resumen_trazabilidad', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    .formato-table th { font-size: 9px; }
    .formato-table td { font-size: 10px; }
  </style>
</head>
<body>
  <table class="formato-table" style="width:100%;margin-bottom:2px">
    <tbody>
      <tr>
        <td style="width:80%;padding:6px 8px">
          <div style="font-size:9px;font-weight:700">REGISTRO:</div>
          <div style="font-size:13px;font-weight:800;text-transform:uppercase;margin-top:2px">${escapeHtml(headerTitulo)}</div>
        </td>
        <td rowspan="3" style="width:20%;text-align:center;vertical-align:middle;padding:6px">
          ${COOPERATIVE?.logo ? `<img src="${COOPERATIVE.logo}" alt="${escapeHtml(COOPERATIVE?.name)}" style="max-height:64px;max-width:100%"/>` : `<div style="font-size:11px;font-weight:700">${escapeHtml(COOPERATIVE?.name) ?? ''}</div>`}
        </td>
      </tr>
      <tr>
        <td style="padding:6px 8px">
          <div style="font-size:9px;font-weight:700">CÓDIGO:</div>
          <div style="font-family:monospace;font-size:10px;margin-top:2px">${headerCodigo}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:6px 8px">
          <div style="font-size:9px;font-weight:700">ÁREA:</div>
          <div style="font-size:10px;margin-top:2px">${headerArea}</div>
        </td>
      </tr>
    </tbody>
  </table>
  <div style="text-align:center;font-size:9px;color:#555;margin-bottom:6px">${escapeHtml(COOPERATIVE?.name) ?? ''} — ${esExportacion ? 'Exportación' : 'Venta nacional'}</div>

  <p class="section-label">Datos de la Orden y el ${LOTE_LABEL}</p>
  <table class="formato-table" style="width:100%">
    <tbody>
      <tr><td class="meta-label">Cliente</td><td>${clientName}</td>
          <td class="meta-label">N° ${LOTE_LABEL} a trazar</td><td>${loteLabel(batch)}</td></tr>
      <tr><td class="meta-label">N° de Venta</td><td>${order?.sale_number ?? '—'}</td>
          <td class="meta-label">N° Orden de Producción</td><td>${order?.client_order_number ?? order?.order_code ?? '—'}</td></tr>
      <tr><td class="meta-label">Formato/Presentación</td><td>${packagingLabel(batch)}</td>
          <td class="meta-label">Cantidad a Trazar</td><td>${fmtNum(loteKg(batch))} kg</td></tr>
      <tr><td class="meta-label">Fecha de Producción</td><td>${batch.envasado_registered_at ? fmtDate(batch.envasado_registered_at) : 'Sin registrar'}</td>
          <td class="meta-label">Certificación</td><td>${certText}</td></tr>
      ${esExportacion ? `<tr><td class="meta-label">Contenedor N°</td><td>${container?.container_number ?? order?.internal_container_number ?? '—'}</td>
          <td class="meta-label">N° BL</td><td>${container?.bill_of_lading ?? '—'}</td></tr>` : ''}
    </tbody>
  </table>

  <p class="section-label">${esExportacion ? 'Documentos de Exportación' : 'Documentos de Venta'}</p>
  <table class="formato-table" style="width:100%">
    <tbody>
      <tr><td class="meta-label">N° Packing List</td><td>${packingListNumero ?? 'Sin registrar'}</td>
          <td class="meta-label">Factura Comercial</td><td>${container?.extra_data?.factura_comercial ?? 'Sin registrar'}</td></tr>
      <tr><td class="meta-label">N° Certificado de Transacción (TC)</td><td>${container?.extra_data?.certificado_transaccion ?? 'Sin registrar'}</td>
          ${esExportacion ? `<td class="meta-label">N° Booking</td><td>${container?.booking_number ?? 'Sin registrar'}</td>` : '<td></td><td></td>'}</tr>
      ${esExportacion ? `<tr><td class="meta-label">Certificado de Origen</td><td>${container?.extra_data?.certificado_origen ?? 'Sin registrar'}</td>
          <td class="meta-label">Carta de Rendimiento del Azúcar</td><td>${container?.extra_data?.carta_rendimiento_azucar ?? 'Sin registrar'}</td></tr>` : ''}
    </tbody>
  </table>

  <p class="section-label">Control de Análisis y Almacén (Producto Terminado)</p>
  ${sideBySide(`
    <table class="formato-table" style="width:100%;height:100%">
      <tbody>
        <tr><td colspan="2" style="background:#eef2f7;font-weight:800;font-size:9px;text-transform:uppercase">Control de Análisis</td></tr>
        <tr><td class="meta-label">% Humedad</td><td style="text-align:right">${batch.calidad_humedad_pct != null ? fmtNum(batch.calidad_humedad_pct) : 'Sin registrar'}</td></tr>
        <tr><td class="meta-label">% Impurezas insolubles</td><td style="text-align:right">${batch.calidad_impurezas_pct != null ? fmtNum(batch.calidad_impurezas_pct) : 'Sin registrar'}</td></tr>
      </tbody>
    </table>`, `
    <table class="formato-table" style="width:100%;height:100%">
      <tbody>
        <tr><td colspan="2" style="background:#eef2f7;font-weight:800;font-size:9px;text-transform:uppercase">Temperatura y Humedad de Almacén PT</td></tr>
        <tr><td class="meta-label">Fecha</td><td>${tempHumedadAlmacen?.fecha ? fmtDate(tempHumedadAlmacen.fecha) : 'Sin registro en el período'}</td></tr>
        <tr><td class="meta-label">Temperatura (°C)</td><td style="text-align:right">${tempHumedadAlmacen?.temperaturaC != null ? fmtNum(tempHumedadAlmacen.temperaturaC) : 'Sin registrar'}</td></tr>
        <tr><td class="meta-label">Humedad relativa (%)</td><td style="text-align:right">${tempHumedadAlmacen?.humedadPct != null ? fmtNum(tempHumedadAlmacen.humedadPct) : 'Sin registrar'}</td></tr>
      </tbody>
    </table>`)}

  <p class="section-label">Producto Terminado</p>
  ${sideBySide(
    codigoFechaBox('Control y Liberación de Producto Terminado', referencias?.liberacionProductoTerminado),
    codigoFechaBox('Control de Sellado, Envasado y Empaque', referencias?.selladoEnvasadoEmpaque),
  )}

  <p class="section-label">Control de Transporte</p>
  <table class="formato-table" style="width:100%">
    <thead><tr><th style="text-align:left">Tramo</th><th>Código de Control</th><th>Fecha</th><th>N° Guías de Transporte</th></tr></thead>
    <tbody>
      <tr><td>Materia prima (centro de proceso → planta de envasado)</td><td>—</td><td></td><td style="font-size:9px">${materiaPrimaGuiasTexto}</td></tr>
      ${(transportControls ?? []).length === 0
        ? '<tr><td colspan="4" style="text-align:center">Sin controles de unidad de transporte registrados</td></tr>'
        : transportControls.map(transporteRow).join('')}
    </tbody>
  </table>
  ${despachoTemperaturaC != null || despachoHumedadPct != null ? `<p style="font-size:9px;margin:2px 0 0;color:#555">
    Informativo -- ${despachoTemperaturaC != null ? `Temperatura al cargar: ${fmtNum(despachoTemperaturaC)}°C` : ''}${despachoTemperaturaC != null && despachoHumedadPct != null ? ' · ' : ''}${despachoHumedadPct != null ? `Humedad relativa al cargar: ${fmtNum(despachoHumedadPct)}%` : ''}
  </p>` : ''}

  <p class="section-label">Control de Materia Prima — Panela</p>
  <table class="formato-table">
    <thead>
      <tr>
        <th style="text-align:left">Proveedor (productor)</th>
        <th>Cantidad (Kg)</th>
        <th>Fecha de Producción</th>
        <th>Fecha de Acopio</th>
        <th>N° Guía de Recepción</th>
        <th>N° Comprobante de Acopio</th>
      </tr>
    </thead>
    <tbody>${materiaPrimaRows || `<tr><td colspan="6" style="text-align:center">Sin datos de materia prima para este ${LOTE_LABEL_LOWER}</td></tr>`}</tbody>
    <tfoot>
      <tr><td style="text-align:right">Total:</td><td style="text-align:right">${fmtNum(totalMateriaPrimaKg)}</td><td colspan="4"></td></tr>
    </tfoot>
  </table>

  <p class="section-label">Colaboradores presentes (Control de Higiene)</p>
  ${(bloquesHigiene ?? []).length === 0
    ? '<p style="font-size:10px;margin:0 0 10px">Sin registro en el período</p>'
    : bloquesHigiene.map(bloqueHigieneHTML).join('')}

  <p class="section-label">Control de Agua</p>
  <p style="font-size:9px;margin:0 0 4px;color:#555">Monitoreo de Cloro Residual del control más reciente en el período${controlAgua?.codigo ? ` — Código: ${controlAgua.codigo}` : ''}${controlAgua?.fecha ? ` · Fecha: ${fmtDate(controlAgua.fecha)}` : ''}.</p>
  <table class="formato-table" style="width:100%">
    <thead><tr><th>Hora</th><th style="text-align:left">Punto de muestreo</th><th>Resultado (ppm)</th><th style="text-align:left">Responsable</th><th style="text-align:left">Acciones correctivas</th></tr></thead>
    <tbody>
      ${!controlAgua ? '<tr><td colspan="5" style="text-align:center">Sin registro en el período</td></tr>'
        : controlAgua.eventos.length === 0 ? '<tr><td colspan="5" style="text-align:center">Sin mediciones registradas ese día</td></tr>'
        : controlAgua.eventos.map(aguaMonitoreoRow).join('')}
    </tbody>
  </table>

  <p class="section-label">Limpieza y Sanitización</p>
  ${sideBySide(
    codigoFechaBox('Control de Limpieza', referencias?.controlLimpieza),
    codigoFechaBox(verificacionLimpiezaLabel, referencias?.verificacionLimpieza),
  )}

  <p class="section-label">Control de Plagas</p>
  ${sideBySide(
    codigoFechaBox('Monitoreo de Trampas Mecánicas', referencias?.monitoreoTrampasMecanicas),
    codigoFechaBox('Monitoreo de Insectocutores', referencias?.monitoreoInsectocutores),
  )}

  <div class="formato-firmas">${firmasHTML}</div>
</body>
</html>`
}

export function resumenTrazabilidadPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLResumenTrazabilidad(order, containerNumber, data, firmantes)
}

export function resumenTrazabilidadExcel(order, containerNumber, data) {
  const { batch, materiaPrima, materiaPrimaGuias, container, referencias, tipo, packingListNumero, transportControls, certNames, bloquesHigiene, controlAgua, tempHumedadAlmacen, despachoTemperaturaC, despachoHumedadPct } = data
  const esExportacion = tipo === 'exportacion'
  const aoa = [
    ['RESUMEN DE TRAZABILIDAD', esExportacion ? '(Exportación)' : '(Nacional)'],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    ...(esExportacion ? [['Contenedor:', container?.container_number ?? order?.internal_container_number ?? '']] : []),
    ['N° de Venta:', order?.sale_number ?? ''],
    ['N° Orden Producción:', order?.client_order_number ?? order?.order_code ?? ''],
    [`N° ${LOTE_LABEL} a trazar:`, loteLabel(batch)],
    ['Formato/Presentación:', packagingLabel(batch)],
    ['Fecha de Producción:', batch.envasado_registered_at ?? ''],
    ['Cantidad a Trazar (Kg):', loteKg(batch)],
    ['Certificación:', (certNames ?? []).join(' - ')],
    ...(esExportacion ? [['N° BL:', container?.bill_of_lading ?? '']] : []),
    [],
    ['CONTROL DE ANÁLISIS'],
    ['% Humedad', batch.calidad_humedad_pct ?? ''],
    ['% Impurezas insolubles', batch.calidad_impurezas_pct ?? ''],
    [],
    ['CONTROL DE TEMPERATURA Y HUMEDAD DE ALMACÉN', tempHumedadAlmacen?.fecha ? `Fecha: ${tempHumedadAlmacen.fecha}` : ''],
    ['Temperatura (°C)', tempHumedadAlmacen?.temperaturaC ?? ''],
    ['Humedad relativa (%)', tempHumedadAlmacen?.humedadPct ?? ''],
    [],
    ['DOCUMENTOS' + (esExportacion ? ' DE EXPORTACIÓN' : ' DE VENTA')],
    ['N° Packing List', packingListNumero ?? ''],
    ['Factura Comercial', container?.extra_data?.factura_comercial ?? ''],
    ['N° Certificado de Transacción', container?.extra_data?.certificado_transaccion ?? ''],
    ...(esExportacion ? [
      ['N° BL', container?.bill_of_lading ?? ''],
      ['N° Booking', container?.booking_number ?? ''],
      ['Certificado de Origen', container?.extra_data?.certificado_origen ?? ''],
      ['Carta de Rendimiento del Azúcar', container?.extra_data?.carta_rendimiento_azucar ?? ''],
    ] : []),
    [],
    ['CONTROL DE TRANSPORTE'],
    ['Tramo', 'Código de Control', 'Fecha', 'N° Guía de Transporte'],
    ['Materia prima (centro de proceso → planta de envasado)', '', '', materiaPrimaGuias.map(g => g.guia_remision).join(', ')],
    ...(transportControls ?? []).map(c => [
      `${c.lugar_partida ?? '—'} → ${c.lugar_destino ?? '—'}`, 'CAESP-PP-BPM-RE-CUT-001', c.control_date ?? '', c.guia_remision ?? '',
    ]),
    ['Temperatura al cargar (°C) [informativo]', despachoTemperaturaC ?? ''],
    ['Humedad relativa al cargar (%) [informativo]', despachoHumedadPct ?? ''],
    [],
    ['REFERENCIAS', 'Código', 'Fecha del registro más reciente en el rango de la orden'],
    ['Control y Liberación de Producto Terminado', referencias.liberacionProductoTerminado?.codigo ?? '', referencias.liberacionProductoTerminado?.fecha ?? ''],
    ['Control de Sellado, Envasado y Empaque de Producto Terminado', referencias.selladoEnvasadoEmpaque?.codigo ?? '', referencias.selladoEnvasadoEmpaque?.fecha ?? ''],
    ['Control de Higiene del Personal', referencias.higiene?.codigo ?? '', referencias.higiene?.fechaLabel ?? referencias.higiene?.fecha ?? ''],
    [],
    ['COLABORADORES PRESENTES (HIGIENE)'],
    ...((bloquesHigiene ?? []).length === 0
      ? [['Sin registro en el período']]
      : bloquesHigiene.flatMap(bloque => [
          [`Turno: ${bloque.turnoLabel}`, 'Código:', bloque.codigo ?? ''],
          ['Nombre', 'Estado'],
          ...(bloque.colaboradores.length === 0
            ? [['Sin colaboradores registrados', '']]
            : bloque.colaboradores.map(c => [
                c.name, c.itemsNoCorrecto.length > 0 ? `No correcto (${c.itemsNoCorrecto.join(', ')})` : 'Correcto',
              ])),
          [],
        ])),
    ['Control de Limpieza', referencias.controlLimpieza?.codigo ?? '', referencias.controlLimpieza?.fechaLabel ?? referencias.controlLimpieza?.fecha ?? ''],
    ['Verificación de Limpieza y Sanitización', referencias.verificacionLimpieza?.codigo ?? '', referencias.verificacionLimpieza?.fecha ?? ''],
    ['Monitoreo de Trampas Mecánicas (Plagas)', referencias.monitoreoTrampasMecanicas?.codigo ?? '', referencias.monitoreoTrampasMecanicas?.fecha ?? ''],
    ['Monitoreo de Insectocutores (Plagas)', referencias.monitoreoInsectocutores?.codigo ?? '', referencias.monitoreoInsectocutores?.fecha ?? ''],
    [],
    ['CONTROL DE AGUA', controlAgua?.codigo ? `Código: ${controlAgua.codigo}` : ''],
    ['Fecha', controlAgua?.fecha ?? ''],
    ['Hora', 'Punto de muestreo', 'Resultado (ppm)', 'Responsable', 'Acciones correctivas'],
    ...(controlAgua?.eventos ?? []).map(ev => [
      ev.event_time ?? '', ev.sampling_point ?? '', ev.result_ppm ?? '', ev.responsable_medicion ?? '', ev.corrective_action ?? '',
    ]),
    [],
    ['CONTROL DE MATERIA PRIMA'],
    ['Productor', 'Cantidad (Kg)', 'Fecha de Producción', 'Fecha de Acopio', 'N° Guía de Recepción', 'N° Comprobante de Acopio'],
    ...materiaPrima.map(r => [
      r.producer_name ?? '—', Number(r.kg ?? 0).toFixed(2), r.fecha_produccion ?? '—', r.fecha_acopio ?? '—',
      r.guia_remision ?? '—', r.comprobante_acopio ?? '—',
    ]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, esExportacion ? 'Trazabilidad Exportación' : 'Trazabilidad Nacional')
  XLSX.writeFile(wb, `${quickDocFileName('resumen_trazabilidad', order, containerNumber)}.xlsx`)
}
