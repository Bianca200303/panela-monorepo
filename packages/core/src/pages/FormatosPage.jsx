import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import FormatosEstibaSection from './FormatosEstibaSection'
import FormatoPersonalSection from './FormatoPersonalSection'
import FormatoDevolucionSection from './FormatoDevolucionSection'
import FormatosCloroSection from './FormatosCloroSection'
import FormatosInspeccionSection from './FormatosInspeccionSection'
import FormatosPlagasSection from './FormatosPlagasSection'
import FormatosSaludSection from './FormatosSaludSection'
import FormatosMantenimientoSection from './FormatosMantenimientoSection'
import FormatosLimpiezaSection from './FormatosLimpiezaSection'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Icon from '../components/Icon'
import DateInput from '../components/DateInput'
import { FORMAT_TYPE_FCMPTPH, FORMAT_TITLE_FCMPTPH, buildPrintHTMLFcmtph } from '../lib/formatos/fcmtph'
import { getCoopCode, openPrintWindow, fmtDate, fmtDateTime, fmtNum } from '../lib/formatos/shared'
import { downloadPdfDocument } from '../lib/pdfDownload'

// Catálogo de documentos agrupados por BPM (Buenas Prácticas de Manufactura)
// / HYS (Higiene y Saneamiento) / Calidad-Cliente -- clasificación por
// significado de cada documento (no hay papel físico con estos códigos para
// verificar contra un BPM/HYS ya impreso, a diferencia de los CAESP-XXX-BPM/
// HYS de CAES). FCPO/FET/FCMPTPH/FMEH = controles de proceso -> BPM.
// FCCLR/FIAE/FCP/FSEA/FLDH = higiene/saneamiento -> HYS. FQD no es un
// control de planta (es gestión de calidad hacia el cliente), va aparte.
const CATEGORY_META = {
  bpm:     { label: 'BPM',              desc: 'Buenas Prácticas de Manufactura' },
  hys:     { label: 'HYS',              desc: 'Higiene y Saneamiento' },
  calidad: { label: 'Calidad / Cliente', desc: 'Gestión de calidad hacia el cliente' },
}
const FORMATOS_CATALOG = [
  { key: 'fcpo',    code: 'FCPO',    label: 'Control de Personal',         category: 'bpm', icon: 'users',
    desc: 'Control de personal operario. Uno por lote de campo, agrupa todas las áreas de trabajo del día.' },
  { key: 'fet',     code: 'FET',     label: 'Estiba y Transporte',         category: 'bpm', icon: 'truck',
    desc: 'Inspección de estiba y transporte. Generado al momento del despacho de la salida de campo.' },
  { key: 'fcmptph', code: 'FCMPTPH', label: 'Mat. Prima · Temp · pH',      category: 'bpm', icon: 'thermometer',
    desc: 'Control de materia prima, temperatura y pH. Uno por módulo y período, agrupa varios lotes de campo.' },
  { key: 'fmeh',    code: 'FMEH',    label: 'Mant. Equipos y Hornillas',   category: 'bpm', icon: 'wrench',
    desc: 'Mantenimiento de equipos y hornillas. Por período, agrupa los registros de mantenimiento preventivo y correctivo.' },
  { key: 'fcclr',   code: 'FCCLR',   label: 'Cloro Libre Residual',        category: 'hys', icon: 'droplet',
    desc: 'Control de cloro libre residual. Por módulo y período de producción.' },
  { key: 'fiae',    code: 'FIAE',    label: 'Inspección de Ambientes',     category: 'hys', icon: 'clipboardCheck',
    desc: 'Inspección de ambientes, equipo y personal. Un formato por registro de inspección, independiente de producción.' },
  { key: 'fcp',     code: 'FCP',     label: 'Control de Plagas',           category: 'hys', icon: 'bug',
    desc: 'Control de plagas (cebos e insectos). Por período, agrupa múltiples registros de un módulo.' },
  { key: 'fsea',    code: 'FSEA',    label: 'Seg. de Enfermedades',        category: 'hys', icon: 'heartPulse',
    desc: 'Seguimiento de enfermedades y accidentes de personal. Por período, agrupa múltiples incidentes del módulo.' },
  { key: 'fldh',    code: 'FLDH',    label: 'Limpieza y Desinfección',     category: 'hys', icon: 'spray',
    desc: 'Limpieza y desinfección de instalaciones. Por período, agrupa las sesiones del módulo.' },
  { key: 'fqd',     code: 'FQD',     label: 'Quejas y Devoluciones',       category: 'calidad', icon: 'messageAlert',
    desc: 'Quejas y devoluciones de clientes. Uno por registro de devolución de producto de campo.' },
]

