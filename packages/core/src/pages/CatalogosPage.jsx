import { formatIsoDate, campaignPeriod, campaignGaps, todayIso } from '../lib/campaigns'
import { useState, useEffect } from 'react'
import { useSimpleCatalog } from '../hooks/useSimpleCatalog'
import ClearableInput from '../components/ClearableInput'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Icon from '../components/Icon'
import AuditStamp from '../components/AuditStamp'
import { AUDIT_COLUMNS } from '../lib/audit'
import { PACKAGING_TYPE_LABELS } from '../lib/loteHelpers'
import { getLoteLabelLower, getLoteLabelPluralLower, getBunqueLabelPluralLower } from '../lib/labels'
import { useConfirm } from '../hooks/useConfirm'
import { useAuthStore } from '../store/authStore'
import { toast } from '../lib/toast'

// Gestión de catálogos de planta: clientes, marcas, productos (SKU/CODPROD)
// y los valores predeterminados de presentación por cliente. Son datos que
// llegan por cooperativa (excel suelto del jefe de planta) y que la
// cooperativa debe poder seguir ampliando, editando o dando de baja sola,
// sin depender de una migración de SQL cada vez -- por eso viven aquí como su
// propia sección, en vez de solo dentro del flujo de Órdenes.
//
// "Valores predeterminados" va separado de "Clientes" a propósito: son dos
// cosas distintas -- uno es la identidad del cliente (nombre/correlativo),
// el otro es una sugerencia editable de presentación que no todos los
// clientes tienen. Más adelante se puede sumar aquí cupos por productor (hoy
// todavía solo por SQL).

const emptyFormCliente = { name: '', code: '' }
const emptyFormDefaults = { client_id: '', default_packaging_type: '', default_units_per_box: '', default_packaging_kg: '', default_pallet_count: '' }
// El producto no está amarrado a un cliente: sirve para cualquier orden.
const emptyFormProducto = { code: '', description: '', brand_id: '', packaging_type: 'bolsa', packaging_kg: '' }
const emptyFormPersonal = { first_name: '', last_name: '' }
const emptyFormCampaign = { id: null, year: '', start_date: '', end_date: '' }
const emptyFormWorker = { first_name: '', last_name: '', coop_module_id: '', dni: '', position: '', certified_since: '', certified_until: '', notes: '' }

// Días de anticipación para avisar "Por vencer" en la certificación.
const CERT_WARNING_DAYS = 30

const toLocalIsoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Estado de la certificación según certified_until. Es solo una advertencia:
// un trabajador vencido sigue apareciendo en el desplegable del móvil (se
// regulariza después, no se frena la producción). Sin fecha = no vence.
function getCertStatus(certifiedUntil) {
  if (!certifiedUntil) return null
  const limit = new Date()
  limit.setDate(limit.getDate() + CERT_WARNING_DAYS)
  if (certifiedUntil < toLocalIsoDate(new Date())) return 'vencida'
  if (certifiedUntil <= toLocalIsoDate(limit)) return 'por_vencer'
  return null
}

// formatIsoDate, campaignPeriod y campaignGaps: lib/campaigns.js (los usa también Cupos).

const hasClientDefaults = (c) =>
  Boolean(c.default_packaging_type || c.default_packaging_kg || c.default_pallet_count || c.default_units_per_box)

// [clave, etiqueta, ícono]
const TAB_GROUPS = [
  { label: 'Comercial', tabs: [['clientes', 'Clientes', 'briefcase'], ['presentacion', 'Presentación por cliente', 'sliders'], ['marcas', 'Marcas', 'tag'], ['productos', 'Productos', 'box']] },
  { label: 'Certificación y personal', tabs: [['certificaciones', 'Certificaciones', 'award'], ['personal', 'Personal de planta', 'users'], ['trabajadores', 'Trabajadores certificados', 'badgeCheck']] },
  { label: 'Producción', tabs: [['campanas', 'Campañas', 'calendar']] },
  { label: 'Planta y logística', tabs: [['balanzas', 'Balanzas', 'scale'], ['transportistas', 'Empresas de transporte', 'truck']] },
]
const TAB_ICONS = Object.fromEntries(TAB_GROUPS.flatMap(g => g.tabs.map(([key, , icon]) => [key, icon])))

// Fila común de todas las listas: nombre + etiquetas + detalle a la
// izquierda, acciones a la derecha. Un registro inactivo se atenúa y lleva
// su etiqueta, en vez de depender solo de la opacidad.
function CatalogRow({ title, badges, subtitle, actions, inactive = false, audit }) {
  return (
    <div className={`catalog-row${inactive ? ' inactive' : ''}`}>
      <div className="catalog-row-main">
        <div className="catalog-row-title">
          <strong>{title}</strong>
          {badges}
          {inactive && <span className="tag">Inactivo</span>}
          <AuditStamp row={audit} />
        </div>
        {subtitle && <div className="muted small">{subtitle}</div>}
      </div>
      {actions && <div className="catalog-row-actions">{actions}</div>}
    </div>
  )
}

