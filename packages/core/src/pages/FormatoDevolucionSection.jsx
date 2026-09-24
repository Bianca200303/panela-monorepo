import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'
import { FORMAT_TITLE_FQD, FORMAT_TYPE_FQD, buildPrintHTMLFqd } from '../lib/formatos/fqd'
import { getCoopCode, openPrintWindow, fmtDate, fmtDateTime } from '../lib/formatos/shared'
import { downloadPdfDocument } from '../lib/pdfDownload'
import { usePeriodPresets } from '../hooks/usePeriodPresets'
import { useFirmantes } from '../hooks/useFirmantes'
import { useHistorialFilter } from '../hooks/useHistorialFilter'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Icon from '../components/Icon'
import DateInput from '../components/DateInput'

const COLOR = 'var(--primary)'
const BG    = 'rgba(15,76,92,0.08)'

// Quién cargó el dato originalmente (móvil o web) -- distinto de "Emitido
// por" (quién generó/firmó el documento formal).
function registeredByText(ret) {
  const u = ret?.registered_by_user ?? ret?.registered_by_web_user
  return u ? `${u.first_name} ${u.last_name}` : null
}

export default function FormatoDevolucionSection({ view }) {
  const COOPERATIVE = useCooperative()
  const { webUser } = useAuthStore()
  const [searchParams] = useSearchParams()
  const docFromUrl = searchParams.get('doc') ?? ''

  const [historial, setHistorial]     = useState([])
  const [loadingHist, setLoadingHist] = useState(true)
  const {
    histFilter, setHistFilter, histCustomFrom, setHistCustomFrom, histCustomTo, setHistCustomTo, filteredHistorial,
  } = useHistorialFilter(historial, docFromUrl)

  const [returns, setReturns]               = useState(null)
  const [loadingReturns, setLoadingReturns] = useState(false)
  const [fqdMap, setFqdMap]                 = useState({})
  const [error, setError]                   = useState('')
  const period = usePeriodPresets(() => { setReturns(null); setSelected(null); setSavedCode(null); setError('') })

  const [selected, setSelected]             = useState(null)
  const { firmantes, setFirmantes, addFirmante, removeFirmante, updateFirmante } = useFirmantes()
  const [savedCode, setSavedCode]           = useState(null)
  const [savedEmittedAt, setSavedEmittedAt] = useState(null)
  const [emitting, setEmitting]             = useState(false)
  const [emitError, setEmitError]           = useState('')

  const [viewing, setViewing]       = useState(null)
  const [reprinting, setReprinting] = useState(null)

  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [pdfError, setPdfError]           = useState('')

  useEffect(() => { loadHistorial() }, [])

  async function loadHistorial() {
    setLoadingHist(true)
    const { data } = await supabase
      .from('formatos_devoluciones')
      .select(`
        id, formato_codigo, emitted_at, emitted_by_name, status, product_return_id,
        product_returns (
          client_name, return_date, quantity_kg, quantity_sacks,
          production_batches ( batch_code, process_date,
            producers ( first_name, last_name, coop_modules ( name ) )
          ),
          registered_by_user:users!product_returns_created_by_fkey ( first_name, last_name ),
          registered_by_web_user:web_users!product_returns_created_by_web_user_id_fkey ( first_name, last_name )
        )
      `)
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('status', 'emitted')
      .order('emitted_at', { ascending: false })
    setHistorial(data ?? [])
    setLoadingHist(false)
  }

  async function handleSearch() {
    if (!period.dateFrom || !period.dateTo) { setError('Selecciona un período.'); return }
    if (period.dateFrom > period.dateTo) { setError('La fecha inicial no puede ser mayor a la final.'); return }
    setError(''); setLoadingReturns(true); setReturns(null); setSelected(null); setSavedCode(null)
    try {
      const { data: rows } = await supabase
        .from('product_returns')
        .select(`
          id, client_name, return_date, quantity_kg, quantity_sacks,
          return_reason, observations, created_by, created_by_web_user_id, voided_at,
          production_batches!inner (
            batch_code, process_date, panela_kg,
            producers ( first_name, last_name, coop_modules ( name ) )
          )
        `)
        .eq('cooperative_id', COOPERATIVE.id)
        .gte('return_date', period.dateFrom)
        .lte('return_date', period.dateTo)
        .order('return_date', { ascending: false })

      if (!rows?.length) { setReturns([]); return }

      const returnIds = rows.map(r => r.id)
      const { data: existing } = await supabase
        .from('formatos_devoluciones')
        .select('product_return_id, formato_codigo, status')
        .in('product_return_id', returnIds)
        .eq('cooperative_id', COOPERATIVE.id)
      const existingMap = {}
      ;(existing ?? []).forEach(e => { existingMap[e.product_return_id] = e })
      setFqdMap(existingMap)
      setReturns(rows)
    } catch (e) { setError(e.message ?? 'Error al buscar') }
    finally { setLoadingReturns(false) }
  }

  async function selectReturn(ret) {
    setSelected(ret)
    setSavedCode(fqdMap[ret.id]?.formato_codigo ?? null)
    setSavedEmittedAt(null)
    setEmitError('')

    if (fqdMap[ret.id]?.formato_codigo) return

    if (ret.created_by) {
      const { data: user } = await supabase
        .from('users')
        .select('first_name, last_name, role')
        .eq('user_id', ret.created_by)
        .eq('cooperative_id', COOPERATIVE.id)
        .maybeSingle()
      setFirmantes(user ? [{
        nombre: `${user.first_name} ${user.last_name}`,
        cargo:  user.role === 'admin_modulo' ? 'Administrador de Módulo' : 'Técnico de Campo',
        orden: 1, fuente: 'auto',
      }] : [])
    } else if (ret.created_by_web_user_id) {
      const { data: user } = await supabase
        .from('web_users')
        .select('first_name, last_name, role')
        .eq('id', ret.created_by_web_user_id)
        .eq('cooperative_id', COOPERATIVE.id)
        .maybeSingle()
      setFirmantes(user ? [{
        nombre: `${user.first_name} ${user.last_name}`,
        cargo:  user.role === 'admin_web' ? 'Administrador' : 'Operador de Planta',
        orden: 1, fuente: 'auto',
      }] : [])
    } else {
      setFirmantes([])
    }
  }

  async function handleEmit() {
    if (!selected) return
    setEmitting(true); setEmitError('')
    try {
      const { data, error: e } = await supabase.rpc('emit_formato_devolucion', {
        p_coop_code:          getCoopCode(COOPERATIVE),
        p_cooperative_id:     COOPERATIVE.id,
        p_product_return_id:  selected.id,
        p_emitted_by:         webUser?.id ?? null,
        p_emitted_by_name:    webUser ? `${webUser.first_name} ${webUser.last_name}` : null,
        p_firmantes:          firmantes,
      })
      if (e) throw e
      setSavedCode(data.formato_codigo)
      setSavedEmittedAt(new Date().toISOString())
      setFqdMap(prev => ({ ...prev, [selected.id]: { formato_codigo: data.formato_codigo, status: 'emitted' } }))
      await loadHistorial()
    } catch (e) { setEmitError(e.message ?? 'Error al emitir') }
    finally { setEmitting(false) }
  }

  async function handleExportPdf() {
    setPdfGenerating(true); setPdfError('')
    try {
      const html = buildPrintHTMLFqd(COOPERATIVE, savedCode ?? '(borrador)', savedEmittedAt, buildReturnData(selected), previewBatch, previewProducer, firmantes)
      await downloadPdfDocument(html)
    } catch (e) { setPdfError(e.message ?? 'Error al generar el PDF') }
    finally { setPdfGenerating(false) }
  }

  function buildReturnData(ret) {
    return {
      client_name:    ret.client_name,
      return_date:    ret.return_date,
      quantity_kg:    ret.quantity_kg,
      quantity_sacks: ret.quantity_sacks,
      return_reason:  ret.return_reason,
      observations:   ret.observations,
    }
  }

  async function handleView(f) {
    setViewing({ formato: f, ret: null })
    const [retRes, fmtRes] = await Promise.all([
      supabase.from('product_returns')
        .select(`
          id, client_name, return_date, quantity_kg, quantity_sacks, return_reason, observations,
          production_batches!inner (
            batch_code, process_date, panela_kg,
            producers ( first_name, last_name, coop_modules ( name ) )
          )
        `)
        .eq('id', f.product_return_id).single(),
      supabase.from('formatos_devoluciones')
        .select('firmantes').eq('id', f.id).single(),
    ])
    setViewing({ formato: f, ret: retRes.data, firmantes: fmtRes.data?.firmantes ?? [] })
  }

  async function handleReprint(f) {
    setReprinting(f.id)
    try {
      const [retRes, fmtRes] = await Promise.all([
        supabase.from('product_returns')
          .select(`
            id, client_name, return_date, quantity_kg, quantity_sacks, return_reason, observations,
            production_batches!inner (
              batch_code, process_date, panela_kg,
              producers ( first_name, last_name, coop_modules ( name ) )
            )
          `)
          .eq('id', f.product_return_id).single(),
        supabase.from('formatos_devoluciones')
          .select('firmantes').eq('id', f.id).single(),
      ])
      const ret     = retRes.data
      const batch   = ret?.production_batches
      const producer = batch?.producers
      const html    = buildPrintHTMLFqd(COOPERATIVE, f.formato_codigo, f.emitted_at, buildReturnData(ret), batch, producer, fmtRes.data?.firmantes ?? [])
      openPrintWindow(html, f.formato_codigo)
    } finally { setReprinting(null) }
  }

  const previewBatch    = selected?.production_batches
  const previewProducer = previewBatch?.producers
  const previewHTML     = selected
    ? buildPrintHTMLFqd(COOPERATIVE, savedCode ?? null, savedEmittedAt, buildReturnData(selected), previewBatch, previewProducer, firmantes)
    : null

  return (
    <div>
      {/* ══ TÍTULO ════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>Formatos de Devoluciones</h2>
          <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: BG, color: COLOR, border: `1px solid ${COLOR}` }}>{FORMAT_TYPE_FQD}</span>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Documentos de <strong>{FORMAT_TITLE_FQD}</strong> — se generan automáticamente al rechazar un lote en Calidad.
        </p>
      </div>

      {view === 'historico' && (<>
      {/* ══ HISTORIAL ══════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16 }}>Historial — {FORMAT_TYPE_FQD}</h3>
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
                <tr><th>Código</th><th>Cliente</th><th>Lote de campo</th><th>F. devolución</th><th>Cantidad</th><th>Registrado por</th><th>Emitido por</th><th>Fecha emisión</th><th></th></tr>
              </thead>
              <tbody>
                {filteredHistorial.map(f => {
                  const ret  = f.product_returns
                  const pb   = ret?.production_batches
                  const qtxt = ret?.quantity_sacks > 0
                    ? `${ret.quantity_sacks} sacos`
                    : `${Number(ret?.quantity_kg ?? 0).toFixed(2)} kg`
                  return (
                    <tr key={f.id} style={f.formato_codigo === docFromUrl ? { background: '#fefce8', outline: '2px solid #facc15' } : {}}>
                      <td><strong style={{ fontFamily: 'monospace', fontSize: 13 }}>{f.formato_codigo}</strong></td>
                      <td style={{ fontSize: 12 }}>{ret?.client_name ?? '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{pb?.batch_code ?? '—'}</td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(ret?.return_date)}</td>
                      <td style={{ fontSize: 12 }}>{qtxt}</td>
                      <td style={{ fontSize: 12 }}>{registeredByText(ret) ?? '—'}</td>
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
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Generar nuevo formato — {FORMAT_TYPE_FQD}</h3>
          <p className="muted small" style={{ margin: 0 }}>Busca los registros de devolución por fecha de devolución para generar el documento.</p>
        </div>

        <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <span className="muted small" style={{ marginRight: 4 }}>Período:</span>
            {[{ key: 'month', label: 'Este mes' }, { key: 'year', label: 'Este año' }, { key: '6months', label: 'Últ. 6 meses' }, { key: 'custom', label: 'Personalizado' }].map(opt => (
              <button key={opt.key} onClick={() => period.selectPreset(opt.key)} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid', background: period.preset === opt.key ? COLOR : '#fff', color: period.preset === opt.key ? '#fff' : '#374151', borderColor: period.preset === opt.key ? COLOR : '#d1d5db', fontWeight: period.preset === opt.key ? 600 : 400 }}>{opt.label}</button>
            ))}
            {period.preset === 'custom' && (<>
              <DateInput className="input" value={period.dateFrom} onChange={e => { period.setDateFrom(e.target.value); setReturns(null) }} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
              <span className="muted small">—</span>
              <DateInput className="input" value={period.dateTo} onChange={e => { period.setDateTo(e.target.value); setReturns(null) }} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
            </>)}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <button className="btn primary" onClick={handleSearch} disabled={loadingReturns}>{loadingReturns ? 'Buscando...' : 'Buscar devoluciones'}</button>
            {period.dateFrom && period.dateTo && <span className="muted small">{period.dateFrom} — {period.dateTo}</span>}
          </div>
          {error && <p style={{ color: '#dc2626', marginTop: 8, marginBottom: 0 }}>{error}</p>}
        </div>
      </div>

      {/* ── Lista de devoluciones encontradas ──────────────────────────────── */}
      {returns !== null && (
        returns.length === 0
          ? <EmptyState message="No hay devoluciones en este período." />
          : (
            <div style={{ marginBottom: 16 }}>
              <div className="muted small" style={{ marginBottom: 8 }}>
                {returns.length} devolución{returns.length !== 1 ? 'es' : ''} encontrada{returns.length !== 1 ? 's' : ''} — selecciona para generar el documento
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {returns.map(r => {
                  const emitido = !!fqdMap[r.id]?.formato_codigo
                  const isSel   = selected?.id === r.id
                  const isVoid  = !!r.voided_at
                  const pb      = r.production_batches
                  const qtxt    = r.quantity_sacks > 0 ? `${r.quantity_sacks} sacos` : `${Number(r.quantity_kg).toFixed(2)} kg`
                  return (
                    <div
                      key={r.id}
                      onClick={() => { if (!isVoid) selectReturn(r) }}
                      style={{
                        padding: '10px 14px', borderRadius: 8,
                        border: `1px solid ${isVoid ? '#e2e8f0' : isSel ? COLOR : emitido ? '#86efac' : '#e2e8f0'}`,
                        background: isVoid ? '#f9fafb' : isSel ? BG : emitido ? '#f0fdf4' : '#fff',
                        cursor: isVoid ? 'default' : 'pointer',
                        opacity: isVoid ? 0.7 : 1,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: 13 }}>{r.client_name}</strong>
                        <span className="muted small" style={{ marginLeft: 10 }}>Devolución: {fmtDate(r.return_date)}</span>
                        <span className="muted small" style={{ marginLeft: 10 }}>{qtxt}</span>
                        {pb && <span className="muted small" style={{ marginLeft: 10, fontFamily: 'monospace', fontSize: 11 }}>Lote: {pb.batch_code}</span>}
                      </div>
                      {isVoid
                        ? <span style={{ fontSize: 11, padding: '2px 8px', color: '#000', borderRadius: 20, border: '1px solid #d1d5db', fontWeight: 600 }}>Anulada</span>
                        : emitido
                        ? <span style={{ fontSize: 11, padding: '2px 8px', background: '#dcfce7', color: '#15803d', borderRadius: 20, border: '1px solid #86efac', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={11} />{fqdMap[r.id].formato_codigo}</span>
                        : isSel ? <span style={{ fontSize: 11, color: COLOR, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Seleccionado <Icon name="chevronDown" size={11} /></span>
                        : <span className="muted small">Seleccionar</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
      )}

      {/* ── Preview + emisión ──────────────────────────────────────────────── */}
      {selected && (<>
        {/* Firmantes */}
        {!savedCode && (
          <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Firmantes del documento</div>
                <div className="muted small">Detectado automáticamente del registrador. Edita si es necesario.</div>
              </div>
              <button className="btn small outline" onClick={addFirmante}>+ Agregar</button>
            </div>
            {firmantes.length === 0 && <p className="muted small" style={{ margin: 0 }}>Sin firmantes detectados. Agrega manualmente.</p>}
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
          <button className="btn outline" onClick={handleExportPdf} disabled={pdfGenerating}>{pdfGenerating ? 'Generando...' : 'Exportar PDF'}</button>
        </div>
        {emitError && <p style={{ color: '#dc2626', marginBottom: 12 }}>{emitError}</p>}
        {pdfError && <p style={{ color: '#dc2626', marginBottom: 12 }}>{pdfError}</p>}

        {/* Vista previa */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <iframe
            key={`${selected?.id}-${savedCode}-${JSON.stringify(firmantes)}`}
            srcDoc={previewHTML}
            style={{ width: '100%', minHeight: 400, border: 'none', display: 'block' }}
            title={`FQD-${selected?.id}`}
            onLoad={e => { try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ } }}
          />
        </div>
      </>)}
      </>)}

      {/* ══ MODAL VER ════════════════════════════════════════════════════ */}
      {viewing && (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', overflowY: 'auto', padding: 0 }}>
          <div style={{ width: '100%', maxWidth: 960, margin: '0 auto', background: '#fff', minHeight: '100vh', padding: '28px 36px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div className="muted small" style={{ marginBottom: 2 }}>{FORMAT_TITLE_FQD}</div>
                <h2 style={{ margin: 0, fontFamily: 'monospace', fontSize: 20 }}>{viewing.formato.formato_codigo}</h2>
                <div className="muted small">
                  Cliente: {viewing.ret?.client_name ?? '—'} · Lote: {viewing.ret?.production_batches?.batch_code ?? '—'} · Emitido: {fmtDateTime(viewing.formato.emitted_at)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn small outline" onClick={() => handleReprint(viewing.formato)} disabled={reprinting === viewing.formato.id}>{reprinting === viewing.formato.id ? '...' : 'Imprimir'}</button>
                <button className="btn small" onClick={() => setViewing(null)}>Cerrar</button>
              </div>
            </div>
            {!viewing.ret ? <SkeletonList count={3} lines={1} /> : (
              <iframe
                srcDoc={buildPrintHTMLFqd(
                  COOPERATIVE,
                  viewing.formato.formato_codigo,
                  viewing.formato.emitted_at,
                  buildReturnData(viewing.ret),
                  viewing.ret?.production_batches,
                  viewing.ret?.production_batches?.producers,
                  viewing.firmantes ?? []
                )}
                style={{ width: '100%', minHeight: 400, border: 'none', display: 'block' }}
                onLoad={e => { try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ } }}
              />
            )}
          </div>
        </div>
      )}

    </div>
  )
}
