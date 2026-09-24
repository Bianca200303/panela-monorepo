import { useState, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { loadFormConfigs, loadProcessingLimits, loadKgPerQuintal } from '@panela/core/lib/formConfig'
import DynamicForm from '@panela/core/components/DynamicForm'
import { loteLabel, BUNQUE_ALLOCATIONS_SELECT, PACKAGING_TYPE_LABELS } from '@panela/core/lib/loteHelpers'
import { getLoteLabelLower, getLoteLabelPluralLower } from '@panela/core/lib/labels'
import { useNavigate } from 'react-router-dom'

const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE)
import EnvasadoModal from '@panela/core/pages/EnvasadoModal'
import CalidadEnvasadoModal from '@panela/core/pages/CalidadEnvasadoModal'
import SelladoEnvasadoCaesModal from './SelladoEnvasadoCaesModal'
import HermeticidadEnvasesCaesModal from './HermeticidadEnvasesCaesModal'
import MonitoreoTamizadoCaesModal from './MonitoreoTamizadoCaesModal'
import Stat from '@panela/core/components/Stat'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import SearchFilterBar from '@panela/core/components/SearchFilterBar'
import DateInput from '@panela/core/components/DateInput'
import QuickDocsModal from '@panela/core/components/QuickDocsModal'
import OrderNumberField from '@panela/core/components/OrderNumberField'
import OrderCard from '@panela/core/pages/OrderCard'
import { QUICK_DOCS } from '../lib/formatos'

const STOCK_PAGE_SIZE = 30


// Labels para tipos de checklist (se cargan dinámicamente desde form_configurations)
// ─── Generación de códigos ───────────────────────────────────────────────────

async function generateOrderCode() {
  const year = new Date().getFullYear()
  const prefix = (COOPERATIVE.code ?? 'ORG').slice(0, 4).toUpperCase()
  const { count } = await supabase
    .from('plant_orders')
    .select('id', { count: 'exact', head: true })
    .eq('cooperative_id', COOPERATIVE.id)
    .gte('created_at', `${year}-01-01`)
  const seq = String((count ?? 0) + 1).padStart(3, '0')
  return `OP-${prefix}-${year}-${seq}`
}

