import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { FORMAT_TYPE_FCCLR, buildPrintHTMLFcclr } from '../lib/formatos/fcclr'
import { fmtDate, fmtDateTime } from '../lib/formatos/shared'
import { downloadPdfDocument } from '../lib/pdfDownload'
import { useFormatoPeriodoAgregado } from '../hooks/useFormatoPeriodoAgregado'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import DateInput from '../components/DateInput'

const COLOR = 'var(--primary)'

const RECORDS_SELECT = 'id, control_date, control_time, measurement_point_1, measurement_point_2, corrective_actions, observations, responsible_person, created_by'

// cooperative como primer parámetro (antes leía COOPERATIVE del módulo
// lib/config, que ya no existe en core) -- el call site (más abajo, dentro
// del componente) lo inyecta desde useCooperative().
async function fetchRecords(cooperative, moduleId, dateFrom, dateTo) {
  const { data } = await supabase
    .from('chlorine_residual_controls')
    .select(RECORDS_SELECT)
    .eq('cooperative_id', cooperative.id)
    .eq('coop_module_id', moduleId)
    .gte('control_date', dateFrom)
    .lte('control_date', dateTo)
    .order('control_date', { ascending: true })
    .order('control_time', { ascending: true })
  return data ?? []
}

async function fetchViewData(cooperative, f) {
  const [recRes, fmtRes] = await Promise.all([
    supabase.from('chlorine_residual_controls')
      .select(RECORDS_SELECT)
      .eq('cooperative_id', cooperative.id)
      .eq('coop_module_id', f.module_id)
      .gte('control_date', f.date_from).lte('control_date', f.date_to)
      .order('control_date').order('control_time'),
    supabase.from('formatos_control_cloro').select('firmantes').eq('id', f.id).single(),
  ])
  return { records: recRes.data ?? [], firmantes: fmtRes.data?.firmantes ?? [] }
}

