import { toast } from '../lib/toast'
import ClearableInput from '../components/ClearableInput'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Icon from '../components/Icon'
import { useConfirm } from '../hooks/useConfirm'
import { exportSheetsToExcel } from '../lib/excelExport'
import ImportarCuposModal from './ImportarCuposModal'
import { fetchActivePlots, fetchQuotasByCampaign, fetchProductionWithoutQuota, fetchProductionOutsideCampaign, quotaWarnings, typicalQuotaKg, quotaSheetColumns, quotaSheetRows } from '../lib/quotaImport'
import { fetchAllRows } from '../lib/fetchAllRows'
import { fetchCampaigns, defaultCampaign, previousCampaign, campaignPeriod, formatIsoDate } from '../lib/campaigns'

// Cupos de producción POR PARCELA y certificación: cuánta panela con una
// certificación puede producir cada parcela por CAMPAÑA (lotes con fecha de
// proceso dentro del periodo de la campaña). El total de un productor no se
// guarda: se calcula sumando sus parcelas. Datos: plot_quotas +
// get_plot_quotas_by_campaign (el mismo RPC que el celular descarga para
// avisar sin conexión). Solo admin_web escribe (migración 20261108120000).
// Carga desde Excel: ImportarCuposModal.

const emptyForm = { quotaId: null, producerId: '', producerName: '', plotId: '', plotName: '', certId: '', cupoKg: '', notes: '' }

const kg = (n) => Number(n ?? 0).toFixed(1)

// Mismos umbrales que la app móvil (plot_quota_status.dart): ok < 80%,
// warning 80-99%, superado >= 100%.
function pctTag(pct, superado) {
  if (superado) return <span className="tag error-tag">{pct}% · superado</span>
  if (pct >= 80) return <span className="tag warn">{pct}%</span>
  return <span className="tag ok">{pct}%</span>
}

const pct = (usado, cupo) => (cupo > 0 ? Math.round((usado / cupo) * 10000) / 100 : 0)