async function generateBatchCode(orderId, orderCode) {
  const { count } = await supabase
    .from('plant_production_batches')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
  const seq = String((count ?? 0) + 1).padStart(2, '0')
  return `LP-${orderCode}-${seq}`
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function OrdenesPage() {
  const webUser = useAuthStore((s) => s.webUser)
  const navigate = useNavigate()

  const [orders, setOrders]               = useState([])
  const [stockItems, setStockItems]       = useState([])   // desde v_plant_available_stock
  // Trazabilidad: mapa { [web_user_id]: 'Nombre Apellido' } para mostrar quién
  // registró envasado/calidad -- sin FK a web_users, se resuelve aparte.
  const [webUsersMap, setWebUsersMap]     = useState({})
  const [loading, setLoading]             = useState(true)
  const [brandCatalog, setBrandCatalog]                 = useState([]) // desde plant_brand_catalog (id, label, is_active)
  const [clients, setClients]                          = useState([]) // desde plant_clients
  const [products, setProducts]                        = useState([]) // desde plant_product_catalog
  const [kgPerQuintal, setKgPerQuintal]                = useState(50)
  const [searchQuery, setSearchQuery]                  = useState('')

  // Modal: nuevo cliente / editar cliente (alta rápida desde "Nueva orden",
  // Solo nombre + correlativo -- la gestión completa (defaults de
  // presentación, activar/desactivar) vive en la sección "Catálogos".
  const emptyFormCliente = { name: '', code: '' }
  const [modalCliente, setModalCliente]     = useState(false)
  const [formCliente, setFormCliente]       = useState(emptyFormCliente)
  const [clienteError, setClienteError]     = useState('')
  const [savingCliente, setSavingCliente]   = useState(false)

  // Modal: nuevo producto (alta rápida desde "Agregar lote de planta") --
  // igual que cliente, la gestión completa vive en "Catálogos".
  const emptyFormProducto = { code: '', description: '', client_id: '', brand_id: '', packaging_type: 'bolsa', packaging_kg: '' }
  const [modalProducto, setModalProducto]   = useState(false)
  const [formProducto, setFormProducto]     = useState(emptyFormProducto)
  const [productoError, setProductoError]   = useState('')
  const [savingProducto, setSavingProducto] = useState(false)
  // Modal: nueva marca (alta rápida desde "Nuevo producto")
  const [modalMarca, setModalMarca]       = useState(false)
  const [formMarca, setFormMarca]         = useState('')
  const [marcaError, setMarcaError]       = useState('')
  const [savingMarca, setSavingMarca]     = useState(false)

  const emptyFormOrden = {
    market: '', notes: '', sale_type: '',
    client_id: '', sale_number: '', client_order_number: '', internal_container_number: '', product: 'Panela',
    tamizado_fecha_inicio: '', tamizado_fecha_fin: '',
    envasado_fecha_inicio: '', envasado_fecha_fin: '',
  }

  // Modal: nueva orden
  const [modalOrden, setModalOrden] = useState(false)
  const [formOrden, setFormOrden]   = useState(emptyFormOrden)

  // Modal: editar orden (ajustar carga total, mercado, etc. de una orden ya creada)
  const [modalEditOrden, setModalEditOrden] = useState(null) // order
  const [formEditOrden,  setFormEditOrden]  = useState(emptyFormOrden)

  // Modal: nuevo lote de planta
  const emptyFormLote = {
    brand: '', client_batch_number: '', boxes_count: '',
    packaging_type: 'bolsa', packaging_count: '', packaging_kg: '',
    description: '', best_before_date: '', pallet_count: '', product_catalog_id: '',
  }
  const [modalLote, setModalLote] = useState(null)  // orderId
  const [formLote, setFormLote]   = useState(emptyFormLote)
  const [loteCertIds, setLoteCertIds]       = useState([])
  const [availableCerts, setAvailableCerts] = useState([])
  const [shelfLifeConfig, setShelfLifeConfig] = useState([])
  // Checkbox opcional: asignar la marca tipeada a mano como marca fija del
  // producto genérico elegido (nunca automático, siempre a pedido).
  const [assignBrandToProduct, setAssignBrandToProduct] = useState(false)
  // Último valor de "Número de cajas" que puso el autocompletado (no lo que
  // tipeó la persona) -- para poder seguir recalculando mientras el campo
  // siga "en automático", pero dejar de tocarlo apenas alguien lo edita a mano.
  const [autoBoxesCount, setAutoBoxesCount] = useState('')

  // Modal: editar lote de planta
  const [modalEditLote, setModalEditLote]   = useState(null) // plantBatch
  const [formEditLote, setFormEditLote]     = useState(emptyFormLote)
  const [editLoteCertIds, setEditLoteCertIds] = useState([])
  const [editAssignBrandToProduct, setEditAssignBrandToProduct] = useState(false)
  const [editAutoBoxesCount, setEditAutoBoxesCount] = useState('')

  // Modal: envasado (1 registro por lote, reconfirma contra lo planificado)
  const [modalEnvasado, setModalEnvasado] = useState(null)  // plantBatch

  // Modales CAES por lote (CPR-002/CPR-003/CPR-007, Fase 2 -- equivalente
  // de CAES a Pesos y Sellado, ver COOPERATIVE.features.controlesPlantaCAES)
  const [modalSelladoEnvasadoCaes, setModalSelladoEnvasadoCaes] = useState(null)  // { batch, order } -- necesita la orden para sale_type/cliente
  const [modalHermeticidadCaes, setModalHermeticidadCaes] = useState(null)  // plantBatch
  const [modalMonitoreoTamizadoCaes, setModalMonitoreoTamizadoCaes] = useState(null)  // plantBatch

  // Modal: control de calidad del envasado (1 registro por lote, editable, requisito para cerrar el lote)
  const [modalCalidad, setModalCalidad] = useState(null)  // plantBatch

  const [showStock, setShowStock] = useState(false)
  const [showAgotados, setShowAgotados] = useState(false)
  const [stockPage, setStockPage] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // Límites del proceso (configurables por cooperativa)
  const [processingLimits, setProcessingLimits] = useState({ mermaThresholdPct: 5 })

  // Documentos rápidos por orden (Registro de Trazabilidad y los que se
  // vayan sumando) -- se arman al vuelo, no son formatos oficiales.
  const [modalQuickDocs, setModalQuickDocs] = useState(null) // { order, containerNumber }

  useEffect(() => {
    loadData()
    supabase
      .from('batch_certs')
      .select('id, name, is_default')
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setAvailableCerts(data ?? []))
    // Cargar configs dinámicamente
    loadFormConfigs(['shelf_life_config']).then(configs => {
      setShelfLifeConfig(configs.shelf_life_config ?? [])
    })
    loadProcessingLimits().then(setProcessingLimits)
    loadKgPerQuintal().then(setKgPerQuintal)
    loadBrands()
    loadClients()
    loadProducts()
  }, [])

  const loadBrands = () => {
    supabase
      .from('plant_brand_catalog')
      .select('id, label, is_active')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('label')
      .then(({ data }) => setBrandCatalog(data ?? []))
  }

  const loadClients = () => {
    supabase
      .from('plant_clients')
      .select('id, name, code, is_active, default_packaging_type, default_units_per_box, default_packaging_kg, default_pallet_count')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('name')
      .then(({ data }) => setClients(data ?? []))
  }

  const loadProducts = () => {
    supabase
      .from('plant_product_catalog')
      .select('id, code, description, client_id, brand_id, packaging_type, packaging_kg, is_active')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('description')
      .then(({ data }) => setProducts(data ?? []))
  }

  const handleSaveCliente = async () => {
    setClienteError('')
    if (!formCliente.name.trim()) {
      setClienteError('El nombre es obligatorio')
      return
    }
    setSavingCliente(true)
    try {
      const { data, error: insErr } = await supabase
        .from('plant_clients')
        .insert({
          name:           formCliente.name.trim(),
          code:           formCliente.code.trim() || null,
          cooperative_id: COOPERATIVE.id,
        })
        .select('id')
        .single()
      if (insErr) throw new Error(insErr.message)
      setModalCliente(false)
      setFormCliente(emptyFormCliente)
      loadClients()
      // Selecciona automáticamente el cliente recién creado en la orden que se está armando.
      setFormOrden(f => ({ ...f, client_id: data.id }))
    } catch (err) {
      setClienteError(err.message)
    } finally {
      setSavingCliente(false)
    }
  }

  const handleCreateProducto = async () => {
    setProductoError('')
    if (!formProducto.code.trim() || !formProducto.description.trim()) {
      setProductoError('Código y descripción son obligatorios')
      return
    }
    setSavingProducto(true)
    try {
      const { data, error: insErr } = await supabase
        .from('plant_product_catalog')
        .insert({
          code:            formProducto.code.trim(),
          description:     formProducto.description.trim(),
          client_id:       formProducto.client_id || null,
          brand_id:        formProducto.brand_id || null,
          packaging_type:  formProducto.packaging_type || null,
          packaging_kg:    formProducto.packaging_kg ? parseFloat(formProducto.packaging_kg) : null,
          cooperative_id:  COOPERATIVE.id,
        })
        .select('id')
        .single()
      if (insErr) throw new Error(insErr.message)
      setModalProducto(false)
      setFormProducto(emptyFormProducto)
      loadProducts()
      // Selecciona automáticamente el producto recién creado en el lote que se
      // está armando (nuevo lote o edición de uno existente, el que esté
      // abierto en ese momento).
      if (modalEditLote) applyProductToLoteForm(setFormEditLote, data.id)
      else if (modalLote) applyProductToLoteForm(setFormLote, data.id)
    } catch (err) {
      setProductoError(err.message)
    } finally {
      setSavingProducto(false)
    }
  }

  const handleCreateMarca = async () => {
    setMarcaError('')
    if (!formMarca.trim()) {
      setMarcaError('El nombre es obligatorio')
      return
    }
    setSavingMarca(true)
    try {
      const { data, error: insErr } = await supabase
        .from('plant_brand_catalog')
        .insert({ label: formMarca.trim(), cooperative_id: COOPERATIVE.id })
        .select('id, label')
        .single()
      if (insErr) throw new Error(insErr.message)
      setModalMarca(false)
      setFormMarca('')
      loadBrands()
      // Selecciona automáticamente la marca recién creada donde corresponda:
      // en el producto si se abrió desde "Nuevo producto", o directo en el
      // campo de texto del lote si se abrió desde el propio formulario de lote.
      if (modalProducto) {
        setFormProducto(f => ({ ...f, brand_id: data.id }))
      } else if (modalEditLote) {
        setFormEditLote(f => ({ ...f, brand: data.label }))
      } else if (modalLote) {
        setFormLote(f => ({ ...f, brand: data.label }))
      }
    } catch (err) {
      setMarcaError(err.message)
    } finally {
      setSavingMarca(false)
    }
  }

  // Asigna como marca fija de un producto genérico la marca que se tipeó a
  // mano en un lote -- solo pasa si el usuario lo pide explícito (checkbox),
  // nunca automático. Si esa marca no existe todavía en el catálogo, se crea
  // de paso (mismo criterio que "+ Nueva marca").
  const assignBrandToProductRecord = async (productId, brandText) => {
    const label = brandText.trim()
    if (!productId || !label) return
    let brand = brandCatalog.find(b => b.label.toLowerCase() === label.toLowerCase())
    if (!brand) {
      const { data, error: insErr } = await supabase
        .from('plant_brand_catalog')
        .insert({ label, cooperative_id: COOPERATIVE.id })
        .select('id, label')
        .single()
      if (insErr) return // no bloquear el guardado del lote por esto
      brand = data
    }
    await supabase.from('plant_product_catalog').update({ brand_id: brand.id }).eq('id', productId)
    loadBrands()
    loadProducts()
  }

  // Productos activos para elegir al armar un lote. Con cliente elegido en
  // la orden, se acota estrictamente a los productos de ESE cliente (nunca
  // los genéricos ni los de otro cliente) -- son el catálogo cerrado de ese
  // cliente. Sin cliente elegido en la orden, se ven todos (incluye los
  // genéricos), porque ahí no hay ningún cliente contra el cual acotar.
  const productsForSelect = (clientId) => {
    const active = products.filter(p => p.is_active)
    if (!clientId) return active
    return active.filter(p => p.client_id === clientId)
  }

  // Sugerencias de marca para el campo de texto del lote (input + datalist,
  // sigue siendo editable a mano). La marca depende del producto elegido, no
  // al revés -- por eso solo se sugiere la marca de ESE producto. Sin
  // producto elegido (o si el producto no tiene marca propia) no hay ninguna
  // marca "correcta" que sugerir todavía, así que no se ofrece ninguna.
  const brandOptionsForLote = (productCatalogId) => {
    const product = products.find(p => p.id === productCatalogId)
    if (!product?.brand_id) return []
    const brand = brandCatalog.find(b => b.id === product.brand_id)
    return brand ? [brand] : []
  }

  // Un producto tiene una sola marca fija -- si el producto elegido ya trae
  // la suya, no tiene sentido ofrecer crear/cambiar la marca del lote desde
  // aquí (quedaría un lote con un producto que dice una marca en su ficha y
  // el campo de texto mostrando otra). Si hace falta esa combinación, es un
  // producto nuevo, no un cambio de marca suelto.
  const productHasOwnBrand = (productCatalogId) =>
    Boolean(products.find(p => p.id === productCatalogId)?.brand_id)

  // Al cargar la cantidad de bolsas, sugiere el número de cajas (cantidad ÷
  // bolsas por caja del cliente) -- solo si "Número de cajas" todavía está
  // vacío, para no pisar un valor que la persona ya haya escrito a mano.
  // No aplica a saco (no se agrupa en cajas).
  const applyPackagingCount = (form, setter, value, orderClient, autoValue, setAutoValue) => {
    const patch = { packaging_count: value }
    if (form.packaging_type === 'bolsa' && orderClient?.default_units_per_box > 0 && value) {
      const stillAuto = form.boxes_count === '' || form.boxes_count === autoValue
      if (stillAuto) {
        const computed = String(Math.ceil(parseFloat(value) / orderClient.default_units_per_box))
        patch.boxes_count = computed
        setAutoValue(computed)
      }
    }
    setter(f => ({ ...f, ...patch }))
  }

  // Sugerencias de presentación para un lote nuevo, a partir del default del
  // cliente de la orden. Si el usuario elige un producto del catálogo dentro
  // del propio formulario de lote, ese valor pisa esto (es más específico --
  // ej: Ethiquable por defecto es bolsa de 500 g, pero también tiene un SKU
  // propio de 25 kg en saco). Son solo sugerencias precargadas, el usuario
  // las puede seguir editando.
  const computeLoteDefaults = (order) => {
    const client = clients.find(c => c.id === order?.client_id)
    return {
      packaging_type: client?.default_packaging_type || 'bolsa',
      packaging_kg:   client?.default_packaging_kg   != null ? String(client.default_packaging_kg) : '',
      pallet_count:   client?.default_pallet_count   != null ? String(client.default_pallet_count) : '',
    }
  }

  // Aplica los valores de un producto del catálogo elegido en el formulario
  // de lote (Agregar o Editar) -- pisa tipo/kg de empaque, nunca boxes/pallet.
  const applyProductToLoteForm = (setter, productId) => {
    const p = products.find(pr => pr.id === productId)
    const brandLabel = p?.brand_id ? brandCatalog.find(b => b.id === p.brand_id)?.label : null
    setter(f => ({
      ...f,
      product_catalog_id: productId,
      packaging_type: p?.packaging_type ?? f.packaging_type,
      packaging_kg:   p?.packaging_kg != null ? String(p.packaging_kg) : f.packaging_kg,
      // Nunca se conserva la marca del producto anterior: si el nuevo
      // producto trae marca propia se usa esa, si no, se limpia -- que quede
      // vacía y editable es mejor que dejar pegada la marca de un producto
      // que ya no es el elegido.
      brand: brandLabel ?? '',
    }))
    // El checkbox "usar esta marca para el producto" quedaba referido al
    // producto anterior -- al cambiar de producto, se desmarca.
    setAssignBrandToProduct(false)
    setEditAssignBrandToProduct(false)
  }

  // ── Carga de datos ──────────────────────────────────────────────────────────

  const loadData = async () => {
    // Solo mostrar el skeleton en la carga inicial -- si ya hay órdenes
    // cargadas (ej. después de cerrar un lote), recargar "en silencio" para
    // no desmontar la lista y perder qué cards estaban abiertas.
    if (orders.length === 0) setLoading(true)

    // Órdenes con lotes de planta, homogenizado y procesado
    const [ordersRes, stockRes] = await Promise.all([
      supabase
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
        .eq('status', 'en_proceso')
        .order('created_at', { ascending: false }),
      // Stock disponible desde la vista (reemplaza 3 queries manuales)
      supabase
        .from('v_plant_available_stock')
        .select('*')
        .eq('cooperative_id', COOPERATIVE.id)
        .order('received_at', { ascending: false }),
    ])

    const ordersArr = ordersRes.data ?? []
    const stockArr = stockRes.data ?? []

    // Resolver nombres de quién registró envasado/calidad (columnas sin FK)
    const userIds = new Set()
    ordersArr.forEach(o => (o.plant_production_batches ?? []).forEach(pb => {
      if (pb.envasado_registered_by) userIds.add(pb.envasado_registered_by)
      if (pb.calidad_registered_by) userIds.add(pb.calidad_registered_by)
    }))
    let usersMap = {}
    if (userIds.size > 0) {
      const { data: usersData } = await supabase
        .from('web_users')
        .select('id, first_name, last_name')
        .in('id', [...userIds])
      ;(usersData ?? []).forEach(u => { usersMap[u.id] = `${u.first_name} ${u.last_name}` })
    }

    setOrders(ordersArr)
    setStockItems(stockArr)
    setWebUsersMap(usersMap)
    setLoading(false)
  }

  // ── Crear orden ─────────────────────────────────────────────────────────────

  // Calcula el año de vencimiento según config de vida útil (solo se ingresa
  // el año -- se guarda como 31 de diciembre de ese año, "vence en el año X").
  // Las excepciones (overrides) matchean por texto contra una descripción del
  // empaque (ej. "saco 50 kg"), armada desde los campos estructurados nuevos.
  const calcBestBeforeDate = (packagingType, packagingKg) => {
    const defaultMonths = shelfLifeConfig.find(f => f.key === 'default_months')?.default ?? 18
    const overrides     = shelfLifeConfig.find(f => f.key === 'overrides')?.default ?? []
    const desc = `${packagingType ?? ''} ${packagingKg ?? ''} kg`.toLowerCase()
    const match = overrides.find(o => desc.includes(o.presentation_contains.toLowerCase()))
    const months = match ? match.months : defaultMonths
    const date = new Date()
    date.setMonth(date.getMonth() + months)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  const handleCreateOrder = async () => {
    setError('')
    if (COOPERATIVE?.features?.ventaNacionalExportacion && !formOrden.sale_type) {
      setError('Selecciona si la orden es de venta Nacional o de Exportación')
      return
    }
    const isNacional = COOPERATIVE?.features?.ventaNacionalExportacion && formOrden.sale_type === 'nacional'
    if (!isNacional && !formOrden.market.trim()) {
      setError('El mercado es obligatorio')
      return
    }
    setSaving(true)
    try {
      const order_code = await generateOrderCode()

      // Sin contenedor todavía -- normalmente no se conoce hasta más
      // adelante en el proceso. Se crea/vincula recién en "Asignar a
      // contenedor" (handleSaveContainer ya contempla el caso de que la
      // orden no tenga container_id: lo crea ahí y lo vincula).
      const { error: insErr } = await supabase
        .from('plant_orders')
        .insert({
          order_code,
          // market es NOT NULL en la BD -- una venta nacional no tiene
          // "mercado" (es vocabulario de exportación, ver el datalist de
          // países), así que se guarda un literal fijo en vez del campo,
          // que en ese caso ni se muestra en el formulario.
          market:                  isNacional ? 'Nacional' : formOrden.market.trim(),
          notes:                   formOrden.notes || null,
          sale_type:                COOPERATIVE?.features?.ventaNacionalExportacion ? formOrden.sale_type : null,
          product:                 formOrden.product.trim() || 'Panela',
          client_id:                formOrden.client_id || null,
          sale_number:              formOrden.sale_number.trim()   || null,
          client_order_number:      formOrden.client_order_number.trim() || null,
          internal_container_number: formOrden.internal_container_number.trim() || null,
          tamizado_fecha_inicio:    formOrden.tamizado_fecha_inicio || null,
          tamizado_fecha_fin:       formOrden.tamizado_fecha_fin || null,
          envasado_fecha_inicio:    formOrden.envasado_fecha_inicio || null,
          envasado_fecha_fin:       formOrden.envasado_fecha_fin || null,
          status:         'en_proceso',
          cooperative_id: COOPERATIVE.id,
          created_by:     webUser.id,
        })
      if (insErr) throw new Error(insErr.message)
      setModalOrden(false)
      setFormOrden(emptyFormOrden)
      loadData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Editar orden (ajustar carga total, mercado, etc.) ───────────────────────

  const openEditOrder = (order) => {
    setError('')
    setModalEditOrden(order)
    setFormEditOrden({
      market:                order.market ?? '',
      notes:                 order.notes ?? '',
      sale_type:              order.sale_type ?? '',
      client_id:              order.client_id ?? '',
      sale_number:            order.sale_number ?? '',
      client_order_number:    order.client_order_number ?? '',
      internal_container_number: order.internal_container_number ?? '',
      product:                order.product ?? 'Panela',
      container_number:      '',
      tamizado_fecha_inicio:  order.tamizado_fecha_inicio ?? '',
      tamizado_fecha_fin:     order.tamizado_fecha_fin ?? '',
      envasado_fecha_inicio:  order.envasado_fecha_inicio ?? '',
      envasado_fecha_fin:     order.envasado_fecha_fin ?? '',
    })
  }

  const handleSaveEditOrder = async () => {
    setError('')
    if (COOPERATIVE?.features?.ventaNacionalExportacion && !formEditOrden.sale_type) {
      setError('Selecciona si la orden es de venta Nacional o de Exportación')
      return
    }
    const isNacionalEdit = COOPERATIVE?.features?.ventaNacionalExportacion && formEditOrden.sale_type === 'nacional'
    if (!isNacionalEdit && !formEditOrden.market.trim()) {
      setError('El mercado es obligatorio')
      return
    }
    setSaving(true)
    try {
      const { error: updErr } = await supabase
        .from('plant_orders')
        .update({
          market:                isNacionalEdit ? 'Nacional' : formEditOrden.market.trim(),
          notes:                 formEditOrden.notes || null,
          sale_type:              COOPERATIVE?.features?.ventaNacionalExportacion ? formEditOrden.sale_type : null,
          product:                formEditOrden.product.trim() || 'Panela',
          client_id:              formEditOrden.client_id || null,
          sale_number:            formEditOrden.sale_number.trim() || null,
          client_order_number:    formEditOrden.client_order_number.trim() || null,
          internal_container_number: formEditOrden.internal_container_number.trim() || null,
          tamizado_fecha_inicio:  formEditOrden.tamizado_fecha_inicio || null,
          tamizado_fecha_fin:     formEditOrden.tamizado_fecha_fin || null,
          envasado_fecha_inicio:  formEditOrden.envasado_fecha_inicio || null,
          envasado_fecha_fin:     formEditOrden.envasado_fecha_fin || null,
        })
        .eq('id', modalEditOrden.id)
      if (updErr) throw new Error(updErr.message)
      setModalEditOrden(null)
      loadData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Crear lote de planta ────────────────────────────────────────────────────

  const handleCreateLote = async () => {
    setError('')
    const { brand, client_batch_number, packaging_type, packaging_count, packaging_kg } = formLote
    if (!formLote.product_catalog_id) {
      setError('Debe elegir un producto del catálogo')
      return
    }
    if (!brand.trim() || !client_batch_number.trim() || !packaging_type || !packaging_count || !packaging_kg) {
      setError(`Marca, número de ${LOTE_LABEL_LOWER}, tipo de empaque, cantidad y kg por unidad son obligatorios`)
      return
    }
    const pCount = parseInt(packaging_count)
    const pKg = parseFloat(packaging_kg)
    if (isNaN(pCount) || pCount <= 0 || isNaN(pKg) || pKg <= 0) {
      setError('Cantidad y kg por unidad deben ser mayores a 0')
      return
    }
    const boxesCount = formLote.boxes_count ? parseInt(formLote.boxes_count) : null
    if (formLote.boxes_count && (isNaN(boxesCount) || boxesCount < 0)) {
      setError('El número de cajas debe ser 0 o mayor')
      return
    }
    const order = orders.find(o => o.id === modalLote)
    setSaving(true)
    try {
      const batch_code = await generateBatchCode(modalLote, order.order_code)
      const { data: batchData, error: insErr } = await supabase
        .from('plant_production_batches')
        .insert({
          batch_code,
          order_id:              modalLote,
          brand:                 brand.trim(),
          client_batch_number:   formLote.client_batch_number.trim() || null,
          boxes_count:           boxesCount,
          packaging_type,
          packaging_count:       pCount,
          packaging_kg:          pKg,
          product_catalog_id:    formLote.product_catalog_id || null,
          description:           formLote.description.trim() || null,
          best_before_date:      formLote.best_before_date || null,
          pallet_count:          formLote.pallet_count ? parseInt(formLote.pallet_count) : null,
          status:                'pendiente_homogenizado',
          cooperative_id:        COOPERATIVE.id,
        })
        .select('id')
        .single()
      if (insErr) throw new Error(insErr.message)
      if (loteCertIds.length > 0 && batchData?.id) {
        await supabase.from('plant_batch_certs').insert(
          loteCertIds.map(certId => ({
            plant_batch_id: batchData.id,
            batch_cert_id:  certId,
            cooperative_id: COOPERATIVE.id,
          }))
        )
      }
      if (assignBrandToProduct) {
        await assignBrandToProductRecord(formLote.product_catalog_id, brand)
      }
      setModalLote(null)
      setFormLote(emptyFormLote)
      setLoteCertIds([])
      setAssignBrandToProduct(false)
      setAutoBoxesCount('')
      loadData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Editar lote de planta ───────────────────────────────────────────────────

  const openEditLote = async (plantBatch) => {
    setError('')
    setModalEditLote(plantBatch)
    setEditAssignBrandToProduct(false)
    setEditAutoBoxesCount('')
    setFormEditLote({
      brand:                plantBatch.brand ?? '',
      client_batch_number:  plantBatch.client_batch_number ?? '',
      boxes_count:          plantBatch.boxes_count != null ? String(plantBatch.boxes_count) : '',
      packaging_type:       plantBatch.packaging_type ?? 'bolsa',
      packaging_count:      plantBatch.packaging_count != null ? String(plantBatch.packaging_count) : '',
      packaging_kg:         plantBatch.packaging_kg != null ? String(plantBatch.packaging_kg) : '',
      description:          plantBatch.description ?? '',
      best_before_date:     plantBatch.best_before_date ?? '',
      pallet_count:         plantBatch.pallet_count != null ? String(plantBatch.pallet_count) : '',
      product_catalog_id:   plantBatch.product_catalog_id ?? '',
    })
    const { data } = await supabase
      .from('plant_batch_certs')
      .select('batch_cert_id')
      .eq('plant_batch_id', plantBatch.id)
    setEditLoteCertIds((data ?? []).map(r => r.batch_cert_id))
  }

  const handleSaveEditLote = async () => {
    setError('')
    const { brand, client_batch_number, packaging_type, packaging_count, packaging_kg } = formEditLote
    if (!formEditLote.product_catalog_id) {
      setError('Debe elegir un producto del catálogo')
      return
    }
    if (!brand.trim() || !client_batch_number.trim() || !packaging_type || !packaging_count || !packaging_kg) {
      setError(`Marca, número de ${LOTE_LABEL_LOWER}, tipo de empaque, cantidad y kg por unidad son obligatorios`)
      return
    }
    const pCount = parseInt(packaging_count)
    const pKg = parseFloat(packaging_kg)
    if (isNaN(pCount) || pCount <= 0 || isNaN(pKg) || pKg <= 0) {
      setError('Cantidad y kg por unidad deben ser mayores a 0')
      return
    }
    const boxesCount = formEditLote.boxes_count ? parseInt(formEditLote.boxes_count) : null
    if (formEditLote.boxes_count && (isNaN(boxesCount) || boxesCount < 0)) {
      setError('El número de cajas debe ser 0 o mayor')
      return
    }
    setSaving(true)
    try {
      const { error: updErr } = await supabase
        .from('plant_production_batches')
        .update({
          brand:                brand.trim(),
          client_batch_number:  client_batch_number.trim() || null,
          boxes_count:          boxesCount,
          packaging_type,
          packaging_count:      pCount,
          packaging_kg:         pKg,
          product_catalog_id:   formEditLote.product_catalog_id || null,
          description:          formEditLote.description.trim() || null,
          best_before_date:     formEditLote.best_before_date || null,
          pallet_count:         formEditLote.pallet_count ? parseInt(formEditLote.pallet_count) : null,
        })
        .eq('id', modalEditLote.id)
      if (updErr) throw new Error(updErr.message)

      // Reemplazar certificaciones del lote
      await supabase.from('plant_batch_certs').delete().eq('plant_batch_id', modalEditLote.id)
      if (editLoteCertIds.length > 0) {
        await supabase.from('plant_batch_certs').insert(
          editLoteCertIds.map(certId => ({
            plant_batch_id: modalEditLote.id,
            batch_cert_id:  certId,
            cooperative_id: COOPERATIVE.id,
          }))
        )
      }
      if (editAssignBrandToProduct) {
        await assignBrandToProductRecord(formEditLote.product_catalog_id, brand)
      }
      setModalEditLote(null)
      setEditAssignBrandToProduct(false)
      loadData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Cerrar lote (fin de tamizado) ────────────────────────────────────────────
  // Decisión manual del usuario: no hay condición automática de kg alcanzado.

  const handleCloseLote = async (plantBatch) => {
    await supabase
      .from('plant_production_batches')
      .update({ status: 'procesado' })
      .eq('id', plantBatch.id)
    loadData()
  }

  // ── Completar orden ─────────────────────────────────────────────────────────

  // Al completar la orden, sugiere (sin pedir confirmación ni bloquear si no
  // se puede derivar) las fechas de tamizado/envasado que todavía falten --
  // nunca pisa una que el usuario ya haya cargado a mano. Se derivan de
  // eventos reales ya registrados: tamizado de plant_batch_bunques.processed_at,
  // cruzado por plant_bunque_batch_allocations (mismo dato en ambas
  // cooperativas, ver [[project_bunques_tamizado]] -- OJO, NO por
  // plant_batch_bunques.plant_batch_id directo: esa columna queda NULL
  // cuando el bunque se reparte por el sistema de allocations, el vínculo
  // real vive en la tabla de allocations; bug real encontrado probando esto
  // en vivo, ver [[project_resumen_trazabilidad_fechas_por_control]]),
  // envasado de plant_production_batches.envasado_registered_at. Estas 4
  // fechas son las que usa el Resumen de Trazabilidad para cruzar
  // Verificación de Limpieza y Control de Plagas -- antes quedaban vacías
  // si nadie se acordaba de tipearlas a mano.
  const handleCompleteOrder = async (orderId) => {
    setSaving(true)
    setError('')
    try {
      const order = orders.find(o => o.id === orderId)
      const batches = order?.plant_production_batches ?? []
      const batchIds = batches.map(b => b.id)
      const patch = {}

      if (!order?.tamizado_fecha_inicio || !order?.tamizado_fecha_fin) {
        const { data: allocations } = batchIds.length > 0
          ? await supabase.from('plant_bunque_batch_allocations')
              .select('plant_batch_bunques ( processed_at )')
              .in('plant_batch_id', batchIds)
          : { data: [] }
        const fechas = (allocations ?? []).map(a => a.plant_batch_bunques?.processed_at?.slice(0, 10)).filter(Boolean).sort()
        if (fechas.length > 0) {
          if (!order?.tamizado_fecha_inicio) patch.tamizado_fecha_inicio = fechas[0]
          if (!order?.tamizado_fecha_fin) patch.tamizado_fecha_fin = fechas[fechas.length - 1]
        }
      }
      if (!order?.envasado_fecha_inicio || !order?.envasado_fecha_fin) {
        const fechas = batches.map(b => b.envasado_registered_at?.slice(0, 10)).filter(Boolean).sort()
        if (fechas.length > 0) {
          if (!order?.envasado_fecha_inicio) patch.envasado_fecha_inicio = fechas[0]
          if (!order?.envasado_fecha_fin) patch.envasado_fecha_fin = fechas[fechas.length - 1]
        }
      }

      const { error: updErr } = await supabase
        .from('plant_orders')
        .update({ status: 'completado', ...patch })
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

  // ── Render ──────────────────────────────────────────────────────────────────

  // Cliente de la orden abierta en "Agregar lote de planta" / "Editar lote"
  // -- para la ayuda "≈ X cajas" y para filtrar el selector de producto del
  // catálogo (productos de ese cliente primero, sin ocultar el resto).
  const loteAddOrder    = orders.find(o => o.id === modalLote)
  const loteOrderClient = clients.find(c => c.id === loteAddOrder?.client_id)
  const editLoteOrder       = orders.find(o => o.id === modalEditLote?.order_id)
  const editLoteOrderClient = clients.find(c => c.id === editLoteOrder?.client_id)

  // Buscador: filtra por código de orden, mercado, cliente o marca de los lotes.
  const searchNeedle = searchQuery.trim().toLowerCase()
  const matchesSearch = (order) => {
    if (!searchNeedle) return true
    const batches = order.plant_production_batches ?? []
    const haystack = [
      order.order_code,
      order.client_order_number,
      order.market,
      order.plant_clients?.name,
      ...batches.map(b => b.brand),
      ...batches.map(b => loteLabel(b)),
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(searchNeedle)
  }

  // orders ya viene filtrado a 'en_proceso' desde loadData -- las órdenes
  // 'completado' viven en /embarque.
  const enProceso = orders.filter(matchesSearch)

  // Stock acumulado por lote de origen (ya calculado por la vista). Viene
  // ordenado cronológicamente (más reciente primero) desde la consulta --
  // aquí solo se recalculan los números, sin reordenar.
  const stockSummary = stockItems.map(s => ({
    ...s,
    received: Number(s.quantity_kg_received ?? 0),
    used: Number(s.kg_used ?? 0),
    available: Number(s.kg_available ?? 0),
  }))
  const stockAgotadosCount = stockSummary.filter(s => s.available <= 0).length
  const stockVisible = showAgotados ? stockSummary : stockSummary.filter(s => s.available > 0)
  const stockTotalPages = Math.max(1, Math.ceil(stockVisible.length / STOCK_PAGE_SIZE))
  const stockPageSafe = Math.min(stockPage, stockTotalPages)
  const stockPageItems = stockVisible.slice((stockPageSafe - 1) * STOCK_PAGE_SIZE, stockPageSafe * STOCK_PAGE_SIZE)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Órdenes de producción</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn small outline" onClick={() => setShowStock(s => !s)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name={showStock ? 'chevronUp' : 'chevronDown'} size={14} />
            {showStock ? 'Ocultar stock' : 'Stock de lotes origen'}
          </button>
          <button className="btn primary" onClick={() => { setModalOrden(true); setError('') }}>
            + Nueva orden
          </button>
        </div>
      </div>

      {/* Panel stock acumulado */}
      {showStock && !loading && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <h4 style={{ margin: 0 }}>
              Stock acumulado de lotes de origen
              <span className="tag info" style={{ marginLeft: 8 }}>{stockVisible.length} lotes</span>
              {stockAgotadosCount > 0 && (
                <span className="tag warn" style={{ marginLeft: 6 }}>{stockAgotadosCount} agotados</span>
              )}
            </h4>
            <button
              className="btn small outline"
              onClick={() => { setShowAgotados(v => !v); setStockPage(1) }}
            >
              {showAgotados ? 'Ocultar agotados' : 'Mostrar agotados'}
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table small">
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Módulo</th>
                  <th>Productor</th>
                  <th>Recibido (kg)</th>
                  <th>Usado (kg)</th>
                  <th>Disponible (kg)</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {stockPageItems.map((s) => {
                  const { received, used, available } = s
                  const pctUsed = received > 0 ? (used / received * 100) : 0
                  return (
                    <tr key={s.exit_item_id} style={{ opacity: available <= 0 ? 0.6 : 1 }}>
                      <td><strong>{s.comprobante_acopio ?? s.guia_remision ?? '—'}</strong></td>
                      <td>{s.module_name ?? '—'}</td>
                      <td>{s.producer_name ?? '—'}</td>
                      <td>{received.toFixed(1)}</td>
                      <td>
                        {used.toFixed(1)}
                        <span className="muted" style={{ marginLeft: 4 }}>({pctUsed.toFixed(0)}%)</span>
                      </td>
                      <td>
                        <strong style={{ color: available <= 0 ? '#dc2626' : available < received * 0.2 ? 'var(--warning)' : 'var(--success)' }}>
                          {available.toFixed(1)}
                        </strong>
                      </td>
                      <td>
                        {available <= 0
                          ? <span className="tag warn">Agotado</span>
                          : available < received * 0.2
                          ? <span className="tag warn">Bajo</span>
                          : <span className="tag ok">Disponible</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {stockVisible.length === 0 && (
            <EmptyState message={showAgotados ? 'No hay lotes registrados.' : 'No hay lotes disponibles (todos agotados).'} />
          )}
          {stockTotalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button
                className="btn small outline"
                onClick={() => setStockPage(p => Math.max(1, p - 1))}
                disabled={stockPageSafe <= 1}
              >
                <Icon name="chevronLeft" size={13} />
              </button>
              <span className="muted small">Página {stockPageSafe} de {stockTotalPages}</span>
              <button
                className="btn small outline"
                onClick={() => setStockPage(p => Math.min(stockTotalPages, p + 1))}
                disabled={stockPageSafe >= stockTotalPages}
              >
                <Icon name="chevronRight" size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && (
        <SearchFilterBar
          search={searchQuery} onSearchChange={setSearchQuery}
          searchPlaceholder="Buscar por orden, cliente, marca o contenedor..."
          style={{ maxWidth: 480 }}
        />
      )}

      {loading ? (
        <SkeletonList count={3} lines={2} />
      ) : enProceso.length === 0 ? (
        <EmptyState message={searchNeedle ? 'Ninguna orden en proceso coincide con la búsqueda.' : 'No hay órdenes en proceso.'} />
      ) : (
        <div className="list">
          {enProceso.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              stockItems={stockItems}
              processingLimits={processingLimits}
              kgPerQuintal={kgPerQuintal}
              webUsersMap={webUsersMap}
              onEditOrder={openEditOrder}
              onEditLote={openEditLote}
              onAddLote={() => {
                setModalLote(order.id)
                setFormLote({ ...emptyFormLote, ...computeLoteDefaults(order) })
                setAssignBrandToProduct(false)
                setAutoBoxesCount('')
                // Un lote de envasado siempre es orgánico -- la certificación
                // marcada como default (Orgánica) viene premarcada, sigue
                // siendo editable/desmarcable igual que el resto de defaults.
                setLoteCertIds(availableCerts.filter(c => c.is_default).map(c => c.id))
                setError('')
              }}
              onGestionarBunques={(pb) => navigate(`/bunques?lote=${pb.id}`)}
              onGestionarEnvasado={(pb) => setModalEnvasado(pb)}
              onGestionarSelladoEnvasadoCaes={(pb) => setModalSelladoEnvasadoCaes({ batch: pb, order })}
              onGestionarHermeticidadCaes={(pb) => setModalHermeticidadCaes(pb)}
              onGestionarMonitoreoTamizadoCaes={(pb) => setModalMonitoreoTamizadoCaes(pb)}
              onGestionarCalidad={(pb) => setModalCalidad(pb)}
              onCloseLote={handleCloseLote}
              onComplete={() => handleCompleteOrder(order.id)}
              onDocumentos={() => setModalQuickDocs({ order, containerNumber: null })}
              onResumenTrazabilidad={(pb) => setModalQuickDocs({ order, containerNumber: null, initialDocKey: 'resumen_trazabilidad', initialBatch: pb })}
              onReload={loadData}
            />
          ))}
        </div>
      )}

      {/* ── Modal: Nueva orden ───────────────────────────────────────────────── */}
      {modalOrden && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>Nueva orden de producción</h3>
              {COOPERATIVE?.features?.ventaNacionalExportacion && (
                <div className="field">
                  <label>Tipo de venta *</label>
                  <select
                    value={formOrden.sale_type}
                    onChange={e => setFormOrden({ ...formOrden, sale_type: e.target.value })}
                  >
                    <option value="">Seleccionar...</option>
                    <option value="nacional">Nacional</option>
                    <option value="exportacion">Exportación</option>
                  </select>
                </div>
              )}
              {!(COOPERATIVE?.features?.ventaNacionalExportacion && formOrden.sale_type === 'nacional') && (
                <div className="field">
                  <label>Mercado destino *</label>
                  <input
                    type="text"
                    list="mercados-list"
                    placeholder="Ej: Alemania, EE.UU., Francia..."
                    value={formOrden.market}
                    onChange={e => setFormOrden({ ...formOrden, market: e.target.value })}
                  />
                  <datalist id="mercados-list">
                    <option value="Alemania" />
                    <option value="EE.UU." />
                    <option value="Francia" />
                    <option value="Reino Unido" />
                    <option value="Italia" />
                    <option value="Países Bajos" />
                    <option value="Bélgica" />
                    <option value="Suiza" />
                    <option value="Austria" />
                    <option value="España" />
                    <option value="Canadá" />
                    <option value="Japón" />
                    <option value="Australia" />
                    <option value="Portugal" />
                    <option value="Suecia" />
                    <option value="Noruega" />
                    <option value="Dinamarca" />
                    <option value="Finlandia" />
                    <option value="Polonia" />
                    <option value="Rusia" />
                    <option value="China" />
                    <option value="Corea del Sur" />
                    <option value="Singapur" />
                    <option value="Nueva Zelanda" />
                    <option value="México" />
                    <option value="Brasil" />
                    <option value="Argentina" />
                  </datalist>
                </div>
              )}
              <p className="muted small" style={{ margin: '0 0 8px' }}>
                La carga total se calcula sola, a medida que agregues {LOTE_LABEL_PLURAL_LOWER}.
              </p>
              {formOrden.sale_type !== 'nacional' && (
                <p className="muted small" style={{ margin: '0 0 8px' }}>
                  El número de contenedor se carga después, en "Asignar a contenedor" -- normalmente todavía no se conoce en este paso.
                </p>
              )}
              <div className="field" style={{ margin: 0 }}>
                <label>Producto</label>
                <input
                  type="text"
                  value={formOrden.product}
                  onChange={e => setFormOrden({ ...formOrden, product: e.target.value })}
                />
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Cliente</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      style={{ flex: 1 }}
                      value={formOrden.client_id}
                      onChange={e => setFormOrden({ ...formOrden, client_id: e.target.value })}
                    >
                      <option value="">Sin cliente</option>
                      {clients.filter(c => c.is_active).map(c => (
                        <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
                      ))}
                    </select>
                    <button type="button" className="btn small outline" onClick={() => { setFormCliente(emptyFormCliente); setModalCliente(true) }}>
                      + Nuevo
                    </button>
                  </div>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Número de venta</label>
                  <input
                    type="text"
                    placeholder="Ej: VTA-2026-001"
                    value={formOrden.sale_number}
                    onChange={e => setFormOrden({ ...formOrden, sale_number: e.target.value })}
                  />
                </div>
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Número de orden de producción</label>
                <input
                  type="text"
                  placeholder="Ej: dado por el cliente"
                  value={formOrden.client_order_number}
                  onChange={e => setFormOrden({ ...formOrden, client_order_number: e.target.value })}
                />
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Contenedor N°</label>
                <input
                  type="text"
                  placeholder="Código interno de la cooperativa"
                  value={formOrden.internal_container_number}
                  onChange={e => setFormOrden({ ...formOrden, internal_container_number: e.target.value })}
                />
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  Distinto de la serie del contenedor físico (esa se carga después, al despachar). Este es el que sale impreso en los documentos de planta.
                </p>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Fechas del flujo
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 4 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tamizado — inicio</label>
                  <DateInput value={formOrden.tamizado_fecha_inicio} onChange={e => setFormOrden({ ...formOrden, tamizado_fecha_inicio: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tamizado — fin</label>
                  <DateInput value={formOrden.tamizado_fecha_fin} onChange={e => setFormOrden({ ...formOrden, tamizado_fecha_fin: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Envasado — inicio</label>
                  <DateInput value={formOrden.envasado_fecha_inicio} onChange={e => setFormOrden({ ...formOrden, envasado_fecha_inicio: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Envasado — fin</label>
                  <DateInput value={formOrden.envasado_fecha_fin} onChange={e => setFormOrden({ ...formOrden, envasado_fecha_fin: e.target.value })} />
                </div>
              </div>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                La fecha de envío ya no se pide aquí -- se toma de la fecha de salida al registrar el contenedor en Embarque.
              </p>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Observaciones</label>
                <textarea
                  rows={2}
                  placeholder="Opcional"
                  value={formOrden.notes}
                  onChange={e => setFormOrden({ ...formOrden, notes: e.target.value })}
                />
              </div>
              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{error}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => setModalOrden(false)} disabled={saving}>Cancelar</button>
              <button className="btn small primary" onClick={handleCreateOrder} disabled={saving}>
                {saving ? 'Creando...' : 'Crear orden'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo cliente (alta rápida -- defaults y edición en "Catálogos") ── */}
      {modalCliente && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>Nuevo cliente</h3>
              <div className="field">
                <label>Nombre *</label>
                <input
                  type="text"
                  placeholder="Ej: Ethiquable"
                  value={formCliente.name}
                  onChange={e => setFormCliente({ ...formCliente, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Correlativo</label>
                <input
                  type="text"
                  placeholder="Opcional — puede tener letras o números"
                  value={formCliente.code}
                  onChange={e => setFormCliente({ ...formCliente, code: e.target.value })}
                />
              </div>
              <p className="muted small">
                Los valores predeterminados de presentación se configuran después, en "Catálogos".
              </p>
              {clienteError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{clienteError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalCliente(false); setClienteError('') }} disabled={savingCliente}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveCliente} disabled={savingCliente}>
                {savingCliente ? 'Guardando...' : 'Crear cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Editar orden ──────────────────────────────────────────────── */}
      {modalEditOrden && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>Editar orden: {modalEditOrden.client_order_number ?? modalEditOrden.order_code}</h3>
              {COOPERATIVE?.features?.ventaNacionalExportacion && (
                <div className="field">
                  <label>Tipo de venta *</label>
                  <select
                    value={formEditOrden.sale_type}
                    onChange={e => setFormEditOrden({ ...formEditOrden, sale_type: e.target.value })}
                  >
                    <option value="">Seleccionar...</option>
                    <option value="nacional">Nacional</option>
                    <option value="exportacion">Exportación</option>
                  </select>
                </div>
              )}
              {!(COOPERATIVE?.features?.ventaNacionalExportacion && formEditOrden.sale_type === 'nacional') && (
                <div className="field">
                  <label>Mercado destino *</label>
                  <input
                    type="text"
                    list="mercados-edit-list"
                    placeholder="Ej: Alemania, EE.UU., Francia..."
                    value={formEditOrden.market}
                    onChange={e => setFormEditOrden({ ...formEditOrden, market: e.target.value })}
                  />
                  <datalist id="mercados-edit-list">
                    <option value="Alemania" />
                    <option value="EE.UU." />
                    <option value="Francia" />
                    <option value="Reino Unido" />
                    <option value="Italia" />
                    <option value="Países Bajos" />
                    <option value="Bélgica" />
                    <option value="Suiza" />
                    <option value="Austria" />
                    <option value="España" />
                    <option value="Canadá" />
                    <option value="Japón" />
                    <option value="Australia" />
                    <option value="Portugal" />
                    <option value="Suecia" />
                    <option value="Noruega" />
                    <option value="Dinamarca" />
                    <option value="Finlandia" />
                    <option value="Polonia" />
                    <option value="Rusia" />
                    <option value="China" />
                    <option value="Corea del Sur" />
                    <option value="Singapur" />
                    <option value="Nueva Zelanda" />
                    <option value="México" />
                    <option value="Brasil" />
                    <option value="Argentina" />
                  </datalist>
                </div>
              )}
              <p className="muted small" style={{ margin: '0 0 8px' }}>
                Carga total actual: <strong>{modalEditOrden.total_kg != null ? Number(modalEditOrden.total_kg).toFixed(1) : '0'} kg</strong> — se recalcula sola según los {LOTE_LABEL_PLURAL_LOWER}.
              </p>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Producto</label>
                  <input
                    type="text"
                    value={formEditOrden.product}
                    onChange={e => setFormEditOrden({ ...formEditOrden, product: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Cliente</label>
                  <select
                    value={formEditOrden.client_id}
                    onChange={e => setFormEditOrden({ ...formEditOrden, client_id: e.target.value })}
                  >
                    <option value="">Sin cliente</option>
                    {clients.filter(c => c.is_active || c.id === formEditOrden.client_id).map(c => (
                      <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Número de venta</label>
                  <input
                    type="text"
                    placeholder="Ej: VTA-2026-001"
                    value={formEditOrden.sale_number}
                    onChange={e => setFormEditOrden({ ...formEditOrden, sale_number: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Número de orden de producción</label>
                  <input
                    type="text"
                    value={formEditOrden.client_order_number}
                    onChange={e => setFormEditOrden({ ...formEditOrden, client_order_number: e.target.value })}
                  />
                </div>
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Contenedor N°</label>
                <input
                  type="text"
                  placeholder="Código interno de la cooperativa"
                  value={formEditOrden.internal_container_number}
                  onChange={e => setFormEditOrden({ ...formEditOrden, internal_container_number: e.target.value })}
                />
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  Distinto de la serie del contenedor físico (esa se carga después, al despachar). Este es el que sale impreso en los documentos de planta.
                </p>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Fechas del flujo
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 4 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tamizado — inicio</label>
                  <DateInput value={formEditOrden.tamizado_fecha_inicio} onChange={e => setFormEditOrden({ ...formEditOrden, tamizado_fecha_inicio: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tamizado — fin</label>
                  <DateInput value={formEditOrden.tamizado_fecha_fin} onChange={e => setFormEditOrden({ ...formEditOrden, tamizado_fecha_fin: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Envasado — inicio</label>
                  <DateInput value={formEditOrden.envasado_fecha_inicio} onChange={e => setFormEditOrden({ ...formEditOrden, envasado_fecha_inicio: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Envasado — fin</label>
                  <DateInput value={formEditOrden.envasado_fecha_fin} onChange={e => setFormEditOrden({ ...formEditOrden, envasado_fecha_fin: e.target.value })} />
                </div>
              </div>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                La fecha de envío ya no se pide aquí -- se toma de la fecha de salida al registrar el contenedor en Embarque.
              </p>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Observaciones</label>
                <textarea
                  rows={2}
                  placeholder="Opcional"
                  value={formEditOrden.notes}
                  onChange={e => setFormEditOrden({ ...formEditOrden, notes: e.target.value })}
                />
              </div>
              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{error}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => setModalEditOrden(null)} disabled={saving}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveEditOrder} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo lote de planta ──────────────────────────────────────── */}
      {modalLote && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>Agregar {LOTE_LABEL_LOWER} de planta</h3>
              <div className="field">
                <label>Producto del catálogo *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    style={{ flex: 1 }}
                    value={formLote.product_catalog_id}
                    onChange={e => applyProductToLoteForm(setFormLote, e.target.value)}
                  >
                    <option value="">Sin producto de catálogo</option>
                    {productsForSelect(loteAddOrder?.client_id).map(p => (
                      <option key={p.id} value={p.id}>{p.description}</option>
                    ))}
                  </select>
                  <button type="button" className="btn small outline" onClick={() => {
                    setProductoError('')
                    setFormProducto({ ...emptyFormProducto, client_id: loteAddOrder?.client_id || '' })
                    setModalProducto(true)
                  }}>
                    + Nuevo
                  </button>
                </div>
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Marca *</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      style={{ flex: 1 }}
                      list="marcas-list"
                      placeholder="Ej: NORANDINO, PanelaBio..."
                      value={formLote.brand}
                      readOnly={productHasOwnBrand(formLote.product_catalog_id)}
                      onChange={e => setFormLote({ ...formLote, brand: e.target.value })}
                    />
                    <datalist id="marcas-list">
                      {brandOptionsForLote(formLote.product_catalog_id).map(b => <option key={b.id} value={b.label} />)}
                    </datalist>
                    {!productHasOwnBrand(formLote.product_catalog_id) && (
                      <button type="button" className="btn small outline" onClick={() => { setMarcaError(''); setFormMarca(''); setModalMarca(true) }}>
                        + Nueva
                      </button>
                    )}
                  </div>
                  {productHasOwnBrand(formLote.product_catalog_id) && (
                    <p className="muted small" style={{ margin: '4px 0 0' }}>
                      La marca viene fija por el producto elegido — para otra marca, cree un producto nuevo.
                    </p>
                  )}
                  {!productHasOwnBrand(formLote.product_catalog_id) && formLote.product_catalog_id && formLote.brand.trim() && (
                    <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontWeight: 400 }}>
                      <input
                        type="checkbox"
                        checked={assignBrandToProduct}
                        onChange={e => setAssignBrandToProduct(e.target.checked)}
                      />
                      Usar "{formLote.brand.trim()}" como marca fija de este producto
                    </label>
                  )}
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Número de {LOTE_LABEL_LOWER} *</label>
                  <input
                    type="text"
                    value={formLote.client_batch_number}
                    onChange={e => setFormLote({ ...formLote, client_batch_number: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tipo de empaque *</label>
                  <select
                    value={formLote.packaging_type}
                    onChange={e => setFormLote({ ...formLote, packaging_type: e.target.value })}
                  >
                    <option value="bolsa">Bolsa</option>
                    <option value="saco">Saco</option>
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Cantidad de {PACKAGING_TYPE_LABELS[formLote.packaging_type].toLowerCase()}s *</label>
                  <input
                    type="number" min="1" step="1" placeholder="1000"
                    value={formLote.packaging_count}
                    onChange={e => applyPackagingCount(formLote, setFormLote, e.target.value, loteOrderClient, autoBoxesCount, setAutoBoxesCount)}
                  />
                  {formLote.packaging_type === 'bolsa' && loteOrderClient?.default_units_per_box > 0 && formLote.packaging_count && (
                    <p className="muted small" style={{ margin: '4px 0 0' }}>
                      ≈ {Math.ceil(parseFloat(formLote.packaging_count) / loteOrderClient.default_units_per_box)} cajas ({loteOrderClient.default_units_per_box} bolsas/caja, según cliente)
                    </p>
                  )}
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Kg por {PACKAGING_TYPE_LABELS[formLote.packaging_type].toLowerCase()} *</label>
                  <input
                    type="number" min="0.001" step="0.001" placeholder="0.5"
                    value={formLote.packaging_kg}
                    onChange={e => setFormLote({ ...formLote, packaging_kg: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Número de cajas</label>
                  <input
                    type="number" min="0" step="1" placeholder="Ej: 40"
                    value={formLote.boxes_count}
                    onChange={e => setFormLote({ ...formLote, boxes_count: e.target.value })}
                  />
                </div>
              </div>
              {formLote.packaging_count && formLote.packaging_kg && (
                <p className="muted small" style={{ marginTop: 8 }}>
                  Total planificado: <strong>
                    {(parseFloat(formLote.packaging_count || 0) * parseFloat(formLote.packaging_kg || 0)).toFixed(1)} kg
                  </strong>
                </p>
              )}
              <div className="field" style={{ marginTop: 8 }}>
                <label>Descripción del {LOTE_LABEL_LOWER}</label>
                <input
                  type="text"
                  placeholder="Ej: Panela orgánica en polvo para Ethiquable"
                  value={formLote.description}
                  onChange={e => setFormLote({ ...formLote, description: e.target.value })}
                />
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Fecha de vencimiento</label>
                  <DateInput
                    value={formLote.best_before_date}
                    onChange={e => setFormLote({ ...formLote, best_before_date: e.target.value })}
                  />
                  {!formLote.best_before_date && (
                    <button
                      type="button"
                      className="btn small outline"
                      style={{ marginTop: 4, fontSize: 11 }}
                      onClick={() => setFormLote(f => ({ ...f, best_before_date: calcBestBeforeDate(f.packaging_type, f.packaging_kg) }))}
                    >
                      Calcular automáticamente
                    </button>
                  )}
                </div>
                {COOPERATIVE?.features?.pallets && (
                  <div className="field" style={{ margin: 0 }}>
                    <label>Pallets por {LOTE_LABEL_LOWER}</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Ej: 20"
                      value={formLote.pallet_count}
                      onChange={e => setFormLote({ ...formLote, pallet_count: e.target.value })}
                    />
                  </div>
                )}
              </div>
              {availableCerts.length > 0 && (
                <div className="field" style={{ marginTop: 12 }}>
                  <label>Certificaciones del {LOTE_LABEL_LOWER}</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {availableCerts.map(cert => (
                      <label key={cert.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', background: loteCertIds.includes(cert.id) ? '#dbeafe' : '#f1f5f9', border: `1px solid ${loteCertIds.includes(cert.id) ? '#93c5fd' : 'var(--border)'}`, borderRadius: 6, padding: '4px 10px' }}>
                        <input
                          type="checkbox"
                          checked={loteCertIds.includes(cert.id)}
                          onChange={() => setLoteCertIds(prev => prev.includes(cert.id) ? prev.filter(x => x !== cert.id) : [...prev, cert.id])}
                        />
                        {cert.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{error}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalLote(null); setLoteCertIds([]) }} disabled={saving}>Cancelar</button>
              <button className="btn small primary" onClick={handleCreateLote} disabled={saving}>
                {saving ? 'Guardando...' : `Agregar ${LOTE_LABEL_LOWER}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Editar lote de planta ─────────────────────────────────────── */}
      {modalEditLote && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>Editar {LOTE_LABEL_LOWER} de planta</h3>
              <div className="field">
                <label>Producto del catálogo *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    style={{ flex: 1 }}
                    value={formEditLote.product_catalog_id}
                    onChange={e => applyProductToLoteForm(setFormEditLote, e.target.value)}
                  >
                    <option value="">Sin producto de catálogo</option>
                    {[...productsForSelect(editLoteOrder?.client_id), ...products.filter(p => !p.is_active && p.id === formEditLote.product_catalog_id)].map(p => (
                      <option key={p.id} value={p.id}>{p.description}</option>
                    ))}
                  </select>
                  <button type="button" className="btn small outline" onClick={() => {
                    setProductoError('')
                    setFormProducto({ ...emptyFormProducto, client_id: editLoteOrder?.client_id || '' })
                    setModalProducto(true)
                  }}>
                    + Nuevo
                  </button>
                </div>
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Marca *</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      style={{ flex: 1 }}
                      list="marcas-edit-lote-list"
                      placeholder="Ej: NORANDINO, PanelaBio..."
                      value={formEditLote.brand}
                      readOnly={productHasOwnBrand(formEditLote.product_catalog_id)}
                      onChange={e => setFormEditLote({ ...formEditLote, brand: e.target.value })}
                    />
                    <datalist id="marcas-edit-lote-list">
                      {brandOptionsForLote(formEditLote.product_catalog_id).map(b => <option key={b.id} value={b.label} />)}
                    </datalist>
                    {!productHasOwnBrand(formEditLote.product_catalog_id) && (
                      <button type="button" className="btn small outline" onClick={() => { setMarcaError(''); setFormMarca(''); setModalMarca(true) }}>
                        + Nueva
                      </button>
                    )}
                  </div>
                  {productHasOwnBrand(formEditLote.product_catalog_id) && (
                    <p className="muted small" style={{ margin: '4px 0 0' }}>
                      La marca viene fija por el producto elegido — para otra marca, cree un producto nuevo.
                    </p>
                  )}
                  {!productHasOwnBrand(formEditLote.product_catalog_id) && formEditLote.product_catalog_id && formEditLote.brand.trim() && (
                    <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontWeight: 400 }}>
                      <input
                        type="checkbox"
                        checked={editAssignBrandToProduct}
                        onChange={e => setEditAssignBrandToProduct(e.target.checked)}
                      />
                      Usar "{formEditLote.brand.trim()}" como marca fija de este producto
                    </label>
                  )}
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Número de {LOTE_LABEL_LOWER} *</label>
                  <input
                    type="text"
                    value={formEditLote.client_batch_number}
                    onChange={e => setFormEditLote({ ...formEditLote, client_batch_number: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tipo de empaque *</label>
                  <select
                    value={formEditLote.packaging_type}
                    onChange={e => setFormEditLote({ ...formEditLote, packaging_type: e.target.value })}
                  >
                    <option value="bolsa">Bolsa</option>
                    <option value="saco">Saco</option>
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Cantidad de {PACKAGING_TYPE_LABELS[formEditLote.packaging_type].toLowerCase()}s *</label>
                  <input
                    type="number" min="1" step="1" placeholder="1000"
                    value={formEditLote.packaging_count}
                    onChange={e => applyPackagingCount(formEditLote, setFormEditLote, e.target.value, editLoteOrderClient, editAutoBoxesCount, setEditAutoBoxesCount)}
                  />
                  {formEditLote.packaging_type === 'bolsa' && editLoteOrderClient?.default_units_per_box > 0 && formEditLote.packaging_count && (
                    <p className="muted small" style={{ margin: '4px 0 0' }}>
                      ≈ {Math.ceil(parseFloat(formEditLote.packaging_count) / editLoteOrderClient.default_units_per_box)} cajas ({editLoteOrderClient.default_units_per_box} bolsas/caja, según cliente)
                    </p>
                  )}
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Kg por {PACKAGING_TYPE_LABELS[formEditLote.packaging_type].toLowerCase()} *</label>
                  <input
                    type="number" min="0.001" step="0.001" placeholder="0.5"
                    value={formEditLote.packaging_kg}
                    onChange={e => setFormEditLote({ ...formEditLote, packaging_kg: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Número de cajas</label>
                  <input
                    type="number" min="0" step="1" placeholder="Ej: 40"
                    value={formEditLote.boxes_count}
                    onChange={e => setFormEditLote({ ...formEditLote, boxes_count: e.target.value })}
                  />
                </div>
              </div>
              {formEditLote.packaging_count && formEditLote.packaging_kg && (
                <p className="muted small" style={{ marginTop: 8 }}>
                  Total planificado: <strong>
                    {(parseFloat(formEditLote.packaging_count || 0) * parseFloat(formEditLote.packaging_kg || 0)).toFixed(1)} kg
                  </strong>
                </p>
              )}
              <div className="field" style={{ marginTop: 8 }}>
                <label>Descripción del {LOTE_LABEL_LOWER}</label>
                <input
                  type="text"
                  placeholder="Ej: Panela orgánica en polvo para Ethiquable"
                  value={formEditLote.description}
                  onChange={e => setFormEditLote({ ...formEditLote, description: e.target.value })}
                />
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Fecha de vencimiento</label>
                  <DateInput
                    value={formEditLote.best_before_date}
                    onChange={e => setFormEditLote({ ...formEditLote, best_before_date: e.target.value })}
                  />
                  {!formEditLote.best_before_date && (
                    <button
                      type="button"
                      className="btn small outline"
                      style={{ marginTop: 4, fontSize: 11 }}
                      onClick={() => setFormEditLote(f => ({ ...f, best_before_date: calcBestBeforeDate(f.packaging_type, f.packaging_kg) }))}
                    >
                      Calcular automáticamente
                    </button>
                  )}
                </div>
                {COOPERATIVE?.features?.pallets && (
                  <div className="field" style={{ margin: 0 }}>
                    <label>Pallets por {LOTE_LABEL_LOWER}</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Ej: 20"
                      value={formEditLote.pallet_count}
                      onChange={e => setFormEditLote({ ...formEditLote, pallet_count: e.target.value })}
                    />
                  </div>
                )}
              </div>
              {availableCerts.length > 0 && (
                <div className="field" style={{ marginTop: 12 }}>
                  <label>Certificaciones del {LOTE_LABEL_LOWER}</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {availableCerts.map(cert => (
                      <label key={cert.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', background: editLoteCertIds.includes(cert.id) ? '#dbeafe' : '#f1f5f9', border: `1px solid ${editLoteCertIds.includes(cert.id) ? '#93c5fd' : 'var(--border)'}`, borderRadius: 6, padding: '4px 10px' }}>
                        <input
                          type="checkbox"
                          checked={editLoteCertIds.includes(cert.id)}
                          onChange={() => setEditLoteCertIds(prev => prev.includes(cert.id) ? prev.filter(x => x !== cert.id) : [...prev, cert.id])}
                        />
                        {cert.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{error}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalEditLote(null); setEditLoteCertIds([]) }} disabled={saving}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveEditLote} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo producto (alta rápida desde "Agregar/Editar lote") ──── */}
      {/* Va DESPUÉS de los modales de lote a propósito -- se abre desde adentro
          de "Agregar/Editar lote", así que en el DOM tiene que quedar después
          para dibujarse encima (mismo z-index en todos los .modal-overlay,
          gana el que aparece más tarde en el árbol). */}
      {modalProducto && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>Nuevo producto</h3>
              <div className="grid two" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Código *</label>
                  <input
                    type="text"
                    placeholder="Ej: PANE01005001"
                    value={formProducto.code}
                    onChange={e => setFormProducto({ ...formProducto, code: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Descripción *</label>
                  <input
                    type="text"
                    placeholder="Ej: Panela exportación x 0.5 kg"
                    value={formProducto.description}
                    onChange={e => setFormProducto({ ...formProducto, description: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Cliente</label>
                  <select
                    value={formProducto.client_id}
                    onChange={e => setFormProducto({ ...formProducto, client_id: e.target.value })}
                  >
                    <option value="">Sin cliente / genérico</option>
                    {clients.filter(c => c.is_active).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Marca</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      style={{ flex: 1 }}
                      value={formProducto.brand_id}
                      onChange={e => setFormProducto({ ...formProducto, brand_id: e.target.value })}
                    >
                      <option value="">Sin marca</option>
                      {brandCatalog.filter(b => b.is_active).map(b => (
                        <option key={b.id} value={b.id}>{b.label}</option>
                      ))}
                    </select>
                    <button type="button" className="btn small outline" onClick={() => setModalMarca(true)}>
                      + Nueva
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tipo de empaque</label>
                  <select
                    value={formProducto.packaging_type}
                    onChange={e => setFormProducto({ ...formProducto, packaging_type: e.target.value })}
                  >
                    <option value="bolsa">Bolsa</option>
                    <option value="saco">Saco</option>
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Kg por {PACKAGING_TYPE_LABELS[formProducto.packaging_type].toLowerCase()}</label>
                  <input
                    type="number" min="0.001" step="0.001" placeholder="0.5"
                    value={formProducto.packaging_kg}
                    onChange={e => setFormProducto({ ...formProducto, packaging_kg: e.target.value })}
                  />
                </div>
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>
                Estos valores solo se sugieren al armar un {LOTE_LABEL_LOWER} de esta orden — no restringen nada, siguen siendo editables.
              </p>
              {productoError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{productoError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalProducto(false); setProductoError('') }} disabled={savingProducto}>Cancelar</button>
              <button className="btn small primary" onClick={handleCreateProducto} disabled={savingProducto}>
                {savingProducto ? 'Guardando...' : 'Crear producto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nueva marca -- va DESPUÉS de Nuevo producto y de los modales
          de lote (mismo motivo: puede abrirse desde adentro de cualquiera de
          los dos, y necesita quedar más arriba en el stacking). ─────────── */}
      {modalMarca && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>Nueva marca</h3>
              <div className="field">
                <label>Nombre *</label>
                <input
                  type="text"
                  placeholder="Ej: NORANDINO, PanelaBio..."
                  value={formMarca}
                  onChange={e => setFormMarca(e.target.value)}
                />
              </div>
              {marcaError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{marcaError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalMarca(false); setMarcaError('') }} disabled={savingMarca}>Cancelar</button>
              <button className="btn small primary" onClick={handleCreateMarca} disabled={savingMarca}>
                {savingMarca ? 'Guardando...' : 'Crear marca'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Envasado ──────────────────────────────────────────────────── */}
      {modalEnvasado && (
        <EnvasadoModal
          plantBatch={modalEnvasado}
          kgPerQuintal={kgPerQuintal}
          webUser={webUser}
          onClose={() => setModalEnvasado(null)}
          onSaved={loadData}
        />
      )}

      {/* ── Modales CAES por lote: Monitoreo del Tamizado, Sellado/Envasado
             y Hermeticidad ──────────────────────────────────────────────── */}
      {modalMonitoreoTamizadoCaes && (
        <MonitoreoTamizadoCaesModal
          plantBatch={modalMonitoreoTamizadoCaes}
          webUser={webUser}
          onClose={() => setModalMonitoreoTamizadoCaes(null)}
        />
      )}
      {modalSelladoEnvasadoCaes && (
        <SelladoEnvasadoCaesModal
          plantBatch={modalSelladoEnvasadoCaes.batch}
          order={modalSelladoEnvasadoCaes.order}
          webUser={webUser}
          onClose={() => setModalSelladoEnvasadoCaes(null)}
        />
      )}
      {modalHermeticidadCaes && (
        <HermeticidadEnvasesCaesModal
          plantBatch={modalHermeticidadCaes}
          webUser={webUser}
          onClose={() => setModalHermeticidadCaes(null)}
        />
      )}

      {/* ── Modal: Control de calidad del envasado ──────────────────────────── */}
      {modalCalidad && (
        <CalidadEnvasadoModal
          plantBatch={modalCalidad}
          webUser={webUser}
          onClose={() => setModalCalidad(null)}
          onSaved={loadData}
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
