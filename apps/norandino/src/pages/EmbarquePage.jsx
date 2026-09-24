import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { loadFormConfigs, splitFixedAndExtra, loadKgPerQuintal } from '@panela/core/lib/formConfig'
import DynamicForm, { validateDynamicForm, getInitialValues } from '@panela/core/components/DynamicForm'
import { downloadPdfDocument } from '@panela/core/lib/pdfDownload'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { fetchOrdenSalidaRows, ordenSalidaPdf } from '@panela/core/lib/formatos/ordenSalida'
import { QUICK_DOCS } from '../lib/formatos'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { loteKg, loteLabel, loteBunques, isOrderNacional, BUNQUE_ALLOCATIONS_SELECT } from '@panela/core/lib/loteHelpers'
import { getLoteLabelLower, getLoteLabelPluralLower } from '@panela/core/lib/labels'

const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE)
import ContainerLoadingModal from '@panela/core/pages/ContainerLoadingModal'
// Sin Packing List-Nacional ni Control de Unidad de Transporte -- son
// documentos SOLO CAES (ver COOPERATIVE.features.ventaNacionalExportacion,
// siempre false acá), esos 2 archivos ni existen en esta app.
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import SearchFilterBar from '@panela/core/components/SearchFilterBar'
import QuickDocsModal from '@panela/core/components/QuickDocsModal'
import OrderNumberField from '@panela/core/components/OrderNumberField'
import EmbarqueCard from '@panela/core/pages/EmbarqueCard'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import ContainerCard from '@panela/core/pages/ContainerCard'
import InformeOrden from '@panela/core/pages/InformeOrden'
import PdfHeaderModal from '@panela/core/pages/PdfHeaderModal'

// Página de Embarque -- separada de OrdenesPage.jsx (2026-08-01): la orden
// nace y se trabaja en /ordenes (producción) hasta que se marca "Completar
// orden"; recién ahí pasa a vivir aquí (status = 'completado'). Antes de eso
// nunca tiene container_id, así que esta página puede cargar SOLO órdenes
// completadas, sin necesidad de compartir un hook de carga con /ordenes.
// Ver [[project_separacion_ordenes_embarque]] en memoria para el detalle
// completo de qué se movió y por qué.


// Columnas fijas en la tabla (lo demás va a extra_data)
const CONTAINER_FIXED_COLS = [
  'container_number', 'seal_number', 'container_size', 'max_capacity_kg',
  'booking_number', 'bill_of_lading', 'shipping_line', 'destination_port',
  'departure_date', 'estimated_arrival',
]
// total_loaded_kg NO va aquí -- es derivado (trigger recalc_dispatch_total_kg
// sobre plant_dispatch_items), nunca se escribe desde el cliente.
const DISPATCH_FIXED_COLS = [
  'dispatch_date', 'seal_verified',
  'temperature_at_load', 'humidity_at_load', 'notes',
]

// El step "contenedor" de CAES trae UNA sola lista con los campos de
// exportación (booking, BL, naviera, puerto, vessel, fechas, certificado de
// origen, carta de rendimiento), porque hoy se guardan en la misma fila de
// plant_containers sin importar el tipo de venta. Se filtran acá según
// order.sale_type para no mostrarle a una venta Nacional campos de embarque
// marítimo que no le aplican -- los campos compartidos (factura comercial,
// certificado de transacción) se muestran en los dos casos. N° Packing
// List y los códigos/guías de transporte YA NO viven acá -- se movieron a
// plant_packing_list_nacional_caes y plant_transport_unit_controls_caes
// (ver PackingListNacionalCaesModal.jsx/TransportUnitControlsCaesModal.jsx
// y migración 20260916140000).
const CAES_EXPORT_ONLY_KEYS = [
  'container_number', 'seal_number', 'precinto_aduana', 'container_size', 'max_capacity_kg',
  'booking_number', 'bill_of_lading', 'shipping_line', 'vessel', 'destination_port',
  'departure_date', 'estimated_arrival', 'certificado_origen', 'carta_rendimiento_azucar',
]

function containerFieldsForOrder(fields, order) {
  if (!COOPERATIVE?.features?.ventaNacionalExportacion) return fields
  if (!isOrderNacional(COOPERATIVE, order)) return fields
  return fields.filter(f => !CAES_EXPORT_ONLY_KEYS.includes(f.key))
}

