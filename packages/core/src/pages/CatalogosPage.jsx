import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Icon from '../components/Icon'
import { PACKAGING_TYPE_LABELS } from '../lib/loteHelpers'
import { getLoteLabelLower, getLoteLabelPluralLower, getBunqueLabelPluralLower } from '../lib/labels'
import { useConfirm } from '../hooks/useConfirm'

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
// clientes tienen. Más adelante se puede sumar aquí trabajadores certificados
// y cupos por productor (hoy todavía solo por SQL).

const emptyFormCliente = { name: '', code: '' }
const emptyFormDefaults = { client_id: '', default_packaging_type: '', default_units_per_box: '', default_packaging_kg: '', default_pallet_count: '' }
const emptyFormProducto = { code: '', description: '', client_id: '', brand_id: '', packaging_type: 'bolsa', packaging_kg: '' }
const emptyFormPersonal = { first_name: '', last_name: '' }
const emptyFormCampaign = { year: '', start_date: '', end_date: '' }

export default function CatalogosPage() {
  const COOPERATIVE = useCooperative()
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

  // Cada sección se despliega por separado -- todas arrancan cerradas para
  // no abrumar con las 7 listas a la vez; se abre solo la que hace falta.
  const [expanded, setExpanded] = useState({ clientes: false, defaults: false, marcas: false, productos: false, certificaciones: false, personal: false, campanas: false })
  const toggleSection = (key) => setExpanded(e => ({ ...e, [key]: !e[key] }))
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

  const [modalCampaign, setModalCampaign]     = useState(false)
  const [formCampaign, setFormCampaign]       = useState(emptyFormCampaign)
  const [campaignError, setCampaignError]     = useState('')
  const [savingCampaign, setSavingCampaign]   = useState(false)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    await Promise.all([loadClients(), loadBrands(), loadProducts(), loadCertifications(), loadPersonnel(), loadCampaigns()])
    setLoading(false)
  }

  const loadClients = () =>
    supabase
      .from('plant_clients')
      .select('id, name, code, is_active, default_packaging_type, default_units_per_box, default_packaging_kg, default_pallet_count')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('name')
      .then(({ data }) => setClients(data ?? []))

  const loadBrands = () =>
    supabase
      .from('plant_brand_catalog')
      .select('id, label, is_active')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('label')
      .then(({ data }) => setBrands(data ?? []))

  const loadProducts = () =>
    supabase
      .from('plant_product_catalog')
      .select('id, code, description, client_id, brand_id, packaging_type, packaging_kg, is_active')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('description')
      .then(({ data }) => setProducts(data ?? []))

  // Mismo catálogo (batch_certs) que usan tanto los lotes de campo/recepción
  // (móvil) como los de envasado/planta (aquí) -- una sola fuente para las dos.
  const loadCertifications = () =>
    supabase
      .from('batch_certs')
      .select('id, name, is_active, is_default')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('name')
      .then(({ data }) => setCertifications(data ?? []))

  // Personal de planta (Envasado/Tamizado) para el Control de Salud e
  // Higiene del Personal -- ver HigienePage.jsx, que también permite un alta
  // rápida inline para no obligar a salir del control que se está llenando.
  const loadPersonnel = () =>
    supabase
      .from('plant_personnel')
      .select('id, first_name, last_name, is_active')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('first_name')
      .then(({ data }) => setPersonnel(data ?? []))

  // Campaña productiva -- ver BunquesPage.jsx, la sugerencia automática de
  // N° de bunque se acota a la campaña activa. Solo puede haber una activa
  // por cooperativa a la vez (constraint en la BD).
  const loadCampaigns = () =>
    supabase
      .from('campaigns')
      .select('id, year, start_date, end_date, is_active')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('year', { ascending: false })
      .then(({ data }) => setCampaigns(data ?? []))

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
      setFormCliente(emptyFormCliente)
      loadClients()
    } catch (err) {
      setClienteError(err.message)
    } finally {
      setSavingCliente(false)
    }
  }

  const handleToggleClienteActive = async (client) => {
    await supabase.from('plant_clients').update({ is_active: !client.is_active }).eq('id', client.id)
    loadClients()
  }

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
      setFormMarca('')
      loadBrands()
    } catch (err) {
      setMarcaError(err.message)
    } finally {
      setSavingMarca(false)
    }
  }

  const handleToggleMarcaActive = async (brand) => {
    await supabase.from('plant_brand_catalog').update({ is_active: !brand.is_active }).eq('id', brand.id)
    loadBrands()
  }

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
      client_id: product.client_id ?? '',
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
        client_id:       formProducto.client_id || null,
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
      setFormProducto(emptyFormProducto)
      loadProducts()
    } catch (err) {
      setProductoError(err.message)
    } finally {
      setSavingProducto(false)
    }
  }

  const handleToggleProductoActive = async (product) => {
    await supabase.from('plant_product_catalog').update({ is_active: !product.is_active }).eq('id', product.id)
    loadProducts()
  }

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
      loadCertifications()
    } catch (err) {
      setCertError(err.message)
    } finally {
      setSavingCert(false)
    }
  }

  const handleToggleCertActive = async (cert) => {
    await supabase.from('batch_certs').update({ is_active: !cert.is_active }).eq('id', cert.id)
    loadCertifications()
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
      setFormPersonal(emptyFormPersonal)
      loadPersonnel()
    } catch (err) {
      setPersonalError(err.message)
    } finally {
      setSavingPersonal(false)
    }
  }

  const handleTogglePersonalActive = async (person) => {
    await supabase.from('plant_personnel').update({ is_active: !person.is_active }).eq('id', person.id)
    loadPersonnel()
  }

  // ── Campañas ─────────────────────────────────────────────────────────────

  const openNewCampaign = () => {
    setCampaignError('')
    const maxYear = campaigns.reduce((m, c) => Math.max(m, c.year), 0)
    // Solo una sugerencia editable, igual que el N° de bunque -- nunca
    // restringe: el usuario puede tipear cualquier año.
    setFormCampaign({ ...emptyFormCampaign, year: maxYear > 0 ? String(maxYear + 1) : String(new Date().getFullYear()) })
    setModalCampaign(true)
  }

  const handleSaveCampaign = async () => {
    setCampaignError('')
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
    try {
      await supabase.from('campaigns').update({ is_active: false }).eq('cooperative_id', COOPERATIVE.id).eq('is_active', true)
      const { error: updErr } = await supabase.from('campaigns').update({ is_active: true }).eq('id', campaign.id)
      if (updErr) throw new Error(updErr.message)
      loadCampaigns()
    } catch (err) {
      setCampaignError(err.message)
    } finally {
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
      loadCampaigns()
    } catch (err) {
      setCampaignError(err.message)
    } finally {
      setSavingCampaign(false)
    }
  }

  const clientName = (id) => clients.find(c => c.id === id)?.name
  const brandLabel = (id) => brands.find(b => b.id === id)?.label

  if (loading) {
    return (
      <div>
        <h2 style={{ margin: '0 0 16px' }}>Catálogos</h2>
        <SkeletonList count={4} lines={2} />
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 4px' }}>Catálogos</h2>
      <p className="muted small" style={{ margin: '0 0 16px' }}>
        Clientes, marcas, productos, certificaciones y personal de planta — se pueden crear, editar o dar de baja aquí,
        sin borrar el historial de lo que ya se usó en órdenes. Más adelante se suman más catálogos a esta sección.
      </p>

      {/* ── Clientes ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded.clientes ? 10 : 0 }}>
          <button
            className="btn small outline"
            onClick={() => toggleSection('clientes')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', padding: 0, background: 'none' }}
          >
            <Icon name={expanded.clientes ? 'chevronUp' : 'chevronDown'} size={16} />
            <h3 style={{ margin: 0 }}>Clientes <span className="muted small">({clients.length})</span></h3>
          </button>
          <button className="btn small primary" onClick={openNewCliente}>+ Nuevo cliente</button>
        </div>
        {expanded.clientes && (
          clients.length === 0 ? (
            <EmptyState message="Todavía no hay clientes cargados." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {clients.map(c => (
                <div key={c.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                  opacity: c.is_active ? 1 : 0.6,
                }}>
                  <span>{c.name}{c.code ? <span className="muted small"> ({c.code})</span> : null}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small primary" onClick={() => openEditCliente(c)}>Editar</button>
                    <button className="btn small warning" onClick={() => handleToggleClienteActive(c)}>
                      {c.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Valores predeterminados por cliente ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: expanded.defaults ? 10 : 0 }}>
          <button
            className="btn small outline"
            onClick={() => toggleSection('defaults')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', padding: 0, background: 'none', textAlign: 'left' }}
          >
            <Icon name={expanded.defaults ? 'chevronUp' : 'chevronDown'} size={16} style={{ marginTop: 4, flexShrink: 0 }} />
            <div>
              <h3 style={{ margin: 0 }}>Valores predeterminados de presentación</h3>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                Por cliente — solo se sugieren al armar un {LOTE_LABEL_LOWER}, nunca restringen. Opcional.
              </p>
            </div>
          </button>
          <button className="btn small primary" onClick={openNewDefaults}>+ Nuevo</button>
        </div>
        {expanded.defaults && (
          clients.length === 0 ? (
            <EmptyState message="Todavía no hay clientes cargados." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {clients.map(c => (
                <div key={c.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                }}>
                  <div>
                    <div>{c.name}</div>
                    {(c.default_packaging_type || c.default_packaging_kg || c.default_pallet_count || c.default_units_per_box) ? (
                      <div className="muted small">
                        {c.default_packaging_type ? PACKAGING_TYPE_LABELS[c.default_packaging_type] : '—'}
                        {c.default_packaging_kg ? `, ${c.default_packaging_kg} kg` : ''}
                        {c.default_units_per_box ? `, ${c.default_units_per_box}/caja` : ''}
                        {(c.default_pallet_count && COOPERATIVE?.features?.pallets) ? `, ${c.default_pallet_count} pallets/${LOTE_LABEL_LOWER}` : ''}
                      </div>
                    ) : (
                      <div className="muted small">Sin valores predeterminados</div>
                    )}
                  </div>
                  <button className="btn small primary" onClick={() => openEditDefaults(c)}>Editar</button>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Marcas ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded.marcas ? 10 : 0 }}>
          <button
            className="btn small outline"
            onClick={() => toggleSection('marcas')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', padding: 0, background: 'none' }}
          >
            <Icon name={expanded.marcas ? 'chevronUp' : 'chevronDown'} size={16} />
            <h3 style={{ margin: 0 }}>Marcas <span className="muted small">({brands.length})</span></h3>
          </button>
          <button className="btn small primary" onClick={openNewMarca}>+ Nueva marca</button>
        </div>
        {expanded.marcas && (
          brands.length === 0 ? (
            <EmptyState message="Todavía no hay marcas cargadas." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {brands.map(b => (
                <div key={b.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                  opacity: b.is_active ? 1 : 0.6,
                }}>
                  <span>{b.label}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small primary" onClick={() => openEditMarca(b)}>Editar</button>
                    <button className="btn small warning" onClick={() => handleToggleMarcaActive(b)}>
                      {b.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Productos ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded.productos ? 10 : 0 }}>
          <button
            className="btn small outline"
            onClick={() => toggleSection('productos')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', padding: 0, background: 'none' }}
          >
            <Icon name={expanded.productos ? 'chevronUp' : 'chevronDown'} size={16} />
            <h3 style={{ margin: 0 }}>Productos <span className="muted small">({products.length})</span></h3>
          </button>
          <button className="btn small primary" onClick={openNewProducto}>+ Nuevo producto</button>
        </div>
        {expanded.productos && (
          products.length === 0 ? (
            <EmptyState message="Todavía no hay productos cargados." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {products.map(p => (
                <div key={p.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                  opacity: p.is_active ? 1 : 0.6,
                }}>
                  <div>
                    <div>{p.description} <span className="muted small">({p.code})</span></div>
                    <div className="muted small">
                      {clientName(p.client_id) ?? 'Sin cliente'} · {brandLabel(p.brand_id) ?? 'Sin marca'}
                      {p.packaging_type ? ` · ${PACKAGING_TYPE_LABELS[p.packaging_type]}` : ''}
                      {p.packaging_kg ? ` ${p.packaging_kg} kg` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small primary" onClick={() => openEditProducto(p)}>Editar</button>
                    <button className="btn small warning" onClick={() => handleToggleProductoActive(p)}>
                      {p.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Certificaciones ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded.certificaciones ? 10 : 0 }}>
          <button
            className="btn small outline"
            onClick={() => toggleSection('certificaciones')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', padding: 0, background: 'none' }}
          >
            <Icon name={expanded.certificaciones ? 'chevronUp' : 'chevronDown'} size={16} />
            <h3 style={{ margin: 0 }}>Certificaciones <span className="muted small">({certifications.length})</span></h3>
          </button>
          <button className="btn small primary" onClick={() => { setCertError(''); setFormCert(''); setModalCert(true) }}>+ Nueva</button>
        </div>
        <p className="muted small" style={{ margin: expanded.certificaciones ? '0 0 10px' : 0 }}>
          Se activan o desactivan una sola vez — aplican tanto a los lotes de campo (recepción, app móvil) como a los {LOTE_LABEL_PLURAL_LOWER}.
        </p>
        {expanded.certificaciones && (
          certifications.length === 0 ? (
            <EmptyState message="Todavía no hay certificaciones cargadas." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {certifications.map(c => (
                <div key={c.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                  opacity: c.is_active ? 1 : 0.6,
                }}>
                  <span>{c.name}{c.is_default ? <span className="muted small"> (default)</span> : null}</span>
                  <button className="btn small warning" onClick={() => handleToggleCertActive(c)}>
                    {c.is_active ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Personal de planta ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded.personal ? 10 : 0 }}>
          <button
            className="btn small outline"
            onClick={() => toggleSection('personal')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', padding: 0, background: 'none' }}
          >
            <Icon name={expanded.personal ? 'chevronUp' : 'chevronDown'} size={16} />
            <h3 style={{ margin: 0 }}>Personal de planta <span className="muted small">({personnel.length})</span></h3>
          </button>
          <button className="btn small primary" onClick={openNewPersonal}>+ Nuevo</button>
        </div>
        <p className="muted small" style={{ margin: expanded.personal ? '0 0 10px' : 0 }}>
          Para el Control de Salud e Higiene del Personal (sección Higiene) — dar de baja no borra los controles ya registrados con esa persona.
        </p>
        {expanded.personal && (
          personnel.length === 0 ? (
            <EmptyState message="Todavía no hay personal cargado." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {personnel.map(p => (
                <div key={p.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                  opacity: p.is_active ? 1 : 0.6,
                }}>
                  <span>{p.first_name} {p.last_name}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small primary" onClick={() => openEditPersonal(p)}>Editar</button>
                    <button className="btn small warning" onClick={() => handleTogglePersonalActive(p)}>
                      {p.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Campañas ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: expanded.campanas ? 10 : 0 }}>
          <button
            className="btn small outline"
            onClick={() => toggleSection('campanas')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', padding: 0, background: 'none', textAlign: 'left' }}
          >
            <Icon name={expanded.campanas ? 'chevronUp' : 'chevronDown'} size={16} style={{ marginTop: 4, flexShrink: 0 }} />
            <div>
              <h3 style={{ margin: 0 }}>Campañas <span className="muted small">({campaigns.length})</span></h3>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                Solo una puede estar activa a la vez — la numeración de {BUNQUE_LABEL_PLURAL_LOWER} de tamizado se sugiere dentro de la campaña activa.
              </p>
            </div>
          </button>
          <button className="btn small primary" onClick={openNewCampaign}>+ Nueva campaña</button>
        </div>
        {expanded.campanas && (
          campaigns.length === 0 ? (
            <EmptyState message="Todavía no hay campañas cargadas." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {campaigns.map(c => (
                <div key={c.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Campaña {c.year}</span>
                    <span className={`tag ${c.is_active ? 'ok' : ''}`}>{c.is_active ? 'Activa' : 'Cerrada'}</span>
                    {(c.start_date || c.end_date) && (
                      <span className="muted small">{c.start_date ?? '—'} a {c.end_date ?? '—'}</span>
                    )}
                  </div>
                  {c.is_active ? (
                    <button className="btn small outline" disabled={savingCampaign} onClick={() => handleCloseCampaign(c)}>Cerrar campaña</button>
                  ) : (
                    <button className="btn small outline" disabled={savingCampaign} onClick={() => handleOpenCampaign(c)}>Abrir esta campaña</button>
                  )}
                </div>
              ))}
            </div>
          )
        )}
        {campaignError && expanded.campanas && <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0 0' }}>{campaignError}</p>}
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
              {clienteError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{clienteError}</p>}
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
                    {clients.filter(c => c.is_active).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
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
              {defaultsError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{defaultsError}</p>}
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
              {marcaError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{marcaError}</p>}
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
                  <label>Cliente</label>
                  <select
                    value={formProducto.client_id}
                    onChange={e => setFormProducto({ ...formProducto, client_id: e.target.value })}
                  >
                    <option value="">Sin cliente / genérico</option>
                    {clients.filter(c => c.is_active || c.id === formProducto.client_id).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
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
              <p className="muted small" style={{ marginTop: 8 }}>
                Estos valores solo se sugieren al armar un {LOTE_LABEL_LOWER} — no restringen nada, siguen siendo editables.
              </p>
              {productoError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{productoError}</p>}
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
              {certError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{certError}</p>}
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
              {personalError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{personalError}</p>}
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

      {/* ── Modal: Nueva campaña ── */}
      {modalCampaign && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>Nueva campaña</h3>
              <div className="field">
                <label>Año *</label>
                <input
                  type="number" step="1"
                  value={formCampaign.year}
                  onChange={e => setFormCampaign({ ...formCampaign, year: e.target.value })}
                />
              </div>
              <div className="grid two" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Fecha de inicio (opcional)</label>
                  <input
                    type="date"
                    value={formCampaign.start_date}
                    onChange={e => setFormCampaign({ ...formCampaign, start_date: e.target.value })}
                  />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Fecha de fin (opcional)</label>
                  <input
                    type="date"
                    value={formCampaign.end_date}
                    onChange={e => setFormCampaign({ ...formCampaign, end_date: e.target.value })}
                  />
                </div>
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>
                Se crea cerrada — usa "Abrir esta campaña" en la lista cuando quieras que pase a ser la vigente.
              </p>
              {campaignError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{campaignError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalCampaign(false); setCampaignError('') }} disabled={savingCampaign}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveCampaign} disabled={savingCampaign}>
                {savingCampaign ? 'Guardando...' : 'Crear campaña'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  )
}
