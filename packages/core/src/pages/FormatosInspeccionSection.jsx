import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'
import { FORMAT_TYPE_FIAE, buildPrintHTMLFiae } from '../lib/formatos/fiae'
import { getCoopCode, openPrintWindow, fmtDate, fmtDateTime } from '../lib/formatos/shared'
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

export default function FormatosInspeccionSection({ view }) {
  const COOPERATIVE = useCooperative()
  const { webUser } = useAuthStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const docFromUrl = searchParams.get('doc') ?? ''

  const [modules, setModules]         = useState([])
  const [historial, setHistorial]     = useState([])
  const [loadingHist, setLoadingHist] = useState(true)
  const {
    histFilter, setHistFilter, histModuleFilter, setHistModuleFilter, histCustomFrom, setHistCustomFrom, histCustomTo, setHistCustomTo, filteredHistorial,
  } = useHistorialFilter(historial, docFromUrl)

  const [moduleId, setModuleId]       = useState('')
  const [inspections, setInspections] = useState(null)
  const [emittedIds, setEmittedIds]   = useState(new Set())
  const [loadingInsp, setLoadingInsp] = useState(false)
  const [error, setError]             = useState('')
  const period = usePeriodPresets(() => { setInspections(null); setSelected(null); setSavedCode(null); setError('') })

  const [selected, setSelected]           = useState(null)
  const [items, setItems]                 = useState([])
  const [loadingItems, setLoadingItems]   = useState(false)
  const { firmantes, setFirmantes, addFirmante, removeFirmante, updateFirmante } = useFirmantes()
  const [savedCode, setSavedCode]         = useState(null)
  const [savedEmittedAt, setSavedEmittedAt] = useState(null)
  const [emitting, setEmitting]           = useState(false)
  const [emitError, setEmitError]         = useState('')

  const [viewing, setViewing]             = useState(null)
  const [reprinting, setReprinting]       = useState(null)

  useEffect(() => { loadHistorial(); loadModules() }, [])

  async function loadModules() {
    const { data } = await supabase.from('coop_modules').select('id, name')
      .eq('cooperative_id', COOPERATIVE.id).order('name')
    setModules(data ?? [])
  }

  async function loadHistorial() {
    setLoadingHist(true)
    const { data } = await supabase
      .from('formatos_inspeccion_ambientes')
      .select('id, formato_codigo, module_id, inspection_id, inspection_date, emitted_by_name, emitted_at, status, firmantes, coop_modules(name)')
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('status', 'emitted')
      .order('emitted_at', { ascending: false })
    setHistorial(data ?? [])
    setLoadingHist(false)
  }

  async function handleSearch() {
    if (!moduleId) { setError('Selecciona un módulo.'); return }
    if (!period.dateFrom || !period.dateTo) { setError('Selecciona un período.'); return }
    setError(''); setLoadingInsp(true); setInspections(null); setSelected(null); setSavedCode(null)
    try {
      const [inspRes, emittedRes] = await Promise.all([
        supabase.from('environment_inspections')
          .select('id, inspection_date, created_by, created_at')
          .eq('cooperative_id', COOPERATIVE.id).eq('coop_module_id', moduleId)
          .gte('inspection_date', period.dateFrom).lte('inspection_date', period.dateTo)
          .order('inspection_date', { ascending: false }),
        supabase.from('formatos_inspeccion_ambientes')
          .select('inspection_id')
          .eq('cooperative_id', COOPERATIVE.id).eq('module_id', moduleId).eq('status', 'emitted'),
      ])
      const emitted = new Set((emittedRes.data ?? []).map(f => f.inspection_id))
      setEmittedIds(emitted)
      setInspections(inspRes.data ?? [])
    } catch (e) { setError(e.message ?? 'Error al buscar') }
    finally { setLoadingInsp(false) }
  }

  async function selectInspection(insp) {
    setSelected(insp); setSavedCode(null); setSavedEmittedAt(null); setEmitError('')
    setLoadingItems(true)
    try {
      const { data: its } = await supabase
        .from('environment_inspection_items')
        .select('area_code, item_code, item_description, condition, corrective_actions, observations')
        .eq('environment_inspection_id', insp.id)
      setItems(its ?? [])
      setFirmantes(await resolveFirmantesFromUserIds(COOPERATIVE, [insp.created_by]))
    } finally { setLoadingItems(false) }
  }

  async function handleEmit() {
    if (!selected) return
    setEmitting(true); setEmitError('')
    try {
      const { data, error: e } = await supabase.rpc('emit_formato_inspeccion_ambientes', {
        p_coop_code:       getCoopCode(COOPERATIVE),
        p_cooperative_id:  COOPERATIVE.id,
        p_module_id:       moduleId,
        p_inspection_id:   selected.id,
        p_inspection_date: selected.inspection_date,
        p_emitted_by:      webUser?.id ?? null,
        p_emitted_by_name: webUser ? `${webUser.first_name} ${webUser.last_name}` : null,
        p_firmantes:       firmantes,
      })
      if (e) throw e
      setSavedCode(data.formato_codigo)
      setSavedEmittedAt(new Date().toISOString())
      setEmittedIds(prev => new Set([...prev, selected.id]))
      await loadHistorial()
    } catch (e) { setEmitError(e.message ?? 'Error al emitir') }
    finally { setEmitting(false) }
  }

  async function handleView(f) {
    setViewing({ formato: f, items: null, firmantes: [] })
    const [itmRes, fmtRes] = await Promise.all([
      supabase.from('environment_inspection_items')
        .select('area_code, item_code, item_description, condition, corrective_actions, observations')
        .eq('environment_inspection_id', f.inspection_id),
      supabase.from('formatos_inspeccion_ambientes').select('firmantes').eq('id', f.id).single(),
    ])
    setViewing({ formato: f, items: itmRes.data ?? [], firmantes: fmtRes.data?.firmantes ?? [] })
  }

  async function handleReprint(f) {
    setReprinting(f.id)
    try {
      const [itmRes, fmtRes, modRes] = await Promise.all([
        supabase.from('environment_inspection_items')
          .select('area_code, item_code, item_description, condition, corrective_actions, observations')
          .eq('environment_inspection_id', f.inspection_id),
        supabase.from('formatos_inspeccion_ambientes').select('firmantes').eq('id', f.id).single(),
        supabase.from('coop_modules').select('name').eq('id', f.module_id).single(),
      ])
      const html = buildPrintHTMLFiae(COOPERATIVE, f.formato_codigo, modRes.data?.name ?? '—', f.inspection_date, f.emitted_at, itmRes.data ?? [], fmtRes.data?.firmantes ?? [])
      openPrintWindow(html, f.formato_codigo)
    } finally { setReprinting(null) }
  }

  const previewHTML = selected && items.length > 0
    ? buildPrintHTMLFiae(COOPERATIVE, savedCode ?? null, modules.find(m => m.id === moduleId)?.name ?? '—', selected.inspection_date, savedEmittedAt, items, firmantes)
    : null

  return (
    <div>
      {view === 'historico' && (<>
      {/* ── Historial ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16 }}>Historial — {FORMAT_TYPE_FIAE}</h3>
          {!loadingHist && <span className="muted small">{filteredHistorial.length} formato{filteredHistorial.length !== 1 ? 's' : ''} encontrado{filteredHistorial.length !== 1 ? 's' : ''}</span>}
        </div>

        <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted small" style={{ marginRight: 4 }}>Período:</span>
            {[{ key: 'month', label: 'Este mes' }, { key: 'year', label: 'Este año' }, { key: '6months', label: 'Últ. 6 meses' }, { key: 'all', label: 'Todos' }, { key: 'custom', label: 'Personalizado' }].map(opt => (
              <button key={opt.key} onClick={() => setHistFilter(opt.key)} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid',
                background: histFilter === opt.key ? COLOR : '#fff',
                color: histFilter === opt.key ? '#fff' : '#374151',
                borderColor: histFilter === opt.key ? COLOR : '#d1d5db',
                fontWeight: histFilter === opt.key ? 600 : 400,
              }}>{opt.label}</button>
            ))}
            {histFilter === 'custom' && (<>
              <DateInput className="input" value={histCustomFrom} onChange={e => setHistCustomFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
              <span className="muted small">—</span>
              <DateInput className="input" value={histCustomTo} onChange={e => setHistCustomTo(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
            </>)}
            <div style={{ marginLeft: 'auto' }}>
              <select className="input" value={histModuleFilter} onChange={e => setHistModuleFilter(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', height: 'auto', minWidth: 160 }}>
                <option value="">Todos los módulos</option>
                {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loadingHist ? <div style={{ padding: 16 }}><SkeletonList count={3} lines={1} /></div>
          : filteredHistorial.length === 0 ? <EmptyState message="No hay formatos emitidos en este período." />
          : (
            <table className="table small" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Código</th><th>Módulo</th><th>Fecha inspección</th>
                  <th>Registrado por</th><th>Emitido por</th><th>Fecha emisión</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filteredHistorial.map(f => (
                  <tr key={f.id} style={f.formato_codigo === docFromUrl ? { background: '#fefce8', outline: '2px solid #facc15' } : {}}>
                    <td><strong style={{ fontFamily: 'monospace', fontSize: 13, color: COLOR }}>{f.formato_codigo}</strong></td>
                    <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLOR, display: 'inline-block' }} />
                      {f.coop_modules?.name ?? '—'}
                    </span></td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(f.inspection_date)}</td>
                    <td style={{ fontSize: 12 }}>{(f.firmantes ?? []).map(fi => fi.nombre).join(', ') || '—'}</td>
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
      {/* ── Generar nuevo ─────────────────────────────────────────────────── */}
      <div>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Generar nuevo formato — {FORMAT_TYPE_FIAE}</h3>
          <p className="muted small" style={{ margin: 0 }}>Selecciona módulo y período para ver las inspecciones registradas.</p>
        </div>

        <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <span className="muted small" style={{ marginRight: 4 }}>Período:</span>
            {[{ key: 'month', label: 'Este mes' }, { key: 'year', label: 'Este año' }, { key: '6months', label: 'Últ. 6 meses' }, { key: 'custom', label: 'Personalizado' }].map(opt => (
              <button key={opt.key} onClick={() => period.selectPreset(opt.key)} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid',
                background: period.preset === opt.key ? COLOR : '#fff',
                color: period.preset === opt.key ? '#fff' : '#374151',
                borderColor: period.preset === opt.key ? COLOR : '#d1d5db',
                fontWeight: period.preset === opt.key ? 600 : 400,
              }}>{opt.label}</button>
            ))}
            {period.preset === 'custom' && (<>
              <DateInput className="input" value={period.dateFrom} onChange={e => { period.setDateFrom(e.target.value); setInspections(null) }} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
              <span className="muted small">—</span>
              <DateInput className="input" value={period.dateTo} onChange={e => { period.setDateTo(e.target.value); setInspections(null) }} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
            </>)}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="small muted">Módulo</label>
              <select className="input" value={moduleId} onChange={e => { setModuleId(e.target.value); setInspections(null); setSelected(null) }} style={{ display: 'block', minWidth: 200 }}>
                <option value="">Seleccionar módulo...</option>
                {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button className="btn primary" onClick={handleSearch} disabled={loadingInsp} style={{ background: COLOR, borderColor: COLOR }}>
              {loadingInsp ? 'Buscando...' : 'Ver inspecciones'}
            </button>
          </div>
          {error && <p style={{ color: '#dc2626', marginTop: 8, marginBottom: 0 }}>{error}</p>}
        </div>

        {/* Lista de inspecciones */}
        {inspections !== null && (
          <div style={{ marginBottom: 16 }}>
            {inspections.length === 0
              ? <EmptyState message="No hay inspecciones registradas en este período para el módulo seleccionado." />
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inspections.map(insp => {
                    const hasFormat = emittedIds.has(insp.id)
                    const isSelected = selected?.id === insp.id
                    return (
                      <div key={insp.id} onClick={() => !hasFormat && selectInspection(insp)} style={{
                        padding: '10px 14px', borderRadius: 8, cursor: hasFormat ? 'default' : 'pointer',
                        border: `1px solid ${isSelected ? COLOR : '#e2e8f0'}`,
                        background: isSelected ? BG : hasFormat ? '#f8fafc' : '#fff',
                        opacity: hasFormat ? 0.6 : 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <div>
                          <strong style={{ color: COLOR }}>{fmtDate(insp.inspection_date)}</strong>
                          <span className="muted small" style={{ marginLeft: 10 }}>Registrado: {fmtDateTime(insp.created_at)}</span>
                        </div>
                        {hasFormat
                          ? <span style={{ fontSize: 11, background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: 10, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={11} />Ya emitido</span>
                          : isSelected
                            ? <span style={{ fontSize: 11, color: COLOR, fontWeight: 600 }}>● Seleccionado</span>
                            : <span className="muted small">Click para seleccionar</span>
                        }
                      </div>
                    )
                  })}
                </div>
              )
            }
          </div>
        )}

        {/* Detalle de inspección seleccionada */}
        {selected && (
          <>
            {loadingItems
              ? <p className="muted">Cargando ítems...</p>
              : (
                <>
                  {/* Firmantes */}
                  {!savedCode && (
                    <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Firmantes</div>
                          <div className="muted small">Detectados automáticamente. Edita antes de emitir.</div>
                        </div>
                        <button className="btn small outline" onClick={addFirmante}>+ Agregar</button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {firmantes.map((f, idx) => (
                          <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderRadius: 8, background: f.fuente === 'auto' ? BG : '#f8fafc', border: `1px solid ${f.fuente === 'auto' ? '#c7d2fe' : '#e2e8f0'}` }}>
                            <span className="muted small" style={{ minWidth: 20 }}>#{idx+1}</span>
                            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600, background: f.fuente === 'auto' ? '#e0e7ff' : '#f3f4f6', color: f.fuente === 'auto' ? COLOR : '#6b7280' }}>{f.fuente}</span>
                            <input className="input" style={{ flex: 2, fontSize: 12, padding: '4px 8px', height: 'auto' }} value={f.nombre} onChange={e => updateFirmante(idx, 'nombre', e.target.value)} placeholder="Nombre completo" />
                            <input className="input" style={{ flex: 2, fontSize: 12, padding: '4px 8px', height: 'auto' }} value={f.cargo} onChange={e => updateFirmante(idx, 'cargo', e.target.value)} placeholder="Cargo" />
                            <button onClick={() => removeFirmante(idx)} style={{ padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#fee2e2', color: '#dc2626', fontSize: 13, fontWeight: 700 }}>✕</button>
                          </div>
                        ))}
                        {firmantes.length === 0 && <p className="muted small" style={{ margin: 0 }}>Sin firmantes detectados. Agrega manualmente.</p>}
                      </div>
                    </div>
                  )}

                  {/* Acción */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                    {!savedCode
                      ? <button className="btn primary" onClick={handleEmit} disabled={emitting} style={{ background: COLOR, borderColor: COLOR }}>
                          {emitting ? 'Emitiendo...' : 'Emitir y guardar formato'}
                        </button>
                      : <span className="tag dot ok" style={{ padding: '6px 12px', fontSize: 14 }}>
                          Emitido: <strong style={{ fontFamily: 'monospace' }}>{savedCode}</strong>
                        </span>
                    }
                    {emitError && <span style={{ color: '#dc2626', fontSize: 13 }}>{emitError}</span>}
                  </div>

                  {/* Preview */}
                  {previewHTML && (
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <iframe
                        srcDoc={previewHTML}
                        style={{ width: '100%', minHeight: 500, border: 'none', display: 'block' }}
                        title="preview-fiae"
                        onLoad={e => { try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ } }}
                      />
                    </div>
                  )}
                </>
              )
            }
          </>
        )}
      </div>
      </>)}

      {/* ── Modal ver ─────────────────────────────────────────────────────── */}
      {viewing && (
        <div className="modal-overlay" onClick={() => setViewing(null)}>
          <div style={{ background: '#fff', borderRadius: 12, width: '90%', maxWidth: 1000, maxHeight: '90vh', overflow: 'auto', padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <strong style={{ fontFamily: 'monospace', color: COLOR }}>{viewing.formato.formato_codigo}</strong>
                <span className="muted small" style={{ marginLeft: 10 }}>Inspección: {fmtDate(viewing.formato.inspection_date)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn small outline" onClick={() => {
                  navigate(`/reportes?tab=formatos&subtab=fiae&doc=${encodeURIComponent(viewing.formato.formato_codigo)}`)
                  setViewing(null)
                }}>Ir al historial</button>
                <button className="btn small outline" onClick={() => setViewing(null)}>✕ Cerrar</button>
              </div>
            </div>
            {viewing.items === null
              ? <div style={{ padding: 20 }}><SkeletonList count={3} lines={1} /></div>
              : <iframe
                  srcDoc={buildPrintHTMLFiae(COOPERATIVE, viewing.formato.formato_codigo, viewing.formato.coop_modules?.name ?? '—', viewing.formato.inspection_date, viewing.formato.emitted_at, viewing.items, viewing.firmantes)}
                  style={{ width: '100%', minHeight: 600, border: 'none', display: 'block' }}
                  title="modal-fiae"
                  onLoad={e => { try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ } }}
                />
            }
          </div>
        </div>
      )}
    </div>
  )
}
