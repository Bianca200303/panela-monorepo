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
import { fetchControlSaludHigienePersonalData } from './saludHigienePersonal'
import { fetchControlVerificacionLimpiezaData } from '@panela/core/lib/formatos/verificacionLimpieza'
import { fetchControlCloroResidualData } from './cloroResidual'
import { fetchControlPlagasData } from './controlPlagas'

export const FORMAT_TITLE_RESUMEN_TRAZABILIDAD = 'RESUMEN DE TRAZABILIDAD'

// Copia SOLO Norandino de este documento (originalmente compartido, ver
// plan de migración a monorepo) -- Norandino nunca tiene
// higieneGrillaMensual/cloroPreparacionMonitoreo/plagasEventosMensuales/
// limpiezaUnificada/controlesPlantaCAES/ventaNacionalExportacion (todos
// false), así que se sacaron los ternarios/ramas de CAES (que ya no
// existen en esta app) y se dejó directo la rama Norandino -- incluye el
// único campo que CAES no tiene (ambientesEquipoPersonal, el 3er
// sub-control de Plagas) y siempre trata la orden como Exportación
// (Norandino no vende nacional, no hay selector de tipo).
//
// Resumen POR LOTE (no por orden) de datos que ya existen en otros controles
// del sistema. Las referencias (higiene, verificación de limpieza, cloro
// residual, plagas) muestran solo la FECHA del control más reciente dentro
// del rango de la orden -- esos controles no tienen un código de formato
// propio cargado en el sistema, así que no se inventa uno.
//
// A diferencia de todo lo demás (siempre por ORDEN), este documento es por
// LOTE: la fecha de producción, el análisis de calidad y la materia prima
// pueden variar entre lotes de una misma orden, así que "por orden" pierde
// trazabilidad apenas hay más de un lote. Si la orden tiene más de un lote,
// el modal pide elegir cuál se está trazando (needsLoteSelector, ver
// QuickDocsModal.jsx) -- con un solo lote se autoselecciona sin pedir nada.
export async function fetchResumenTrazabilidadData(order, kgPerQuintal, selectedBatch) {
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
  // para Inspección de Ambientes/Equipo/Personal y Control de Plagas, que
  // pueden coincidir en cualquier momento de ese ciclo completo, no solo el
  // día exacto de producción (a diferencia de Higiene/Cloro/Verificación,
  // que sí exigen la fecha exacta -- ver
  // [[project_resumen_trazabilidad_fechas_por_control]]). Si la orden
  // todavía no tiene fecha de despacho (no se despachó), cae de respaldo en
  // fechaHasta (fin de envasado) en vez de quedar abierto, para que el
  // reporte generado ANTES del despacho no muestre todo vacío.
  const fechaHastaDespacho = order?.fecha_envio ?? fechaHasta

  const [materiaPrimaAll, higiene, verificacion, cloro, plagas, containerCtx, cargaRes, certNames, selladoEnvasadoRes, tempHumedadAlmacenRes, dispatchRes] = await Promise.all([
    fetchRawMaterialInputsForOrder(order.id),
    fetchControlSaludHigienePersonalData(order, { desde: fechaProduccionLote, hasta: fechaProduccionLote }),
    fetchControlVerificacionLimpiezaData(COOPERATIVE, order, { desde: fechaDesde, hasta: fechaHastaDespacho }),
    fetchControlCloroResidualData(order, { desde: fechaProduccionLote, hasta: fechaProduccionLote }),
    fetchControlPlagasData(order, { desde: fechaDesde, hasta: fechaHastaDespacho }),
    order?.container_id ? resolveContainerContext(COOPERATIVE, order) : Promise.resolve(null),
    !order?.container_id
      ? Promise.resolve({ data: null })
      : supabase.from('plant_container_loadings').select('documento_number').eq('container_id', order.container_id).maybeSingle(),
    fetchOrderCertNames(order.id),
    // Norandino no tiene "Control de Sellado, Envasado y Empaque" real (es
    // un control de CAES, Fase 2) -- se aproxima con Control de Pesos y
    // Sellado (COA-PPA-GCA-RG-005), que es lo más parecido que existe acá.
    // Sigue sin código de formato propio (esa tabla no lo guarda).
    supabase.from('plant_batch_weight_seal_forms').select('control_date').eq('plant_batch_id', batch.id).order('control_date', { ascending: false }).limit(1).maybeSingle(),
    // Temperatura/Humedad de "Almacén de Producto Terminado" -- mismo
    // origen que la versión CAES (RMP-003, plant_temp_humidity_control_caes)
    // porque nunca se armó un control equivalente propio de Norandino para
    // esto -- si no hay fila (caso normal hoy), la sección queda "Sin
    // registrar" en vez de romper.
    fechaProduccionLote
      ? supabase
          .from('plant_temp_humidity_control_caes')
          .select('control_date, t_promedio, hr_promedio')
          .eq('ubicacion', 'Almacén de Producto Terminado')
          .eq('control_date', fechaProduccionLote)
          .maybeSingle()
      : Promise.resolve({ data: null }),
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
  // productor/viaje), así que se derivan de ahí en vez de inventar un rango
  // único.
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

  // Cada control ya existente se cruza dentro del mismo rango de fechas de
  // la orden -- se muestra el registro más reciente encontrado en ese
  // rango, con su código propio (formato_codigo, generado al guardar cada
  // control) y su fecha.
  const lastBlock = (blocks, dateField) => {
    if (blocks.length === 0) return null
    return [...blocks].sort((a, b) => (a[dateField] ?? '').localeCompare(b[dateField] ?? '')).slice(-1)[0]
  }
  const refFromBlock = (block, dateField) =>
    block ? { fecha: block[dateField], codigo: block.codigo ?? null } : null
  const lastBlockWithData = (blocks, hasDataFn, dateField) => {
    const withData = blocks.filter(hasDataFn).sort((a, b) => (a[dateField] ?? '').localeCompare(b[dateField] ?? ''))
    return withData.slice(-1)[0] ?? null
  }

  // Colaboradores presentes: el papel lista los nombres del control de
  // higiene, no solo su fecha. Norandino es 1 control por fecha+turno+área
  // (roster con asistencia), con la fecha EXACTA de producción del lote (no
  // un rango, ver [[project_resumen_trazabilidad_fechas_por_control]]).
  const ultimoBloqueHigiene = lastBlock(higiene.blocks, 'fecha')
  const colaboradoresHigiene = (ultimoBloqueHigiene?.workers ?? []).filter(w => w.attended).map(w => w.name)
  const bloquesHigiene = ultimoBloqueHigiene
    ? [{
        turnoLabel: ultimoBloqueHigiene.turno === 'tarde' ? 'Tarde' : 'Mañana',
        codigo: ultimoBloqueHigiene.codigo ?? null,
        colaboradores: colaboradoresHigiene.map(name => ({ name, itemsNoCorrecto: [] })),
      }]
    : []

  // Plagas en el papel son 3 controles separados con su propia fecha
  // (Monitoreo Trampas Mecánicas, Inspección de Ambientes/Equipo/Personal,
  // Monitoreo Insectocutores). Norandino modela los 3 dentro del mismo
  // plant_pest_controls -- los primeros 2 en sub-tablas (roedores/luz), el
  // 3ro en 2 columnas del propio control
  // (ambientes_equipo_personal_ok/observaciones); los 3 comparten el mismo
  // formato_codigo porque son el mismo registro.
  const bloqueTrampasMecanicasRaw = lastBlockWithData(
    plagas.blocks, b => Object.keys(b.rodentByDevice ?? {}).length > 0, 'controlDate')
  const bloqueInsectocutoresRaw = lastBlockWithData(
    plagas.blocks, b => Object.keys(b.lightByTrap ?? {}).length > 0, 'controlDate')
  const bloqueAmbientesEquipoPersonal = lastBlockWithData(
    plagas.blocks, b => !!b.ambientesEquipoPersonalOk, 'controlDate')
  const bloqueTrampasMecanicas = refFromBlock(bloqueTrampasMecanicasRaw, 'controlDate')
  const bloqueInsectocutores = refFromBlock(bloqueInsectocutoresRaw, 'controlDate')
  const ambientesEquipoPersonal = bloqueAmbientesEquipoPersonal
    ? { fecha: bloqueAmbientesEquipoPersonal.controlDate, codigo: bloqueAmbientesEquipoPersonal.codigo ?? null, estado: bloqueAmbientesEquipoPersonal.ambientesEquipoPersonalOk }
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
    tipo: 'exportacion',
    batch: { ...batch, ...batchData, envasado_registered_at: fechaProduccionLote },
    fechaProduccionLote,
    materiaPrima,
    materiaPrimaGuias,
    container: containerCtx?.container ?? null,
    packingListNumero: cargaRes?.data?.documento_number ?? null,
    transportControls: [],
    despachoTemperaturaC: dispatchRes?.data?.temperature_at_load ?? null,
    despachoHumedadPct: dispatchRes?.data?.humidity_at_load ?? null,
    controlAgua: null,
    tempHumedadAlmacen,
    certNames,
    fechaDesde,
    fechaHasta,
    colaboradoresHigiene,
    higieneIncidencias: [],
    bloquesHigiene,
    referencias: {
      higiene:                     ultimoBloqueHigiene,
      verificacionLimpieza:        refFromBlock(lastBlock(verificacion.blocks, 'controlDate'), 'controlDate'),
      cloroResidual:               refFromBlock(lastBlock(cloro.blocks, 'controlDate'), 'controlDate'),
      monitoreoTrampasMecanicas:   bloqueTrampasMecanicas,
      monitoreoInsectocutores:     bloqueInsectocutores,
      ambientesEquipoPersonal,
      controlLimpieza:             null,
      // Norandino (plant_batch_weight_seal_forms) sigue sin código propio.
      liberacionProductoTerminado: { fecha: fechaLiberacion, codigo: batchData?.liberacion_formato_codigo ?? null },
      selladoEnvasadoEmpaque:      { fecha: selladoEnvasadoRes?.data?.control_date ?? null, codigo: null },
    },
  }
}

export function buildPrintHTMLResumenTrazabilidad(order, containerNumber, data, firmantes) {
  const { batch, materiaPrima, materiaPrimaGuias, container, referencias, packingListNumero, certNames, bloquesHigiene, tempHumedadAlmacen, despachoTemperaturaC, despachoHumedadPct } = data
  const clientName = escapeHtml(order?.plant_clients?.name) ?? '—'
  const certText = certNames?.length > 0 ? escapeHtml(certNames.join(' - ').toUpperCase()) : '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  // Sin papel de referencia físico conocido para Norandino en este
  // documento -- mismo estilo de caja que CAES, pero sin código/área
  // inventados.
  const headerTitulo = FORMAT_TITLE_RESUMEN_TRAZABILIDAD
  const headerCodigo = '—'
  const headerArea = '—'

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

  const referenciaRow = (label, ref, extra = '') => `
    <tr><td>${label}</td>
        <td style="font-family:monospace;white-space:nowrap">${ref?.codigo ?? '—'}</td>
        <td style="text-align:center">${ref?.fechaLabel ?? (ref?.fecha ? `${fmtDate(ref.fecha)}${extra}` : 'Sin registro en el período')}</td></tr>`

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

  // Una tabla por turno (mismo helper que CAES, acá siempre va a haber como
  // mucho 1 bloque -- ver bloquesHigiene arriba).
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
  <div style="text-align:center;font-size:9px;color:#555;margin-bottom:6px">${escapeHtml(COOPERATIVE?.name) ?? ''} — Exportación</div>

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
      <tr><td class="meta-label">Contenedor N°</td><td>${container?.container_number ?? order?.internal_container_number ?? '—'}</td>
          <td class="meta-label">N° BL</td><td>${container?.bill_of_lading ?? '—'}</td></tr>
    </tbody>
  </table>

  <p class="section-label">Documentos de Exportación</p>
  <table class="formato-table" style="width:100%">
    <tbody>
      <tr><td class="meta-label">N° Packing List</td><td>${packingListNumero ?? 'Sin registrar'}</td>
          <td class="meta-label">Factura Comercial</td><td>${container?.extra_data?.factura_comercial ?? 'Sin registrar'}</td></tr>
      <tr><td class="meta-label">N° Certificado de Transacción (TC)</td><td>${container?.extra_data?.certificado_transaccion ?? 'Sin registrar'}</td>
          <td class="meta-label">N° Booking</td><td>${container?.booking_number ?? 'Sin registrar'}</td></tr>
      <tr><td class="meta-label">Certificado de Origen</td><td>${container?.extra_data?.certificado_origen ?? 'Sin registrar'}</td>
          <td class="meta-label">Carta de Rendimiento del Azúcar</td><td>${container?.extra_data?.carta_rendimiento_azucar ?? 'Sin registrar'}</td></tr>
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

  <p class="section-label">Limpieza y Sanitización</p>
  ${sideBySide(
    '',
    codigoFechaBox('Verificación del Programa de Limpieza y Sanitización', referencias?.verificacionLimpieza),
  )}

  <p class="section-label">Control de Plagas</p>
  ${sideBySide(
    codigoFechaBox('Monitoreo de Trampas Mecánicas', referencias?.monitoreoTrampasMecanicas),
    codigoFechaBox('Monitoreo de Insectocutores', referencias?.monitoreoInsectocutores),
  )}
  <table class="formato-table" style="width:100%;margin-top:4px">
    <tbody>
      ${referenciaRow('Inspección de Ambientes, Equipo y Personal (Plagas)', referencias?.ambientesEquipoPersonal, referencias?.ambientesEquipoPersonal?.estado === 'no_correcto' ? ' — NO CORRECTO' : '')}
      ${referenciaRow('Control de Cloro Residual', referencias?.cloroResidual)}
    </tbody>
  </table>

  <div class="formato-firmas">${firmasHTML}</div>
</body>
</html>`
}

export function resumenTrazabilidadPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLResumenTrazabilidad(order, containerNumber, data, firmantes)
}

export function resumenTrazabilidadExcel(order, containerNumber, data) {
  const { batch, materiaPrima, materiaPrimaGuias, container, referencias, packingListNumero, certNames, bloquesHigiene, tempHumedadAlmacen, despachoTemperaturaC, despachoHumedadPct } = data
  const aoa = [
    ['RESUMEN DE TRAZABILIDAD', '(Exportación)'],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    ['Contenedor:', container?.container_number ?? order?.internal_container_number ?? ''],
    ['N° de Venta:', order?.sale_number ?? ''],
    ['N° Orden Producción:', order?.client_order_number ?? order?.order_code ?? ''],
    [`N° ${LOTE_LABEL} a trazar:`, loteLabel(batch)],
    ['Formato/Presentación:', packagingLabel(batch)],
    ['Fecha de Producción:', batch.envasado_registered_at ?? ''],
    ['Cantidad a Trazar (Kg):', loteKg(batch)],
    ['Certificación:', (certNames ?? []).join(' - ')],
    ['N° BL:', container?.bill_of_lading ?? ''],
    [],
    ['CONTROL DE ANÁLISIS'],
    ['% Humedad', batch.calidad_humedad_pct ?? ''],
    ['% Impurezas insolubles', batch.calidad_impurezas_pct ?? ''],
    [],
    ['CONTROL DE TEMPERATURA Y HUMEDAD DE ALMACÉN', tempHumedadAlmacen?.fecha ? `Fecha: ${tempHumedadAlmacen.fecha}` : ''],
    ['Temperatura (°C)', tempHumedadAlmacen?.temperaturaC ?? ''],
    ['Humedad relativa (%)', tempHumedadAlmacen?.humedadPct ?? ''],
    [],
    ['DOCUMENTOS DE EXPORTACIÓN'],
    ['N° Packing List', packingListNumero ?? ''],
    ['Factura Comercial', container?.extra_data?.factura_comercial ?? ''],
    ['N° Certificado de Transacción', container?.extra_data?.certificado_transaccion ?? ''],
    ['N° BL', container?.bill_of_lading ?? ''],
    ['N° Booking', container?.booking_number ?? ''],
    ['Certificado de Origen', container?.extra_data?.certificado_origen ?? ''],
    ['Carta de Rendimiento del Azúcar', container?.extra_data?.carta_rendimiento_azucar ?? ''],
    [],
    ['CONTROL DE TRANSPORTE'],
    ['Tramo', 'Código de Control', 'Fecha', 'N° Guía de Transporte'],
    ['Materia prima (centro de proceso → planta de envasado)', '', '', materiaPrimaGuias.map(g => g.guia_remision).join(', ')],
    ['Temperatura al cargar (°C) [informativo]', despachoTemperaturaC ?? ''],
    ['Humedad relativa al cargar (%) [informativo]', despachoHumedadPct ?? ''],
    [],
    ['REFERENCIAS', 'Código', 'Fecha del registro más reciente en el rango de la orden'],
    ['Control y Liberación de Producto Terminado', referencias.liberacionProductoTerminado?.codigo ?? '', referencias.liberacionProductoTerminado?.fecha ?? ''],
    ['Control de Sellado, Envasado y Empaque de Producto Terminado', referencias.selladoEnvasadoEmpaque?.codigo ?? '', referencias.selladoEnvasadoEmpaque?.fecha ?? ''],
    ['Control de Higiene del Personal', referencias.higiene?.codigo ?? '', referencias.higiene?.fecha ?? ''],
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
    ['Verificación de Limpieza y Sanitización', referencias.verificacionLimpieza?.codigo ?? '', referencias.verificacionLimpieza?.fecha ?? ''],
    ['Control de Cloro Residual', referencias.cloroResidual?.codigo ?? '', referencias.cloroResidual?.fecha ?? ''],
    ['Monitoreo de Trampas Mecánicas (Plagas)', referencias.monitoreoTrampasMecanicas?.codigo ?? '', referencias.monitoreoTrampasMecanicas?.fecha ?? ''],
    ['Monitoreo de Insectocutores (Plagas)', referencias.monitoreoInsectocutores?.codigo ?? '', referencias.monitoreoInsectocutores?.fecha ?? ''],
    ['Inspección de Ambientes, Equipo y Personal (Plagas)', referencias.ambientesEquipoPersonal?.codigo ?? '',
      referencias.ambientesEquipoPersonal ? `${referencias.ambientesEquipoPersonal.fecha}${referencias.ambientesEquipoPersonal.estado === 'no_correcto' ? ' (no correcto)' : ''}` : ''],
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
  XLSX.utils.book_append_sheet(wb, ws, 'Trazabilidad Exportación')
  XLSX.writeFile(wb, `${quickDocFileName('resumen_trazabilidad', order, containerNumber)}.xlsx`)
}
