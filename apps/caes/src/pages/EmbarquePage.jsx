import { toast } from '@panela/core/lib/toast'
import { trackAction } from '@panela/core/lib/usage'
import { AUDIT_COLUMNS } from '@panela/core/lib/audit'
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { loadFormConfigs, splitFixedAndExtra, loadKgPerQuintal } from '@panela/core/lib/formConfig'
import DynamicForm, { validateDynamicForm, getInitialValues } from '@panela/core/components/DynamicForm'
import { downloadPdfDocument } from '@panela/core/lib/pdfDownload'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { fetchOrdenSalidaRows, ordenSalidaPdf } from '@panela/core/lib/formatos/ordenSalida'
import { fetchTramos } from '@panela/core/lib/formatos/tramos'
import { QUICK_DOCS, FIELD_DOCS } from '../lib/formatos'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { loteKg, loteLabel, isOrderNacional, BUNQUE_ALLOCATIONS_SELECT } from '@panela/core/lib/loteHelpers'
import { getLoteLabelLower, getLoteLabelPluralLower } from '@panela/core/lib/labels'

import ContainerLoadingModal from '@panela/core/pages/ContainerLoadingModal'
import PackingListNacionalCaesModal from './PackingListNacionalCaesModal'
import TransportUnitControlsCaesModal from './TransportUnitControlsCaesModal'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import ErrorState from '@panela/core/components/ErrorState'
import Icon from '@panela/core/components/Icon'
import SearchFilterBar from '@panela/core/components/SearchFilterBar'
import QuickDocsModal from '@panela/core/components/QuickDocsModal'
import OrderNumberField from '@panela/core/components/OrderNumberField'
import EmbarqueCard from '@panela/core/pages/EmbarqueCard'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import ContainerCard from '@panela/core/pages/ContainerCard'
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
  'departure_date', 'estimated_arrival', 'certificado_origen', 'carta_rendimiento_azucar', 'puerto_salida',
]

// Factura comercial y certificado de transacción son opcionales (no se
// exigen para registrar el contenedor/despacho); se marca en la etiqueta.
const OPTIONAL_LABEL_KEYS = ['factura_comercial', 'certificado_transaccion']
const withOptionalLabels = (fields) => fields.map(f =>
  OPTIONAL_LABEL_KEYS.includes(f.key) && !f.required && !/opcional/i.test(f.label)
    ? { ...f, label: `${f.label} (opcional)` }
    : f)