export default function CatalogosPage() {
  const COOPERATIVE = useCooperative()
  const { webUser } = useAuthStore()
  // Solo el Administrador mantiene la lista de trabajadores certificados (la
  // BD también lo exige, ver migración 20261012120000).
  const isAdmin = webUser?.role === 'admin_web'
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
  const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE)
  const BUNQUE_LABEL_PLURAL_LOWER = getBunqueLabelPluralLower(COOPERATIVE)
  const [loading, setLoading] = useState(true)
  const [clients, setClients]   = useState([])
  const [brands, setBrands]     = useState([])
  const [products, setProducts] = useState([])
  const [certifications, setCertifications] = useState([])
  const [personnel, setPersonnel] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [workers, setWorkers] = useState([])
  const [modules, setModules] = useState([])
  const [workerModuleFilter, setWorkerModuleFilter] = useState('')

  // Una sola lista visible a la vez (pestañas agrupadas, mismo patrón que
  // Controles); la pestaña sale de la URL, así el botón "Activar campaña"
  // del aviso global (Layout.jsx) cambia de pestaña aunque ya esté aquí.
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') ?? 'clientes'
  const [search, setSearch] = useState('')
  const selectTab = (key) => {
    setSearch('')
    setActionError('')
    setSearchParams({ tab: key })
  }
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [modalCliente, setModalCliente]         = useState(false)
  const [formCliente, setFormCliente]           = useState(emptyFormCliente)
  const [editingClienteId, setEditingClienteId] = useState(null)
  const [clienteError, setClienteError]         = useState('')
  const [savingCliente, setSavingCliente]       = useState(false)

  // Modal aparte para editar solo los defaults de presentación de un cliente.
  const [modalDefaults, setModalDefaults]     = useState(null) // client row, o null
  const [formDefaults, setFormDefaults]       = useState(emptyFormDefaults)
  const [defaultsError, setDefaultsError]     = useState('')
  const [savingDefaults, setSavingDefaults]   = useState(false)

  const [modalMarca, setModalMarca]           = useState(false)
  const [formMarca, setFormMarca]             = useState('')
  const [editingMarcaId, setEditingMarcaId]   = useState(null)
  const [marcaError, setMarcaError]           = useState('')
  const [savingMarca, setSavingMarca]         = useState(false)

  const [modalProducto, setModalProducto]         = useState(false)
  const [formProducto, setFormProducto]           = useState(emptyFormProducto)
  const [editingProductoId, setEditingProductoId] = useState(null)
  const [productoError, setProductoError]         = useState('')
  const [savingProducto, setSavingProducto]       = useState(false)

  const [modalCert, setModalCert]       = useState(false)
  const [formCert, setFormCert]         = useState('')
  const [certError, setCertError]       = useState('')
  const [savingCert, setSavingCert]     = useState(false)

  const [modalPersonal, setModalPersonal]         = useState(false)
  const [formPersonal, setFormPersonal]           = useState(emptyFormPersonal)
  const [editingPersonalId, setEditingPersonalId] = useState(null)
  const [personalError, setPersonalError]         = useState('')
  const [savingPersonal, setSavingPersonal]       = useState(false)

  const [modalWorker, setModalWorker]         = useState(false)
  const [formWorker, setFormWorker]           = useState(emptyFormWorker)
  const [editingWorkerId, setEditingWorkerId] = useState(null)
  const [workerError, setWorkerError]         = useState('')
  const [savingWorker, setSavingWorker]       = useState(false)

  const [modalCampaign, setModalCampaign]     = useState(false)
  const [formCampaign, setFormCampaign]       = useState(emptyFormCampaign)
  const [campaignError, setCampaignError]     = useState('')
  const [savingCampaign, setSavingCampaign]   = useState(false)

  useEffect(() => { loadAll() }, [])

  // Error de carga por lista: sin esto una consulta fallida se veía igual que
  // una lista vacía ("Todavía no hay..."). Si falla, se conservan los datos
  // que ya estaban en pantalla.
  const [loadErrors, setLoadErrors] = useState({})
  const handleLoad = (key, setter) => ({ data, error }) => {
    setLoadErrors(prev => ({ ...prev, [key]: error ? error.message : null }))
    if (!error) setter(data ?? [])
  }

  // Balanzas (código elegido en Calibración de Balanzas) y empresas de
  // transporte (elegidas en el Control de Unidad de Transporte / despacho).
  const balanzas = useSimpleCatalog({
    table: 'plant_balances', cooperativeId: COOPERATIVE.id, orderBy: 'code', loadKey: 'balanzas', handleLoad,
    fields: [
      { key: 'code', label: 'Código', required: true, placeholder: 'Ej: BAG-012' },
      { key: 'area', label: 'Área', placeholder: 'Ej: Envasado' },
      { key: 'equipment_name', label: 'Denominación del equipo', placeholder: 'Ej: Balanza electrónica (0.5g - 3kg)' },
      { key: 'error_maximo_permitido', label: 'Error máximo permitido', placeholder: 'Ej: ±0.04' },
    ],
    titles: { new: 'Nueva balanza', edit: 'Editar balanza', created: 'Balanza creada', updated: 'Balanza actualizada' },
  })
  const transportistas = useSimpleCatalog({
    table: 'plant_transport_companies', cooperativeId: COOPERATIVE.id, orderBy: 'razon_social', loadKey: 'transportistas', handleLoad,
    fields: [
      { key: 'razon_social', label: 'Razón social', required: true },
      { key: 'ruc', label: 'RUC' },
      { key: 'constancia_mtc', label: 'Constancia MTC' },
    ],
    titles: { new: 'Nueva empresa de transporte', edit: 'Editar empresa de transporte', created: 'Empresa de transporte creada', updated: 'Empresa de transporte actualizada' },
  })

  // Error de Activar/Desactivar. `.select('id')` es necesario: si RLS
  // bloquea el UPDATE, Supabase no devuelve error sino 0 filas, y antes el
  // botón simplemente no hacía nada.
  const [actionError, setActionError] = useState('')
  const toggleActive = async (table, row, reload) => {
    setActionError('')
    const verb = row.is_active ? 'desactivar' : 'activar'
    const { data, error } = await supabase
      .from(table)
      .update({ is_active: !row.is_active })
      .eq('id', row.id)
      .select('id')
    if (error) {
      setActionError(`No se pudo ${verb}: ${error.message}`)
      return
    }
    if (!data?.length) {
      setActionError(`No se pudo ${verb}: no tiene permiso para modificar este registro.`)
      return
    }
    toast.success(row.is_active ? 'Registro desactivado' : 'Registro activado')
    reload()
  }

  const loadAll = async () => {
    setLoading(true)
    await Promise.all([loadClients(), loadBrands(), loadProducts(), loadCertifications(), loadPersonnel(), loadWorkers(), loadModules(), loadCampaigns(), balanzas.load(), transportistas.load()])
    setLoading(false)
  }

  const loadClients = () =>
    supabase
      .from('plant_clients')
      .select(`id, name, code, is_active, default_packaging_type, default_units_per_box, default_packaging_kg, default_pallet_count, ${AUDIT_COLUMNS}`)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('name')
      .then(handleLoad('clientes', setClients))

  const loadBrands = () =>
    supabase
      .from('plant_brand_catalog')
      .select(`id, label, is_active, ${AUDIT_COLUMNS}`)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('label')
      .then(handleLoad('marcas', setBrands))

  const loadProducts = () =>
    supabase
      .from('plant_product_catalog')
      .select(`id, code, description, client_id, brand_id, packaging_type, packaging_kg, is_active, ${AUDIT_COLUMNS}`)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('description')
      .then(handleLoad('productos', setProducts))

  // Mismo catálogo (batch_certs) que usan tanto los lotes de campo/recepción
  // (móvil) como los de envasado/planta (aquí) -- una sola fuente para las dos.
  const loadCertifications = () =>
    supabase
      .from('batch_certs')
      .select(`id, name, is_active, is_default, ${AUDIT_COLUMNS}`)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('name')
      .then(handleLoad('certificaciones', setCertifications))

  // Personal de planta (Envasado/Tamizado) para el Control de Salud e
  // Higiene del Personal -- ver HigienePage.jsx, que también permite un alta
  // rápida inline para no obligar a salir del control que se está llenando.
  const loadPersonnel = () =>
    supabase
      .from('plant_personnel')
      .select(`id, first_name, last_name, is_active, ${AUDIT_COLUMNS}`)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('first_name')
      .then(handleLoad('personal', setPersonnel))

  // Trabajadores certificados por módulo de campo -- alimentan el desplegable
  // "Nombre y Apellidos" del Control de personal operario en el móvil
  // (CertifiedWorkersService). Distinto de plant_personnel, que es la planta.
  const loadWorkers = () =>
    supabase
      .from('certified_workers')
      .select(`id, first_name, last_name, coop_module_id, dni, position, certified_since, certified_until, notes, is_active, ${AUDIT_COLUMNS}`)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('last_name')
      .then(handleLoad('trabajadores', setWorkers))

  const loadModules = () =>
    supabase
      .from('coop_modules')
      .select('id, name')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('name')
      .then(handleLoad('modulos', setModules))

  // Campaña productiva -- ver BunquesPage.jsx, la sugerencia automática de
  // N° de bunque se acota a la campaña activa. Solo puede haber una activa
  // por cooperativa a la vez (constraint en la BD).
  const loadCampaigns = () =>
    supabase
      .from('campaigns')
      .select(`id, year, start_date, end_date, is_active, ${AUDIT_COLUMNS}`)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('year', { ascending: false })
      .then(handleLoad('campanas', setCampaigns))

  // ── Clientes (identidad: nombre + correlativo) ──────────────────────────────

  const openNewCliente = () => {
    setClienteError('')
    setEditingClienteId(null)
    setFormCliente(emptyFormCliente)
    setModalCliente(true)
  }

  const openEditCliente = (client) => {
    setClienteError('')
    setEditingClienteId(client.id)
    setFormCliente({ name: client.name ?? '', code: client.code ?? '' })
    setModalCliente(true)
  }

  const handleSaveCliente = async () => {
    setClienteError('')
    if (!formCliente.name.trim()) {
      setClienteError('El nombre es obligatorio')
      return
    }
    setSavingCliente(true)
    try {
      const payload = { name: formCliente.name.trim(), code: formCliente.code.trim() || null }
      if (editingClienteId) {
        const { error: updErr } = await supabase.from('plant_clients').update(payload).eq('id', editingClienteId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { error: insErr } = await supabase.from('plant_clients').insert({ ...payload, cooperative_id: COOPERATIVE.id })
        if (insErr) throw new Error(insErr.message)
      }
      setModalCliente(false)
      setEditingClienteId(null)
      toast.success(editingClienteId ? 'Cliente actualizado' : 'Cliente creado')
      setFormCliente(emptyFormCliente)
      loadClients()
    } catch (err) {
      setClienteError(err.message)
    } finally {
      setSavingCliente(false)
    }
  }

  const handleToggleClienteActive = (client) => toggleActive('plant_clients', client, loadClients)

  // ── Valores predeterminados por cliente (sección propia) ────────────────────

  // "Nuevo" aquí no crea un cliente -- elige a cuál de los ya existentes
  // (que todavía no tenga defaults cargados) asignarle valores por primera
  // vez. modalDefaults = { id: null } marca ese modo "eligiendo cliente".
  const openNewDefaults = () => {
    setDefaultsError('')
    setModalDefaults({ id: null })
    setFormDefaults(emptyFormDefaults)
  }

  const openEditDefaults = (client) => {
    setDefaultsError('')
    setModalDefaults(client)
    setFormDefaults({
      client_id: client.id,
      default_packaging_type: client.default_packaging_type ?? '',
      default_units_per_box:  client.default_units_per_box  != null ? String(client.default_units_per_box) : '',
      default_packaging_kg:   client.default_packaging_kg   != null ? String(client.default_packaging_kg)  : '',
      default_pallet_count:   client.default_pallet_count   != null ? String(client.default_pallet_count) : '',
    })
  }

  const handleSaveDefaults = async () => {
    setDefaultsError('')
    const targetClientId = modalDefaults.id || formDefaults.client_id
    if (!targetClientId) {
      setDefaultsError('Elija a qué cliente corresponde')
      return
    }
    setSavingDefaults(true)
    try {
      const { error: updErr } = await supabase
        .from('plant_clients')
        .update({
          default_packaging_type: formDefaults.default_packaging_type || null,
          default_units_per_box:  formDefaults.default_units_per_box ? parseInt(formDefaults.default_units_per_box) : null,
          default_packaging_kg:   formDefaults.default_packaging_kg  ? parseFloat(formDefaults.default_packaging_kg) : null,
          default_pallet_count:   formDefaults.default_pallet_count  ? parseInt(formDefaults.default_pallet_count) : null,
        })
        .eq('id', targetClientId)
      if (updErr) throw new Error(updErr.message)
      setModalDefaults(null)
      toast.success('Valores predeterminados guardados')
      loadClients()
    } catch (err) {
      setDefaultsError(err.message)
    } finally {
      setSavingDefaults(false)
    }
  }

  // ── Marcas ───────────────────────────────────────────────────────────────

  const openNewMarca = () => {
    setMarcaError('')
    setEditingMarcaId(null)
    setFormMarca('')
    setModalMarca(true)
  }

  const openEditMarca = (brand) => {
    setMarcaError('')
    setEditingMarcaId(brand.id)
    setFormMarca(brand.label)
    setModalMarca(true)
  }

  const handleSaveMarca = async () => {
    setMarcaError('')
    if (!formMarca.trim()) {
      setMarcaError('El nombre es obligatorio')
      return
    }
    setSavingMarca(true)
    try {
      if (editingMarcaId) {
        const { error: updErr } = await supabase.from('plant_brand_catalog').update({ label: formMarca.trim() }).eq('id', editingMarcaId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { error: insErr } = await supabase.from('plant_brand_catalog').insert({ label: formMarca.trim(), cooperative_id: COOPERATIVE.id })
        if (insErr) throw new Error(insErr.message)
      }
      setModalMarca(false)
      setEditingMarcaId(null)
      toast.success(editingMarcaId ? 'Marca actualizada' : 'Marca creada')
      setFormMarca('')
      loadBrands()
    } catch (err) {
      setMarcaError(err.message)
    } finally {
      setSavingMarca(false)
    }
  }

  const handleToggleMarcaActive = (brand) => toggleActive('plant_brand_catalog', brand, loadBrands)

  // ── Productos ────────────────────────────────────────────────────────────

  const openNewProducto = () => {
    setProductoError('')
    setEditingProductoId(null)
    setFormProducto(emptyFormProducto)
    setModalProducto(true)
  }

  const openEditProducto = (product) => {
    setProductoError('')
    setEditingProductoId(product.id)
    setFormProducto({
      code: product.code ?? '',
      description: product.description ?? '',
      brand_id: product.brand_id ?? '',
      packaging_type: product.packaging_type ?? 'bolsa',
      packaging_kg: product.packaging_kg != null ? String(product.packaging_kg) : '',
    })
    setModalProducto(true)
  }

  const handleSaveProducto = async () => {
    setProductoError('')
    if (!formProducto.code.trim() || !formProducto.description.trim()) {
      setProductoError('Código y descripción son obligatorios')
      return
    }
    setSavingProducto(true)
    try {
      const payload = {
        code:            formProducto.code.trim(),
        description:     formProducto.description.trim(),
        // Vínculo a cliente en desuso: al guardar, el producto queda
        // disponible para cualquier cliente.
        client_id:       null,
        brand_id:        formProducto.brand_id || null,
        packaging_type:  formProducto.packaging_type || null,
        packaging_kg:    formProducto.packaging_kg ? parseFloat(formProducto.packaging_kg) : null,
      }
      if (editingProductoId) {
        const { error: updErr } = await supabase.from('plant_product_catalog').update(payload).eq('id', editingProductoId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { error: insErr } = await supabase.from('plant_product_catalog').insert({ ...payload, cooperative_id: COOPERATIVE.id })
        if (insErr) throw new Error(insErr.message)
      }
      setModalProducto(false)
      setEditingProductoId(null)
      toast.success(editingProductoId ? 'Producto actualizado' : 'Producto creado')
      setFormProducto(emptyFormProducto)
      loadProducts()
    } catch (err) {
      setProductoError(err.message)
    } finally {
      setSavingProducto(false)
    }
  }

  const handleToggleProductoActive = (product) => toggleActive('plant_product_catalog', product, loadProducts)

  // ── Certificaciones ──────────────────────────────────────────────────────

  const handleCreateCert = async () => {
    setCertError('')
    if (!formCert.trim()) {
      setCertError('El nombre es obligatorio')
      return
    }
    setSavingCert(true)
    try {
      const { error: insErr } = await supabase.from('batch_certs').insert({ name: formCert.trim(), cooperative_id: COOPERATIVE.id })
      if (insErr) throw new Error(insErr.message)
      setModalCert(false)
      setFormCert('')
      toast.success('Certificación creada')
      loadCertifications()
    } catch (err) {
      setCertError(err.message)
    } finally {
      setSavingCert(false)
    }
  }

  // Al dar de baja una certificación con cupos, se avisa: sus cupos dejan de
  // verse y de avisar (get_plot_quotas_by_campaign solo trae certificaciones
  // activas) pero no se borran; si se reactiva, vuelven.
  const handleToggleCertActive = async (cert) => {
    if (cert.is_active) {
      // Cupos en campañas vigentes o futuras (las pasadas ya no importan).
      const { count } = await supabase.from('plot_quotas')
        .select('id, campaigns!inner ( end_date )', { count: 'exact', head: true })
        .eq('batch_cert_id', cert.id).gte('campaigns.end_date', todayIso())
      if (count > 0) {
        const ok = await confirm({
          title: `Desactivar ${cert.name}`,
          message: `${cert.name} tiene ${count} cupo${count === 1 ? '' : 's'} en la campaña vigente o en futuras. Dejarán de verse y de avisar en la web y el celular. No se borran: si la reactiva, vuelven.`,
          confirmText: 'Desactivar',
        })
        if (!ok) return
      }
    }
    toggleActive('batch_certs', cert, loadCertifications)
  }

  // ── Personal de planta ───────────────────────────────────────────────────

  const openNewPersonal = () => {
    setPersonalError('')
    setEditingPersonalId(null)
    setFormPersonal(emptyFormPersonal)
    setModalPersonal(true)
  }

  const openEditPersonal = (person) => {
    setPersonalError('')
    setEditingPersonalId(person.id)
    setFormPersonal({ first_name: person.first_name ?? '', last_name: person.last_name ?? '' })
    setModalPersonal(true)
  }

  const handleSavePersonal = async () => {
    setPersonalError('')
    if (!formPersonal.first_name.trim() || !formPersonal.last_name.trim()) {
      setPersonalError('Nombre y apellido son obligatorios')
      return
    }
    setSavingPersonal(true)
    try {
      const payload = { first_name: formPersonal.first_name.trim(), last_name: formPersonal.last_name.trim() }
      if (editingPersonalId) {
        const { error: updErr } = await supabase.from('plant_personnel').update(payload).eq('id', editingPersonalId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { error: insErr } = await supabase.from('plant_personnel').insert({ ...payload, cooperative_id: COOPERATIVE.id })
        if (insErr) throw new Error(insErr.message)
      }
      setModalPersonal(false)
      setEditingPersonalId(null)
      toast.success(editingPersonalId ? 'Personal actualizado' : 'Personal creado')
      setFormPersonal(emptyFormPersonal)
      loadPersonnel()
    } catch (err) {
      setPersonalError(err.message)
    } finally {
      setSavingPersonal(false)
    }
  }

  const handleTogglePersonalActive = (person) => toggleActive('plant_personnel', person, loadPersonnel)

  // ── Trabajadores certificados ───────────────────────────────────────────

  const openNewWorker = () => {
    setWorkerError('')
    setEditingWorkerId(null)
    // Si hay un módulo filtrado, el alta arranca en ese módulo.
    setFormWorker({ ...emptyFormWorker, coop_module_id: workerModuleFilter })
    setModalWorker(true)
  }

  const openEditWorker = (w) => {
    setWorkerError('')
    setEditingWorkerId(w.id)
    setFormWorker({
      first_name: w.first_name ?? '',
      last_name: w.last_name ?? '',
      coop_module_id: w.coop_module_id ?? '',
      dni: w.dni ?? '',
      position: w.position ?? '',
      certified_since: w.certified_since ?? '',
      certified_until: w.certified_until ?? '',
      notes: w.notes ?? '',
    })
    setModalWorker(true)
  }

  const handleSaveWorker = async () => {
    setWorkerError('')
    if (!formWorker.first_name.trim() || !formWorker.last_name.trim() || !formWorker.coop_module_id) {
      setWorkerError('Nombre, apellido y módulo son obligatorios')
      return
    }
    const dni = formWorker.dni.trim()
    if (dni && !/^\d{8}$/.test(dni)) {
      setWorkerError('El DNI debe tener 8 dígitos')
      return
    }
    if (formWorker.certified_since && formWorker.certified_until && formWorker.certified_until < formWorker.certified_since) {
      setWorkerError('"Certificado hasta" no puede ser anterior a "Certificado desde"')
      return
    }
    setSavingWorker(true)
    try {
      const payload = {
        first_name: formWorker.first_name.trim(),
        last_name: formWorker.last_name.trim(),
        coop_module_id: formWorker.coop_module_id,
        dni: dni || null,
        position: formWorker.position.trim() || null,
        certified_since: formWorker.certified_since || null,
        certified_until: formWorker.certified_until || null,
        notes: formWorker.notes.trim() || null,
      }
      // Al crear: si ya existe en el módulo (mismo DNI o, sin DNI, mismo
      // nombre) no se duplica. Dado de baja → se reactiva con estos datos;
      // activo → se avisa. Igual que en el celular.
      const fullName = `${payload.first_name} ${payload.last_name}`.toLowerCase()
      const existing = editingWorkerId ? null : workers.find(w =>
        w.coop_module_id === payload.coop_module_id &&
        (dni ? w.dni === dni : `${w.first_name} ${w.last_name}`.trim().toLowerCase() === fullName))
      if (existing?.is_active) {
        setWorkerError(`${existing.first_name} ${existing.last_name} ya está registrado en este módulo`)
        return
      }
      if (editingWorkerId || existing) {
        const { error: updErr } = await supabase.from('certified_workers')
          .update(existing ? { ...payload, is_active: true } : payload)
          .eq('id', editingWorkerId || existing.id)
        if (updErr) throw updErr
      } else {
        const { error: insErr } = await supabase.from('certified_workers').insert({ ...payload, cooperative_id: COOPERATIVE.id })
        if (insErr) throw insErr
      }
      setModalWorker(false)
      setEditingWorkerId(null)
      toast.success(existing ? 'Trabajador reactivado' : editingWorkerId ? 'Trabajador actualizado' : 'Trabajador creado')
      setFormWorker(emptyFormWorker)
      loadWorkers()
    } catch (err) {
      // idx_cw_unique_dni_per_module: mismo DNI dos veces en el mismo módulo.
      setWorkerError(err.code === '23505' ? 'Ya existe un trabajador con ese DNI en este módulo' : err.message)
    } finally {
      setSavingWorker(false)
    }
  }

  const handleToggleWorkerActive = (w) => toggleActive('certified_workers', w, loadWorkers)

  // ── Campañas ─────────────────────────────────────────────────────────────

  const openNewCampaign = () => {
    setCampaignError('')
    const maxYear = campaigns.reduce((m, c) => Math.max(m, c.year), 0)
    // Solo una sugerencia editable, igual que el N° de bunque -- nunca
    // restringe: el usuario puede tipear cualquier año.
    setFormCampaign({ ...emptyFormCampaign, year: maxYear > 0 ? String(maxYear + 1) : String(new Date().getFullYear()) })
    setModalCampaign(true)
  }

  // Editar el periodo de una campaña existente (los cupos y lo usado se
  // recalculan solos: lo usado se calcula desde los lotes).
  const openEditCampaign = (c) => {
    setCampaignError('')
    setFormCampaign({ id: c.id, year: String(c.year), start_date: c.start_date ?? '', end_date: c.end_date ?? '' })
    setModalCampaign(true)
  }

  const handleSaveCampaign = async () => {
    setCampaignError('')
    if (formCampaign.id) {
      setSavingCampaign(true)
      try {
        const { error: updErr } = await supabase.from('campaigns').update({
          start_date: formCampaign.start_date || null,
          end_date: formCampaign.end_date || null,
        }).eq('id', formCampaign.id)
        if (updErr) throw new Error(updErr.message)
        setModalCampaign(false)
        setFormCampaign(emptyFormCampaign)
        toast.success(`Periodo de la campaña ${formCampaign.year} actualizado`)
        loadCampaigns()
      } catch (err) {
        setCampaignError(err.message)
      } finally {
        setSavingCampaign(false)
      }
      return
    }
    const yearNum = parseInt(formCampaign.year)
    if (!yearNum) {
      setCampaignError('Ingrese un año válido')
      return
    }
    setSavingCampaign(true)
    try {
      const { error: insErr } = await supabase.from('campaigns').insert({
        cooperative_id: COOPERATIVE.id,
        year: yearNum,
        start_date: formCampaign.start_date || null,
        end_date: formCampaign.end_date || null,
      })
      if (insErr) throw new Error(insErr.message)
      setModalCampaign(false)
      setFormCampaign(emptyFormCampaign)
      toast.success(`Campaña ${yearNum} creada`)
      loadCampaigns()
    } catch (err) {
      setCampaignError(err.message)
    } finally {
      setSavingCampaign(false)
    }
  }

  // Abrir una campaña cierra la que esté activa antes -- solo puede haber
  // una vigente por cooperativa (así lo pidió el usuario: apertura/cierre
  // administrado a propósito, no automático por fecha del sistema).
  const handleOpenCampaign = async (campaign) => {
    setCampaignError('')
    setSavingCampaign(true)
    // Son dos pasos (cerrar la vigente, abrir la nueva) porque la BD no
    // permite dos activas a la vez. Si el segundo falla, se vuelve a abrir la
    // que estaba -- antes la cooperativa podía quedar sin campaña activa.
    const previous = campaigns.find(c => c.is_active)
    try {
      if (previous) {
        const { error: closeErr } = await supabase.from('campaigns').update({ is_active: false }).eq('id', previous.id)
        if (closeErr) throw new Error(closeErr.message)
      }
      const { data: opened, error: updErr } = await supabase.from('campaigns').update({ is_active: true }).eq('id', campaign.id).select('id')
      if (updErr || !opened?.length) {
        if (previous) await supabase.from('campaigns').update({ is_active: true }).eq('id', previous.id)
        throw new Error(updErr?.message ?? 'no tiene permiso para modificar campañas')
      }
      toast.success(`Campaña ${campaign.year} abierta`)
    } catch (err) {
      setCampaignError(`No se pudo abrir la campaña ${campaign.year}: ${err.message}`)
    } finally {
      loadCampaigns()
      setSavingCampaign(false)
    }
  }

  const handleCloseCampaign = async (campaign) => {
    setCampaignError('')
    const ok = await confirm({
      title: 'Cerrar campaña',
      message: `¿Cerrar la campaña ${campaign.year}? Deja de ser la campaña vigente -- los ${BUNQUE_LABEL_PLURAL_LOWER} nuevos ya no van a sugerir número dentro de ella hasta que se abra otra.`,
      confirmText: 'Cerrar campaña',
    })
    if (!ok) return
    setSavingCampaign(true)
    try {
      const { error: updErr } = await supabase.from('campaigns').update({ is_active: false }).eq('id', campaign.id)
      if (updErr) throw new Error(updErr.message)
      toast.success(`Campaña ${campaign.year} cerrada`)
      loadCampaigns()
    } catch (err) {
      setCampaignError(err.message)
    } finally {
      setSavingCampaign(false)
    }
  }

  const brandLabel = (id) => brands.find(b => b.id === id)?.label
  const moduleName = (id) => modules.find(m => m.id === id)?.name ?? '—'

  if (loading) {
    return (
      <div>
        <h2 style={{ margin: '0 0 16px' }}>Catálogos</h2>
        <SkeletonList count={4} lines={2} />
      </div>
    )
  }

  const COUNTS = {
    clientes: clients.length,
    presentacion: clients.length,
    marcas: brands.length,
    productos: products.length,
    certificaciones: certifications.length,
    personal: personnel.length,
    trabajadores: workers.length,
    campanas: campaigns.length,
    balanzas: balanzas.rows.length,
    transportistas: transportistas.rows.length,
  }

  // Activos primero; dentro de cada grupo se respeta el orden de la consulta.
  const activeFirst = (rows) => [...rows].sort((a, b) => Number(b.is_active) - Number(a.is_active))
  const query = search.trim().toLowerCase()
  const matches = (...fields) => !query || fields.some(f => f && String(f).toLowerCase().includes(query))

  const toggleButton = (row, onToggle) => (
    <button className={`btn small ${row.is_active ? 'danger' : 'outline'}`} onClick={() => onToggle(row)}>
      {row.is_active ? 'Desactivar' : 'Activar'}
    </button>
  )
  const editButton = (onClick) => <button className="btn small outline" onClick={onClick}>Editar</button>

  const LOAD_KEYS = { presentacion: ['clientes'], trabajadores: ['trabajadores', 'modulos'] }
  const currentLoadError = (LOAD_KEYS[tab] ?? [tab]).map(k => loadErrors[k]).find(Boolean)

  const renderList = (rows, emptyMessage, renderRow) => {
    // Con error de carga el aviso ya está arriba -- no decir "Todavía no hay...".
    if (rows.length === 0 && currentLoadError) return null
    if (rows.length === 0) {
      return query
        ? <EmptyState icon="search" message="No hay resultados para la búsqueda." />
        : <EmptyState message={emptyMessage} action={section.onNew ? { label: section.newLabel, onClick: section.onNew } : undefined} />
    }
    return <div className="catalog-list">{rows.map(renderRow)}</div>
  }

  const searchBox = (placeholder) => (
    <div className="catalog-search">
      <Icon name="search" size={16} />
      <ClearableInput placeholder={placeholder} value={search} onChange={e => setSearch(e.target.value)} onClear={() => setSearch('')} />
    </div>
  )

  const SECTIONS = {
    balanzas: {
      title: 'Balanzas',
      description: 'Códigos para la calibración de balanzas.',
      onNew: balanzas.openNew,
      newLabel: 'Nueva balanza',
      body: () => (
        <>
          {searchBox('Buscar por código, área o equipo')}
          {renderList(
            activeFirst(balanzas.rows).filter(b => matches(b.code, b.area, b.equipment_name)),
            'Todavía no hay balanzas cargadas.',
            b => (
              <CatalogRow
                key={b.id}
                audit={b}
                inactive={!b.is_active}
                title={b.code}
                subtitle={[b.area, b.equipment_name, b.error_maximo_permitido && `EMP ${b.error_maximo_permitido}`].filter(Boolean).join(' · ')}
                actions={<>{editButton(() => balanzas.openEdit(b))}{toggleButton(b, r => toggleActive('plant_balances', r, balanzas.load))}</>}
              />
            ),
          )}
        </>
      ),
    },
    transportistas: {
      title: 'Empresas de transporte',
      description: 'Para elegirlas al registrar el transporte del despacho.',
      onNew: transportistas.openNew,
      newLabel: 'Nueva empresa',
      body: () => (
        <>
          {searchBox('Buscar por razón social o RUC')}
          {renderList(
            activeFirst(transportistas.rows).filter(t => matches(t.razon_social, t.ruc)),
            'Todavía no hay empresas de transporte cargadas.',
            t => (
              <CatalogRow
                key={t.id}
                audit={t}
                inactive={!t.is_active}
                title={t.razon_social}
                subtitle={[t.ruc && `RUC ${t.ruc}`, t.constancia_mtc && `MTC ${t.constancia_mtc}`].filter(Boolean).join(' · ')}
                actions={<>{editButton(() => transportistas.openEdit(t))}{toggleButton(t, r => toggleActive('plant_transport_companies', r, transportistas.load))}</>}
              />
            ),
          )}
        </>
      ),
    },
    clientes: {
      title: 'Clientes',
      description: 'Nombre y correlativo de cada cliente.',
      onNew: openNewCliente,
      newLabel: 'Nuevo cliente',
      body: () => (
        <>
          {searchBox('Buscar por nombre o correlativo')}
          {renderList(
            activeFirst(clients).filter(c => matches(c.name, c.code)),
            'Todavía no hay clientes cargados.',
            c => (
              <CatalogRow
                key={c.id}
                audit={c}
                inactive={!c.is_active}
                title={c.name}
                subtitle={c.code ? `Correlativo ${c.code}` : null}
                actions={<>{editButton(() => openEditCliente(c))}{toggleButton(c, handleToggleClienteActive)}</>}
              />
            ),
          )}
        </>
      ),
    },
    presentacion: {
      title: 'Valores predeterminados de presentación',
      description: `Empaque sugerido por cliente al armar un ${LOTE_LABEL_LOWER}.`,
      onNew: openNewDefaults,
      newLabel: 'Asignar valores',
      body: () => (
        <>
          {searchBox('Buscar cliente')}
          {renderList(
            clients.filter(c => c.is_active && matches(c.name)),
            'Todavía no hay clientes cargados.',
            c => {
              const hasDefaults = hasClientDefaults(c)
              const summary = [
                c.default_packaging_type && PACKAGING_TYPE_LABELS[c.default_packaging_type],
                c.default_packaging_kg && `${c.default_packaging_kg} kg`,
                c.default_units_per_box && `${c.default_units_per_box}/caja`,
                c.default_pallet_count && COOPERATIVE?.features?.pallets && `${c.default_pallet_count} pallets/${LOTE_LABEL_LOWER}`,
              ].filter(Boolean).join(' · ')
              return (
                <CatalogRow
                  key={c.id}
                  audit={c}
                  title={c.name}
                  subtitle={hasDefaults ? summary : 'Sin valores predeterminados'}
                  actions={editButton(() => openEditDefaults(c))}
                />
              )
            },
          )}
        </>
      ),
    },
    marcas: {
      title: 'Marcas',
      description: 'Marcas con las que se rotulan los productos.',
      onNew: openNewMarca,
      newLabel: 'Nueva marca',
      body: () => (
        <>
          {searchBox('Buscar marca')}
          {renderList(
            activeFirst(brands).filter(b => matches(b.label)),
            'Todavía no hay marcas cargadas.',
            b => (
              <CatalogRow
                key={b.id}
                audit={b}
                inactive={!b.is_active}
                title={b.label}
                actions={<>{editButton(() => openEditMarca(b))}{toggleButton(b, handleToggleMarcaActive)}</>}
              />
            ),
          )}
        </>
      ),
    },
    productos: {
      title: 'Productos',
      description: 'Código (SKU/CODPROD), marca y presentación.',
      onNew: openNewProducto,
      newLabel: 'Nuevo producto',
      body: () => (
        <>
          {searchBox('Buscar por descripción, código o marca')}
          {renderList(
            activeFirst(products).filter(p => matches(p.description, p.code, brandLabel(p.brand_id))),
            'Todavía no hay productos cargados.',
            p => (
              <CatalogRow
                key={p.id}
                audit={p}
                inactive={!p.is_active}
                title={p.description}
                badges={<span className="tag info">{p.code}</span>}
                subtitle={[
                  brandLabel(p.brand_id) ?? 'Sin marca',
                  p.packaging_type && `${PACKAGING_TYPE_LABELS[p.packaging_type]}${p.packaging_kg ? ` ${p.packaging_kg} kg` : ''}`,
                ].filter(Boolean).join(' · ')}
                actions={<>{editButton(() => openEditProducto(p))}{toggleButton(p, handleToggleProductoActive)}</>}
              />
            ),
          )}
        </>
      ),
    },
    certificaciones: {
      title: 'Certificaciones',
      description: `Aplican a los lotes de campo y a los ${LOTE_LABEL_PLURAL_LOWER}.`,
      onNew: () => { setCertError(''); setFormCert(''); setModalCert(true) },
      newLabel: 'Nueva certificación',
      body: () => renderList(
        activeFirst(certifications),
        'Todavía no hay certificaciones cargadas.',
        c => (
          <CatalogRow
            key={c.id}
            audit={c}
            inactive={!c.is_active}
            title={c.name}
            badges={c.is_default ? <span className="tag info">Por defecto</span> : null}
            actions={toggleButton(c, handleToggleCertActive)}
          />
        ),
      ),
    },
    personal: {
      title: 'Personal de planta',
      description: 'Personal de envasado y tamizado.',
      onNew: openNewPersonal,
      newLabel: 'Nuevo personal',
      body: () => (
        <>
          {searchBox('Buscar por nombre')}
          {renderList(
            activeFirst(personnel).filter(p => matches(`${p.first_name} ${p.last_name}`)),
            'Todavía no hay personal cargado.',
            p => (
              <CatalogRow
                key={p.id}
                audit={p}
                inactive={!p.is_active}
                title={`${p.first_name} ${p.last_name}`}
                actions={<>{editButton(() => openEditPersonal(p))}{toggleButton(p, handleTogglePersonalActive)}</>}
              />
            ),
          )}
        </>
      ),
    },
    trabajadores: {
      title: 'Trabajadores certificados',
      description: 'Trabajadores de campo certificados, por módulo.',
      onNew: isAdmin ? openNewWorker : null,
      newLabel: 'Nuevo trabajador',
      body: () => {
        const inModule = workerModuleFilter ? workers.filter(w => w.coop_module_id === workerModuleFilter) : workers
        const vencidas = inModule.filter(w => w.is_active && getCertStatus(w.certified_until) === 'vencida').length
        const porVencer = inModule.filter(w => w.is_active && getCertStatus(w.certified_until) === 'por_vencer').length
        return (
          <>
            {!isAdmin && (
              <p className="catalog-notice">Solo el Administrador puede modificar esta lista.</p>
            )}
            <div className="catalog-toolbar">
              {searchBox('Buscar por nombre, DNI o cargo')}
              <select className="input" style={{ maxWidth: 240 }} value={workerModuleFilter} onChange={e => setWorkerModuleFilter(e.target.value)}>
                <option value="">Todos los módulos</option>
                {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            {(vencidas > 0 || porVencer > 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {vencidas > 0 && <span className="tag error-tag">{vencidas} con certificación vencida</span>}
                {porVencer > 0 && <span className="tag warn">{porVencer} por vencer (30 días)</span>}
              </div>
            )}
            {renderList(
              activeFirst(inModule).filter(w => matches(`${w.first_name} ${w.last_name}`, w.dni, w.position)),
              'Todavía no hay trabajadores certificados en este módulo.',
              w => {
                const status = getCertStatus(w.certified_until)
                return (
                  <CatalogRow
                    key={w.id}
                    audit={w}
                    inactive={!w.is_active}
                    title={`${w.first_name} ${w.last_name}`}
                    badges={<>
                      {status === 'vencida' && <span className="tag error-tag">Vencida</span>}
                      {status === 'por_vencer' && <span className="tag warn">Por vencer</span>}
                    </>}
                    subtitle={[
                      !workerModuleFilter && moduleName(w.coop_module_id),
                      w.position,
                      w.dni && `DNI ${w.dni}`,
                      w.certified_until && `Certificado hasta ${formatIsoDate(w.certified_until)}`,
                    ].filter(Boolean).join(' · ')}
                    actions={isAdmin ? <>{editButton(() => openEditWorker(w))}{toggleButton(w, handleToggleWorkerActive)}</> : null}
                  />
                )
              },
            )}
          </>
        )
      },
    },
    campanas: {
      title: 'Campañas',
      description: `Solo una puede estar activa a la vez; define la numeración de ${BUNQUE_LABEL_PLURAL_LOWER} y el periodo de los cupos.`,
      onNew: openNewCampaign,
      newLabel: 'Nueva campaña',
      body: () => (
        <>
          {renderList(
            campaigns,
            'Todavía no hay campañas cargadas.',
            c => (
              <CatalogRow
                key={c.id}
                audit={c}
                title={`Campaña ${c.year}`}
                badges={<span className={`tag ${c.is_active ? 'ok' : ''}`}>{c.is_active ? 'Activa' : 'Cerrada'}</span>}
                subtitle={campaignPeriod(c)}
                actions={<>
                  <button className="btn small outline" disabled={savingCampaign} onClick={() => openEditCampaign(c)}>Editar periodo</button>
                  {c.is_active ? (
                    <button className="btn small danger" disabled={savingCampaign} onClick={() => handleCloseCampaign(c)}>Cerrar campaña</button>
                  ) : (
                    <button className="btn small outline" disabled={savingCampaign} onClick={() => handleOpenCampaign(c)}>Abrir esta campaña</button>
                  )}
                </>}
              />
            ),
          )}
          {campaignGaps(campaigns).map(g => (
            <p key={g.from} style={{ color: 'var(--warning)', fontSize: 13, margin: '8px 0 0' }}>
              Del {formatIsoDate(g.from)} al {formatIsoDate(g.to)} no pertenece a ninguna campaña: los lotes con esas fechas no cuentan para ningún cupo.
            </p>
          ))}
          {campaignError && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>{campaignError}</p>}
        </>
      ),
    },
  }

  const section = SECTIONS[tab] ?? SECTIONS.clientes

  return (
    <div>
      <h2 style={{ margin: '0 0 16px' }}>Catálogos</h2>

      <div className="catalog-layout">
      <nav className="catalog-nav" aria-label="Catálogos">
        {TAB_GROUPS.map(group => (
          <div key={group.label} className="catalog-nav-group">
            <div className="catalog-nav-label">{group.label}</div>
            {group.tabs.map(([key, label, icon]) => (
              <button
                key={key}
                className={`catalog-nav-item${tab === key ? ' active' : ''}`}
                aria-current={tab === key ? 'page' : undefined}
                onClick={() => selectTab(key)}
              >
                <Icon name={icon} size={16} />
                <span className="catalog-nav-text">{label}</span>
                <span className="catalog-nav-count">{COUNTS[key]}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="card catalog-panel">
        <div className="catalog-header">
          <div className="catalog-header-title">
            <span className="catalog-header-icon"><Icon name={TAB_ICONS[tab] ?? 'briefcase'} size={20} /></span>
            <div>
              <h3 style={{ margin: 0 }}>{section.title}</h3>
              <p className="catalog-header-desc">{section.description}</p>
            </div>
          </div>
          {section.onNew && (
            <button className="btn small primary catalog-new-btn" onClick={section.onNew}>
              <Icon name="plus" size={14} />{section.newLabel}
            </button>
          )}
        </div>
        {currentLoadError && (
          <div className="catalog-error">
            <Icon name="alertTriangle" size={16} />
            <span style={{ flex: 1 }}>No se pudo cargar esta lista. Revise la conexión e intente de nuevo.</span>
            <button className="btn small danger" onClick={loadAll}>Reintentar</button>
          </div>
        )}
        {actionError && (
          <div className="catalog-error">
            <Icon name="alertTriangle" size={16} />
            <span style={{ flex: 1 }}>{actionError}</span>
            <button className="btn small danger" onClick={() => setActionError('')}>Cerrar</button>
          </div>
        )}
        {section.body()}
      </div>
      </div>

      {/* ── Modal: Nuevo/Editar cliente ── */}
      {modalCliente && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>{editingClienteId ? 'Editar cliente' : 'Nuevo cliente'}</h3>
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
              {clienteError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '4px 0' }}>{clienteError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalCliente(false); setClienteError(''); setEditingClienteId(null) }} disabled={savingCliente}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveCliente} disabled={savingCliente}>
                {savingCliente ? 'Guardando...' : editingClienteId ? 'Guardar cambios' : 'Crear cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Editar valores predeterminados ── */}
      {modalDefaults && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 4px' }}>Valores predeterminados</h3>
              {modalDefaults.id ? (
                <p className="muted small" style={{ margin: '0 0 16px' }}>{modalDefaults.name}</p>
              ) : (
                <div className="field">
                  <label>Cliente *</label>
                  <select
                    value={formDefaults.client_id}
                    onChange={e => setFormDefaults({ ...formDefaults, client_id: e.target.value })}
                  >
                    <option value="">Elegir cliente...</option>
                    {/* Solo clientes sin valores -- los que ya tienen se
                        cambian con su "Editar"; antes este alta los pisaba. */}
                    {clients.filter(c => c.is_active && !hasClientDefaults(c)).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {clients.filter(c => c.is_active && !hasClientDefaults(c)).length === 0 && (
                    <p className="muted small" style={{ margin: '6px 0 0' }}>
                      Todos los clientes activos ya tienen valores. Para cambiarlos, use "Editar" en la lista.
                    </p>
                  )}
                </div>
              )}
              <div className="grid two" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tipo de empaque</label>
                  <select
                    value={formDefaults.default_packaging_type}
                    onChange={e => setFormDefaults({
                      ...formDefaults,
                      default_packaging_type: e.target.value,
                      // "Bolsas por caja" no aplica a saco -- se limpia para
                      // no dejar guardado un valor que ya no se ve ni tiene sentido.
                      default_units_per_box: e.target.value === 'saco' ? '' : formDefaults.default_units_per_box,
                    })}
                  >
                    <option value="">Sin default</option>
                    <option value="bolsa">Bolsa</option>
                    <option value="saco">Saco</option>
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Kg por bolsa/saco</label>
                  <input
                    type="number" min="0.001" step="0.001" placeholder="Ej: 0.5"
                    value={formDefaults.default_packaging_kg}
                    onChange={e => setFormDefaults({ ...formDefaults, default_packaging_kg: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                {formDefaults.default_packaging_type !== 'saco' && (
                  <div className="field" style={{ margin: 0 }}>
                    <label>Bolsas por caja</label>
                    <input
                      type="number" min="1" step="1" placeholder="Ej: 10"
                      value={formDefaults.default_units_per_box}
                      onChange={e => setFormDefaults({ ...formDefaults, default_units_per_box: e.target.value })}
                    />
                  </div>
                )}
                {COOPERATIVE?.features?.pallets && (
                  <div className="field" style={{ margin: 0 }}>
                    <label>Pallets por {LOTE_LABEL_LOWER}</label>
                    <input
                      type="number" min="1" step="1" placeholder="Ej: 11"
                      value={formDefaults.default_pallet_count}
                      onChange={e => setFormDefaults({ ...formDefaults, default_pallet_count: e.target.value })}
                    />
                  </div>
                )}
              </div>
              {defaultsError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '4px 0' }}>{defaultsError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalDefaults(null); setDefaultsError('') }} disabled={savingDefaults}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveDefaults} disabled={savingDefaults}>
                {savingDefaults ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nueva/Editar marca ── */}
      {modalMarca && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>{editingMarcaId ? 'Editar marca' : 'Nueva marca'}</h3>
              <div className="field">
                <label>Nombre *</label>
                <input
                  type="text"
                  placeholder="Ej: NORANDINO, PanelaBio..."
                  value={formMarca}
                  onChange={e => setFormMarca(e.target.value)}
                />
              </div>
              {marcaError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '4px 0' }}>{marcaError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalMarca(false); setMarcaError(''); setEditingMarcaId(null) }} disabled={savingMarca}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveMarca} disabled={savingMarca}>
                {savingMarca ? 'Guardando...' : editingMarcaId ? 'Guardar cambios' : 'Crear marca'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo/Editar producto ── */}
      {modalProducto && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>{editingProductoId ? 'Editar producto' : 'Nuevo producto'}</h3>
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
                  <label>Marca</label>
                  <select
                    value={formProducto.brand_id}
                    onChange={e => setFormProducto({ ...formProducto, brand_id: e.target.value })}
                  >
                    <option value="">Sin marca</option>
                    {brands.filter(b => b.is_active || b.id === formProducto.brand_id).map(b => (
                      <option key={b.id} value={b.id}>{b.label}</option>
                    ))}
                  </select>
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
              {productoError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '4px 0' }}>{productoError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalProducto(false); setProductoError(''); setEditingProductoId(null) }} disabled={savingProducto}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveProducto} disabled={savingProducto}>
                {savingProducto ? 'Guardando...' : editingProductoId ? 'Guardar cambios' : 'Crear producto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nueva certificación ── */}
      {modalCert && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>Nueva certificación</h3>
              <div className="field">
                <label>Nombre *</label>
                <input
                  type="text"
                  placeholder="Ej: Orgánica, FLO, Naturland..."
                  value={formCert}
                  onChange={e => setFormCert(e.target.value)}
                />
              </div>
              {certError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '4px 0' }}>{certError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalCert(false); setCertError('') }} disabled={savingCert}>Cancelar</button>
              <button className="btn small primary" onClick={handleCreateCert} disabled={savingCert}>
                {savingCert ? 'Guardando...' : 'Crear certificación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {balanzas.modal}
      {transportistas.modal}

      {/* ── Modal: Nuevo/Editar personal de planta ── */}
      {modalPersonal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>{editingPersonalId ? 'Editar personal' : 'Nuevo personal de planta'}</h3>
              <div className="grid two" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Nombre *</label>
                  <input
                    type="text"
                    value={formPersonal.first_name}
                    onChange={e => setFormPersonal({ ...formPersonal, first_name: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Apellido *</label>
                  <input
                    type="text"
                    value={formPersonal.last_name}
                    onChange={e => setFormPersonal({ ...formPersonal, last_name: e.target.value })}
                  />
                </div>
              </div>
              {personalError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '4px 0' }}>{personalError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalPersonal(false); setPersonalError(''); setEditingPersonalId(null) }} disabled={savingPersonal}>Cancelar</button>
              <button className="btn small primary" onClick={handleSavePersonal} disabled={savingPersonal}>
                {savingPersonal ? 'Guardando...' : editingPersonalId ? 'Guardar cambios' : 'Crear personal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo/Editar trabajador certificado ── */}
      {modalWorker && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>{editingWorkerId ? 'Editar trabajador certificado' : 'Nuevo trabajador certificado'}</h3>
              <div className="grid two" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Nombre *</label>
                  <input
                    type="text"
                    value={formWorker.first_name}
                    onChange={e => setFormWorker({ ...formWorker, first_name: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Apellidos *</label>
                  <input
                    type="text"
                    value={formWorker.last_name}
                    onChange={e => setFormWorker({ ...formWorker, last_name: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Módulo *</label>
                  <select
                    value={formWorker.coop_module_id}
                    onChange={e => setFormWorker({ ...formWorker, coop_module_id: e.target.value })}
                  >
                    <option value="">Seleccione un módulo</option>
                    {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>DNI</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    value={formWorker.dni}
                    onChange={e => setFormWorker({ ...formWorker, dni: e.target.value.replace(/\D/g, '') })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Cargo</label>
                  <input
                    type="text"
                    placeholder="Ej: Operario de módulo"
                    value={formWorker.position}
                    onChange={e => setFormWorker({ ...formWorker, position: e.target.value })}
                  />
                </div>
                <div />
                <div className="field" style={{ margin: 0 }}>
                  <label>Certificado desde</label>
                  <input
                    type="date"
                    value={formWorker.certified_since}
                    onChange={e => setFormWorker({ ...formWorker, certified_since: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Certificado hasta</label>
                  <input
                    type="date"
                    value={formWorker.certified_until}
                    onChange={e => setFormWorker({ ...formWorker, certified_until: e.target.value })}
                  />
                </div>
              </div>
              <p className="muted small" style={{ margin: '6px 0 0' }}>
                Si "Certificado hasta" queda vacío, la certificación no vence.
              </p>
              <div className="field" style={{ margin: '8px 0 0' }}>
                <label>Notas</label>
                <textarea
                  rows={2}
                  value={formWorker.notes}
                  onChange={e => setFormWorker({ ...formWorker, notes: e.target.value })}
                />
              </div>
              {workerError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '4px 0' }}>{workerError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalWorker(false); setWorkerError(''); setEditingWorkerId(null) }} disabled={savingWorker}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveWorker} disabled={savingWorker}>
                {savingWorker ? 'Guardando...' : editingWorkerId ? 'Guardar cambios' : 'Crear trabajador'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nueva campaña ── */}
      {modalCampaign && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>{formCampaign.id ? `Periodo de la campaña ${formCampaign.year}` : 'Nueva campaña'}</h3>
              {!formCampaign.id && (
                <div className="field">
                  <label>Año *</label>
                  <input
                    type="number" step="1"
                    value={formCampaign.year}
                    onChange={e => setFormCampaign({ ...formCampaign, year: e.target.value })}
                  />
                </div>
              )}
              <div className="grid two" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Fecha de inicio (vacía = 01/01)</label>
                  <input
                    type="date"
                    value={formCampaign.start_date}
                    onChange={e => setFormCampaign({ ...formCampaign, start_date: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Fecha de fin (vacía = 31/12)</label>
                  <input
                    type="date"
                    value={formCampaign.end_date}
                    onChange={e => setFormCampaign({ ...formCampaign, end_date: e.target.value })}
                  />
                </div>
              </div>
              {!formCampaign.id && (
                <p className="muted small" style={{ marginTop: 8 }}>
                  Se crea cerrada; se abre desde la lista.
                </p>
              )}
              {campaignError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '4px 0' }}>{campaignError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalCampaign(false); setCampaignError(''); setFormCampaign(emptyFormCampaign) }} disabled={savingCampaign}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveCampaign} disabled={savingCampaign}>
                {savingCampaign ? 'Guardando...' : formCampaign.id ? 'Guardar periodo' : 'Crear campaña'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  )
}
