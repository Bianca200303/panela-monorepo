import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { FORMAT_TYPE_FCP, buildPrintHTMLFcp } from '../lib/formatos/fcp'
import { fmtDate, fmtDateTime } from '../lib/formatos/shared'
import { useFormatoPeriodoAgregado } from '../hooks/useFormatoPeriodoAgregado'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import DateInput from '../components/DateInput'

const COLOR = 'var(--primary)'
const BG    = 'rgba(15,76,92,0.08)'

const RECORDS_SELECT = `
  id, control_date, created_by,
  pest_control_bait_records   ( id, product_name, quantity, unit, bait_stations, bait_observations ),
  pest_control_insect_records ( id, product_name, quantity, unit, insect_data )
`

// cooperative como primer parámetro (antes leía COOPERATIVE del módulo
// lib/config, que ya no existe en core) -- el call site (más abajo, dentro
// del componente) lo inyecta desde useCooperative().
async function fetchRecords(cooperative, moduleId, dateFrom, dateTo) {
  const { data } = await supabase
    .from('pest_controls')
    .select(RECORDS_SELECT)
    .eq('cooperative_id', cooperative.id).eq('coop_module_id', moduleId)
    .gte('control_date', dateFrom).lte('control_date', dateTo)
    .order('control_date')
  return data ?? []
}

async function fetchViewData(cooperative, f) {
  const [pcRes, fmtRes] = await Promise.all([
    supabase.from('pest_controls').select(RECORDS_SELECT)
      .eq('cooperative_id', cooperative.id).eq('coop_module_id', f.module_id)
      .gte('control_date', f.date_from).lte('control_date', f.date_to).order('control_date'),
    supabase.from('formatos_control_plagas').select('firmantes').eq('id', f.id).single(),
  ])
  return { records: pcRes.data ?? [], firmantes: fmtRes.data?.firmantes ?? [] }
}