// Barra de avance del cupo, con los mismos colores que la etiqueta de %.
function QuotaBar({ pct: value, superado }) {
  const color = superado ? 'var(--danger)' : value >= 80 ? 'var(--warning)' : 'var(--success)'
  return (
    <span style={{ flex: '1 1 120px', maxWidth: 220, height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
      <span style={{ display: 'block', height: '100%', width: `${Math.min(value, 100)}%`, background: color }} />
    </span>
  )
}

const FILTERS = [
  { key: 'todas', label: 'Todas' },
  { key: 'con', label: 'Con cupo' },
  { key: 'sin', label: 'Sin cupo' },
  { key: 'superado', label: 'Superadas' },
  { key: 'sinCupoProd', label: 'Producción sin cupo' },
]

// Productores que se muestran a la vez (son más de 500).
const PAGE = 50

const plotMatchesFilter =(plot, filter) =>
  filter === 'con' ? plot.quotas.length > 0
    : filter === 'sin' ? plot.quotas.length === 0
    : filter === 'superado' ? plot.quotas.some(q => q.superado)
    : filter === 'sinCupoProd' ? plot.unquoted.length > 0
    : true

// Productor → parcelas → cupos. Incluye las parcelas activas sin cupo (para
// asignarles uno) y las parcelas con cupo o con producción aunque ya estén
// de baja. unquoted = producción del año en certificaciones sin cupo en esa
// parcela (get_production_without_quota).
function groupByProducer(plots, quotas, unquoted) {
  const plotMap = new Map(plots.map(p => [p.id, {
    id: p.id, name: p.name, code: p.code, quotas: [], unquoted: [],
    producer: { id: p.producerId, name: p.producerName, dni: p.dni, module: p.moduleName },
  }]))
  const plotFor = (r) => {
    if (!plotMap.has(r.plot_id)) {
      plotMap.set(r.plot_id, {
        id: r.plot_id, name: r.plot_name, code: r.plot_code, quotas: [], unquoted: [],
        producer: { id: r.producer_id, name: r.producer_name, dni: r.producer_dni, module: r.module_name },
      })
    }
    return plotMap.get(r.plot_id)
  }
  for (const q of quotas) plotFor(q).quotas.push(q)
  for (const u of unquoted) plotFor(u).unquoted.push(u)
  const groups = new Map()
  for (const pl of plotMap.values()) {
    const pr = pl.producer
    if (!groups.has(pr.id)) groups.set(pr.id, { key: pr.id, id: pr.id, name: pr.name, dni: pr.dni, module: pr.module, plots: [] })
    groups.get(pr.id).plots.push(pl)
  }
  // Conteos y totales: de TODAS sus parcelas (no cambian al buscar o filtrar).
  return [...groups.values()]
    .map(g => {
      const all = g.plots.flatMap(pl => pl.quotas)
      return {
        ...g,
        plots: g.plots.sort((a, b) => a.name.localeCompare(b.name)),
        plotCount: g.plots.length,
        withQuota: g.plots.filter(pl => pl.quotas.length > 0).length,
        cupo: all.reduce((t, q) => t + Number(q.cupo_kg), 0),
        usado: all.reduce((t, q) => t + Number(q.acumulado_kg), 0),
        superado: all.some(q => q.superado),
        sinCupoProd: g.plots.some(pl => pl.unquoted.length > 0),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Exportar Excel: hoja 1 = mismo formato que la plantilla de importación
// (una fila por parcela, una columna por certificación), se puede corregir
// y volver a importar; hoja 2 = consumo de cada cupo (solo lectura).
const USAGE_COLUMNS = [
  { label: 'Productor', value: r => r.producer_name },
  { label: 'DNI', value: r => r.producer_dni },
  { label: 'Módulo', value: r => r.module_name },
  { label: 'Parcela', value: r => r.plot_name },
  { label: 'Código parcela', value: r => r.plot_code },
  { label: 'Certificación', value: r => r.cert_name },
  { label: 'Cupo (kg)', value: r => Number(r.cupo_kg) },
  { label: 'Notas', value: r => r.notes },
  { label: 'Campaña', value: r => r.year },
  { label: 'Usado (kg)', value: r => Number(r.acumulado_kg) },
  { label: 'Disponible (kg)', value: r => Number(r.disponible_kg) },
  { label: '% usado', value: r => Number(r.porcentaje_usado) },
]

const UNQUOTED_COLUMNS = [
  { label: 'Productor', value: r => r.producer_name },
  { label: 'DNI', value: r => r.producer_dni },
  { label: 'Módulo', value: r => r.module_name },
  { label: 'Parcela', value: r => r.plot_name },
  { label: 'Código parcela', value: r => r.plot_code },
  { label: 'Certificación', value: r => r.cert_name },
  { label: 'Producido sin cupo (kg)', value: r => Number(r.panela_kg) },
  { label: 'Lotes', value: r => r.lotes },
]

export default function CuposProduccionPage() {
  const COOPERATIVE_ID = useCooperative().id
  const [campaigns, setCampaigns] = useState(null) // null = cargando
  const [campaignId, setCampaignId] = useState('')
  const [outside, setOutside] = useState([]) // lotes fuera de toda campaña
  const [showOutside, setShowOutside] = useState(false)
  const [filter, setFilter] = useState(null) // null = automático (ver activeFilter)
  const [moduleFilter, setModuleFilter] = useState('') // nombre del módulo
  const [expanded, setExpanded] = useState(() => new Set()) // productores abiertos
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const [plots, setPlots] = useState(null) // parcelas activas de la cooperativa
  const [certs, setCerts] = useState([])
  const [modules, setModules] = useState([])
  const [quotas, setQuotas] = useState([])
  const [unquoted, setUnquoted] = useState([]) // producción sin cupo del año
  const [tableSearch, setTableSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [producerQuery, setProducerQuery] = useState('')
  const [producerResults, setProducerResults] = useState([])

  const [modalForm, setModalForm] = useState(null)
  const [modalPlots, setModalPlots] = useState([]) // parcelas activas del productor elegido en el modal
  const [modalError, setModalError] = useState('')
  const [saving, setSaving] = useState(false)

  const [showBulk, setShowBulk] = useState(false)
  const [bulkModuleId, setBulkModuleId] = useState('')
  const [bulkCertId, setBulkCertId] = useState('')
  const [bulkCupoKg, setBulkCupoKg] = useState('')
  const [bulkError, setBulkError] = useState('')
  const [bulkResult, setBulkResult] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [copySaving, setCopySaving] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const loadCerts = useCallback(() =>
    supabase.from('batch_certs').select('id, name')
      .eq('cooperative_id', COOPERATIVE_ID).eq('is_active', true).order('name')
      .then(({ data }) => setCerts(data ?? []))
  , [COOPERATIVE_ID])

  const loadModules = useCallback(() =>
    supabase.from('coop_modules').select('id, name')
      .eq('cooperative_id', COOPERATIVE_ID).eq('is_active', true).order('name')
      .then(({ data }) => setModules(data ?? []))
  , [COOPERATIVE_ID])

  const loadQuotas = useCallback((id) => {
    if (!id) { setQuotas([]); setUnquoted([]); setLoading(false); return Promise.resolve() }
    setLoading(true)
    return Promise.all([
      fetchQuotasByCampaign(id)
        .then(setQuotas)
        .catch(err => { toast.error('No se pudieron cargar los cupos', err.message); setQuotas([]) }),
      fetchProductionWithoutQuota(id)
        .then(setUnquoted)
        .catch(err => { toast.error('No se pudo cargar la producción sin cupo', err.message); setUnquoted([]) }),
    ]).finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadCerts(); loadModules() }, [loadCerts, loadModules])
  useEffect(() => { loadQuotas(campaignId) }, [campaignId, loadQuotas])
  useEffect(() => {
    fetchCampaigns(COOPERATIVE_ID)
      .then(list => { setCampaigns(list); setCampaignId(defaultCampaign(list)?.id ?? '') })
      .catch(err => { toast.error('No se pudieron cargar las campañas', err.message); setCampaigns([]) })
    fetchProductionOutsideCampaign().then(setOutside)
      .catch(err => toast.error('No se pudo revisar la producción fuera de campaña', err.message))
  }, [COOPERATIVE_ID])
  const campaign = campaigns?.find(c => c.id === campaignId) ?? null
  const prevCampaign = campaign ? previousCampaign(campaigns, campaign) : null
  useEffect(() => {
    fetchActivePlots(COOPERATIVE_ID).then(setPlots)
      .catch(err => { toast.error('No se pudieron cargar las parcelas', err.message); setPlots([]) })
  }, [COOPERATIVE_ID])

  // Parcelas activas (de productores activos) del módulo de la carga masiva.
  const bulkPlots = bulkModuleId && plots ? plots.filter(p => p.moduleId === bulkModuleId) : null

  // Búsqueda de productor desde 2 caracteres.
  useEffect(() => {
    if (producerQuery.trim().length < 2) { setProducerResults([]); return }
    const q = producerQuery.trim()
    const timer = setTimeout(() => {
      supabase.from('producers')
        .select('id, first_name, last_name, dni, coop_modules(name)')
        .eq('cooperative_id', COOPERATIVE_ID).eq('is_active', true)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,dni.ilike.%${q}%`)
        .order('first_name').limit(20)
        .then(({ data }) => setProducerResults(data ?? []))
    }, 250)
    return () => clearTimeout(timer)
  }, [producerQuery, COOPERATIVE_ID])

  // Parcelas del productor elegido en el modal (nuevo cupo).
  useEffect(() => {
    if (!modalForm?.producerId || modalForm.quotaId) { setModalPlots([]); return }
    supabase.from('plots').select('id, name, code')
      .eq('producer_id', modalForm.producerId).eq('is_active', true).order('name')
      .then(({ data }) => setModalPlots(data ?? []))
  }, [modalForm?.producerId, modalForm?.quotaId])

  const tableQuery = tableSearch.trim().toLowerCase()
  const allGroups = useMemo(() => groupByProducer(plots ?? [], quotas, unquoted), [plots, quotas, unquoted])

  // Módulo y búsqueda. Búsqueda: si coincide el productor se ven todas sus
  // parcelas; si no, solo las parcelas que coinciden.
  const searched = useMemo(() => {
    const inModule = moduleFilter ? allGroups.filter(g => g.module === moduleFilter) : allGroups
    if (!tableQuery) return inModule
    const hit = (...vals) => vals.some(v => v?.toLowerCase().includes(tableQuery))
    return inModule
      .map(g => (hit(g.name, g.dni) ? g : { ...g, plots: g.plots.filter(pl => hit(pl.name, pl.code)) }))
      .filter(g => g.plots.length > 0)
  }, [allGroups, moduleFilter, tableQuery])

  const counts = useMemo(() => {
    const all = searched.flatMap(g => g.plots)
    return Object.fromEntries(FILTERS.map(f => [f.key, all.filter(pl => plotMatchesFilter(pl, f.key)).length]))
  }, [searched])

  // Al entrar se ve "Con cupo" (la mayoría de parcelas suele no tener cupo);
  // si todavía no hay ninguno en el año, "Todas".
  const activeFilter = filter ?? (counts.con > 0 ? 'con' : 'todas')

  const groups = useMemo(() => searched
    .map(g => ({ ...g, plots: g.plots.filter(pl => plotMatchesFilter(pl, activeFilter)) }))
    .filter(g => g.plots.length > 0), [searched, activeFilter])

  const filteredQuotas = groups.flatMap(g => g.plots.flatMap(pl => pl.quotas))

  // Se muestran por partes; al cambiar filtro, módulo o búsqueda se vuelve
  // a empezar.
  useEffect(() => { setVisibleCount(PAGE) }, [activeFilter, moduleFilter, tableQuery, campaignId])
  const toggleProducer = (id) => setExpanded(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  // Con búsqueda los resultados son pocos: se muestran abiertos.
  const isOpen = (id) => !!tableQuery || expanded.has(id)

  const handleExport = () => {
    const visiblePlots = groups.flatMap(g => g.plots.map(pl => ({
      id: pl.id, name: pl.name, code: pl.code,
      producerName: g.name, dni: g.dni, moduleName: g.module,
    })))
    exportSheetsToExcel({
      fileName: `Cupos por parcela campaña ${campaign?.year}${tableQuery || moduleFilter || activeFilter !== 'todas' ? ' (filtrado)' : ''}`,
      sheets: [
        { sheetName: `Campaña ${campaign?.year}`, columns: quotaSheetColumns(certs), rows: quotaSheetRows(visiblePlots, quotas) },
        { sheetName: 'Consumo', columns: USAGE_COLUMNS, rows: filteredQuotas },
        { sheetName: 'Producción sin cupo', columns: UNQUOTED_COLUMNS, rows: groups.flatMap(g => g.plots.flatMap(pl => pl.unquoted)) },
      ],
    })
  }

  // Sin argumentos: elegir productor y parcela en el modal. Desde la lista:
  // productor y parcela ya elegidos.
  const openNewQuota = (producer = null, plot = null, certId = '') => {
    setModalError('')
    setModalForm({
      ...emptyForm,
      producerId: producer?.id ?? '',
      producerName: producer?.name ?? '',
      plotId: plot?.id ?? '',
      certId,
    })
  }

  const openEditQuota = (row) => {
    setModalError('')
    setModalForm({
      quotaId: row.quota_id,
      producerId: row.producer_id,
      producerName: row.producer_name,
      plotId: row.plot_id,
      plotName: row.plot_name,
      certId: row.cert_id,
      cupoKg: String(row.cupo_kg),
      notes: row.notes ?? '',
    })
  }

  // Certificaciones que la parcela ya tiene en el año: en "Nuevo cupo" no se
  // ofrecen (para cambiarlas se usa Editar).
  const takenCertIds = (plotId) => new Set(quotas.filter(q => q.plot_id === plotId).map(q => q.cert_id))
  const modalTakenCerts = modalForm && !modalForm.quotaId ? takenCertIds(modalForm.plotId) : new Set()

  const typicalKg = useMemo(() => typicalQuotaKg(quotas.map(q => Number(q.cupo_kg))), [quotas])
  const editedQuota = modalForm?.quotaId ? quotas.find(q => q.quota_id === modalForm.quotaId) : null
  const modalWarnings = modalForm && Number(modalForm.cupoKg) > 0
    ? quotaWarnings({
        cupoKg: Number(modalForm.cupoKg),
        previousKg: editedQuota ? Number(editedQuota.cupo_kg) : null,
        usedKg: editedQuota ? Number(editedQuota.acumulado_kg) : 0,
        referenceKg: typicalKg,
      })
    : []

  const closeModal = () => { setModalForm(null); setProducerQuery(''); setProducerResults([]) }

  const handlePickProducerInModal = (producer) => {
    setModalForm(f => ({ ...f, producerId: producer.id, producerName: `${producer.first_name} ${producer.last_name}`, plotId: '' }))
    setProducerQuery('')
    setProducerResults([])
  }

  const handleSaveQuota = async () => {
    setModalError('')
    if (!modalForm.producerId) { setModalError('Elija un productor.'); return }
    if (!modalForm.plotId) { setModalError('Elija una parcela.'); return }
    if (!modalForm.certId) { setModalError('Elija una certificación.'); return }
    const cupoKg = Number(modalForm.cupoKg)
    if (!cupoKg || cupoKg <= 0) { setModalError('El cupo debe ser un número mayor a 0.'); return }

    setSaving(true)
    try {
      const { error } = modalForm.quotaId
        ? await supabase.from('plot_quotas')
            .update({ cupo_kg: cupoKg, notes: modalForm.notes.trim() || null })
            .eq('id', modalForm.quotaId)
        : await supabase.from('plot_quotas').insert({
            plot_id: modalForm.plotId,
            batch_cert_id: modalForm.certId,
            cooperative_id: COOPERATIVE_ID,
            cupo_kg: cupoKg,
            campaign_id: campaignId,
            notes: modalForm.notes.trim() || null,
          })
      if (error) {
        if (error.code === '23505') throw new Error('Esta parcela ya tiene un cupo para esa certificación en esta campaña.')
        throw error
      }
      closeModal()
      toast.success('Cupo guardado')
      loadQuotas(campaignId)
    } catch (err) {
      setModalError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteQuota = async (row) => {
    const ok = await confirm({
      title: 'Eliminar cupo',
      message: `¿Eliminar el cupo de ${row.cert_name} de la parcela ${row.plot_name} (${row.producer_name}) en la campaña ${campaign?.year}?`,
      confirmText: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('plot_quotas').delete().eq('id', row.quota_id)
    if (error) { toast.error('No se pudo eliminar el cupo', error.message); return }
    toast.success('Cupo eliminado')
    loadQuotas(campaignId)
  }

  // Inserta cupos sin pisar los que ya existan en la campaña (si alguien ya
  // ajustó uno a mano, no se revierte).
  const insertQuotasSkippingExisting = async (rows) => {
    const { data, error } = await supabase.from('plot_quotas')
      .upsert(rows, { onConflict: 'plot_id,batch_cert_id,campaign_id', ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    return data?.length ?? 0
  }

  const handleCopyPreviousCampaign = async () => {
    setBulkError(''); setBulkResult('')
    if (!prevCampaign) { setBulkError('No hay una campaña anterior.'); return }
    const ok = await confirm({
      title: 'Copiar cupos de la campaña anterior',
      message: `¿Copiar todos los cupos de la campaña ${prevCampaign.year} a la campaña ${campaign.year}? Las parcelas que ya tengan cupo en esta campaña para esa certificación no se modifican.`,
      confirmText: 'Copiar',
    })
    if (!ok) return
    setCopySaving(true)
    try {
      const prev = await fetchAllRows(() => supabase.from('plot_quotas')
        .select('plot_id, batch_cert_id, cupo_kg')
        .eq('cooperative_id', COOPERATIVE_ID).eq('campaign_id', prevCampaign.id)
        .order('id'))
      // Solo certificaciones activas: una dada de baja no pasa a la nueva campaña.
      const activeCertIds = new Set(certs.map(c => c.id))
      const toCopy = prev.filter(q => activeCertIds.has(q.batch_cert_id))
      if (!toCopy.length) { setBulkError(`No hay cupos cargados en la campaña ${prevCampaign.year}.`); return }
      const inserted = await insertQuotasSkippingExisting(toCopy.map(q => ({
        ...q, cooperative_id: COOPERATIVE_ID, campaign_id: campaignId, notes: `Copiado de la campaña ${prevCampaign.year}`,
      })))
      loadQuotas(campaignId)
      setBulkResult(`Se copiaron ${inserted} de ${toCopy.length} cupos de la campaña ${prevCampaign.year}.`)
    } catch (err) {
      setBulkError(err.message)
    } finally {
      setCopySaving(false)
    }
  }

  // Mismo cupo para todas las parcelas activas de un módulo.
  const handleBulkAssign = async () => {
    setBulkError(''); setBulkResult('')
    if (!bulkModuleId) { setBulkError('Elija un módulo.'); return }
    if (!bulkCertId) { setBulkError('Elija una certificación.'); return }
    const cupoKg = Number(bulkCupoKg)
    if (!cupoKg || cupoKg <= 0) { setBulkError('El cupo debe ser un número mayor a 0.'); return }

    setBulkSaving(true)
    try {
      if (!bulkPlots?.length) { setBulkError('Ese módulo no tiene parcelas activas.'); return }
      const inserted = await insertQuotasSkippingExisting(bulkPlots.map(p => ({
        plot_id: p.id, batch_cert_id: bulkCertId, cooperative_id: COOPERATIVE_ID, cupo_kg: cupoKg, campaign_id: campaignId,
      })))
      loadQuotas(campaignId)
      setBulkCupoKg('')
      setBulkResult(`Se asignó el cupo a ${inserted} de ${bulkPlots.length} parcelas del módulo (las que ya tenían cupo para esa certificación en esta campaña no se modificaron).`)
    } catch (err) {
      setBulkError(err.message)
    } finally {
      setBulkSaving(false)
    }
  }

  const producerOption = (p, onPick) => (
    <div key={p.id} style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 6 }} onClick={() => onPick(p)}>
      {p.first_name} {p.last_name} <span className="muted small">DNI {p.dni} · {p.coop_modules?.name ?? 'sin módulo'}</span>
    </div>
  )

  const rowActions = (row) => (
    <>
      <button className="btn small primary" onClick={() => openEditQuota(row)}>Editar</button>
      <button className="btn small danger primary" onClick={() => handleDeleteQuota(row)}>Eliminar</button>
    </>
  )

  return (
    <div>
      {/* Encabezado: campaña y acciones de la página (importar/exportar/nuevo)
          separadas de los filtros de la lista, para que no se confundan. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
          <h2 style={{ margin: '0 0 6px' }}>Cupos de producción por parcela</h2>
          {campaigns?.length > 0 && (
            <div className="field" style={{ margin: 0 }}>
              <label>Campaña</label>
              <select className="input" value={campaignId} onChange={e => setCampaignId(e.target.value)}>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>Campaña {c.year} ({campaignPeriod(c)}){c.is_active ? ' · activa' : ''}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {campaign && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small outline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setShowImport(true)}>
              <Icon name="upload" size={15} /> Importar Excel
            </button>
            <button className="btn small outline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={handleExport} disabled={groups.length === 0}>
              <Icon name="download" size={15} /> Exportar Excel
            </button>
            <button className="btn small primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => openNewQuota()}>
              <Icon name="plus" size={15} /> Nuevo cupo
            </button>
          </div>
        )}
      </div>

      {outside.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderColor: 'var(--warning)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
              {outside.length} lote{outside.length === 1 ? '' : 's'} con fecha fuera de toda campaña: no cuenta{outside.length === 1 ? '' : 'n'} para ningún cupo. Ajuste las fechas en Catálogos → Campañas.
            </span>
            <button className="btn small outline" onClick={() => setShowOutside(v => !v)}>{showOutside ? 'Ocultar' : 'Ver lotes'}</button>
          </div>
          {showOutside && (
            <div style={{ marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
              <table className="table small">
                <thead><tr>{['Fecha de proceso', 'Recibo de acopio', 'Productor', 'Parcela', 'Panela kg'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {outside.map(o => (
                    <tr key={o.batch_id}>
                      <td>{formatIsoDate(o.process_date)}</td>
                      <td>{o.receipts || '—'}</td>
                      <td>{o.producer_name}</td>
                      <td>{o.plot_name ?? '—'}{o.plot_code ? ` · ${o.plot_code}` : ''}</td>
                      <td>{kg(o.panela_kg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {campaigns && campaigns.length === 0 && (
        <EmptyState icon="calendar" message="No hay campañas. Créelas en Catálogos → Campañas: los cupos son por campaña." />
      )}

      {campaign && (<>

      <div className="card" style={{ marginTop: 16 }}>
        <button className="btn small outline" onClick={() => setShowBulk(s => !s)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', padding: 0, background: 'none' }}>
          <Icon name={showBulk ? 'chevronUp' : 'chevronDown'} size={16} />
          <strong>Carga masiva de cupos · Campaña {campaign.year}</strong>
        </button>

        {showBulk && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <p className="muted small" style={{ margin: '0 0 6px' }}>No reemplaza los cupos ya cargados en esta campaña.</p>
              <button className="btn small primary" onClick={handleCopyPreviousCampaign} disabled={copySaving || !prevCampaign}>
                {copySaving ? 'Copiando...' : prevCampaign ? `Copiar cupos de la campaña ${prevCampaign.year}` : 'Sin campaña anterior para copiar'}
              </button>
            </div>
            <div>
              <div className="grid two" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Módulo</label>
                  <select className="input" value={bulkModuleId} onChange={e => setBulkModuleId(e.target.value)}>
                    <option value="">Seleccionar...</option>
                    {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Certificación</label>
                  <select className="input" value={bulkCertId} onChange={e => setBulkCertId(e.target.value)}>
                    <option value="">Seleccionar...</option>
                    {certs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Cupo por parcela (kg)</label>
                  <input type="number" className="input" min="0" step="0.1" value={bulkCupoKg} onChange={e => setBulkCupoKg(e.target.value)} />
                </div>
              </div>
              <button className="btn small primary" style={{ marginTop: 8 }} onClick={handleBulkAssign} disabled={bulkSaving}>
                {bulkSaving ? 'Aplicando...' : bulkPlots ? `Aplicar a ${bulkPlots.length} parcela(s) del módulo` : 'Aplicar'}
              </button>
            </div>
            {bulkError && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{bulkError}</p>}
            {bulkResult && <p style={{ color: 'var(--success)', fontSize: 13, margin: 0 }}>{bulkResult}</p>}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="segmented" role="tablist" style={{ flexWrap: 'wrap', borderRadius: 14, marginBottom: 10 }}>
          {FILTERS.map(f => (
            <button key={f.key} role="tab" aria-selected={activeFilter === f.key}
              className={activeFilter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>
              {f.label} <span style={{ fontWeight: 400, opacity: 0.8 }}>{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <ClearableInput className="input" placeholder="Buscar por productor, DNI, parcela o código..."
              value={tableSearch} onChange={e => setTableSearch(e.target.value)} onClear={() => setTableSearch('')} />
          </div>
          <select className="input" style={{ flex: '0 1 220px', width: 'auto' }} value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
            <option value="">Todos los módulos</option>
            {modules.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>

        {loading || !plots ? (
          <SkeletonList count={4} lines={2} />
        ) : groups.length === 0 ? (
          <EmptyState icon="search" message={tableQuery ? 'Ningún productor coincide con la búsqueda.' : 'No hay parcelas en este filtro.'} />
        ) : (
          <div style={{ maxHeight: 600, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span>{groups.length} productor{groups.length === 1 ? '' : 'es'}</span>
              {!tableQuery && (
                <button className="btn small outline" style={{ border: 'none', padding: 0, background: 'none' }}
                  onClick={() => setExpanded(s => (s.size ? new Set() : new Set(groups.slice(0, visibleCount).map(g => g.id))))}>
                  {expanded.size ? 'Cerrar todos' : 'Abrir los visibles'}
                </button>
              )}
            </div>
            {groups.slice(0, visibleCount).map(g => (
              <div key={g.key} style={{ border: '1px solid var(--border)', borderRadius: 8, flexShrink: 0 }}>
                <button type="button" onClick={() => toggleProducer(g.id)} aria-expanded={isOpen(g.id)}
                  style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit',
                    borderBottom: isOpen(g.id) ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon name={isOpen(g.id) ? 'chevronUp' : 'chevronDown'} size={16} />
                    <span>
                      <strong>{g.name}</strong>
                      <span className="muted small"> · DNI {g.dni}{g.module ? ` · ${g.module}` : ''} · {g.plotCount} parcela{g.plotCount === 1 ? '' : 's'}, {g.withQuota} con cupo</span>
                    </span>
                  </span>
                  {(g.cupo > 0 || g.sinCupoProd) && (
                    <span className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 1 420px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {g.cupo > 0 && (
                        <>
                          <QuotaBar pct={pct(g.usado, g.cupo)} superado={g.usado >= g.cupo} />
                          {kg(g.usado)} / {kg(g.cupo)} kg {pctTag(pct(g.usado, g.cupo), g.usado >= g.cupo)}
                        </>
                      )}
                      {g.superado && g.usado < g.cupo && <span className="tag error-tag">parcela superada</span>}
                      {g.sinCupoProd && <span className="tag warn">producción sin cupo</span>}
                    </span>
                  )}
                </button>
                {isOpen(g.id) && g.plots.map(pl => (
                  <div key={pl.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 200px) 1fr', gap: 8, padding: '8px 12px', alignItems: 'start' }}>
                    <span>
                      {pl.name}
                      {pl.code ? <span className="muted small"> · {pl.code}</span> : null}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {pl.quotas.map(q => (
                        <div key={q.quota_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ width: 110 }} className="small">{q.cert_name}</span>
                          <QuotaBar usado={Number(q.acumulado_kg)} cupo={Number(q.cupo_kg)} superado={q.superado} pct={Number(q.porcentaje_usado)} />
                          <span className="small" style={{ minWidth: 150 }}>{kg(q.acumulado_kg)} / {kg(q.cupo_kg)} kg</span>
                          {pctTag(q.porcentaje_usado, q.superado)}
                          <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>{rowActions(q)}</span>
                        </div>
                      ))}
                      {pl.unquoted.map(u => (
                        <div key={u.cert_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ width: 110 }} className="small">{u.cert_name}</span>
                          <span className="small" style={{ color: 'var(--warning)', fontWeight: 600 }}>
                            Sin cupo · {kg(u.panela_kg)} kg producidos ({u.lotes} lote{u.lotes === 1 ? '' : 's'})
                          </span>
                          <span style={{ marginLeft: 'auto' }}>
                            <button className="btn small primary" onClick={() => openNewQuota(g, pl, u.cert_id)}>Asignar cupo</button>
                          </span>
                        </div>
                      ))}
                      <div>
                        <button className="btn small outline" onClick={() => openNewQuota(g, pl)}>
                          {pl.quotas.length ? '+ Otra certificación' : '+ Asignar cupo'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {groups.length > visibleCount && (
              <button className="btn small outline" style={{ alignSelf: 'center', flexShrink: 0 }} onClick={() => setVisibleCount(n => n + PAGE)}>
                Mostrar más ({groups.length - visibleCount} restantes)
              </button>
            )}
          </div>
        )}
      </div>

      </>)}

      {modalForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>{modalForm.quotaId ? 'Editar cupo' : 'Nuevo cupo'} · Campaña {campaign?.year}</h3>

              {!modalForm.quotaId && !modalForm.producerId ? (
                <div className="field">
                  <label>Productor *</label>
                  <ClearableInput className="input" placeholder="Buscar por nombre o DNI..."
                    value={producerQuery} onChange={e => setProducerQuery(e.target.value)} onClear={() => setProducerQuery('')} />
                  {producerResults.length > 0 && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                      {producerResults.map(p => producerOption(p, handlePickProducerInModal))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="field">
                  <label>Productor</label>
                  <input type="text" className="input" value={modalForm.producerName} disabled />
                </div>
              )}

              {modalForm.producerId && (
                <div className="field">
                  <label>Parcela *</label>
                  {modalForm.quotaId ? (
                    <input type="text" className="input" value={modalForm.plotName} disabled />
                  ) : (
                    <select className="input" value={modalForm.plotId} onChange={e => {
                      const plotId = e.target.value
                      setModalForm(f => ({ ...f, plotId, certId: takenCertIds(plotId).has(f.certId) ? '' : f.certId }))
                    }}>
                      <option value="">{modalPlots.length ? 'Seleccionar...' : 'El productor no tiene parcelas activas'}</option>
                      {modalPlots.map(p => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
                    </select>
                  )}
                </div>
              )}

              <div className="field">
                <label>Certificación *</label>
                <select className="input" value={modalForm.certId} disabled={!!modalForm.quotaId}
                  onChange={e => setModalForm(f => ({ ...f, certId: e.target.value }))}>
                  <option value="">Seleccionar...</option>
                  {certs.map(c => (
                    <option key={c.id} value={c.id} disabled={modalTakenCerts.has(c.id)}>
                      {c.name}{modalTakenCerts.has(c.id) ? ' (ya tiene cupo)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Cupo (kg) *</label>
                <input type="number" className="input" min="0" step="0.1" value={modalForm.cupoKg}
                  onChange={e => setModalForm(f => ({ ...f, cupoKg: e.target.value }))} />
                {modalWarnings.map(w => (
                  <div key={w} className="small" style={{ color: 'var(--warning)', marginTop: 4 }}>Revise: {w}</div>
                ))}
              </div>

              <div className="field">
                <label>Notas</label>
                <input type="text" className="input" placeholder="Opcional" value={modalForm.notes}
                  onChange={e => setModalForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              {modalError && <p style={{ color: 'var(--danger)', fontSize: 14, margin: '4px 0' }}>{modalError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={closeModal} disabled={saving}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveQuota} disabled={saving}>{saving ? 'Guardando...' : 'Guardar cupo'}</button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <ImportarCuposModal plots={plots} campaign={campaign} quotas={quotas} certs={certs}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); loadQuotas(campaignId) }} />
      )}

      {confirmDialog}
    </div>
  )
}