function containerFieldsForOrder(fields, order) {
  if (!COOPERATIVE?.features?.ventaNacionalExportacion) return withOptionalLabels(fields)
  if (!isOrderNacional(COOPERATIVE, order)) return withOptionalLabels(fields)
  return withOptionalLabels(fields.filter(f => !CAES_EXPORT_ONLY_KEYS.includes(f.key)))
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
  const [loadError, setLoadError] = useState('')
  const [kgPerQuintal, setKgPerQuintal] = useState(50)
  const [searchQuery, setSearchQuery]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // "Lista para embarque" y "En contenedor" ahora son pestañas (antes iban
  // lado a lado en la misma pantalla) -- cada una a pantalla completa.
  const [searchParams, setSearchParams] = useSearchParams()
  const [pageTab, setPageTab] = useState(searchParams.get('tab') ?? 'lista')
  // Despachados: se muestran los más recientes y el resto con "Ver más"
  // (es una lista que solo crece).
  const [showAllDone, setShowAllDone] = useState(false)
  function selectPageTab(tab) {
    setShowAllDone(false)
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
  const [packingListsNacionalMap, setPackingListsNacionalMap] = useState({})
  const [modalPackingListNacional, setModalPackingListNacional] = useState(null) // container
  // Control de Unidad de Transporte (CAES, Nacional y Exportación)
  const [modalControlTransporte, setModalControlTransporte] = useState(null) // { container, orders }
  // Sube al cerrar ese modal: ContainerCard vuelve a contar sus controles.
  const [controlsVersion, setControlsVersion] = useState(0)

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

    const { data: ordersRes, error: ordersErr } = await supabase
      .from('plant_orders')
      .select(`
        id, order_code, market, total_kg, status, notes, created_at, container_id, sale_number, sale_type, ${AUDIT_COLUMNS},
        product, client_id, client_order_number, internal_container_number,
        tamizado_fecha_inicio, tamizado_fecha_fin, envasado_fecha_inicio, envasado_fecha_fin, fecha_envio,
        plant_clients ( id, name, code ),
        plant_production_batches (
          id, order_id, batch_code, brand, client_batch_number, boxes_count, packaging_type, packaging_count, packaging_kg, ${AUDIT_COLUMNS},
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

    // Antes un fallo se veía como "no hay órdenes listas para embarque".
    if (ordersErr) {
      setLoadError(ordersErr.message)
      setLoading(false)
      return
    }
    setLoadError('')
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
      toast.success('Orden reabierta', 'Volvió a "En proceso" en Órdenes.')
      trackAction('reabrir_orden')
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
      toast.success('Contenedor guardado')
      trackAction('asignar_contenedor')
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
      label: `${loteLabel(b)}${b.brand ? ` · ${b.brand}` : ''}`,
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
      setError(`Ingrese al menos un ${getLoteLabelLower(COOPERATIVE, modalDispatch.order)} con kg despachados`)
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
      toast.success('Despacho registrado')
      trackAction('registrar_despacho')
      loadData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── PDF de trazabilidad ─────────────────────────────────────────────────────

  // Orden de Salida de Productos (COA-OIM-RG-007) -- por contenedor, no por
  // orden: se arma con las órdenes que comparten ese contenedor (cOrders),
  // solo tiene sentido una vez que ya hay un despacho registrado (ahí se
  // completan transportista/conductor/guías/precintos).
  const handleOrdenSalidaPdf = async (container, dispatch, ordersInContainer) => {
    try {
      const { rows, totals } = await fetchOrdenSalidaRows(ordersInContainer)
      const tramos = COOPERATIVE?.features?.ventaNacionalExportacion ? await fetchTramos(container.id) : []
      const html = ordenSalidaPdf(COOPERATIVE, container, dispatch, ordersInContainer, rows, totals, loadingsMap[container.id], tramos)
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

  // Sin ?tab= en la URL, se abre la primera pestaña con algo pendiente (antes
  // siempre "Lista para embarque", aunque estuviera vacía). Una sola vez.
  const autoTabDone = useRef(!!searchParams.get('tab'))
  useEffect(() => {
    if (loading || autoTabDone.current) return
    autoTabDone.current = true
    if (listaEmbarque.length > 0) return
    if (COOPERATIVE?.features?.ventaNacionalExportacion && nacionalPreparando.length > 0) setPageTab('nacional')
    else if (contenedoresCargado.length > 0) setPageTab('contenedor')
  }, [loading])

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
        onDocumentos={() => setModalQuickDocs({ order: cOrders[0], containerNumber: container.container_number })}
        onResumenTrazabilidad={() => setModalQuickDocs({ order: cOrders[0], containerNumber: container.container_number, initialDocKey: 'resumen_trazabilidad', initialBatch: cOrders[0]?.plant_production_batches?.[0] })}
        onOrdenSalidaPdf={() => handleOrdenSalidaPdf(container, dispatch, cOrders)}
        onPackingListNacional={() => setModalPackingListNacional(container)}
        onControlTransporte={() => setModalControlTransporte({ container, orders: cOrders })}
        onReopenOrder={handleReopenOrder}
        onReload={loadData}
        onEditarContenedor={() => openModalContainer(cOrders[0])}
        controlsVersion={controlsVersion}
      />
    )
  }

  // Una sola lista a todo el ancho (antes 2 columnas lado a lado que dejaban
  // media pantalla vacía): primero lo que falta despachar, después lo ya
  // despachado (más reciente primero, los más viejos detrás de "Ver más").
  const DONE_LIMIT = 10
  const renderContainerSections = (pendingItems, doneItems, emptyMessage) => {
    if (pendingItems.length === 0 && doneItems.length === 0) {
      return <EmptyState message={searchNeedle ? 'Ningún contenedor coincide con la búsqueda.' : emptyMessage} />
    }
    const doneSorted = [...doneItems].sort((a, b) => (b.dispatch?.dispatch_date ?? '').localeCompare(a.dispatch?.dispatch_date ?? ''))
    const doneVisible = showAllDone ? doneSorted : doneSorted.slice(0, DONE_LIMIT)
    return (
      <>
        {pendingItems.length > 0 && (
          <section className="embarque-section">
            <h3 className="embarque-section-title">Por despachar <span className="tab-count">{pendingItems.length}</span></h3>
            <div className="list">{pendingItems.map(renderContainerCard)}</div>
          </section>
        )}
        {doneItems.length > 0 && (
          <section className="embarque-section">
            <h3 className="embarque-section-title">Despachados <span className="tab-count">{doneItems.length}</span></h3>
            <div className="list">{doneVisible.map(renderContainerCard)}</div>
            {doneSorted.length > DONE_LIMIT && !showAllDone && (
              <button className="btn small outline" style={{ marginTop: 8 }} onClick={() => setShowAllDone(true)}>
                Ver {doneSorted.length - DONE_LIMIT} más
              </button>
            )}
          </section>
        )}
      </>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Despacho / Embarque</h2>
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
          {/* Sin número mientras carga: un "0" provisorio parece un dato real. */}
          {!loading && <span className="tab-count">{listaEmbarque.length}</span>}
        </button>
        {COOPERATIVE?.features?.ventaNacionalExportacion && (
          <button className={`btn small ${pageTab === 'nacional' ? 'primary' : 'outline'}`} onClick={() => selectPageTab('nacional')}>
            Despachos nacionales
            {/* Sin número mientras carga: un "0" provisorio parece un dato real. */}
            {!loading && <span className="tab-count">{despachosNacionales.length}</span>}
          </button>
        )}
        <button className={`btn small ${pageTab === 'contenedor' ? 'primary' : 'outline'}`} onClick={() => selectPageTab('contenedor')}>
          En contenedor
          {/* Sin número mientras carga: un "0" provisorio parece un dato real. */}
          {!loading && <span className="tab-count">{contenedoresExportacion.length}</span>}
        </button>
      </div>

      {loading ? (
        <SkeletonList count={2} lines={2} />
      ) : loadError ? (
        <ErrorState message="No se pudo cargar Embarque. Revise la conexión e intente de nuevo." onRetry={loadData} />
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
        renderContainerSections(nacionalPreparando, nacionalDespachado, 'Todavía no hay despachos nacionales.')

      ) : (

        /* En contenedor -- 2 columnas por estado, para diferenciar de un
           vistazo qué contenedores ya se despacharon de los que todavía no. */
        renderContainerSections(contenedoresCargado, contenedoresDespachado, 'Todavía no hay contenedores.')

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

      {/* ── Modal: Packing List-Nacional (CAES) ──────────────────────────── */}
      {modalPackingListNacional && (
        <PackingListNacionalCaesModal
          container={modalPackingListNacional}
          webUser={webUser}
          onClose={() => setModalPackingListNacional(null)}
          onSaved={loadData}
        />
      )}

      {/* ── Modal: Control de Unidad de Transporte (CAES) ────────────────── */}
      {modalControlTransporte && (
        <TransportUnitControlsCaesModal
          container={modalControlTransporte.container}
          orders={modalControlTransporte.orders}
          webUser={webUser}
          onClose={() => { setModalControlTransporte(null); setControlsVersion(v => v + 1) }}
        />
      )}

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
              {error && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
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
                <label>Kg despachados por {getLoteLabelLower(COOPERATIVE, modalDispatch.order)}</label>
                {dispatchItems.length === 0 ? (
                  <p className="muted small">Esta orden no tiene {getLoteLabelPluralLower(COOPERATIVE, modalDispatch.order)}.</p>
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
                fields={dispatchFields.filter(f =>
                  // Almacén portuario: solo exportación.
                  !(f.key === 'fecha_ingreso_almacen_portuario' && isOrderNacional(COOPERATIVE, modalDispatch?.order)))}
                values={formDispatch}
                onChange={(key, value) => setFormDispatch(prev => ({ ...prev, [key]: value }))}
              />
              {error && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
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
          fieldDocs={FIELD_DOCS}
        />
      )}
    </div>
  )
}
