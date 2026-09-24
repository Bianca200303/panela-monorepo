import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'
import { FORMAT_TITLE_FCPO, FORMAT_TYPE_FCPO, buildPrintHTMLFcpo } from '../lib/formatos/fcpo'
import { getCoopCode, openPrintWindow, fmtDate, fmtDateTime } from '../lib/formatos/shared'
import { downloadPdfDocument } from '../lib/pdfDownload'
import { usePeriodPresets } from '../hooks/usePeriodPresets'
import { useFirmantes } from '../hooks/useFirmantes'
import { useHistorialFilter } from '../hooks/useHistorialFilter'
import { resolveFirmantesFromUserIds } from '../lib/firmanteHelpers'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Icon from '../components/Icon'
import DateInput from '../components/DateInput'

const COLOR = 'var(--primary)'
const BG    = 'rgba(15,76,92,0.08)'

export default function FormatoPersonalSection({ view }) {
  const COOPERATIVE = useCooperative()
  const { webUser } = useAuthStore()
  const [searchParams] = useSearchParams()
  const docFromUrl = searchParams.get('doc') ?? ''

  const [historial, setHistorial]     = useState([])
  const [loadingHist, setLoadingHist] = useState(true)
  const {
    histFilter, setHistFilter, histCustomFrom, setHistCustomFrom, histCustomTo, setHistCustomTo, filteredHistorial,
  } = useHistorialFilter(historial, docFromUrl)

  const [modules, setModules]   = useState([])
  const [moduleId, setModuleId] = useState('')
  const [batches, setBatches]   = useState(null)
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [fcpoMap, setFcpoMap]   = useState({})
  const [error, setError]       = useState('')
  const period = usePeriodPresets(() => { setBatches(null); setSelected(null); setSavedCode(null); setError('') })

  const [selected, setSelected]           = useState(null)
  const [controls, setControls]           = useState([])
  const [loadingControls, setLoadingControls] = useState(false)
  const { firmantes, setFirmantes, addFirmante, removeFirmante, updateFirmante } = useFirmantes()
  const [savedCode, setSavedCode]         = useState(null)
  const [savedEmittedAt, setSavedEmittedAt] = useState(null)
  const [emitting, setEmitting]           = useState(false)
  const [emitError, setEmitError]         = useState('')

  const [viewing, setViewing]     = useState(null)
  const [reprinting, setReprinting] = useState(null)

  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [pdfError, setPdfError]           = useState('')

  useEffect(() => {
    loadHistorial()
    loadModules()
  }, [])

  async function loadHistorial() {
    setLoadingHist(true)
    const { data } = await supabase
      .from('formatos_control_personal')
      .select(`
        id, formato_codigo, emitted_at, emitted_by_name, status, production_batch_id, firmantes,
        production_batches ( batch_code, process_date,
          producers ( first_name, last_name, coop_modules ( name ) )
        )
      `)
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('status', 'emitted')
      .order('emitted_at', { ascending: false })
    setHistorial(data ?? [])
    setLoadingHist(false)
  }

  async function loadModules() {
    const { data } = await supabase
      .from('coop_modules').select('id, name')
      .eq('cooperative_id', COOPERATIVE.id).order('name')
    setModules(data ?? [])
  }

  async function handleSearch() {
    if (!moduleId) { setError('Selecciona un módulo.'); return }
    if (!period.dateFrom || !period.dateTo) { setError('Selecciona un período.'); return }
    if (period.dateFrom > period.dateTo) { setError('La fecha inicial no puede ser mayor a la final.'); return }
    setError(''); setLoadingBatches(true); setBatches(null); setSelected(null); setSavedCode(null)
    try {
      const { data: prods } = await supabase
        .from('producers').select('id')
        .eq('coop_module_id', moduleId).eq('cooperative_id', COOPERATIVE.id)
      if (!prods?.length) { setBatches([]); return }

      const { data: rows } = await supabase
        .from('production_batches')
        .select('id, batch_code, process_date, producers(first_name, last_name)')
        .eq('cooperative_id', COOPERATIVE.id)
        .in('producer_id', prods.map(p => p.id))
        .gte('process_date', period.dateFrom).lte('process_date', period.dateTo)
        .order('process_date', { ascending: false })
      if (!rows?.length) { setBatches([]); return }

      const batchIds = rows.map(r => r.id)

      // Lotes que tienen worker_controls
      const { data: wcs } = await supabase
        .from('worker_controls').select('production_batch_id')
        .in('production_batch_id', batchIds).eq('cooperative_id', COOPERATIVE.id)
      const batchesWithControls = new Set((wcs ?? []).map(w => w.production_batch_id))

      // FCPO ya emitidos
      const { data: existing } = await supabase
        .from('formatos_control_personal')
        .select('production_batch_id, formato_codigo, status')
        .in('production_batch_id', batchIds).eq('cooperative_id', COOPERATIVE.id)
      const existingMap = {}
      ;(existing ?? []).forEach(e => { existingMap[e.production_batch_id] = e })
      setFcpoMap(existingMap)

      setBatches(rows.filter(b => batchesWithControls.has(b.id)))
    } catch (e) { setError(e.message ?? 'Error al buscar') }
    finally { setLoadingBatches(false) }
  }

  async function selectBatch(batch) {
    setSelected(batch)
    setSavedCode(fcpoMap[batch.id]?.formato_codigo ?? null)
    setSavedEmittedAt(null)
    setEmitError('')
    setLoadingControls(true)
    try {
      const { data: wcs } = await supabase
        .from('worker_controls')
        .select('id, work_area, observations, created_at, created_by, worker_control_items(worker_name, uniform_complete, no_makeup, nails_short_clean, nails_no_polish, hands_clean, no_jewelry, hair_covered, no_beard, no_wounds)')
        .eq('production_batch_id', batch.id).eq('cooperative_id', COOPERATIVE.id)
        .order('work_area')
      setControls(wcs ?? [])

      if (!fcpoMap[batch.id]?.formato_codigo) {
        setFirmantes(await resolveFirmantesFromUserIds(COOPERATIVE, (wcs ?? []).map(w => w.created_by)))
      }
    } finally { setLoadingControls(false) }
  }

  async function handleEmit() {
    if (!selected) return
    setEmitting(true); setEmitError('')
    try {
      const { data, error: e } = await supabase.rpc('emit_formato_control_personal', {
        p_coop_code:       getCoopCode(COOPERATIVE),
        p_cooperative_id:  COOPERATIVE.id,
        p_batch_id:        selected.id,
        p_emitted_by:      webUser?.id ?? null,
        p_emitted_by_name: webUser ? `${webUser.first_name} ${webUser.last_name}` : null,
        p_firmantes:       firmantes,
      })
      if (e) throw e
      setSavedCode(data.formato_codigo)
      setSavedEmittedAt(new Date().toISOString())
      setFcpoMap(prev => ({ ...prev, [selected.id]: { formato_codigo: data.formato_codigo, status: 'emitted' } }))
      setBatches(prev => prev ? prev.map(b => b.id === selected.id ? { ...b, _emitido: data.formato_codigo } : b) : prev)
      await loadHistorial()
    } catch (e) { setEmitError(e.message ?? 'Error al emitir') }
    finally { setEmitting(false) }
  }

  async function handleExportPdf(batch, prod, wcs, fms, code, emAt) {
    setPdfGenerating(true); setPdfError('')
    try {
      const areas = wcs.map(w => ({ work_area: w.work_area, observations: w.observations, items: w.worker_control_items ?? [] }))
      const html  = buildPrintHTMLFcpo(COOPERATIVE, code ?? '(borrador)', emAt, batch, prod, areas, fms)
      await downloadPdfDocument(html)
    } catch (e) { setPdfError(e.message ?? 'Error al generar el PDF') }
    finally { setPdfGenerating(false) }
  }

  async function handleView(f) {
    setViewing({ formato: f, data: null })
    const pbId = f.production_batch_id
    const [batchRes, wcsRes] = await Promise.all([
      supabase.from('production_batches')
        .select('id, batch_code, process_date, producers(first_name, last_name, coop_modules(name))')
        .eq('id', pbId).single(),
      supabase.from('worker_controls')
        .select('id, work_area, observations, worker_control_items(worker_name, uniform_complete, no_makeup, nails_short_clean, nails_no_polish, hands_clean, no_jewelry, hair_covered, no_beard, no_wounds)')
        .eq('production_batch_id', pbId)
        .eq('cooperative_id', COOPERATIVE.id).order('work_area'),
    ])
    const fmtRes = await supabase.from('formatos_control_personal')
      .select('firmantes').eq('id', f.id).single()
    setViewing({ formato: f, batch: batchRes.data, controls: wcsRes.data ?? [], firmantes: fmtRes.data?.firmantes ?? [] })
  }

  async function handleReprint(f) {
    setReprinting(f.id)
    const pbId = f.production_batch_id
    try {
      const [batchRes, wcsRes, fmtRes] = await Promise.all([
        supabase.from('production_batches')
          .select('id, batch_code, process_date, producers(first_name, last_name, coop_modules(name))')
          .eq('id', pbId).single(),
        supabase.from('worker_controls')
          .select('id, work_area, observations, worker_control_items(worker_name, uniform_complete, no_makeup, nails_short_clean, nails_no_polish, hands_clean, no_jewelry, hair_covered, no_beard, no_wounds)')
          .eq('production_batch_id', pbId)
          .eq('cooperative_id', COOPERATIVE.id).order('work_area'),
        supabase.from('formatos_control_personal').select('firmantes').eq('id', f.id).single(),
      ])
      const batch   = batchRes.data
      const wcs     = wcsRes.data ?? []
      const fms     = fmtRes.data?.firmantes ?? []
      const producer = batch?.producers
      const areas   = wcs.map(w => ({ work_area: w.work_area, observations: w.observations, items: w.worker_control_items ?? [] }))
      const html    = buildPrintHTMLFcpo(COOPERATIVE, f.formato_codigo, f.emitted_at, batch, producer, areas, fms)
      openPrintWindow(html, f.formato_codigo)
    } finally { setReprinting(null) }
  }

  // Para el preview del formato seleccionado
  const previewAreas    = controls.map(w => ({ work_area: w.work_area, observations: w.observations, items: w.worker_control_items ?? [] }))
  const previewProducer = selected?.producers
  const previewHTML     = selected ? buildPrintHTMLFcpo(COOPERATIVE, savedCode ?? null, savedEmittedAt, selected, previewProducer, previewAreas, firmantes) : null

  return (
    <div>
      {/* ══ TÍTULO ════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>Formatos de Personal</h2>
          <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: BG, color: COLOR, border: `1px solid ${COLOR}` }}>{FORMAT_TYPE_FCPO}</span>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Documentos de <strong>{FORMAT_TITLE_FCPO}</strong> — uno por lote de campo.
        </p>
      </div>

      {view === 'historico' && (<>
      {/* ══ HISTORIAL ══════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16 }}>Historial — {FORMAT_TYPE_FCPO}</h3>
          {!loadingHist && <span className="muted small">{filteredHistorial.length} formato{filteredHistorial.length !== 1 ? 's' : ''}</span>}
        </div>

        <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted small" style={{ marginRight: 4 }}>Período:</span>
            {[{ key: 'month', label: 'Este mes' }, { key: 'year', label: 'Este año' }, { key: '6months', label: 'Últ. 6 meses' }, { key: 'all', label: 'Todos' }, { key: 'custom', label: 'Personalizado' }].map(opt => (
              <button key={opt.key} onClick={() => setHistFilter(opt.key)} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid', background: histFilter === opt.key ? COLOR : '#fff', color: histFilter === opt.key ? '#fff' : '#374151', borderColor: histFilter === opt.key ? COLOR : '#d1d5db', fontWeight: histFilter === opt.key ? 600 : 400 }}>{opt.label}</button>
            ))}
            {histFilter === 'custom' && (<>
              <DateInput className="input" value={histCustomFrom} onChange={e => setHistCustomFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
              <span className="muted small">—</span>
              <DateInput className="input" value={histCustomTo} onChange={e => setHistCustomTo(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
            </>)}
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loadingHist ? <div style={{ padding: 16 }}><SkeletonList count={3} lines={1} /></div>
          : filteredHistorial.length === 0 ? <EmptyState message="No hay formatos en este período." />
          : (
            <table className="table small" style={{ margin: 0 }}>
              <thead>
                <tr><th>Código</th><th>Lote de campo</th><th>Productor</th><th>Módulo</th><th>F. proceso</th><th>Registrado por</th><th>Emitido por</th><th>Fecha emisión</th><th></th></tr>
              </thead>
              <tbody>
                {filteredHistorial.map(f => {
                  const pb  = f.production_batches
                  const prd = pb?.producers
                  return (
                    <tr key={f.id} style={f.formato_codigo === docFromUrl ? { background: '#fefce8', outline: '2px solid #facc15' } : {}}>
                      <td><strong style={{ fontFamily: 'monospace', fontSize: 13 }}>{f.formato_codigo}</strong></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{pb?.batch_code ?? '—'}</td>
                      <td style={{ fontSize: 12 }}>{prd ? `${prd.first_name} ${prd.last_name}` : '—'}</td>
                      <td style={{ fontSize: 12 }}>{prd?.coop_modules?.name ?? '—'}</td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(pb?.process_date)}</td>
                      <td style={{ fontSize: 12 }}>{(f.firmantes ?? []).map(fi => fi.nombre).join(', ') || '—'}</td>
                      <td style={{ fontSize: 12 }}>{f.emitted_by_name ?? '—'}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted)' }}>{fmtDateTime(f.emitted_at)}</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button className="btn small outline" onClick={() => handleView(f)}>Ver</button>
                        <button className="btn small outline" onClick={() => handleReprint(f)} disabled={reprinting === f.id}>{reprinting === f.id ? '...' : 'Imprimir'}</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </>)}

      {view === 'nuevo' && (<>
      {/* ══ GENERAR NUEVO ══════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Generar nuevo formato — {FORMAT_TYPE_FCPO}</h3>
          <p className="muted small" style={{ margin: 0 }}>Busca los lotes con controles de personal registrados en el período.</p>
        </div>

        <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <span className="muted small" style={{ marginRight: 4 }}>Período:</span>
            {[{ key: 'month', label: 'Este mes' }, { key: 'year', label: 'Este año' }, { key: '6months', label: 'Últ. 6 meses' }, { key: 'custom', label: 'Personalizado' }].map(opt => (
              <button key={opt.key} onClick={() => period.selectPreset(opt.key)} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid', background: period.preset === opt.key ? COLOR : '#fff', color: period.preset === opt.key ? '#fff' : '#374151', borderColor: period.preset === opt.key ? COLOR : '#d1d5db', fontWeight: period.preset === opt.key ? 600 : 400 }}>{opt.label}</button>
            ))}
            {period.preset === 'custom' && (<>
              <DateInput className="input" value={period.dateFrom} onChange={e => { period.setDateFrom(e.target.value); setBatches(null) }} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
              <span className="muted small">—</span>
              <DateInput className="input" value={period.dateTo} onChange={e => { period.setDateTo(e.target.value); setBatches(null) }} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
            </>)}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="small muted">Módulo</label>
              <select className="input" value={moduleId} onChange={e => { setModuleId(e.target.value); setBatches(null) }} style={{ display: 'block', minWidth: 200 }}>
                <option value="">Seleccionar módulo...</option>
                {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button className="btn primary" onClick={handleSearch} disabled={loadingBatches}>{loadingBatches ? 'Buscando...' : 'Buscar lotes'}</button>
            {period.dateFrom && period.dateTo && <span className="muted small">{period.dateFrom} — {period.dateTo}</span>}
          </div>
          {error && <p style={{ color: '#dc2626', marginTop: 8, marginBottom: 0 }}>{error}</p>}
        </div>
      </div>

      {/* ── Lista de lotes encontrados ──────────────────────────────────── */}
      {batches !== null && (
        batches.length === 0
          ? <EmptyState message="No hay lotes con control de personal en este período y módulo." />
          : (
            <div style={{ marginBottom: 16 }}>
              <div className="muted small" style={{ marginBottom: 8 }}>{batches.length} lote{batches.length !== 1 ? 's' : ''} encontrado{batches.length !== 1 ? 's' : ''} — selecciona para generar el documento</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {batches.map(b => {
                  const emitido = !!fcpoMap[b.id]?.formato_codigo
                  const isSel   = selected?.id === b.id
                  return (
                    <div key={b.id} onClick={() => selectBatch(b)} style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${isSel ? COLOR : emitido ? '#86efac' : '#e2e8f0'}`, background: isSel ? BG : emitido ? '#f0fdf4' : '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong style={{ fontSize: 13, fontFamily: 'monospace' }}>{b.batch_code}</strong>
                        <span className="muted small" style={{ marginLeft: 10 }}>Proceso: {fmtDate(b.process_date)}</span>
                        {b.producers && <span className="muted small" style={{ marginLeft: 10 }}>{b.producers.first_name} {b.producers.last_name}</span>}
                      </div>
                      {emitido
                        ? <span style={{ fontSize: 11, padding: '2px 8px', background: '#dcfce7', color: '#15803d', borderRadius: 20, border: '1px solid #86efac', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={11} />{fcpoMap[b.id].formato_codigo}</span>
                        : isSel ? <span style={{ fontSize: 11, color: COLOR, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Seleccionado <Icon name="chevronDown" size={11} /></span>
                        : <span className="muted small">Seleccionar</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
      )}

      {/* ── Preview + emisión ──────────────────────────────────────────── */}
      {selected && (
        <div style={{ marginTop: 8 }}>
          {loadingControls ? <p className="muted">Cargando controles...</p> : (<>

            {/* Firmantes */}
            {!savedCode && (
              <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Firmantes del documento</div>
                    <div className="muted small">Detectados automáticamente de quien registró los controles. Edita si es necesario.</div>
                  </div>
                  <button className="btn small outline" onClick={addFirmante}>+ Agregar</button>
                </div>
                {firmantes.length === 0 && <p className="muted small" style={{ margin: 0 }}>Sin firmantes detectados. Agrega manualmente si es necesario.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {firmantes.map((f, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 8, background: f.fuente === 'auto' ? '#f0fdf4' : '#f8fafc', border: `1px solid ${f.fuente === 'auto' ? '#86efac' : '#e2e8f0'}` }}>
                      <span className="muted small" style={{ minWidth: 20 }}>#{idx + 1}</span>
                      <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600, minWidth: 48, textAlign: 'center', background: f.fuente === 'auto' ? '#dcfce7' : '#e0e7ff', color: f.fuente === 'auto' ? '#15803d' : '#4338ca' }}>{f.fuente === 'auto' ? 'auto' : 'manual'}</span>
                      <input className="input" style={{ flex: 2, fontSize: 12, padding: '4px 8px', height: 'auto' }} value={f.nombre} onChange={e => updateFirmante(idx, 'nombre', e.target.value)} placeholder="Nombre completo" />
                      <input className="input" style={{ flex: 2, fontSize: 12, padding: '4px 8px', height: 'auto' }} value={f.cargo} onChange={e => updateFirmante(idx, 'cargo', e.target.value)} placeholder="Cargo" />
                      <button onClick={() => removeFirmante(idx)} style={{ padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#fee2e2', color: '#dc2626', fontSize: 13, fontWeight: 700 }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Botones */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
              {!savedCode
                ? <button className="btn primary" onClick={handleEmit} disabled={emitting}>{emitting ? 'Emitiendo...' : 'Emitir y guardar formato'}</button>
                : <span className="tag dot ok" style={{ padding: '6px 12px', fontSize: 14 }}>Emitido: <strong style={{ fontFamily: 'monospace' }}>{savedCode}</strong></span>}
              <button className="btn outline" onClick={() => handleExportPdf(selected, previewProducer, controls, firmantes, savedCode, savedEmittedAt)} disabled={pdfGenerating}>{pdfGenerating ? 'Generando...' : 'Exportar PDF'}</button>
            </div>
            {emitError && <p style={{ color: '#dc2626', marginBottom: 12 }}>{emitError}</p>}
            {pdfError && <p style={{ color: '#dc2626', marginBottom: 12 }}>{pdfError}</p>}

            {/* Vista previa en iframe */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <iframe
                key={`${selected?.id}-${savedCode}-${JSON.stringify(firmantes)}`}
                srcDoc={previewHTML}
                style={{ width: '100%', minHeight: 500, border: 'none', display: 'block' }}
                title={`FCPO-${selected?.batch_code}`}
                onLoad={e => { try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ } }}
              />
            </div>
          </>)}
        </div>
      )}
      </>)}

      {/* ══ MODAL VER ════════════════════════════════════════════════════ */}
      {viewing && (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', overflowY: 'auto', padding: 0 }}>
          <div style={{ width: '100%', maxWidth: 960, margin: '0 auto', background: '#fff', minHeight: '100vh', padding: '28px 36px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div className="muted small" style={{ marginBottom: 2 }}>{FORMAT_TITLE_FCPO}</div>
                <h2 style={{ margin: 0, fontFamily: 'monospace', fontSize: 20 }}>{viewing.formato.formato_codigo}</h2>
                <div className="muted small">
                  Lote: {viewing.formato.production_batches?.batch_code ?? '—'} · Emitido: {fmtDateTime(viewing.formato.emitted_at)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn small outline" onClick={() => handleReprint(viewing.formato)} disabled={reprinting === viewing.formato.id}>{reprinting === viewing.formato.id ? '...' : 'Imprimir'}</button>
                <button className="btn small" onClick={() => setViewing(null)}>Cerrar</button>
              </div>
            </div>
            {!viewing.batch ? <SkeletonList count={3} lines={1} /> : (
              <iframe
                srcDoc={buildPrintHTMLFcpo(
                  COOPERATIVE,
                  viewing.formato.formato_codigo,
                  viewing.formato.emitted_at,
                  viewing.batch,
                  viewing.batch?.producers,
                  (viewing.controls ?? []).map(w => ({ work_area: w.work_area, observations: w.observations, items: w.worker_control_items ?? [] })),
                  viewing.firmantes ?? []
                )}
                style={{ width: '100%', minHeight: 600, border: 'none', display: 'block' }}
                onLoad={e => { try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ } }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