export default function FormatosPlagasSection({ view }) {
  const COOPERATIVE = useCooperative()
  const navigate = useNavigate()
  const {
    docFromUrl, modules, moduleId, setModuleId,
    loadingHist,
    histFilter, setHistFilter, histModuleFilter, setHistModuleFilter, histCustomFrom, setHistCustomFrom, histCustomTo, setHistCustomTo, filteredHistorial,
    preset, dateFrom, setDateFrom, dateTo, setDateTo, selectPreset,
    records: pestControls, loadingRecords, searchError, handleSearch,
    firmantes, addFirmante, removeFirmante, updateFirmante,
    savedCode, emitting, emitError, handleEmit,
    viewing, setViewing, handleView,
    reprinting, handleReprint,
    previewHTML,
  } = useFormatoPeriodoAgregado({
    historialTable: 'formatos_control_plagas',
    rpcName: 'emit_formato_control_plagas',
    fetchRecords: (...args) => fetchRecords(COOPERATIVE, ...args),
    fetchViewData: (...args) => fetchViewData(COOPERATIVE, ...args),
    buildPrintHTML: (...args) => buildPrintHTMLFcp(COOPERATIVE, ...args),
  })

  return (
    <div>
      {view === 'historico' && (<>
      {/* ── Historial ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16 }}>Historial — {FORMAT_TYPE_FCP}</h3>
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
                <tr><th>Código</th><th>Módulo</th><th>Período</th><th>Registrado por</th><th>Emitido por</th><th>Fecha emisión</th><th></th></tr>
              </thead>
              <tbody>
                {filteredHistorial.map(f => (
                  <tr key={f.id} style={f.formato_codigo === docFromUrl ? { background: '#fefce8', outline: '2px solid #facc15' } : {}}>
                    <td><strong style={{ fontFamily: 'monospace', fontSize: 13, color: COLOR }}>{f.formato_codigo}</strong></td>
                    <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLOR, display: 'inline-block' }} />
                      {f.coop_modules?.name ?? '—'}
                    </span></td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(f.date_from)} — {fmtDate(f.date_to)}</td>
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
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Generar nuevo formato — {FORMAT_TYPE_FCP}</h3>
          <p className="muted small" style={{ margin: 0 }}>Selecciona módulo y período para agrupar los registros de control de plagas.</p>
        </div>

        <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <span className="muted small" style={{ marginRight: 4 }}>Período:</span>
            {[{ key: 'month', label: 'Este mes' }, { key: 'year', label: 'Este año' }, { key: '6months', label: 'Últ. 6 meses' }, { key: 'custom', label: 'Personalizado' }].map(opt => (
              <button key={opt.key} onClick={() => selectPreset(opt.key)} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid',
                background: preset === opt.key ? COLOR : '#fff',
                color: preset === opt.key ? '#fff' : '#374151',
                borderColor: preset === opt.key ? COLOR : '#d1d5db',
                fontWeight: preset === opt.key ? 600 : 400,
              }}>{opt.label}</button>
            ))}
            {preset === 'custom' && (<>
              <DateInput className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
              <span className="muted small">—</span>
              <DateInput className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
            </>)}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="small muted">Módulo</label>
              <select className="input" value={moduleId} onChange={e => setModuleId(e.target.value)} style={{ display: 'block', minWidth: 200 }}>
                <option value="">Seleccionar módulo...</option>
                {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button className="btn primary" onClick={handleSearch} disabled={loadingRecords} style={{ background: COLOR, borderColor: COLOR }}>
              {loadingRecords ? 'Buscando...' : 'Ver registros'}
            </button>
          </div>
          {searchError && <p style={{ color: '#dc2626', marginTop: 8, marginBottom: 0 }}>{searchError}</p>}
        </div>

        {pestControls !== null && (
          <>
            {pestControls.length === 0
              ? <EmptyState message="No hay registros de control de plagas en este período." />
              : (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <span className="muted small">{pestControls.length} registro{pestControls.length !== 1 ? 's' : ''} encontrado{pestControls.length !== 1 ? 's' : ''} · </span>
                    <span className="muted small">{pestControls.filter(p => p.pest_control_bait_records?.length > 0).length} con cebos · </span>
                    <span className="muted small">{pestControls.filter(p => p.pest_control_insect_records?.length > 0).length} con insectos</span>
                  </div>

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
                          <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderRadius: 8, background: f.fuente === 'auto' ? BG : '#f8fafc', border: `1px solid ${f.fuente === 'auto' ? '#fecaca' : '#e2e8f0'}` }}>
                            <span className="muted small" style={{ minWidth: 20 }}>#{idx+1}</span>
                            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600, background: f.fuente === 'auto' ? '#fee2e2' : '#f3f4f6', color: f.fuente === 'auto' ? COLOR : '#6b7280' }}>{f.fuente}</span>
                            <input className="input" style={{ flex: 2, fontSize: 12, padding: '4px 8px', height: 'auto' }} value={f.nombre} onChange={e => updateFirmante(idx, 'nombre', e.target.value)} placeholder="Nombre completo" />
                            <input className="input" style={{ flex: 2, fontSize: 12, padding: '4px 8px', height: 'auto' }} value={f.cargo} onChange={e => updateFirmante(idx, 'cargo', e.target.value)} placeholder="Cargo" />
                            <button onClick={() => removeFirmante(idx)} style={{ padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#fee2e2', color: '#dc2626', fontSize: 13, fontWeight: 700 }}>✕</button>
                          </div>
                        ))}
                        {firmantes.length === 0 && <p className="muted small" style={{ margin: 0 }}>Sin firmantes. Agrega manualmente.</p>}
                      </div>
                    </div>
                  )}

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
                </>
              )
            }

            {previewHTML && (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <iframe
                  srcDoc={previewHTML}
                  style={{ width: '100%', minHeight: 400, border: 'none', display: 'block' }}
                  title="preview-fcp"
                  onLoad={e => { try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ } }}
                />
              </div>
            )}
          </>
        )}
      </div>
      </>)}

      {/* ── Modal ver ─────────────────────────────────────────────────────── */}
      {viewing && (
        <div className="modal-overlay" onClick={() => setViewing(null)}>
          <div style={{ background: '#fff', borderRadius: 12, width: '90%', maxWidth: 1000, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <strong style={{ fontFamily: 'monospace', color: COLOR }}>{viewing.formato.formato_codigo}</strong>
                <span className="muted small" style={{ marginLeft: 10 }}>{fmtDate(viewing.formato.date_from)} — {fmtDate(viewing.formato.date_to)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn small outline" onClick={() => {
                  navigate(`/reportes?tab=formatos&subtab=fcp&doc=${encodeURIComponent(viewing.formato.formato_codigo)}`)
                  setViewing(null)
                }}>Ir al historial</button>
                <button className="btn small outline" onClick={() => setViewing(null)}>✕ Cerrar</button>
              </div>
            </div>
            {viewing.records === null
              ? <div style={{ padding: 20 }}><SkeletonList count={3} lines={1} /></div>
              : <iframe
                  srcDoc={buildPrintHTMLFcp(COOPERATIVE, viewing.formato.formato_codigo, viewing.formato.coop_modules?.name ?? '—', viewing.formato.date_from, viewing.formato.date_to, viewing.formato.emitted_at, viewing.records, viewing.firmantes)}
                  style={{ width: '100%', minHeight: 500, border: 'none', display: 'block' }}
                  title="modal-fcp"
                  onLoad={e => { try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ } }}
                />
            }
          </div>
        </div>
      )}
    </div>
  )
}