export default function FormatosPage() {
  const COOPERATIVE = useCooperative()
  const { webUser } = useAuthStore()
  const [searchParams] = useSearchParams()
  const docFromUrl = searchParams.get('doc') ?? ''

  const [modules, setModules]         = useState([])
  const [allCerts, setAllCerts]       = useState([])
  const [historial, setHistorial]     = useState([])
  const [loadingHist, setLoadingHist] = useState(true)

  // Filtros historial
  const [histFilter, setHistFilter]             = useState(docFromUrl ? 'all' : 'month')
  const [histModuleFilter, setHistModuleFilter] = useState('')
  const [histCustomFrom, setHistCustomFrom]     = useState('')
  const [histCustomTo, setHistCustomTo]         = useState('')

  // Formulario
  const [moduleId, setModuleId]                 = useState('')
  const [dateFrom, setDateFrom]                 = useState('')
  const [dateTo, setDateTo]                     = useState('')
  const [newPeriodFilter, setNewPeriodFilter]   = useState('')
  const [batches, setBatches]                   = useState(null)
  const [batchDocMap, setBatchDocMap]           = useState({})
  const [selectedBatchIds, setSelectedBatchIds] = useState(new Set())
  const [moduleName, setModuleName]             = useState('')
  const [loading, setLoading]                   = useState(false)
  const [emitting, setEmitting]                 = useState(false)
  const [savedCode, setSavedCode]               = useState(null)
  const [savedEmittedAt, setSavedEmittedAt]     = useState(null)
  const [error, setError]                       = useState('')
  const [obsEdits, setObsEdits]                 = useState({})
  const [savingObs, setSavingObs]               = useState({})
  const [reprinting, setReprinting]             = useState(null)
  const [viewing, setViewing]                   = useState(null)

  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [pdfError, setPdfError]           = useState('')

  const [firmantes, setFirmantes] = useState([])
  const [tab, setTab] = useState(searchParams.get('subtab') ?? 'fcmptph')
  const [view, setView] = useState('historico')

  function handleTabChange(key) {
    setTab(key)
    setView('historico')
  }

  useEffect(() => { loadInitial() }, [])

  async function loadInitial() {
    const [{ data: mods }, { data: certs }] = await Promise.all([
      supabase.from('coop_modules').select('id, name').eq('cooperative_id', COOPERATIVE.id).eq('is_active', true).order('name'),
      supabase.from('batch_certs').select('id, name').eq('cooperative_id', COOPERATIVE.id).order('name'),
    ])
    setModules(mods ?? [])
    setAllCerts(certs ?? [])
    await loadHistorial()
  }

  async function loadHistorial() {
    setLoadingHist(true)
    const { data } = await supabase
      .from('formatos_control_mp_ph')
      .select('id, formato_codigo, module_id, date_from, date_to, emitted_by_name, emitted_at, status, coop_modules(name)')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('emitted_at', { ascending: false })
    setHistorial(data ?? [])
    setLoadingHist(false)
  }

  async function fetchBatchesForFormat(modId, from, to) {
    const { data: prods } = await supabase
      .from('producers').select('id')
      .eq('coop_module_id', modId).eq('cooperative_id', COOPERATIVE.id)
    if (!prods?.length) return []

    const { data: rows } = await supabase
      .from('production_batches')
      .select(`id, batch_code, harvest_date, process_date, cane_kg, juice_liters, panela_kg, confitillo_kg,
        efficiency_percentage, observations, registered_by_user_id,
        producers(first_name, last_name, is_member, appagrop_code),
        plots(name, code),
        production_batch_certs(batch_certs(id, name))`)
      .eq('cooperative_id', COOPERATIVE.id)
      .in('producer_id', prods.map(p => p.id))
      .gte('process_date', from).lte('process_date', to)
      .order('process_date', { ascending: true })
    if (!rows?.length) return []

    const batchIds = rows.map(r => r.id)
    const [phRes, tempRes] = await Promise.all([
      supabase.from('batch_ph_controls')
        .select('production_batch_id, record_date, regulator_type, regulator_quantity_value, regulator_quantity_unit, ph_initial, ph_final, brix, corrective_action')
        .in('production_batch_id', batchIds).order('record_date'),
      supabase.from('batch_temperatures')
        .select('production_batch_id, temperature, sequence_number')
        .in('production_batch_id', batchIds).order('sequence_number'),
    ])

    const phByBatch = {}
    ;(phRes.data ?? []).forEach(p => {
      if (!phByBatch[p.production_batch_id]) phByBatch[p.production_batch_id] = []
      phByBatch[p.production_batch_id].push(p)
    })
    const tempByBatch = {}
    ;(tempRes.data ?? []).forEach(t => {
      if (!tempByBatch[t.production_batch_id]) tempByBatch[t.production_batch_id] = []
      tempByBatch[t.production_batch_id].push(t)
    })

    return rows.map(b => ({
      ...b,
      ph_controls: phByBatch[b.id] ?? [],
      temperatures: tempByBatch[b.id] ?? [],
    }))
  }

  async function fetchResponsibles(rows) {
    const ids = [...new Set(rows.map(b => b.registered_by_user_id).filter(Boolean))]
    if (!ids.length) return []
    const { data } = await supabase
      .from('users').select('user_id, first_name, last_name, role')
      .in('user_id', ids).eq('cooperative_id', COOPERATIVE.id)
    return data ?? []
  }

  function buildFirmantesFromResponsibles(resp) {
    return resp.map((r, i) => ({
      nombre: `${r.first_name} ${r.last_name}`,
      cargo: r.role === 'admin_modulo' ? 'Administrador de Módulo' : 'Técnico de Campo',
      orden: i + 1,
      fuente: 'auto',
    }))
  }

  function handleNewPeriod(key) {
    setNewPeriodFilter(key)
    setBatches(null)
    setSavedCode(null)
    setError('')
    if (key === 'custom') return
    const today = new Date()
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const todayStr = fmt(today)
    if (key === 'month') {
      setDateFrom(fmt(new Date(today.getFullYear(), today.getMonth(), 1)))
      setDateTo(todayStr)
    } else if (key === 'year') {
      setDateFrom(fmt(new Date(today.getFullYear(), 0, 1)))
      setDateTo(todayStr)
    } else if (key === '6months') {
      const from = new Date(today)
      from.setMonth(from.getMonth() - 6)
      setDateFrom(fmt(from))
      setDateTo(todayStr)
    }
  }

  async function handlePreview() {
    if (!moduleId || !dateFrom || !dateTo) { setError('Selecciona módulo y rango de fechas.'); return }
    if (dateFrom > dateTo) { setError('La fecha inicial no puede ser mayor a la fecha final.'); return }
    setError(''); setLoading(true); setSavedCode(null); setSavedEmittedAt(null); setBatches(null); setObsEdits({})
    try {
      const mod = modules.find(m => m.id === moduleId)
      setModuleName(mod?.name ?? '')
      const rows = await fetchBatchesForFormat(moduleId, dateFrom, dateTo)

      const docMap = {}
      if (rows.length > 0) {
        const { data: links } = await supabase
          .from('formatos_control_mp_ph_lotes')
          .select('lote_campo_id, formatos_control_mp_ph(formato_codigo)')
          .in('lote_campo_id', rows.map(r => r.id))
        ;(links ?? []).forEach(l => {
          if (l.formatos_control_mp_ph?.formato_codigo)
            docMap[l.lote_campo_id] = l.formatos_control_mp_ph.formato_codigo
        })
      }

      setBatchDocMap(docMap)
      setSelectedBatchIds(new Set(rows.filter(r => !docMap[r.id]).map(r => r.id)))
      setBatches(rows)
      const resp = await fetchResponsibles(rows)
      setFirmantes(buildFirmantesFromResponsibles(resp))
    } catch (e) {
      setError(e.message ?? 'Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }

  async function handleObsBlur(batchId, value) {
    const original = batches.find(b => b.id === batchId)?.observations ?? ''
    if (value === original) return
    setSavingObs(s => ({ ...s, [batchId]: true }))
    await supabase.from('production_batches').update({ observations: value || null }).eq('id', batchId)
    setSavingObs(s => ({ ...s, [batchId]: false }))
    setBatches(prev => prev.map(b => b.id === batchId ? { ...b, observations: value || null } : b))
  }

  function toggleBatch(id) {
    setSelectedBatchIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllNew() {
    const newIds = batches.filter(b => !batchDocMap[b.id]).map(b => b.id)
    const allNewSelected = newIds.every(id => selectedBatchIds.has(id))
    setSelectedBatchIds(prev => {
      const next = new Set(prev)
      newIds.forEach(id => allNewSelected ? next.delete(id) : next.add(id))
      return next
    })
  }

  function updateFirmante(idx, field, value) {
    setFirmantes(prev => prev.map((f, i) => i === idx ? { ...f, [field]: value } : f))
  }
  function removeFirmante(idx) {
    setFirmantes(prev => prev.filter((_, i) => i !== idx).map((f, i) => ({ ...f, orden: i + 1 })))
  }
  function addFirmante() {
    setFirmantes(prev => [...prev, { nombre: '', cargo: '', orden: prev.length + 1, fuente: 'manual' }])
  }

  async function handleEmit() {
    const toEmit = batches?.filter(b => selectedBatchIds.has(b.id)) ?? []
    if (!toEmit.length) { setError('Selecciona al menos un lote para emitir.'); return }
    setEmitting(true); setError('')
    try {
      const emittedByName = webUser ? `${webUser.first_name} ${webUser.last_name}` : null
      const { data, error: e } = await supabase.rpc('emit_formato_mp_ph', {
        p_coop_code:       getCoopCode(COOPERATIVE),
        p_cooperative_id:  COOPERATIVE.id,
        p_module_id:       moduleId,
        p_date_from:       dateFrom,
        p_date_to:         dateTo,
        p_emitted_by:      webUser?.id ?? null,
        p_emitted_by_name: emittedByName,
        p_firmantes:       firmantes,
        p_batch_ids:       toEmit.map(b => b.id),
      })
      if (e) throw e
      setSavedCode(data.formato_codigo)
      setSavedEmittedAt(new Date().toISOString())
      await loadHistorial()
    } catch (e) {
      setError(e.message ?? 'Error al emitir formato')
    } finally {
      setEmitting(false)
    }
  }

  async function handleExportPdf() {
    const toShow = batches?.filter(b => selectedBatchIds.has(b.id)) ?? []
    if (!toShow.length) return
    setPdfGenerating(true); setPdfError('')
    try {
      const html = buildPrintHTMLFcmtph(COOPERATIVE, savedCode ?? '(borrador)', moduleName, dateFrom, dateTo, savedEmittedAt, toShow, allCerts, firmantes)
      await downloadPdfDocument(html)
    } catch (e) { setPdfError(e.message ?? 'Error al generar el PDF') }
    finally { setPdfGenerating(false) }
  }

  async function loadFormatoData(formato) {
    const { data: links } = await supabase
      .from('formatos_control_mp_ph_lotes')
      .select(`
        formatos_control_mp_ph ( firmantes ),
        production_batches (
          id, batch_code, harvest_date, process_date, cane_kg, juice_liters,
          panela_kg, confitillo_kg, efficiency_percentage, observations,
          registered_by_user_id,
          producers ( first_name, last_name, is_member, appagrop_code ),
          plots ( name, code ),
          production_batch_certs ( batch_certs ( id, name ) )
        )
      `)
      .eq('formato_id', formato.id)

    const rows = (links ?? []).map(l => l.production_batches).filter(Boolean)
      .sort((a, b) => (a.process_date ?? '').localeCompare(b.process_date ?? ''))
    const firmantesGuardados = links?.[0]?.formatos_control_mp_ph?.firmantes ?? []

    if (!rows.length) return { rows, firmantesGuardados }

    const batchIds = rows.map(r => r.id)
    const [phRes, tempRes] = await Promise.all([
      supabase.from('batch_ph_controls')
        .select('production_batch_id, record_date, regulator_type, regulator_quantity_value, regulator_quantity_unit, ph_initial, ph_final, brix, corrective_action')
        .in('production_batch_id', batchIds).order('record_date'),
      supabase.from('batch_temperatures')
        .select('production_batch_id, temperature, sequence_number')
        .in('production_batch_id', batchIds).order('sequence_number'),
    ])

    const phByBatch = {}
    ;(phRes.data ?? []).forEach(p => {
      if (!phByBatch[p.production_batch_id]) phByBatch[p.production_batch_id] = []
      phByBatch[p.production_batch_id].push(p)
    })
    const tempByBatch = {}
    ;(tempRes.data ?? []).forEach(t => {
      if (!tempByBatch[t.production_batch_id]) tempByBatch[t.production_batch_id] = []
      tempByBatch[t.production_batch_id].push(t)
    })

    const enriched = rows.map(b => ({
      ...b,
      ph_controls: phByBatch[b.id] ?? [],
      temperatures: tempByBatch[b.id] ?? [],
    }))

    return { rows: enriched, firmantesGuardados }
  }

  async function handleView(formato) {
    setViewing({ formato, rows: null, firmantes: [] })
    const { rows, firmantesGuardados } = await loadFormatoData(formato)
    setViewing({ formato, rows, firmantes: firmantesGuardados })
  }

  async function handleReprint(formato) {
    setReprinting(formato.id)
    try {
      const { rows, firmantesGuardados } = await loadFormatoData(formato)
      const html = buildPrintHTMLFcmtph(
        COOPERATIVE,
        formato.formato_codigo,
        formato.coop_modules?.name ?? '',
        formato.date_from, formato.date_to,
        formato.emitted_at, rows, allCerts, firmantesGuardados
      )
      openPrintWindow(html, formato.formato_codigo)
    } catch (e) {
      console.error(e)
    } finally {
      setReprinting(null)
    }
  }

  // ── Filtrado historial ────────────────────────────────────────────────────
  const now = new Date()
  const filteredHistorial = historial.filter(f => {
    if (docFromUrl && f.formato_codigo !== docFromUrl) return false
    const d = new Date(f.emitted_at)
    if (histFilter === 'month') {
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return false
    } else if (histFilter === 'year') {
      if (d.getFullYear() !== now.getFullYear()) return false
    } else if (histFilter === '6months') {
      const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 6)
      if (d < cutoff) return false
    } else if (histFilter === 'custom') {
      if (histCustomFrom && d < new Date(histCustomFrom + 'T00:00:00')) return false
      if (histCustomTo   && d > new Date(histCustomTo   + 'T23:59:59')) return false
    }
    if (histModuleFilter && f.module_id !== histModuleFilter) return false
    return true
  })

  return (
    <div>
      {/* ══ TÍTULO ════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Formatos de Campo</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Documentos oficiales generados a partir de los registros del sistema. Organizados en Buenas Prácticas de Manufactura, Higiene y Saneamiento, y Calidad/Cliente.
        </p>
      </div>

      {/* ══ CATEGORÍAS BPM / HYS / CALIDAD ═══════════════════════════════════ */}
      {['bpm', 'hys', 'calidad'].map(cat => {
        const meta = CATEGORY_META[cat]
        const items = FORMATOS_CATALOG.filter(f => f.category === cat)
        return (
          <div key={cat} className="formato-category">
            <div className="formato-category-label">
              {meta.label}<span className="formato-category-desc"> — {meta.desc}</span>
            </div>
            <div className="formato-tab-grid">
              {items.map(f => (
                <button
                  key={f.key}
                  className={`formato-tab-card${tab === f.key ? ' active' : ''}`}
                  onClick={() => handleTabChange(f.key)}
                >
                  <Icon name={f.icon} size={20} className="formato-tab-icon" />
                  <span>
                    <span className="formato-tab-code">{f.code}</span>
                    <span className="formato-tab-sub">{f.label}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {/* ── Banner del documento activo ──────────────────────────────────────── */}
      {(() => {
        const active = FORMATOS_CATALOG.find(f => f.key === tab)
        if (!active) return null
        const meta = CATEGORY_META[active.category]
        return (
          <div className="formato-banner">
            <div className="formato-banner-icon"><Icon name={active.icon} size={22} /></div>
            <div className="formato-banner-body">
              <div className="formato-banner-crumb">{active.code === 'FCMPTPH' ? FORMAT_TYPE_FCMPTPH : active.code} · {meta.desc}</div>
              <h3>{active.label}</h3>
              <p>{active.desc}</p>
            </div>
            <div className="formato-banner-actions">
              <button className={`btn small ${view === 'historico' ? 'primary' : 'outline'}`} onClick={() => setView('historico')}>
                <Icon name="clock" size={14} /> Histórico
              </button>
              <button className={`btn small ${view === 'nuevo' ? 'primary' : 'outline'}`} onClick={() => setView('nuevo')}>
                <Icon name="plus" size={14} /> Nuevo registro
              </button>
            </div>
          </div>
        )
      })()}

      {tab === 'fcmptph' && (<>

      {view === 'historico' && (<>
      {/* ══ HISTORIAL ════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16 }}>Historial — {FORMAT_TYPE_FCMPTPH}</h3>
          {!loadingHist && (
            <span className="muted small">{filteredHistorial.length} formato{filteredHistorial.length !== 1 ? 's' : ''} encontrado{filteredHistorial.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted small" style={{ marginRight: 4 }}>Período:</span>
            {[
              { key: 'month',   label: 'Este mes' },
              { key: 'year',    label: 'Este año' },
              { key: '6months', label: 'Últ. 6 meses' },
              { key: 'all',     label: 'Todos' },
              { key: 'custom',  label: 'Personalizado' },
            ].map(opt => (
              <button key={opt.key} onClick={() => setHistFilter(opt.key)} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid',
                background: histFilter === opt.key ? 'var(--primary)' : '#fff',
                color:      histFilter === opt.key ? '#fff' : '#374151',
                borderColor: histFilter === opt.key ? 'var(--primary)' : '#d1d5db',
                fontWeight: histFilter === opt.key ? 600 : 400,
              }}>{opt.label}</button>
            ))}
            {histFilter === 'custom' && (
              <>
                <DateInput className="input" value={histCustomFrom} onChange={e => setHistCustomFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
                <span className="muted small">—</span>
                <DateInput className="input" value={histCustomTo} onChange={e => setHistCustomTo(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
              </>
            )}
            <div style={{ marginLeft: 'auto' }}>
              <select className="input" value={histModuleFilter} onChange={e => setHistModuleFilter(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', height: 'auto', minWidth: 160 }}>
                <option value="">Todos los módulos</option>
                {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loadingHist ? (
            <div style={{ padding: 16 }}><SkeletonList count={3} lines={1} /></div>
          ) : filteredHistorial.length === 0 ? (
            <EmptyState message="No hay formatos emitidos en este período." />
          ) : (
            <table className="table small" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Módulo</th>
                  <th>Período cubierto</th>
                  <th>Emitido por</th>
                  <th>Fecha emisión</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredHistorial.map(f => (
                  <tr key={f.id} style={f.formato_codigo === docFromUrl ? { background: '#fefce8', outline: '2px solid #facc15' } : {}}>
                    <td><strong style={{ fontFamily: 'monospace', fontSize: 13 }}>{f.formato_codigo}</strong></td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
                        {f.coop_modules?.name ?? '—'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(f.date_from)} — {fmtDate(f.date_to)}</td>
                    <td style={{ fontSize: 12 }}>{f.emitted_by_name ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted)' }}>{fmtDateTime(f.emitted_at)}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn small outline" onClick={() => handleView(f)}>Ver</button>
                      <button className="btn small outline" onClick={() => handleReprint(f)} disabled={reprinting === f.id}>
                        {reprinting === f.id ? '...' : 'Imprimir'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </>)}

      {view === 'nuevo' && (<>
      {/* ══ GENERAR NUEVO FORMATO ════════════════════════════════════════════ */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Generar nuevo formato — {FORMAT_TYPE_FCMPTPH}</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Selecciona el módulo y período para ver los lotes de producción del campo y generar el documento.
          </p>
        </div>

        <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <span className="muted small" style={{ marginRight: 4 }}>Período:</span>
            {[
              { key: 'month',   label: 'Este mes' },
              { key: 'year',    label: 'Este año' },
              { key: '6months', label: 'Últ. 6 meses' },
              { key: 'custom',  label: 'Personalizado' },
            ].map(opt => (
              <button key={opt.key} onClick={() => handleNewPeriod(opt.key)} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid',
                background:   newPeriodFilter === opt.key ? 'var(--primary)' : '#fff',
                color:        newPeriodFilter === opt.key ? '#fff'    : '#374151',
                borderColor:  newPeriodFilter === opt.key ? 'var(--primary)' : '#d1d5db',
                fontWeight:   newPeriodFilter === opt.key ? 600       : 400,
              }}>{opt.label}</button>
            ))}
            {newPeriodFilter === 'custom' && (
              <>
                <DateInput className="input" value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setBatches(null); setSavedCode(null) }}
                  style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
                <span className="muted small">—</span>
                <DateInput className="input" value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setBatches(null); setSavedCode(null) }}
                  style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="small muted">Módulo</label>
              <select className="input" value={moduleId}
                onChange={e => { setModuleId(e.target.value); setBatches(null); setSavedCode(null) }}
                style={{ display: 'block', minWidth: 200 }}>
                <option value="">Seleccionar módulo...</option>
                {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button className="btn primary" onClick={handlePreview} disabled={loading}>
              {loading ? 'Cargando...' : 'Ver producciones'}
            </button>
          </div>
          {error && <p style={{ color: '#dc2626', marginTop: 8, marginBottom: 0 }}>{error}</p>}
        </div>
      </div>

      {batches !== null && (<>
        {/* ── Firmantes ──────────────────────────────────────────────────────── */}
        {!savedCode && (
          <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Firmantes del documento</div>
                <div className="muted small">Detectados automáticamente. Edita, elimina o agrega antes de emitir.</div>
              </div>
              <button className="btn small outline" onClick={addFirmante} style={{ whiteSpace: 'nowrap' }}>
                + Agregar firmante
              </button>
            </div>
            {firmantes.length === 0 && (
              <p className="muted small" style={{ margin: 0 }}>
                No se detectaron responsables. Agrega manualmente si es necesario.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {firmantes.map((f, idx) => (
                <div key={idx} style={{
                  display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 8,
                  background: f.fuente === 'auto' ? '#f0fdf4' : '#f8fafc',
                  border: `1px solid ${f.fuente === 'auto' ? '#86efac' : '#e2e8f0'}`,
                }}>
                  <span className="muted small" style={{ minWidth: 20 }}>#{idx + 1}</span>
                  <span style={{
                    fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600, minWidth: 48, textAlign: 'center',
                    background: f.fuente === 'auto' ? '#dcfce7' : '#e0e7ff',
                    color: f.fuente === 'auto' ? '#15803d' : '#4338ca',
                  }}>{f.fuente === 'auto' ? 'auto' : 'manual'}</span>
                  <input className="input" style={{ flex: 2, fontSize: 12, padding: '4px 8px', height: 'auto' }}
                    value={f.nombre} onChange={e => updateFirmante(idx, 'nombre', e.target.value)}
                    placeholder="Nombre completo" />
                  <input className="input" style={{ flex: 2, fontSize: 12, padding: '4px 8px', height: 'auto' }}
                    value={f.cargo} onChange={e => updateFirmante(idx, 'cargo', e.target.value)}
                    placeholder="Cargo" />
                  <button onClick={() => removeFirmante(idx)} style={{
                    padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center',
                  }}><Icon name="x" size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Botones de acción ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          {!savedCode ? (
            <button className="btn primary" onClick={handleEmit} disabled={emitting || !batches.length}>
              {emitting ? 'Emitiendo...' : 'Emitir y guardar formato'}
            </button>
          ) : (
            <span className="tag dot ok" style={{ padding: '6px 12px', fontSize: 14 }}>
              Emitido: <strong style={{ fontFamily: 'monospace' }}>{savedCode}</strong>
            </span>
          )}
          {batches.length > 0 && (
            <button className="btn outline" onClick={handleExportPdf} disabled={pdfGenerating}>{pdfGenerating ? 'Generando...' : 'Exportar PDF'}</button>
          )}
          {batches.length === 0 && (
            <span className="muted">No hay producciones registradas en este módulo para el período seleccionado.</span>
          )}
        </div>
        {pdfError && <p style={{ color: '#dc2626', marginBottom: 12 }}>{pdfError}</p>}

        {/* ── Tabla de selección ──────────────────────────────────────────────── */}
        {batches.length > 0 && (() => {
          const alreadyEmittedCount = batches.filter(b => batchDocMap[b.id]).length
          const visibleBatches = savedCode ? batches.filter(b => selectedBatchIds.has(b.id)) : batches
          const sel = visibleBatches.filter(b => selectedBatchIds.has(b.id))
          const selectedTotals = {
            cane_kg:       sel.reduce((s, b) => s + Number(b.cane_kg ?? 0), 0),
            juice_liters:  sel.reduce((s, b) => s + Number(b.juice_liters ?? 0), 0),
            panela_kg:     sel.reduce((s, b) => s + Number(b.panela_kg ?? 0), 0),
            confitillo_kg: sel.reduce((s, b) => s + Number(b.confitillo_kg ?? 0), 0),
          }
          return (
            <div className="formato-print">
              {!savedCode && alreadyEmittedCount > 0 && (
                <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ color: '#92400e', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Icon name="alertTriangle" size={14} />
                    {alreadyEmittedCount} lote{alreadyEmittedCount !== 1 ? 's' : ''} ya emitido{alreadyEmittedCount !== 1 ? 's' : ''}
                  </strong>
                  <span style={{ color: '#78350f' }}>Están desmarcados por defecto. Puedes incluirlos si es necesario.</span>
                </div>
              )}

              <div className="formato-header">
                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{COOPERATIVE?.name}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, textTransform: 'uppercase' }}>{FORMAT_TITLE_FCMPTPH}</div>
                </div>
                <div className="formato-meta">
                  <div><span className="meta-label">Código:</span> <strong style={{ fontFamily: 'monospace' }}>{savedCode ?? '(pendiente de emisión)'}</strong></div>
                  <div><span className="meta-label">Fecha de emisión:</span> {savedEmittedAt ? new Date(savedEmittedAt).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '___/___/______'}</div>
                  <div><span className="meta-label">Módulo:</span> {moduleName}</div>
                  <div><span className="meta-label">Período:</span> {fmtDate(dateFrom)} — {fmtDate(dateTo)}</div>
                  {!COOPERATIVE?.features?.certificacion && <div><span className="meta-label">Fecha de aprobación:</span> ___/___/______</div>}
                </div>
              </div>

              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table className="formato-table">
                  <thead>
                    <tr>
                      {!savedCode && (
                        <th rowSpan={2} style={{ width: 32, textAlign: 'center', cursor: 'pointer' }} onClick={toggleAllNew} title="Marcar/desmarcar todos los nuevos">☑</th>
                      )}
                      <th rowSpan={2}>Lote</th>
                      <th rowSpan={2}>Productor</th>
                      <th rowSpan={2}>Parcela</th>
                      <th rowSpan={2}>F. Corte</th>
                      <th colSpan={allCerts.length || 1} style={{ textAlign: 'center' }}>Calidad de la caña</th>
                      <th rowSpan={2}>Caña (kg)</th>
                      <th rowSpan={2}>F. Proceso</th>
                      <th rowSpan={2}>Jugo (L)</th>
                      <th rowSpan={2}>Panela (kg)</th>
                      <th rowSpan={2}>Confitillo (kg)</th>
                      <th rowSpan={2}>Rendim. %</th>
                      <th rowSpan={2}>pH</th>
                      <th rowSpan={2}>Temp.</th>
                      <th rowSpan={2}>Observaciones</th>
                    </tr>
                    <tr>
                      {allCerts.length > 0
                        ? allCerts.map(c => <th key={c.id} style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{c.name}</th>)
                        : <th>—</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBatches.map(b => {
                      const certIds = new Set((b.production_batch_certs ?? []).map(pc => pc.batch_certs?.id).filter(Boolean))
                      const plotText = b.plots ? `${b.plots.name} (${b.plots.code})` : '—'
                      const producerName = b.producers ? `${b.producers.first_name} ${b.producers.last_name}` : '—'
                      const existingDoc = batchDocMap[b.id]
                      const isSelected = selectedBatchIds.has(b.id)
                      const rowStyle = !savedCode && existingDoc && !isSelected ? { opacity: 0.5, background: '#fafafa' } : {}
                      return (
                        <tr key={b.id} style={rowStyle}>
                          {!savedCode && (
                            <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                              <input type="checkbox" checked={isSelected} onChange={() => toggleBatch(b.id)}
                                title={existingDoc ? `Ya incluido en ${existingDoc}` : 'Incluir en este documento'} />
                              {existingDoc && (
                                <div style={{ fontSize: 9, color: '#b45309', marginTop: 2, whiteSpace: 'nowrap' }}>{existingDoc}</div>
                              )}
                            </td>
                          )}
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{b.batch_code}</td>
                          <td>{producerName}</td>
                          <td style={{ fontSize: 11 }}>{plotText}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.harvest_date)}</td>
                          {allCerts.length > 0
                            ? allCerts.map(c => <td key={c.id} style={{ textAlign: 'center' }}>{certIds.has(c.id) ? <Icon name="check" size={12} style={{ display: 'inline-block' }} /> : ''}</td>)
                            : <td />}
                          <td style={{ textAlign: 'right' }}>{fmtNum(b.cane_kg)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.process_date)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(b.juice_liters)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(b.panela_kg)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(b.confitillo_kg)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(b.efficiency_percentage)}</td>
                          <td style={{ textAlign: 'center', fontSize: 11, color: b.ph_controls.length > 0 ? '#15803d' : '#9ca3af' }}>
                            {b.ph_controls.length > 0 ? `${b.ph_controls.length} reg.` : '—'}
                          </td>
                          <td style={{ textAlign: 'center', fontSize: 11, color: b.temperatures.length > 0 ? '#c2410c' : '#9ca3af' }}>
                            {b.temperatures.length > 0 ? `${b.temperatures.length} lect.` : '—'}
                          </td>
                          <td style={{ fontSize: 11, minWidth: 140 }}>
                            {savedCode ? b.observations ?? '' : (
                              <textarea rows={2}
                                style={{ width: '100%', fontSize: 11, border: '1px solid #ccc', borderRadius: 3, padding: '2px 4px', resize: 'vertical', boxSizing: 'border-box', opacity: savingObs[b.id] ? 0.5 : 1 }}
                                value={obsEdits[b.id] !== undefined ? obsEdits[b.id] : (b.observations ?? '')}
                                onChange={e => setObsEdits(s => ({ ...s, [b.id]: e.target.value }))}
                                onBlur={e => handleObsBlur(b.id, e.target.value)}
                                placeholder="Observaciones..." />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700 }}>
                      <td colSpan={(!savedCode ? 1 : 0) + 4 + (allCerts.length || 1) + 1} style={{ textAlign: 'right' }}>
                        TOTAL {!savedCode && selectedBatchIds.size > 0 && `(${selectedBatchIds.size} lote${selectedBatchIds.size !== 1 ? 's' : ''} seleccionado${selectedBatchIds.size !== 1 ? 's' : ''})`}
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(selectedTotals.cane_kg)}</td>
                      <td />
                      <td style={{ textAlign: 'right' }}>{fmtNum(selectedTotals.juice_liters)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(selectedTotals.panela_kg)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(selectedTotals.confitillo_kg)}</td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="formato-firmas">
                {firmantes.length > 0 ? firmantes.map((f, i) => (
                  <div key={i} className="firma-bloque">
                    <div className="firma-linea" />
                    <div className="firma-nombre">{f.nombre || '_______________________'}</div>
                    <div className="firma-cargo">{f.cargo || 'Responsable'}</div>
                  </div>
                )) : (
                  <div className="firma-bloque">
                    <div className="firma-linea" />
                    <div className="firma-nombre">_______________________</div>
                    <div className="firma-cargo">Responsable</div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}
      </>)}
      </>)}

      {/* ══ MODAL VER FORMATO ════════════════════════════════════════════════ */}
      {viewing && (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', overflowY: 'auto', padding: 0 }}>
          <div style={{ width: '100%', maxWidth: 1000, margin: '0 auto', background: '#fff', minHeight: '100vh', padding: '28px 36px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div className="muted small" style={{ marginBottom: 2 }}>{FORMAT_TYPE_FCMPTPH}</div>
                <h2 style={{ margin: 0, fontFamily: 'monospace', fontSize: 20 }}>{viewing.formato.formato_codigo}</h2>
                <div className="muted small">
                  Módulo: {viewing.formato.coop_modules?.name ?? '—'} · Período: {fmtDate(viewing.formato.date_from)} — {fmtDate(viewing.formato.date_to)} · Emitido: {fmtDateTime(viewing.formato.emitted_at)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn small outline" onClick={() => handleReprint(viewing.formato)} disabled={reprinting === viewing.formato.id}>
                  {reprinting === viewing.formato.id ? '...' : 'Imprimir'}
                </button>
                <button className="btn small" onClick={() => setViewing(null)}>Cerrar</button>
              </div>
            </div>

            {!viewing.rows ? (
              <SkeletonList count={3} lines={1} />
            ) : viewing.rows.length === 0 ? (
              <EmptyState message="No se encontraron lotes para este formato." />
            ) : (
              <div className="formato-print">
                <div className="formato-header">
                  <div style={{ textAlign: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{COOPERATIVE?.name}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, textTransform: 'uppercase' }}>{FORMAT_TITLE_FCMPTPH}</div>
                  </div>
                  <div className="formato-meta">
                    <div><span className="meta-label">Código:</span> <strong style={{ fontFamily: 'monospace' }}>{viewing.formato.formato_codigo}</strong></div>
                    <div><span className="meta-label">Fecha de emisión:</span> {fmtDate(viewing.formato.emitted_at)}</div>
                    <div><span className="meta-label">Módulo:</span> {viewing.formato.coop_modules?.name ?? '—'}</div>
                    <div><span className="meta-label">Período:</span> {fmtDate(viewing.formato.date_from)} — {fmtDate(viewing.formato.date_to)}</div>
                    {!COOPERATIVE?.features?.certificacion && <div><span className="meta-label">Fecha de aprobación:</span> ___/___/______</div>}
                  </div>
                </div>

                {viewing.rows.map((b, i) => {
                  const certIds = new Set((b.production_batch_certs ?? []).map(pc => pc.batch_certs?.id).filter(Boolean))
                  const plotText = b.plots ? `${b.plots.name} (${b.plots.code})` : '—'
                  const producerName = b.producers ? `${b.producers.first_name} ${b.producers.last_name}` : '—'
                  return (
                    <div key={b.id} style={{ marginTop: 20 }}>
                      {i > 0 && <hr style={{ border: 'none', borderTop: '2px dashed #ccc', margin: '16px 0' }} />}
                      <div style={{ background: '#f0f0f0', borderLeft: '4px solid #444', padding: '6px 10px', marginBottom: 8, fontSize: 12 }}>
                        <strong>{b.batch_code}</strong> · {producerName} · F. Proceso: {fmtDate(b.process_date)}
                      </div>

                      <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#444', margin: '8px 0 3px' }}>Datos de producción</div>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="formato-table">
                          <thead>
                            <tr>
                              <th rowSpan={2}>Productor</th>
                              <th rowSpan={2}>Condición</th>
                              <th rowSpan={2}>Parcela</th>
                              <th rowSpan={2}>F. Corte</th>
                              <th colSpan={allCerts.length || 1} style={{ textAlign: 'center' }}>Calidad de la caña</th>
                              <th rowSpan={2}>Caña (kg)</th>
                              <th rowSpan={2}>F. Proceso</th>
                              <th rowSpan={2}>Jugo (L)</th>
                              <th rowSpan={2}>Panela (kg)</th>
                              <th rowSpan={2}>Confitillo (kg)</th>
                              <th rowSpan={2}>Rendim. %</th>
                              <th rowSpan={2}>Observaciones</th>
                            </tr>
                            <tr>
                              {allCerts.length > 0 ? allCerts.map(c => <th key={c.id} style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{c.name}</th>) : <th>—</th>}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>{producerName}</td>
                              <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Icon name="check" size={11} />{b.producers?.is_member ? 'SOCIO' : 'NO SOCIO'}
                                </span>
                              </td>
                              <td style={{ fontSize: 11 }}>{plotText}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.harvest_date)}</td>
                              {allCerts.length > 0 ? allCerts.map(c => <td key={c.id} style={{ textAlign: 'center' }}>{certIds.has(c.id) ? <Icon name="check" size={12} style={{ display: 'inline-block' }} /> : ''}</td>) : <td />}
                              <td style={{ textAlign: 'right' }}>{fmtNum(b.cane_kg)}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.process_date)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtNum(b.juice_liters)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtNum(b.panela_kg)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtNum(b.confitillo_kg)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtNum(b.efficiency_percentage)}</td>
                              <td style={{ fontSize: 11 }}>{b.observations ?? ''}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#444', margin: '10px 0 3px' }}>Control de pH</div>
                      {b.ph_controls.length === 0 ? (
                        <p className="muted small" style={{ marginBottom: 8 }}>Sin registros de pH.</p>
                      ) : (
                        <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                          <table className="formato-table">
                            <thead>
                              <tr>
                                <th>#</th><th>Fecha</th><th>Regulador</th><th>Cantidad</th><th>Unidad</th>
                                <th>pH sin regular</th><th>pH regulado</th><th>Brix</th><th>Acción correctiva</th>
                              </tr>
                            </thead>
                            <tbody>
                              {b.ph_controls.map((p, pi) => (
                                <tr key={pi}>
                                  <td style={{ textAlign: 'center' }}>{pi + 1}</td>
                                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.record_date?.split?.('T')?.[0] ?? p.record_date)}</td>
                                  <td>{p.regulator_type ?? '—'}</td>
                                  <td style={{ textAlign: 'right' }}>{p.regulator_quantity_value ?? '—'}</td>
                                  <td>{p.regulator_quantity_unit ?? '—'}</td>
                                  <td style={{ textAlign: 'center' }}>{fmtNum(p.ph_initial)}</td>
                                  <td style={{ textAlign: 'center' }}>{fmtNum(p.ph_final)}</td>
                                  <td style={{ textAlign: 'center' }}>{p.brix != null ? `${fmtNum(p.brix)}°Bx` : '—'}</td>
                                  <td style={{ fontSize: 11 }}>{p.corrective_action ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#444', margin: '10px 0 3px' }}>Control de temperatura</div>
                      {b.temperatures.length === 0 ? (
                        <p className="muted small">Sin registros de temperatura.</p>
                      ) : (
                        <table className="formato-table" style={{ maxWidth: 280 }}>
                          <thead><tr><th>Batch #</th><th>Temperatura (°C)</th></tr></thead>
                          <tbody>
                            {b.temperatures.map((t, ti) => (
                              <tr key={ti}>
                                <td style={{ textAlign: 'center' }}>{t.sequence_number}</td>
                                <td style={{ textAlign: 'center' }}>{fmtNum(t.temperature)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}

                <div className="formato-firmas">
                  {viewing.firmantes.length > 0 ? viewing.firmantes.map((f, i) => (
                    <div key={i} className="firma-bloque">
                      <div className="firma-linea" />
                      <div className="firma-nombre">{f.nombre}</div>
                      <div className="firma-cargo">{f.cargo}</div>
                    </div>
                  )) : (
                    <div className="firma-bloque">
                      <div className="firma-linea" />
                      <div className="firma-nombre">_______________________</div>
                      <div className="firma-cargo">Responsable</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </>)}

      {tab === 'fet'  && <FormatosEstibaSection view={view} />}
      {tab === 'fcpo'  && <FormatoPersonalSection view={view} />}
      {tab === 'fqd'   && <FormatoDevolucionSection view={view} />}
      {tab === 'fcclr' && <FormatosCloroSection view={view} />}
      {tab === 'fiae'  && <FormatosInspeccionSection view={view} />}
      {tab === 'fcp'   && <FormatosPlagasSection view={view} />}
      {tab === 'fsea'  && <FormatosSaludSection view={view} />}
      {tab === 'fmeh'  && <FormatosMantenimientoSection view={view} />}
      {tab === 'fldh'  && <FormatosLimpiezaSection view={view} />}

      <style>{`
        .formato-print { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: white; }
        .formato-header { border: 1px solid #333; padding: 10px 14px; margin-bottom: 8px; }
        .formato-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-top: 8px; font-size: 12px; }
        .meta-label { font-weight: 600; }
        .formato-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .formato-table th, .formato-table td { border: 1px solid #555; padding: 3px 5px; vertical-align: middle; }
        .formato-table th { background: #e8e8e8; font-weight: 700; font-size: 10px; text-align: center; }
        .formato-table tfoot td { background: #f0f0f0; }
        .formato-firmas { display: flex; gap: 40px; margin-top: 40px; flex-wrap: wrap; }
        .firma-bloque { flex: 1; min-width: 160px; text-align: center; }
        .firma-linea { border-top: 1px solid #333; margin-bottom: 4px; }
        .firma-nombre { font-weight: 600; font-size: 11px; }
        .firma-cargo { font-size: 10px; color: #555; }
      `}</style>
    </div>
  )
}