export default function FormatosCloroSection({ view }) {
  const COOPERATIVE = useCooperative()
  const {
    docFromUrl, modules, moduleId, setModuleId,
    loadingHist,
    histFilter, setHistFilter, histModuleFilter, setHistModuleFilter, histCustomFrom, setHistCustomFrom, histCustomTo, setHistCustomTo, filteredHistorial,
    preset, dateFrom, setDateFrom, dateTo, setDateTo, selectPreset,
    records, loadingRecords, searchError, handleSearch,
    firmantes, addFirmante, removeFirmante, updateFirmante,
    savedCode, emitting, emitError, handleEmit,
    viewing, setViewing, handleView,
    reprinting, handleReprint,
    previewHTML,
  } = useFormatoPeriodoAgregado({
    historialTable: 'formatos_control_cloro',
    rpcName: 'emit_formato_control_cloro',
    fetchRecords: (...args) => fetchRecords(COOPERATIVE, ...args),
    fetchViewData: (...args) => fetchViewData(COOPERATIVE, ...args),
    buildPrintHTML: (...args) => buildPrintHTMLFcclr(COOPERATIVE, ...args),
  })

  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [pdfError, setPdfError] = useState('')

  const handleExportPdf = async () => {
    setPdfGenerating(true)
    setPdfError('')
    try {
      await downloadPdfDocument(previewHTML)
    } catch (err) {
      setPdfError(err.message)
    } finally {
      setPdfGenerating(false)
    }
  }

  return (
    <div>
      {view === 'historico' && (<>
      {/* ══ HISTORIAL ══════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16 }}>Historial — {FORMAT_TYPE_FCCLR}</h3>
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
          : filteredHistorial.length === 0 ? <EmptyState message="No hay formatos en este período." />
          : (
            <table className="table small" style={{ margin: 0 }}>
              <thead>
                <tr><th>Código</th><th>Módulo</th><th>Período cubierto</th><th>Registrado por</th><th>Emitido por</th><th>Fecha emisión</th><th></th></tr>
              </thead>
              <tbody>
                {filteredHistorial.map(f => (
                  <tr key={f.id} style={f.formato_codigo === docFromUrl ? { background: '#fefce8', outline: '2px solid #facc15' } : {}}>
                    <td><strong style={{ fontFamily: 'monospace', fontSize: 13 }}>{f.formato_codigo}</strong></td>
                    <td style={{ fontSize: 12 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLOR, display: 'inline-block' }} />
                        {f.coop_modules?.name ?? '—'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(f.date_from)} — {fmtDate(f.date_to)}</td>
                    <td style={{ fontSize: 12 }}>{(f.firmantes ?? []).map(fi => fi.nombre).join(', ') || '—'}</td>
                    <td style={{ fontSize: 12 }}>{f.emitted_by_name ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted)' }}>{fmtDateTime(f.emitted_at)}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn small outline" onClick={() => handleView(f)}>Ver</button>
                      <button className="btn small outline" onClick={() => handleReprint(f)} disabled={reprinting === f.id}>{reprinting === f.id ? '...' : 'Imprimir'}</button>
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
      {/* ══ GENERAR NUEVO ══════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Generar nuevo formato — {FORMAT_TYPE_FCCLR}</h3>
          <p className="muted small" style={{ margin: 0 }}>Selecciona el módulo y período para ver los registros de cloro y generar el documento.</p>
        </div>

        <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <span className="muted small" style={{ marginRight: 4 }}>Período:</span>
            {[{ key: 'month', label: 'Este mes' }, { key: 'year', label: 'Este año' }, { key: '6months', label: 'Últ. 6 meses' }, { key: 'custom', label: 'Personalizado' }].map(opt => (
              <button key={opt.key} onClick={() => selectPreset(opt.key)} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid', background: preset === opt.key ? COLOR : '#fff', color: preset === opt.key ? '#fff' : '#374151', borderColor: preset === opt.key ? COLOR : '#d1d5db', fontWeight: preset === opt.key ? 600 : 400 }}>{opt.label}</button>
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
              {loadingRecords ? 'Cargando...' : 'Ver registros'}
            </button>
          </div>
          {searchError && <p style={{ color: '#dc2626', marginTop: 8, marginBottom: 0 }}>{searchError}</p>}
        </div>
      </div>

      {records !== null && (<>
        {/* Firmantes */}
        {!savedCode && (
          <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Firmantes del documento</div>
                <div className="muted small">Detectados automáticamente. Edita, elimina o agrega antes de emitir.</div>
              </div>
              <button className="btn small outline" onClick={addFirmante} style={{ whiteSpace: 'nowrap' }}>+ Agregar firmante</button>
            </div>
            {firmantes.length === 0 && <p className="muted small" style={{ margin: 0 }}>No se detectaron responsables. Agrega manualmente si es necesario.</p>}
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
          {!savedCode ? (
            <button className="btn primary" onClick={handleEmit} disabled={emitting || records.length === 0} style={{ background: COLOR, borderColor: COLOR }}>
              {emitting ? 'Emitiendo...' : 'Emitir y guardar formato'}
            </button>
          ) : (
            <span className="tag dot ok" style={{ padding: '6px 12px', fontSize: 14 }}>
              Emitido: <strong style={{ fontFamily: 'monospace' }}>{savedCode}</strong>
            </span>
          )}
          {emitError && <span style={{ color: '#dc2626', fontSize: 13 }}>{emitError}</span>}
          {pdfError && <span style={{ color: '#dc2626', fontSize: 13 }}>{pdfError}</span>}
          {records.length > 0 && (
            <button className="btn outline" onClick={handleExportPdf} disabled={pdfGenerating}>{pdfGenerating ? 'Generando...' : 'Exportar PDF'}</button>
          )}
          {records.length === 0 && <span className="muted">No hay registros de cloro en este módulo para el período seleccionado.</span>}
        </div>

        {/* Preview iframe */}
        {records.length > 0 && previewHTML && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <iframe
              srcDoc={previewHTML}
              style={{ width: '100%', minHeight: 500, border: 'none', display: 'block' }}
              title="preview-fcclr"
              onLoad={e => {
                try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ }
              }}
            />
          </div>
        )}
      </>)}
      </>)}

      {/* ══ MODAL VER ══════════════════════════════════════════════════════════ */}
      {viewing && (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', overflowY: 'auto', padding: 0 }}>
          <div style={{ width: '100%', maxWidth: 1000, margin: '0 auto', background: '#fff', minHeight: '100vh', padding: '28px 36px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div className="muted small" style={{ marginBottom: 2 }}>{FORMAT_TYPE_FCCLR}</div>
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
            {!viewing.records ? (
              <SkeletonList count={3} lines={1} />
            ) : (
              <iframe
                srcDoc={buildPrintHTMLFcclr(COOPERATIVE, viewing.formato.formato_codigo, viewing.formato.coop_modules?.name ?? '—', viewing.formato.date_from, viewing.formato.date_to, viewing.formato.emitted_at, viewing.records, viewing.firmantes)}
                style={{ width: '100%', minHeight: 600, border: 'none', display: 'block' }}
                title={viewing.formato.formato_codigo}
                onLoad={e => {
                  try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ }
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
