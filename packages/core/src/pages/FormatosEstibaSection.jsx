import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'
import { FORMAT_TITLE_ESTIBA, buildPrintHTMLEstiba } from '../lib/formatos/estiba'
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

const chkCell = (v) => ({ textAlign: 'center', fontWeight: 700, color: v ? 'var(--success)' : '#dc2626' })

export default function FormatosEstibaSection({ view }) {
  const COOPERATIVE = useCooperative()
  const { webUser } = useAuthStore()
  const [searchParams] = useSearchParams()
  const docFromUrl = searchParams.get('doc') ?? ''

  const [historial, setHistorial]     = useState([])
  const [loadingHist, setLoadingHist] = useState(true)
  const {
    histFilter, setHistFilter, histCustomFrom, setHistCustomFrom, histCustomTo, setHistCustomTo, filteredHistorial,
  } = useHistorialFilter(historial, docFromUrl)

  const [inspections, setInspections] = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const period = usePeriodPresets(() => { setInspections(null); setSelected(null); setSavedCode(null); setError('') })

  const [selected, setSelected]         = useState(null)
  const [exitItems, setExitItems]       = useState([])
  const [loadingItems, setLoadingItems] = useState(false)

  const { firmantes, setFirmantes, addFirmante, removeFirmante, updateFirmante } = useFirmantes()
  const [emitting, setEmitting]             = useState(false)
  const [savedCode, setSavedCode]           = useState(null)
  const [savedEmittedAt, setSavedEmittedAt] = useState(null)
  const [emitError, setEmitError]           = useState('')

  const [viewing, setViewing]       = useState(null)
  const [reprinting, setReprinting] = useState(null)

  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [pdfError, setPdfError]           = useState('')

  useEffect(() => { loadHistorial() }, [])

  async function loadHistorial() {
    setLoadingHist(true)
    const { data } = await supabase
      .from('stowage_transport_inspections')
      .select('id, formato_codigo, emitted_by_name, emitted_at, status, inspection_date, carrier_name, vehicle_plate, exit_registration_id, exit_registrations(exit_code, exit_date), registered_by_user:users!stowage_transport_inspections_created_by_fkey(first_name, last_name)')
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('status', 'emitted')
      .order('emitted_at', { ascending: false })
    setHistorial(data ?? [])
    setLoadingHist(false)
  }

  async function handleSearch() {
    if (!period.dateFrom || !period.dateTo) { setError('Selecciona rango de fechas.'); return }
    if (period.dateFrom > period.dateTo) { setError('La fecha inicial no puede ser mayor a la final.'); return }
    setError(''); setLoading(true); setSelected(null); setSavedCode(null)
    try {
      const { data } = await supabase
        .from('stowage_transport_inspections')
        .select('id, formato_codigo, status, inspection_date, carrier_name, carrier_ruc, carrier_license, vehicle_brand, vehicle_plate, vehicle_condition, has_spare_tire, has_valid_soat, has_technical_review, has_first_aid_kit, has_fire_extinguisher, has_gps, has_cleaning_supplies, floors_clean, walls_clean, ceilings_clean, no_strange_odors, tarp_clean, pallets_clean, sack_clean_condition, sack_tied_condition, observations, exit_registration_id, exit_registrations(id, exit_code, exit_date, total_kg, document_number)')
        .eq('cooperative_id', COOPERATIVE.id)
        .gte('inspection_date', period.dateFrom).lte('inspection_date', period.dateTo)
        .order('inspection_date', { ascending: false })
      setInspections(data ?? [])
    } catch (e) { setError(e.message ?? 'Error al buscar') }
    finally { setLoading(false) }
  }

  async function selectInspection(insp) {
    setSelected(insp)
    setSavedCode(insp.formato_codigo ?? null)
    setSavedEmittedAt(null)
    setEmitError('')
    setLoadingItems(true)
    try {
      const exitRegId = insp.exit_registrations?.id ?? insp.exit_registration_id
      if (exitRegId) {
        const { data: items } = await supabase
          .from('exit_items')
          .select('id, quantity_kg, item_document_number, production_batches(batch_code, harvest_date, registered_by_user_id, producers(first_name, last_name))')
          .eq('exit_registration_id', exitRegId)
        setExitItems(items ?? [])
        if (!insp.formato_codigo) {
          const userIds = [...new Set((items ?? []).map(i => i.production_batches?.registered_by_user_id).filter(Boolean))]
          if (userIds.length) {
            const { data: users } = await supabase.from('users').select('user_id, first_name, last_name, role')
              .in('user_id', userIds).eq('cooperative_id', COOPERATIVE.id)
            setFirmantes((users ?? []).map((u, i) => ({
              nombre: `${u.first_name} ${u.last_name}`,
              cargo: u.role === 'admin_modulo' ? 'Administrador de Módulo' : 'Técnico de Campo',
              orden: i + 1, fuente: 'auto',
            })))
          } else setFirmantes([])
        }
      } else { setExitItems([]); setFirmantes([]) }
    } finally { setLoadingItems(false) }
  }

  async function handleEmit() {
    if (!selected) return
    setEmitting(true); setEmitError('')
    try {
      const { data, error: e } = await supabase.rpc('emit_formato_estiba_transporte', {
        p_coop_code:       getCoopCode(COOPERATIVE),
        p_cooperative_id:  COOPERATIVE.id,
        p_inspection_id:   selected.id,
        p_emitted_by:      webUser?.id ?? null,
        p_emitted_by_name: webUser ? `${webUser.first_name} ${webUser.last_name}` : null,
        p_firmantes:       firmantes,
      })
      if (e) throw e
      setSavedCode(data.formato_codigo)
      setSavedEmittedAt(new Date().toISOString())
      setInspections(prev => prev.map(i => i.id === selected.id ? { ...i, formato_codigo: data.formato_codigo, status: 'emitted' } : i))
      await loadHistorial()
    } catch (e) { setEmitError(e.message ?? 'Error al emitir') }
    finally { setEmitting(false) }
  }

  async function handleExportPdf(insp, items, fms, code, emAt) {
    setPdfGenerating(true); setPdfError('')
    try {
      const html = buildPrintHTMLEstiba(COOPERATIVE, code ?? '(borrador)', emAt, insp.exit_registrations, insp, items, fms)
      await downloadPdfDocument(html)
    } catch (e) { setPdfError(e.message ?? 'Error al generar el PDF') }
    finally { setPdfGenerating(false) }
  }

  async function loadInspectionData(id, exitRegId) {
    const [inspRes, itemsRes, fmtRes] = await Promise.all([
      supabase.from('stowage_transport_inspections').select('*, exit_registrations(id, exit_code, exit_date, total_kg, document_number)').eq('id', id).single(),
      supabase.from('exit_items').select('id, quantity_kg, item_document_number, production_batches(batch_code, harvest_date, producers(first_name, last_name))').eq('exit_registration_id', exitRegId ?? ''),
      supabase.from('stowage_transport_inspections').select('firmantes').eq('id', id).single(),
    ])
    return { insp: inspRes.data, items: itemsRes.data ?? [], firmantes: fmtRes.data?.firmantes ?? [] }
  }

  async function handleView(formato) {
    setViewing({ formato, data: null })
    const exitRegId = formato.exit_registrations?.id ?? formato.exit_registration_id
    const data = await loadInspectionData(formato.id, exitRegId)
    setViewing({ formato, data })
  }

  async function handleReprint(formato) {
    setReprinting(formato.id)
    try {
      const exitRegId = formato.exit_registrations?.id ?? formato.exit_registration_id
      const { insp, items, firmantes: fms } = await loadInspectionData(formato.id, exitRegId)
      const html = buildPrintHTMLEstiba(COOPERATIVE, formato.formato_codigo, formato.emitted_at, insp?.exit_registrations, insp, items, fms)
      openPrintWindow(html, formato.formato_codigo)
    } finally { setReprinting(null) }
  }

  return (
    <div>
      {/* ══ TÍTULO ════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>Formatos de Campo</h2>
          <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: BG, color: COLOR, border: `1px solid ${COLOR}` }}>FET</span>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Documentos de <strong>Inspección de Estiba y Transporte</strong> — uno por salida de campo.
        </p>
      </div>

      {view === 'historico' && (<>
      {/* ══ HISTORIAL ══════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 2px', fontSize: 16 }}>Historial — Estiba y Transporte</h3>
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
                <tr><th>Código</th><th>Salida</th><th>Transportista</th><th>Registrado por</th><th>Emitido por</th><th>Fecha emisión</th><th></th></tr>
              </thead>
              <tbody>
                {filteredHistorial.map(f => (
                  <tr key={f.id} style={f.formato_codigo === docFromUrl ? { background: '#fefce8', outline: '2px solid #facc15' } : {}}>
                    <td><strong style={{ fontFamily: 'monospace', fontSize: 13 }}>{f.formato_codigo}</strong></td>
                    <td style={{ fontSize: 12 }}>{f.exit_registrations?.exit_code ?? '—'} <span className="muted">({fmtDate(f.exit_registrations?.exit_date)})</span></td>
                    <td style={{ fontSize: 12 }}>{f.carrier_name} · {f.vehicle_plate}</td>
                    <td style={{ fontSize: 12 }}>{f.registered_by_user ? `${f.registered_by_user.first_name} ${f.registered_by_user.last_name}` : '—'}</td>
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
      {/* ══ GENERAR NUEVO ══════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Generar nuevo formato — Estiba y Transporte</h3>
          <p className="muted small" style={{ margin: 0 }}>Busca las inspecciones registradas en campo en el período.</p>
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
              <button key={opt.key} onClick={() => period.selectPreset(opt.key)} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: '1px solid',
                background:  period.preset === opt.key ? COLOR : '#fff',
                color:       period.preset === opt.key ? '#fff' : '#374151',
                borderColor: period.preset === opt.key ? COLOR  : '#d1d5db',
                fontWeight:  period.preset === opt.key ? 600    : 400,
              }}>{opt.label}</button>
            ))}
            {period.preset === 'custom' && (
              <>
                <DateInput className="input" value={period.dateFrom} onChange={e => { period.setDateFrom(e.target.value); setInspections(null); setSelected(null) }} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
                <span className="muted small">—</span>
                <DateInput className="input" value={period.dateTo} onChange={e => { period.setDateTo(e.target.value); setInspections(null); setSelected(null) }} style={{ fontSize: 12, padding: '4px 8px', height: 'auto' }} />
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn primary" onClick={handleSearch} disabled={loading}>{loading ? 'Buscando...' : 'Buscar inspecciones'}</button>
            {period.dateFrom && period.dateTo && <span className="muted small">{period.dateFrom} — {period.dateTo}</span>}
          </div>
          {error && <p style={{ color: '#dc2626', marginTop: 8, marginBottom: 0 }}>{error}</p>}
        </div>
      </div>

      {/* ── Lista de inspecciones encontradas ──────────────────────────── */}
      {inspections !== null && (
        <>
          {inspections.length === 0
            ? <EmptyState message="No hay inspecciones en este período." />
            : (
              <div style={{ marginBottom: 16 }}>
                <div className="muted small" style={{ marginBottom: 8 }}>{inspections.length} inspección{inspections.length !== 1 ? 'es' : ''} — haz clic para seleccionar</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {inspections.map(insp => {
                    const emitido = !!insp.formato_codigo
                    const isSel   = selected?.id === insp.id
                    return (
                      <div key={insp.id}
                        onClick={() => selectInspection(insp)}
                        style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${isSel ? COLOR : emitido ? '#86efac' : '#e2e8f0'}`, background: isSel ? BG : emitido ? '#f0fdf4' : '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ fontSize: 13 }}>{insp.exit_registrations?.exit_code ?? '—'}</strong>
                          <span className="muted small" style={{ marginLeft: 10 }}>Inspección: {fmtDate(insp.inspection_date)}</span>
                          <span className="muted small" style={{ marginLeft: 10 }}>{insp.carrier_name} · {insp.vehicle_plate}</span>
                        </div>
                        {emitido
                          ? <span style={{ fontSize: 11, padding: '2px 8px', background: '#dcfce7', color: '#15803d', borderRadius: 20, border: '1px solid #86efac', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={11} />{insp.formato_codigo}</span>
                          : isSel ? <span style={{ fontSize: 11, color: COLOR, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Seleccionado <Icon name="chevronDown" size={11} /></span>
                          : <span className="muted small">Seleccionar</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          }
        </>
      )}

      {/* ── Preview del seleccionado ──────────────────────────────────── */}
      {selected && (
        <div style={{ marginTop: 8 }}>
          {loadingItems ? <p className="muted">Cargando datos...</p> : (
            <>
              {/* Firmantes */}
              {!savedCode && (
                <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Firmantes del documento</div>
                      <div className="muted small">Detectados de los responsables de campo. Edita o agrega antes de emitir.</div>
                    </div>
                    <button className="btn small outline" onClick={addFirmante}>+ Agregar firmante</button>
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
                <button className="btn outline" onClick={() => handleExportPdf(selected, exitItems, firmantes, savedCode, savedEmittedAt)} disabled={pdfGenerating}>{pdfGenerating ? 'Generando...' : 'Exportar PDF'}</button>
              </div>
              {emitError && <p style={{ color: '#dc2626', marginBottom: 12 }}>{emitError}</p>}
              {pdfError && <p style={{ color: '#dc2626', marginBottom: 12 }}>{pdfError}</p>}

              {/* Vista previa */}
              <div className="card" style={{ padding: '16px 20px' }}>
                <div style={{ textAlign: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{COOPERATIVE?.name}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, textTransform: 'uppercase' }}>{FORMAT_TITLE_ESTIBA}</div>
                </div>

                {/* Datos generales */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 13, marginBottom: 16 }}>
                  <div><span style={{ fontWeight: 600 }}>Código:</span> <span style={{ fontFamily: 'monospace' }}>{savedCode ?? '(pendiente)'}</span></div>
                  <div><span style={{ fontWeight: 600 }}>Fecha emisión:</span> {savedEmittedAt ? new Date(savedEmittedAt).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '___/___/______'}</div>
                  <div><span style={{ fontWeight: 600 }}>N° Salida:</span> {selected.exit_registrations?.exit_code ?? '—'}</div>
                  <div><span style={{ fontWeight: 600 }}>Fecha salida:</span> {fmtDate(selected.exit_registrations?.exit_date)}</div>
                  <div><span style={{ fontWeight: 600 }}>Fecha inspección:</span> {fmtDate(selected.inspection_date)}</div>
                  <div><span style={{ fontWeight: 600 }}>Guía de remisión:</span> {selected.exit_registrations?.document_number ?? '—'}</div>
                  <div><span style={{ fontWeight: 600 }}>Transportista:</span> {selected.carrier_name}</div>
                  <div><span style={{ fontWeight: 600 }}>Vehículo:</span> {selected.vehicle_brand} · {selected.vehicle_plate}</div>
                  <div><span style={{ fontWeight: 600 }}>Estado:</span> <span style={{ color: selected.vehicle_condition === 'adequate' ? 'var(--success)' : '#dc2626', fontWeight: 700 }}>{selected.vehicle_condition === 'adequate' ? 'APTO' : 'NO APTO'}</span></div>
                  {selected.carrier_ruc && <div><span style={{ fontWeight: 600 }}>RUC:</span> {selected.carrier_ruc}</div>}
                  {selected.carrier_license && <div><span style={{ fontWeight: 600 }}>Licencia:</span> {selected.carrier_license}</div>}
                </div>

                {/* Checklists */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, color: '#000' }}>Checklist del vehículo</div>
                    <table className="formato-table">
                      <tbody>
                        {[['Llanta repuesto', selected.has_spare_tire], ['SOAT vigente', selected.has_valid_soat], ['Revisión técnica', selected.has_technical_review], ['Botiquín', selected.has_first_aid_kit], ['Extintor', selected.has_fire_extinguisher], ['GPS', selected.has_gps], ['Útiles limpieza', selected.has_cleaning_supplies]].map(([l, v]) => (
                          <tr key={l}><td>{l}</td><td style={chkCell(v)}><Icon name={v ? 'check' : 'x'} size={13} style={{ display: 'inline-block' }} /></td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, color: '#000' }}>Condiciones de limpieza</div>
                    <table className="formato-table" style={{ marginBottom: 12 }}>
                      <tbody>
                        {[['Piso limpio', selected.floors_clean], ['Paredes limpias', selected.walls_clean], ['Techo limpio', selected.ceilings_clean], ['Sin olores extraños', selected.no_strange_odors], ['Toldo limpio', selected.tarp_clean], ['Pallets limpios', selected.pallets_clean]].map(([l, v]) => (
                          <tr key={l}><td>{l}</td><td style={chkCell(v)}><Icon name={v ? 'check' : 'x'} size={13} style={{ display: 'inline-block' }} /></td></tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, color: '#000' }}>Condición de sacos</div>
                    <table className="formato-table">
                      <tbody>
                        <tr><td>Limpieza</td><td><strong>{selected.sack_clean_condition ?? '—'}</strong></td></tr>
                        <tr><td>Amarrado / cosido</td><td><strong>{selected.sack_tied_condition ?? '—'}</strong></td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Observaciones */}
                {selected.observations && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, color: '#000' }}>Observaciones</div>
                    <p style={{ margin: 0, fontSize: 13, color: '#000' }}>{selected.observations}</p>
                  </div>
                )}

                {/* Lotes de campo */}
                {exitItems.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, color: '#000' }}>Lotes de campo ({exitItems.length})</div>
                    <table className="formato-table">
                      <thead><tr><th>#</th><th>Lote</th><th>Productor</th><th>Kg</th></tr></thead>
                      <tbody>
                        {exitItems.map((ei, i) => (
                          <tr key={ei.id}>
                            <td style={{ textAlign: 'center' }}>{i + 1}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{ei.item_document_number ?? ei.production_batches?.batch_code ?? '—'}</td>
                            <td style={{ fontSize: 12 }}>{ei.production_batches?.producers ? `${ei.production_batches.producers.first_name} ${ei.production_batches.producers.last_name}` : '—'}</td>
                            <td style={{ textAlign: 'right', fontSize: 12 }}>{ei.quantity_kg ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Firmas preview */}
                <div className="formato-firmas" style={{ marginTop: 32 }}>
                  {firmantes.length > 0 ? firmantes.map((f, i) => (
                    <div key={i} className="firma-bloque">
                      <div className="firma-linea" />
                      <div className="firma-nombre">{f.nombre || '_______________________'}</div>
                      <div className="firma-cargo">{f.cargo || 'Responsable'}</div>
                    </div>
                  )) : (
                    <div className="firma-bloque">
                      <div className="firma-linea" /><div className="firma-nombre">_______________________</div><div className="firma-cargo">Responsable</div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
      </>)}

      {/* ══ MODAL VER FORMATO ════════════════════════════════════════════ */}
      {viewing && (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', overflowY: 'auto', padding: 0 }}>
          <div style={{ width: '100%', maxWidth: 900, margin: '0 auto', background: '#fff', minHeight: '100vh', padding: '28px 36px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div className="muted small" style={{ marginBottom: 2 }}>Inspección de Estiba y Transporte</div>
                <h2 style={{ margin: 0, fontFamily: 'monospace', fontSize: 20 }}>{viewing.formato.formato_codigo}</h2>
                <div className="muted small">
                  Salida: {viewing.formato.exit_registrations?.exit_code ?? '—'} · {viewing.formato.carrier_name} · {viewing.formato.vehicle_plate} · Emitido: {fmtDateTime(viewing.formato.emitted_at)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn small outline" onClick={() => handleReprint(viewing.formato)} disabled={reprinting === viewing.formato.id}>{reprinting === viewing.formato.id ? '...' : 'Imprimir'}</button>
                <button className="btn small" onClick={() => setViewing(null)}>Cerrar</button>
              </div>
            </div>

            {!viewing.data ? <SkeletonList count={3} lines={1} /> : (() => {
              const { insp, items, firmantes: fms } = viewing.data
              const f = viewing.formato
              return (
                <div className="formato-print">
                  <div className="formato-header">
                    <div style={{ textAlign: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{COOPERATIVE?.name}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, textTransform: 'uppercase' }}>{FORMAT_TITLE_ESTIBA}</div>
                    </div>
                    <div className="formato-meta">
                      <div><span className="meta-label">Código:</span> <strong style={{ fontFamily: 'monospace' }}>{f.formato_codigo}</strong></div>
                      <div><span className="meta-label">Fecha emisión:</span> {fmtDate(f.emitted_at)}</div>
                      <div><span className="meta-label">N° Salida:</span> {insp?.exit_registrations?.exit_code ?? '—'}</div>
                      <div><span className="meta-label">Fecha salida:</span> {fmtDate(insp?.exit_registrations?.exit_date)}</div>
                      <div><span className="meta-label">Fecha inspección:</span> {fmtDate(insp?.inspection_date)}</div>
                      <div><span className="meta-label">Guía de remisión:</span> {insp?.exit_registrations?.document_number ?? '—'}</div>
                      <div><span className="meta-label">Transportista:</span> {insp?.carrier_name}</div>
                      <div><span className="meta-label">Vehículo:</span> {insp?.vehicle_brand} · {insp?.vehicle_plate}</div>
                      <div><span className="meta-label">Estado:</span> <strong style={{ color: insp?.vehicle_condition === 'adequate' ? 'var(--success)' : '#dc2626' }}>{insp?.vehicle_condition === 'adequate' ? 'APTO' : 'NO APTO'}</strong></div>
                      {insp?.carrier_ruc && <div><span className="meta-label">RUC:</span> {insp.carrier_ruc}</div>}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, margin: '14px 0' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Checklist del vehículo</div>
                      <table className="formato-table">
                        <tbody>
                          {[['Llanta repuesto', insp?.has_spare_tire], ['SOAT vigente', insp?.has_valid_soat], ['Revisión técnica', insp?.has_technical_review], ['Botiquín', insp?.has_first_aid_kit], ['Extintor', insp?.has_fire_extinguisher], ['GPS', insp?.has_gps], ['Útiles limpieza', insp?.has_cleaning_supplies]].map(([l, v]) => (
                            <tr key={l}><td>{l}</td><td style={{ textAlign: 'center', color: v ? 'var(--success)' : '#dc2626', fontWeight: 700 }}><Icon name={v ? 'check' : 'x'} size={13} style={{ display: 'inline-block' }} /></td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Condiciones de limpieza</div>
                      <table className="formato-table" style={{ marginBottom: 12 }}>
                        <tbody>
                          {[['Piso limpio', insp?.floors_clean], ['Paredes limpias', insp?.walls_clean], ['Techo limpio', insp?.ceilings_clean], ['Sin olores extraños', insp?.no_strange_odors], ['Toldo limpio', insp?.tarp_clean], ['Pallets limpios', insp?.pallets_clean]].map(([l, v]) => (
                            <tr key={l}><td>{l}</td><td style={{ textAlign: 'center', color: v ? 'var(--success)' : '#dc2626', fontWeight: 700 }}><Icon name={v ? 'check' : 'x'} size={13} style={{ display: 'inline-block' }} /></td></tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Condición de sacos</div>
                      <table className="formato-table">
                        <tbody>
                          <tr><td>Limpieza</td><td><strong>{insp?.sack_clean_condition ?? '—'}</strong></td></tr>
                          <tr><td>Amarrado / cosido</td><td><strong>{insp?.sack_tied_condition ?? '—'}</strong></td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {insp?.observations && (
                    <div style={{ marginBottom: 14 }}>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>Observaciones: </span>
                      <span style={{ fontSize: 12 }}>{insp.observations}</span>
                    </div>
                  )}

                  {items.length > 0 && (
                    <>
                      <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, margin: '12px 0 6px' }}>Lotes de campo ({items.length})</div>
                      <table className="formato-table">
                        <thead><tr><th>#</th><th>Lote</th><th>Productor</th><th>Kg</th></tr></thead>
                        <tbody>
                          {items.map((ei, i) => (
                            <tr key={ei.id}>
                              <td style={{ textAlign: 'center' }}>{i + 1}</td>
                              <td style={{ fontFamily: 'monospace' }}>{ei.item_document_number ?? ei.production_batches?.batch_code ?? '—'}</td>
                              <td>{ei.production_batches?.producers ? `${ei.production_batches.producers.first_name} ${ei.production_batches.producers.last_name}` : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{ei.quantity_kg ?? '—'} kg</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  <div className="formato-firmas" style={{ marginTop: 32 }}>
                    {fms.length > 0 ? fms.map((fi, i) => (
                      <div key={i} className="firma-bloque">
                        <div className="firma-linea" /><div className="firma-nombre">{fi.nombre}</div><div className="firma-cargo">{fi.cargo}</div>
                      </div>
                    )) : <div className="firma-bloque"><div className="firma-linea" /><div className="firma-nombre">_______________________</div><div className="firma-cargo">Responsable</div></div>}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      <style>{`
        .formato-print { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: white; }
        .formato-header { border: 1px solid #333; padding: 10px 14px; margin-bottom: 8px; }
        .formato-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-top: 8px; font-size: 12px; }
        .meta-label { font-weight: 600; }
        .formato-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .formato-table th, .formato-table td { border: 1px solid #555; padding: 3px 5px; vertical-align: middle; }
        .formato-table th { background: #e8e8e8; font-weight: 700; font-size: 10px; text-align: center; }
        .formato-firmas { display: flex; gap: 40px; margin-top: 40px; flex-wrap: wrap; }
        .firma-bloque { flex: 1; min-width: 160px; text-align: center; }
        .firma-linea { border-top: 1px solid #333; margin-bottom: 4px; }
        .firma-nombre { font-weight: 600; font-size: 11px; }
        .firma-cargo { font-size: 10px; color: #555; }
      `}</style>
    </div>
  )
}