async function generateDispatchCode() {
  const year = new Date().getFullYear()
  const prefix = (COOPERATIVE.code ?? 'ORG').slice(0, 4).toUpperCase()
  const { count } = await supabase
    .from('plant_dispatches')
    .select('id', { count: 'exact', head: true })
    .eq('cooperative_id', COOPERATIVE.id)
    .gte('created_at', `${year}-01-01`)
  const seq = String((count ?? 0) + 1).padStart(3, '0')
  return `DS-${prefix}-${year}-${seq}`
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function EmbarquePage() {
  const webUser = useAuthStore((s) => s.webUser)

  const [orders, setOrders]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [kgPerQuintal, setKgPerQuintal] = useState(50)
  const [searchQuery, setSearchQuery]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // "Lista para embarque" y "En contenedor" ahora son pestañas (antes iban
  // lado a lado en la misma pantalla) -- cada una a pantalla completa.
  const [searchParams, setSearchParams] = useSearchParams()
  const [pageTab, setPageTab] = useState(searchParams.get('tab') ?? 'lista')
  function selectPageTab(tab) {
    setPageTab(tab)
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('tab', tab); return next })
  }

  // Modal: contenedor
  const [modalContainer, setModalContainer] = useState(null) // { order, existing }
  const [formContainer, setFormContainer]   = useState({})
  const [containerFields, setContainerFields] = useState([])

  // Modal: despacho
  const [modalDispatch, setModalDispatch] = useState(null) // { order, container }
  const [formDispatch, setFormDispatch]   = useState({})
  const [dispatchFields, setDispatchFields] = useState([])
  // Kg despachados por lote (plant_dispatch_items) -- uno por cada lote de
  // las órdenes del contenedor, prellenado con lo planificado (loteKg) o con
  // lo ya guardado si se está editando un despacho existente. El total del
  // despacho (total_loaded_kg) sale de sumar esto, ya no se tipea a mano.
  const [dispatchItems, setDispatchItems] = useState([]) // [{ plant_batch_id, label, quantity_kg }]

  // Contenedores: mapa { container_id: container_row }
  const [containersMap, setContainersMap] = useState({})
  // Despachos: mapa { container_id: dispatch_row }
  const [dispatchesMap, setDispatchesMap] = useState({})
  // Cargas (Packing List): mapa { container_id: loading_row }
  const [loadingsMap, setLoadingsMap] = useState({})
  // Modal: registrar carga del contenedor (Packing List)
  const [modalCarga, setModalCarga] = useState(null) // { container, orders }

  // Packing List-Nacional (CAES): mapa { container_id: packing_list_nacional_row }
  // -- queda siempre {} para Norandino (no aplica), pero ContainerCard.jsx
  // (compartido) sigue leyendo esta prop, así que no se saca.
  const [packingListsNacionalMap, setPackingListsNacionalMap] = useState({})

  // Informe de trazabilidad completa
  const [informeOrden, setInformeOrden]     = useState(null)
  const [informeData, setInformeData]       = useState(null)
  const [informeLoading, setInformeLoading] = useState(false)

  // Documentos rápidos por orden
  const [modalQuickDocs, setModalQuickDocs] = useState(null) // { order, containerNumber }

  useEffect(() => {
    loadData()
    loadFormConfigs(COOPERATIVE, ['contenedor', 'despacho']).then(configs => {
      setContainerFields(configs.contenedor ?? [])
      setDispatchFields(configs.despacho ?? [])
    })
    loadKgPerQuintal(COOPERATIVE).then(setKgPerQuintal)
  }, [])

  // ── Carga de datos ──────────────────────────────────────────────────────────
  // Solo órdenes 'completado' -- las 'en_proceso' viven en /ordenes y nunca
  // tienen container_id todavía, así que no hace falta traerlas aquí.

  const loadData = async () => {
    setLoading(true)

    const { data: ordersRes } = await supabase
      .from('plant_orders')
      .select(`
        id, order_code, market, total_kg, status, notes, created_at, container_id, sale_number, sale_type,
        product, client_id, client_order_number, internal_container_number,
        tamizado_fecha_inicio, tamizado_fecha_fin, envasado_fecha_inicio, envasado_fecha_fin, fecha_envio,
        plant_clients ( id, name, code ),
        plant_production_batches (
          id, order_id, batch_code, brand, client_batch_number, boxes_count, packaging_type, packaging_count, packaging_kg,
          product_catalog_id,
          plant_product_catalog ( description ),
          status, notes, description, best_before_date, pallet_count, tamizada_kg,
          envasado_turno, envasado_qq, envasado_descarte_barrido_kg,
          envasado_cajas_envasadas, envasado_cajas_descarte,
          envasado_bolsas_envasadas, envasado_sacos_envasados,
          envasado_bolsas_rechazo_metal, envasado_bolsas_descarte_fabrica,
          envasado_bolsas_descarte_sellado, envasado_bolsas_descarte_codificado,
          envasado_registered_by, envasado_registered_at,
          calidad_humedad_pct, calidad_impurezas_pct, calidad_color, calidad_sabor, calidad_textura,
          calidad_observaciones, calidad_registered_by, calidad_registered_at,
          liberacion_unidades_por_lote, liberacion_formato_presentacion, liberacion_muestreado_por, liberacion_resultado, liberacion_formato_codigo,
${BUNQUE_ALLOCATIONS_SELECT}
        )
      `)
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('status', 'completado')
      .order('created_at', { ascending: false })

    const ordersArr = ordersRes ?? []

    // Contenedores, despachos, cargas y Packing List-Nacional
    const containerIds = [...new Set(ordersArr.map(o => o.container_id).filter(Boolean))]
    let ctMap = {}
    let dsMap = {}
    let ldMap = {}
    let plnMap = {}
    if (containerIds.length > 0) {
      const [ctRes, dsRes, ldRes, plnRes] = await Promise.all([
        supabase
          .from('plant_containers')
          .select('*')
          .in('id', containerIds)
          .eq('cooperative_id', COOPERATIVE.id),
        supabase
          .from('plant_dispatches')
          .select('*')
          .in('container_id', containerIds)
          .eq('cooperative_id', COOPERATIVE.id),
        supabase
          .from('plant_container_loadings')
          .select('*')
          .in('container_id', containerIds)
          .eq('cooperative_id', COOPERATIVE.id),
        COOPERATIVE?.features?.ventaNacionalExportacion
          ? supabase
              .from('plant_packing_list_nacional_caes')
              .select('*')
              .in('container_id', containerIds)
              .eq('cooperative_id', COOPERATIVE.id)
          : Promise.resolve({ data: [] }),
      ])
      ;(ctRes.data ?? []).forEach(c => { ctMap[c.id] = c })
      ;(dsRes.data ?? []).forEach(d => { dsMap[d.container_id] = d })
      ;(ldRes.data ?? []).forEach(l => { ldMap[l.container_id] = l })
      ;(plnRes.data ?? []).forEach(p => { plnMap[p.container_id] = p })
    }

    setOrders(ordersArr)
    setContainersMap(ctMap)
    setDispatchesMap(dsMap)
    setLoadingsMap(ldMap)
    setPackingListsNacionalMap(plnMap)
    setLoading(false)
  }

  // Reabrir siempre desasigna el contenedor -- si no, la orden vuelve a
  // "en_proceso" pero queda con un container_id colgado, y al completarla
  // de nuevo reaparece pegada a ese contenedor viejo sin haber pasado por
  // "Asignar a contenedor" (posiblemente ya con otras órdenes distintas).
  const handleReopenOrder = async (orderId) => {
    setSaving(true)
    setError('')
    try {
      const { error: updErr } = await supabase
        .from('plant_orders')
        .update({ status: 'en_proceso', container_id: null })
        .eq('id', orderId)
      if (updErr) throw new Error(updErr.message)
      loadData()
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setSaving(false)
    }
  }

  // ── Contenedor ──────────────────────────────────────────────────────────────

  const openModalContainer = (order) => {
    const existing = containersMap[order.container_id] ?? null
    setModalContainer({ order, existing })
    setError('')
    if (existing) {
      // Cargar valores existentes
      const vals = {}
      for (const col of CONTAINER_FIXED_COLS) {
        vals[col] = existing[col] ?? ''
      }
      // extra_data
      if (existing.extra_data) {
        for (const [k, v] of Object.entries(existing.extra_data)) {
          vals[k] = v
        }
      }
      setFormContainer(vals)
    } else {
      setFormContainer(getInitialValues(containerFieldsForOrder(containerFields, order)))
    }
  }

  const handleSaveContainer = async () => {
    setError('')
    const { valid, errors } = validateDynamicForm(containerFieldsForOrder(containerFields, modalContainer.order), formContainer)
    if (!valid) {
      setError(errors[0])
      return
    }

    setSaving(true)
    try {
      const { fixed, extraData } = splitFixedAndExtra(formContainer, CONTAINER_FIXED_COLS)
      // Convertir numéricos
      if (fixed.max_capacity_kg) fixed.max_capacity_kg = parseFloat(fixed.max_capacity_kg)

      const { order, existing } = modalContainer
      let containerId

      if (existing) {
        const { error: updErr } = await supabase
          .from('plant_containers')
          .update({ ...fixed, extra_data: extraData, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (updErr) throw new Error(updErr.message)
        containerId = existing.id
      } else {
        const { data: newContainer, error: insErr } = await supabase
          .from('plant_containers')
          .insert({
            ...fixed,
            extra_data: Object.keys(extraData).length > 0 ? extraData : {},
            status: 'preparando',
            cooperative_id: COOPERATIVE.id,
            created_by: webUser.id,
          })
          .select('id').single()
        if (insErr) throw new Error(insErr.message)
        const { error: linkErr } = await supabase
          .from('plant_orders')
          .update({ container_id: newContainer.id })
          .eq('id', order.id)
        if (linkErr) throw new Error(linkErr.message)
        containerId = newContainer.id
      }

      // La fecha de salida del contenedor ES la fecha de envío de la orden
      // -- ya no se piden por separado (ver OrdenesPage.jsx). Un mismo
      // contenedor puede tener varias órdenes, así que se sincroniza a
      // todas las que ya estén vinculadas a él, no solo a la que abrió
      // este modal.
      if (fixed.departure_date) {
        const { error: syncErr } = await supabase
          .from('plant_orders')
          .update({ fecha_envio: fixed.departure_date })
          .eq('container_id', containerId)
        if (syncErr) throw new Error(syncErr.message)
      }

      setModalContainer(null)
      loadData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Despacho ───────────────────────────────────────────────────────────────

  const openModalDispatch = async (order) => {
    const container = containersMap[order.container_id]
    if (!container) return
    const existing = dispatchesMap[container.id] ?? null
    setModalDispatch({ order, container, existing })
    setError('')

    // Todos los lotes de todas las órdenes del contenedor (no solo la
    // primera) -- un despacho es por contenedor, puede agrupar varias
    // órdenes (ver ContainerCard).
    const containerOrders = orders.filter(o => o.container_id === container.id)
    const batches = containerOrders.flatMap(o => o.plant_production_batches ?? [])

    let savedItemsMap = {}
    if (existing) {
      const { data: itemsData } = await supabase
        .from('plant_dispatch_items')
        .select('plant_batch_id, quantity_kg')
        .eq('dispatch_id', existing.id)
      ;(itemsData ?? []).forEach(it => { savedItemsMap[it.plant_batch_id] = it.quantity_kg })
    }
    setDispatchItems(batches.map(b => ({
      plant_batch_id: b.id,
      label: `${loteLabel(b)} · ${b.brand}`,
      // Prellenado con lo ya guardado (si se edita) o con lo planificado --
      // editable igual, pero evita retipear a mano un total que ya se sabe.
      quantity_kg: String(savedItemsMap[b.id] ?? loteKg(b) ?? 0),
    })))

    if (existing) {
      const vals = {}
      for (const col of DISPATCH_FIXED_COLS) {
        vals[col] = existing[col] ?? ''
      }
      if (existing.extra_data) {
        for (const [k, v] of Object.entries(existing.extra_data)) {
          vals[k] = v
        }
      }
      setFormDispatch(vals)
    } else {
      const initial = getInitialValues(dispatchFields)
      if (order.fecha_envio) initial.dispatch_date = order.fecha_envio
      setFormDispatch(initial)
    }
  }

  const handleSetDispatchItemKg = (plant_batch_id, value) => {
    setDispatchItems(prev => prev.map(it => it.plant_batch_id === plant_batch_id ? { ...it, quantity_kg: value } : it))
  }

  const handleSaveDispatch = async () => {
    setError('')
    const { valid, errors } = validateDynamicForm(dispatchFields, formDispatch)
    if (!valid) {
      setError(errors[0])
      return
    }
    const itemsToSave = dispatchItems.filter(it => parseFloat(it.quantity_kg) > 0)
    if (itemsToSave.length === 0) {
      setError(`Ingrese al menos un ${LOTE_LABEL_LOWER} con kg despachados`)
      return
    }

    setSaving(true)
    try {
      const { fixed, extraData } = splitFixedAndExtra(formDispatch, DISPATCH_FIXED_COLS)
      // Convertir numéricos
      if (fixed.temperature_at_load) fixed.temperature_at_load = parseFloat(fixed.temperature_at_load)
      if (fixed.humidity_at_load) fixed.humidity_at_load = parseFloat(fixed.humidity_at_load)
      if (fixed.notes === '') fixed.notes = null

      const { container, existing } = modalDispatch
      let dispatchId

      if (existing) {
        dispatchId = existing.id
        const { error: updErr } = await supabase
          .from('plant_dispatches')
          .update({ ...fixed, extra_data: extraData, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (updErr) throw new Error(updErr.message)
      } else {
        const dispatch_code = await generateDispatchCode()
        const { data: insData, error: insErr } = await supabase
          .from('plant_dispatches')
          .insert({
            container_id: container.id,
            dispatch_code,
            ...fixed,
            extra_data: Object.keys(extraData).length > 0 ? extraData : {},
            loaded_by: webUser.id,
            cooperative_id: COOPERATIVE.id,
          })
          .select('id')
          .single()
        if (insErr) throw new Error(insErr.message)
        dispatchId = insData.id
      }

      // Reemplazar los items del despacho -- el trigger recalc_dispatch_total_kg
      // deja total_loaded_kg actualizado solo, no se toca desde aquí.
      const { error: delErr } = await supabase.from('plant_dispatch_items').delete().eq('dispatch_id', dispatchId)
      if (delErr) throw new Error(delErr.message)
      const { error: itemsErr } = await supabase.from('plant_dispatch_items').insert(
        itemsToSave.map(it => ({
          dispatch_id: dispatchId,
          plant_batch_id: it.plant_batch_id,
          quantity_kg: parseFloat(it.quantity_kg),
          cooperative_id: COOPERATIVE.id,
        }))
      )
      if (itemsErr) throw new Error(itemsErr.message)

      // Actualizar status del contenedor
      await supabase
        .from('plant_containers')
        .update({ status: 'despachado', updated_at: new Date().toISOString() })
        .eq('id', container.id)

      setModalDispatch(null)
      loadData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Informe completo ────────────────────────────────────────────────────────

  const loadInforme = async (order) => {
    setInformeOrden(order)
    setInformeLoading(true)
    setInformeData(null)

    const exitItemIds = (order.plant_production_batches ?? [])
      .flatMap(pb => loteBunques(pb).flatMap(b => (b.plant_homogenization_inputs ?? []).map(h => h.source_exit_item_id)))
      .filter(Boolean)

    // Documentos de planta de envasado -- los mismos 14 que en "Documentos"
    // (QUICK_DOCS), a nivel de ORDEN completa (no por lote). Se piden todos
    // de una para poder mostrar el "Estado de documentos" al toque y no
    // depender de que el usuario abra cada uno para saber si hay datos. Cada
    // fetch puede fallar solo (ej. Orden de Salida/Packing List si todavía
    // no hay despacho/carga) -- no es fatal para el resto del informe.
    const plantDocsEntries = await Promise.all(QUICK_DOCS.map(async d => {
      try {
        const docData = await d.fetchData(order, kgPerQuintal)
        return [d.key, { data: docData, error: null }]
      } catch (err) {
        return [d.key, { data: null, error: err.message }]
      }
    }))
    const plantDocsMap = Object.fromEntries(plantDocsEntries)

    if (exitItemIds.length === 0) {
      setInformeData({ exitItemsMap: {}, evalMap: {}, recMap: {}, tempsMap: {}, phMap: {}, certsMap: {}, workersMap: {}, stowageMap: {}, fieldDocsMap: {}, fcpoMap: {}, chlorineByModuleDate: {}, fcclrByModule: {}, cleaningByModuleDate: {}, fldhByModule: {}, returnsByBatch: {}, fqdMap: {}, plantDocsMap })
      setInformeLoading(false)
      return
    }

    // Primera ronda: exit_items directo (fuente principal de trazabilidad) + calidad + recepción
    const [exitItemsRes, evalsRes, recItemsRes] = await Promise.all([
      supabase
        .from('exit_items')
        .select(`
          id, quantity_kg, item_document_number,
          exit_registrations ( id, exit_code, exit_date, document_number, destination ),
          production_batches (
            id, batch_code, harvest_date, process_date, cane_kg, juice_liters, panela_kg, confitillo_kg,
            cachaza_percentage, efficiency_percentage, porcentaje_extraccion, cane_density, observations,
            producers ( first_name, last_name, dni, appagrop_code, is_member, coop_modules ( id, name ) ),
            plots ( name, code )
          )
        `)
        .in('id', exitItemIds)
        .eq('cooperative_id', COOPERATIVE.id),
      supabase
        .from('quality_evaluations')
        .select('exit_item_id, humidity_pct, impurities_pct, color, sack_condition, appearance, notes')
        .in('exit_item_id', exitItemIds)
        .eq('cooperative_id', COOPERATIVE.id),
      supabase
        .from('exit_reception_items')
        .select('exit_item_id, quantity_kg_sent, quantity_kg_received, discrepancy_reason, exit_receptions ( received_at, notes, status )')
        .in('exit_item_id', exitItemIds),
    ])

    const exitItemsMap = {}
    ;(exitItemsRes.data ?? []).forEach(ei => { exitItemsMap[ei.id] = ei })

    const evalMap = {}
    ;(evalsRes.data ?? []).forEach(e => { evalMap[e.exit_item_id] = e })

    const recMap = {}
    ;(recItemsRes.data ?? []).forEach(r => { recMap[r.exit_item_id] = r })

    // IDs únicos para segunda ronda — vienen de exit_items (no depende de calidad)
    const prodBatchIds = [...new Set(
      Object.values(exitItemsMap).map(ei => ei.production_batches?.id).filter(Boolean)
    )]
    const exitRegIds = [...new Set(
      Object.values(exitItemsMap).map(ei => ei.exit_registrations?.id).filter(Boolean)
    )]
    // Módulos y fechas de proceso para consultas de cloro
    const moduleIds = [...new Set(
      Object.values(exitItemsMap).map(ei => ei.production_batches?.producers?.coop_modules?.id).filter(Boolean)
    )]
    const processDates = [...new Set(
      Object.values(exitItemsMap).map(ei => ei.production_batches?.process_date).filter(Boolean)
    )]

    // Segunda ronda: datos de campo en paralelo
    const [tempsRes, phRes, certsRes, workersRes, stowageRes, formatsRes, fcpoRes, chlorineRes, fcclrRes, cleaningRes, fldhRes, returnsRes] = await Promise.all([
      prodBatchIds.length > 0
        ? supabase.from('batch_temperatures')
            .select('production_batch_id, temperature, sequence_number')
            .in('production_batch_id', prodBatchIds)
            .eq('cooperative_id', COOPERATIVE.id)
            .order('sequence_number')
        : { data: [] },
      prodBatchIds.length > 0
        ? supabase.from('batch_ph_controls')
            .select('production_batch_id, record_date, ph_initial, ph_final, regulator_type, regulator_quantity_value, regulator_quantity_unit, brix, corrective_action')
            .in('production_batch_id', prodBatchIds)
            .eq('cooperative_id', COOPERATIVE.id)
            .order('record_date')
        : { data: [] },
      prodBatchIds.length > 0
        ? supabase.from('production_batch_certs')
            .select('production_batch_id, batch_certs ( name )')
            .in('production_batch_id', prodBatchIds)
        : { data: [] },
      prodBatchIds.length > 0
        ? supabase.from('worker_controls')
            .select('id, production_batch_id, work_area, observations, created_at, created_by, worker_control_items(worker_name, uniform_complete, no_makeup, nails_short_clean, nails_no_polish, hands_clean, no_jewelry, hair_covered, no_beard, no_wounds)')
            .in('production_batch_id', prodBatchIds)
            .eq('cooperative_id', COOPERATIVE.id)
            .order('work_area')
        : { data: [] },
      exitRegIds.length > 0
        ? supabase.from('stowage_transport_inspections')
            .select('id, exit_registration_id, inspection_date, carrier_name, carrier_ruc, carrier_license, vehicle_brand, vehicle_plate, vehicle_condition, has_spare_tire, has_valid_soat, has_technical_review, has_first_aid_kit, has_fire_extinguisher, has_gps, has_cleaning_supplies, floors_clean, walls_clean, ceilings_clean, no_strange_odors, tarp_clean, pallets_clean, sack_clean_condition, sack_tied_condition, observations, formato_codigo, emitted_by_name, emitted_at, firmantes')
            .in('exit_registration_id', exitRegIds)
            .eq('cooperative_id', COOPERATIVE.id)
        : { data: [] },
      prodBatchIds.length > 0
        ? supabase.from('formatos_control_mp_ph_lotes')
            .select('lote_campo_id, formatos_control_mp_ph ( id, formato_codigo, date_from, date_to, emitted_at, emitted_by_name, firmantes, coop_modules ( name ) )')
            .in('lote_campo_id', prodBatchIds)
        : { data: [] },
      prodBatchIds.length > 0
        ? supabase.from('formatos_control_personal')
            .select('production_batch_id, formato_codigo, emitted_at, firmantes, status')
            .in('production_batch_id', prodBatchIds).eq('cooperative_id', COOPERATIVE.id)
        : { data: [] },
      moduleIds.length > 0 && processDates.length > 0
        ? supabase.from('chlorine_residual_controls')
            .select('id, coop_module_id, control_date, control_time, measurement_point_1, measurement_point_2, corrective_actions, observations, responsible_person')
            .eq('cooperative_id', COOPERATIVE.id)
            .in('coop_module_id', moduleIds)
            .in('control_date', processDates)
            .order('control_date').order('control_time')
        : { data: [] },
      moduleIds.length > 0
        ? supabase.from('formatos_control_cloro')
            .select('id, formato_codigo, module_id, date_from, date_to, emitted_at, firmantes, status')
            .eq('cooperative_id', COOPERATIVE.id)
            .in('module_id', moduleIds)
            .eq('status', 'emitted')
        : { data: [] },
      moduleIds.length > 0 && processDates.length > 0
        ? supabase.from('cleaning_disinfections')
            .select('id, coop_module_id, cleaning_date, cleaning_types, general_observations, cleaning_disinfection_items(area_code)')
            .eq('cooperative_id', COOPERATIVE.id)
            .in('coop_module_id', moduleIds)
            .in('cleaning_date', processDates)
        : { data: [] },
      moduleIds.length > 0
        ? supabase.from('formatos_limpieza_desinfeccion')
            .select('id, formato_codigo, module_id, date_from, date_to, emitted_at, status')
            .eq('cooperative_id', COOPERATIVE.id)
            .in('module_id', moduleIds)
            .eq('status', 'emitted')
        : { data: [] },
      prodBatchIds.length > 0
        ? supabase.from('product_returns')
            .select('id, production_batch_id, client_name, return_date, quantity_kg, quantity_sacks, return_reason, observations')
            .eq('cooperative_id', COOPERATIVE.id)
            .in('production_batch_id', prodBatchIds)
            .order('return_date', { ascending: false })
        : { data: [] },
    ])

    const tempsMap = {}
    ;(tempsRes.data ?? []).forEach(t => {
      if (!tempsMap[t.production_batch_id]) tempsMap[t.production_batch_id] = []
      tempsMap[t.production_batch_id].push(t)
    })
    const phMap = {}
    ;(phRes.data ?? []).forEach(p => {
      if (!phMap[p.production_batch_id]) phMap[p.production_batch_id] = []
      phMap[p.production_batch_id].push(p)
    })
    const certsMap = {}
    ;(certsRes.data ?? []).forEach(c => {
      if (!certsMap[c.production_batch_id]) certsMap[c.production_batch_id] = []
      if (c.batch_certs?.name) certsMap[c.production_batch_id].push(c.batch_certs.name)
    })
    const workersMap = {}
    ;(workersRes.data ?? []).forEach(w => {
      if (!workersMap[w.production_batch_id]) workersMap[w.production_batch_id] = []
      workersMap[w.production_batch_id].push(w)
    })
    const stowageMap = {}
    ;(stowageRes.data ?? []).forEach(s => { stowageMap[s.exit_registration_id] = s })
    const fcpoMap = {}
    ;(fcpoRes.data ?? []).forEach(f => { fcpoMap[f.production_batch_id] = f })
    const chlorineByModuleDate = {}
    ;(chlorineRes.data ?? []).forEach(r => {
      const key = `${r.coop_module_id}_${r.control_date}`
      if (!chlorineByModuleDate[key]) chlorineByModuleDate[key] = []
      chlorineByModuleDate[key].push(r)
    })
    const fcclrByModule = {}
    ;(fcclrRes.data ?? []).forEach(f => {
      if (!fcclrByModule[f.module_id]) fcclrByModule[f.module_id] = []
      fcclrByModule[f.module_id].push(f)
    })
    const cleaningByModuleDate = {}
    ;(cleaningRes.data ?? []).forEach(r => {
      const key = `${r.coop_module_id}_${r.cleaning_date}`
      if (!cleaningByModuleDate[key]) cleaningByModuleDate[key] = []
      const areas = [...new Set((r.cleaning_disinfection_items ?? []).map(i => i.area_code))]
      cleaningByModuleDate[key].push({ ...r, areas })
    })
    const fldhByModule = {}
    ;(fldhRes.data ?? []).forEach(f => {
      if (!fldhByModule[f.module_id]) fldhByModule[f.module_id] = []
      fldhByModule[f.module_id].push(f)
    })
    const returnsByBatch = {}
    ;(returnsRes.data ?? []).forEach(r => {
      if (!returnsByBatch[r.production_batch_id]) returnsByBatch[r.production_batch_id] = []
      returnsByBatch[r.production_batch_id].push(r)
    })
    const fqdMap = {}
    if ((returnsRes.data ?? []).length > 0) {
      const returnIds = (returnsRes.data ?? []).map(r => r.id)
      const { data: fqdRes } = await supabase
        .from('formatos_devoluciones')
        .select('product_return_id, formato_codigo, emitted_at, firmantes, status')
        .in('product_return_id', returnIds)
        .eq('cooperative_id', COOPERATIVE.id)
      ;(fqdRes ?? []).forEach(f => { fqdMap[f.product_return_id] = f })
    }

    // fieldDocsMap: formato_id → { id, document_code, emitted_at, formatDetails, coveredBatchIds }
    const fieldDocsMap = {}
    ;(formatsRes.data ?? []).forEach(row => {
      const fmt = row.formatos_control_mp_ph
      if (!fmt) return
      if (!fieldDocsMap[fmt.id]) {
        fieldDocsMap[fmt.id] = {
          id: fmt.id,
          document_code: fmt.formato_codigo,
          emitted_at: fmt.emitted_at,
          emitted_by_name: fmt.emitted_by_name,
          formatDetails: { date_from: fmt.date_from, date_to: fmt.date_to, coop_modules: fmt.coop_modules },
          firmantes: fmt.firmantes ?? [],
          coveredBatchIds: [],
        }
      }
      fieldDocsMap[fmt.id].coveredBatchIds.push(row.lote_campo_id)
    })

    setInformeData({ exitItemsMap, evalMap, recMap, tempsMap, phMap, certsMap, workersMap, stowageMap, fieldDocsMap, fcpoMap, chlorineByModuleDate, fcclrByModule, cleaningByModuleDate, fldhByModule, returnsByBatch, fqdMap, plantDocsMap })
    setInformeLoading(false)
  }

  // ── PDF de trazabilidad ─────────────────────────────────────────────────────

  // Orden de Salida de Productos (COA-OIM-RG-007) -- por contenedor, no por
  // orden: se arma con las órdenes que comparten ese contenedor (cOrders),
  // solo tiene sentido una vez que ya hay un despacho registrado (ahí se
  // completan transportista/conductor/guías/precintos).
  const handleOrdenSalidaPdf = async (container, dispatch, ordersInContainer) => {
    try {
      const { rows, totals } = await fetchOrdenSalidaRows(ordersInContainer)
      const html = ordenSalidaPdf(COOPERATIVE, container, dispatch, ordersInContainer, rows, totals, loadingsMap[container.id], packingListsNacionalMap[container.id])
      await downloadPdfDocument(html)
    } catch (err) {
      setError(err.message)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // Buscador: filtra por código de orden, mercado, cliente, marca de los
  // lotes o N° de contenedor.
  const searchNeedle = searchQuery.trim().toLowerCase()
  const matchesSearch = (order) => {
    if (!searchNeedle) return true
    const batches = order.plant_production_batches ?? []
    const haystack = [
      order.order_code,
      order.client_order_number,
      order.market,
      order.plant_clients?.name,
      containersMap[order.container_id]?.container_number,
      ...batches.map(b => b.brand),
      ...batches.map(b => loteLabel(b)),
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(searchNeedle)
  }

  // La orden llega aquí ya 'completado', pero puede que todavía no tenga
  // contenedor/despacho asignado -- eso separa "Lista para embarque" de las
  // pestañas siguientes. A diferencia de antes, NO se exige tener ya la guía
  // de remisión cargada para salir de "Lista para embarque": esa guía se
  // completa recién en el Packing List-Nacional, que vive dentro de la
  // tarjeta del contenedor/despacho -- exigirla acá generaba un candado
  // (no había forma de llegar a cargarla, ver [[project_control_unidad_transporte_caes]]).
  // Alcanza con que exista el registro (order.container_id set, sin importar
  // qué tan completo esté todavía).
  const listaEmbarque = orders.filter(o => !o.container_id).filter(matchesSearch)
  const contenedoresActivos = Object.values(
    orders
      .filter(o => !!o.container_id)
      .reduce((acc, o) => {
        const cid = o.container_id
        if (!acc[cid]) acc[cid] = { container: containersMap[cid], orders: [], dispatch: dispatchesMap[cid], loading: loadingsMap[cid] }
        acc[cid].orders.push(o)
        return acc
      }, {})
  ).filter(c => c.container && c.orders.some(matchesSearch))

  // Una venta Nacional de CAES no tiene contenedor marítimo real -- se
  // despacha por camión (ver [[project_despacho_nacional_caes]]) -- así que
  // conviven mal con "En contenedor" bajo el mismo rótulo. Se separan en su
  // propia pestaña "Despachos nacionales"; "En contenedor" queda solo para
  // Exportación (para Norandino, que no tiene ventaNacionalExportacion,
  // despachosNacionales siempre sale vacío y esa pestaña no se muestra).
  const despachosNacionales    = contenedoresActivos.filter(c => isOrderNacional(COOPERATIVE, c.orders[0]))
  const contenedoresExportacion = contenedoresActivos.filter(c => !isOrderNacional(COOPERATIVE, c.orders[0]))

  // Dentro de cada pestaña se separan en 2 columnas por estado -- "Preparando"
  // va con "Cargado" (todavía no se despachó), "Despachado" en su propia
  // columna. "En tránsito"/"Entregado" no se usan (ver CONTAINER_STATUS_LABELS),
  // así que no hacen falta más columnas.
  const nacionalPreparando    = despachosNacionales.filter(c => c.container.status !== 'despachado')
  const nacionalDespachado    = despachosNacionales.filter(c => c.container.status === 'despachado')
  const contenedoresCargado    = contenedoresExportacion.filter(c => c.container.status !== 'despachado')
  const contenedoresDespachado = contenedoresExportacion.filter(c => c.container.status === 'despachado')

  // Una sola ContainerCard por cada { container, orders, dispatch, loading }
  // -- se reusa igual en las 4 columnas (Nacional/Exportación × Preparando/
  // Despachado) para no repetir 17 props 4 veces.
  function renderContainerCard({ container, orders: cOrders, dispatch, loading: carga }) {
    return (
      <ContainerCard
        key={container.id}
        container={container}
        orders={cOrders}
        dispatch={dispatch}
        carga={carga}
        packingListNacional={packingListsNacionalMap[container.id]}
        onCarga={() => setModalCarga({ container, orders: cOrders })}
        onDispatch={() => openModalDispatch(cOrders[0])}
        onInforme={() => loadInforme(cOrders[0])}
        onDocumentos={() => setModalQuickDocs({ order: cOrders[0], containerNumber: container.container_number })}
        onResumenTrazabilidad={() => setModalQuickDocs({ order: cOrders[0], containerNumber: container.container_number, initialDocKey: 'resumen_trazabilidad', initialBatch: cOrders[0]?.plant_production_batches?.[0] })}
        onOrdenSalidaPdf={() => handleOrdenSalidaPdf(container, dispatch, cOrders)}
        onReopenOrder={handleReopenOrder}
        onReload={loadData}
        onEditarContenedor={() => openModalContainer(cOrders[0])}
      />
    )
  }

  // Columna con encabezado + contador + lista de ContainerCard -- reusada
  // tanto en "Despachos nacionales" como en "En contenedor".
  function ContainerColumn({ title, items, emptyMessage, tagClass }) {
    return (
      <div>
        <h3 style={{ margin: '0 0 12px' }}>
          {title}
          <span className={tagClass} style={{ marginLeft: 8 }}>{items.length}</span>
        </h3>
        {items.length === 0 ? (
          <EmptyState message={searchNeedle ? 'Ningún contenedor coincide con la búsqueda.' : emptyMessage} />
        ) : (
          <div className="list">{items.map(renderContainerCard)}</div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Embarque</h2>
      </div>

      {!loading && (
        <SearchFilterBar
          search={searchQuery} onSearchChange={setSearchQuery}
          searchPlaceholder="Buscar por orden, cliente, marca o contenedor..."
          style={{ maxWidth: 480 }}
        />
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={`btn small ${pageTab === 'lista' ? 'primary' : 'outline'}`} onClick={() => selectPageTab('lista')}>
          Lista para embarque
          {pageTab === 'lista'
            ? <span style={{ marginLeft: 6, opacity: 0.85 }}>({listaEmbarque.length})</span>
            : <span className="tag info" style={{ marginLeft: 6 }}>{listaEmbarque.length}</span>}
        </button>
        {COOPERATIVE?.features?.ventaNacionalExportacion && (
          <button className={`btn small ${pageTab === 'nacional' ? 'primary' : 'outline'}`} onClick={() => selectPageTab('nacional')}>
            Despachos nacionales
            {pageTab === 'nacional'
              ? <span style={{ marginLeft: 6, opacity: 0.85 }}>({despachosNacionales.length})</span>
              : <span className="tag ok" style={{ marginLeft: 6 }}>{despachosNacionales.length}</span>}
          </button>
        )}
        <button className={`btn small ${pageTab === 'contenedor' ? 'primary' : 'outline'}`} onClick={() => selectPageTab('contenedor')}>
          En contenedor
          {pageTab === 'contenedor'
            ? <span style={{ marginLeft: 6, opacity: 0.85 }}>({contenedoresExportacion.length})</span>
            : <span className="tag ok" style={{ marginLeft: 6 }}>{contenedoresExportacion.length}</span>}
        </button>
      </div>

      {loading ? (
        <SkeletonList count={2} lines={2} />
      ) : pageTab === 'lista' ? (

        /* Lista para embarque */
        <div>
          {listaEmbarque.length === 0 ? (
            <EmptyState message={searchNeedle ? 'Ninguna orden en lista de embarque coincide con la búsqueda.' : 'No hay órdenes esperando contenedor.'} />
          ) : (
            <div className="list">
              {listaEmbarque.map(order => (
                <EmbarqueCard
                  key={order.id}
                  order={order}
                  onAsignar={() => openModalContainer(order)}
                  onInforme={() => loadInforme(order)}
                  onReopen={() => handleReopenOrder(order.id)}
                  onDocumentos={() => setModalQuickDocs({ order })}
                  onReload={loadData}
                />
              ))}
            </div>
          )}
        </div>

      ) : pageTab === 'nacional' ? (

        /* Despachos nacionales -- una venta Nacional CAES no tiene
           contenedor marítimo real (se despacha por camión), así que vive
           separada de "En contenedor" en vez de compartir ese rótulo. */
        <div className="split">
          <ContainerColumn title="Preparando" items={nacionalPreparando} tagClass="tag info"
            emptyMessage="No hay despachos nacionales en preparación." />
          <ContainerColumn title="Despachado" items={nacionalDespachado} tagClass="tag ok"
            emptyMessage="Todavía no hay despachos nacionales despachados." />
        </div>

      ) : (

        /* En contenedor -- 2 columnas por estado, para diferenciar de un
           vistazo qué contenedores ya se despacharon de los que todavía no. */
        <div className="split">
          <ContainerColumn title="Cargado" items={contenedoresCargado} tagClass="tag info"
            emptyMessage="No hay contenedores en preparación o cargados." />
          <ContainerColumn title="Despachado" items={contenedoresDespachado} tagClass="tag ok"
            emptyMessage="Todavía no hay contenedores despachados." />
        </div>

      )}

      {/* ── Modal: Registrar carga (Packing List) ───────────────────────── */}
      {modalCarga && (
        <ContainerLoadingModal
          container={modalCarga.container}
          orders={modalCarga.orders}
          webUser={webUser}
          onClose={() => setModalCarga(null)}
          onSaved={loadData}
        />
      )}

      {/* Sin modal de Packing List-Nacional ni de Control de Unidad de
          Transporte -- son SOLO CAES, esos 2 componentes ni existen acá
          (se sacó también el estado/props que los disparaban). El botón de
          Control de Unidad de Transporte ya está gateado por
          ventaNacionalExportacion en ContainerCard.jsx (siempre false acá),
          así que nunca llega a mostrarse. */}

      {/* ── Modal: Contenedor / Despacho nacional ───────────────────────────── */}
      {modalContainer && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 4px' }}>
                {isOrderNacional(COOPERATIVE, modalContainer.order)
                  ? `${modalContainer.existing ? 'Editar' : 'Registrar'} despacho nacional`
                  : `${modalContainer.existing ? 'Editar' : 'Registrar'} contenedor${modalContainer.existing?.container_number ? `: ${modalContainer.existing.container_number}` : ''}`}
              </h3>
              <p className="muted small" style={{ margin: '0 0 16px' }}>
                Mercado: {modalContainer.order.market} · {modalContainer.order.total_kg ?? 0} kg
              </p>
              <DynamicForm
                fields={containerFieldsForOrder(containerFields, modalContainer.order)}
                values={formContainer}
                onChange={(key, value) => setFormContainer(prev => ({ ...prev, [key]: value }))}
              />
              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => setModalContainer(null)} disabled={saving}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveContainer} disabled={saving}>
                {saving
                  ? 'Guardando...'
                  : modalContainer.existing ? 'Actualizar' : isOrderNacional(COOPERATIVE, modalContainer.order) ? 'Registrar despacho nacional' : 'Registrar contenedor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Despacho ────────────────────────────────────────────────── */}
      {modalDispatch && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 4px' }}>
                {modalDispatch.existing ? 'Editar' : 'Registrar'} despacho
              </h3>
              <p className="muted small" style={{ margin: '0 0 4px' }}>
                Orden: {modalDispatch.order.client_order_number ?? modalDispatch.order.order_code} · Mercado: {modalDispatch.order.market}
              </p>
              <p className="muted small" style={{ margin: '0 0 16px' }}>
                Contenedor: {modalDispatch.container.container_number ?? '—'} · Sello: {modalDispatch.container.seal_number ?? '—'}
              </p>

              <div className="field">
                <label>Kg despachados por {LOTE_LABEL_LOWER}</label>
                {dispatchItems.length === 0 ? (
                  <p className="muted small">Esta orden no tiene {LOTE_LABEL_PLURAL_LOWER}.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {dispatchItems.map(it => (
                      <div key={it.plant_batch_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="small" style={{ flex: 1 }}>{it.label}</span>
                        <input
                          type="number" min="0" step="0.1"
                          style={{ width: 110 }}
                          value={it.quantity_kg}
                          onChange={e => handleSetDispatchItemKg(it.plant_batch_id, e.target.value)}
                        />
                        <span className="muted small">kg</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                      <strong className="small">Total</strong>
                      <strong className="small">
                        {dispatchItems.reduce((s, it) => s + (parseFloat(it.quantity_kg) || 0), 0).toFixed(1)} kg
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              <DynamicForm
                fields={dispatchFields}
                values={formDispatch}
                onChange={(key, value) => setFormDispatch(prev => ({ ...prev, [key]: value }))}
              />
              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => setModalDispatch(null)} disabled={saving}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveDispatch} disabled={saving}>
                {saving ? 'Guardando...' : modalDispatch.existing ? 'Actualizar' : 'Registrar despacho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Informe de trazabilidad ───────────────────────────────────────────── */}
      {informeOrden && (
        <InformeOrden
          order={informeOrden}
          containerNumber={containersMap[informeOrden.container_id]?.container_number}
          data={informeData}
          loading={informeLoading}
          onClose={() => { setInformeOrden(null); setInformeData(null) }}
          quickDocs={QUICK_DOCS}
        />
      )}

      {/* ── Documentos rápidos por orden ─────────────────────────────────────── */}
      {modalQuickDocs && (
        <QuickDocsModal
          order={modalQuickDocs.order}
          containerNumber={modalQuickDocs.containerNumber}
          kgPerQuintal={kgPerQuintal}
          initialDocKey={modalQuickDocs.initialDocKey}
          initialBatch={modalQuickDocs.initialBatch}
          onClose={() => setModalQuickDocs(null)}
          quickDocs={QUICK_DOCS}
        />
      )}
    </div>
  )
}
