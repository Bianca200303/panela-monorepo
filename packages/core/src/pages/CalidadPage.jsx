import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'
import { useConfirm } from '../hooks/useConfirm'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import SearchFilterBar from '../components/SearchFilterBar'
import DateInput from '../components/DateInput'
import Icon from '../components/Icon'

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const APPROVAL_LABELS = {
  aprobado: { text: 'Aprobado', className: 'tag ok' },
  rechazado: { text: 'Rechazado', className: 'tag error' },
  aprobado_con_observaciones: { text: 'Aprobado c/ obs.', className: 'tag warn' },
}

const SAVE_BUTTON_LABELS = {
  aprobado: 'Guardar aprobación',
  aprobado_con_observaciones: 'Guardar aprobación',
  rechazado: 'Guardar rechazo',
}

export default function CalidadPage() {
  const COOPERATIVE = useCooperative()
  const webUser = useAuthStore((s) => s.webUser)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [receptions, setReceptions] = useState([])
  const [kgUsedMap, setKgUsedMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Rechazo de calidad por lote
  const [approvalModal, setApprovalModal] = useState(null)
  const [rejectionEdits, setRejectionEdits] = useState([])
  const [savingApproval, setSavingApproval] = useState(false)

  // Filtros
  const [search,      setSearch]      = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [activeRange, setActiveRange] = useState(null) // 0 | 7 | 30 | null

  // Historial rápido de devoluciones -- solo consulta, sin emitir formato
  // (eso sigue viviendo en Reportes > Formatos > FQD).
  const [showDevoluciones, setShowDevoluciones]         = useState(false)
  const [devoluciones, setDevoluciones]                 = useState([])
  const [loadingDevoluciones, setLoadingDevoluciones]   = useState(false)
  const [devolucionesLoaded, setDevolucionesLoaded]     = useState(false)

  useEffect(() => { loadData() }, [])

  const toggleDevoluciones = async () => {
    const next = !showDevoluciones
    setShowDevoluciones(next)
    if (next && !devolucionesLoaded) {
      setLoadingDevoluciones(true)
      const { data } = await supabase
        .from('product_returns')
        .select(`
          id, production_batch_id, return_date, quantity_kg, quantity_sacks, return_reason, voided_at,
          production_batches ( batch_code, producers ( first_name, last_name ) )
        `)
        .eq('cooperative_id', COOPERATIVE.id)
        .order('return_date', { ascending: false })
      setDevoluciones(data ?? [])
      setDevolucionesLoaded(true)
      setLoadingDevoluciones(false)
    }
  }

  const loadData = async () => {
    setLoading(true)

    // Recepciones registradas con sus items
    const { data: receptionsData } = await supabase
      .from('exit_receptions')
      .select(`
        id, received_at, status,
        exit_registrations (
          id, exit_code, exit_date, total_kg, document_number,
          exit_items (
            id, quantity_kg, production_batch_id, item_document_number,
            production_batches (
              batch_code, harvest_date,
              producers ( first_name, last_name )
            )
          )
        ),
        exit_reception_items (
          id, exit_item_id, quantity_kg_received
        )
      `)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('received_at', { ascending: false })

    // Evaluaciones de calidad (se crean en la recepción, en RecepcionPage.jsx)
    const { data: evals } = await supabase
      .from('quality_evaluations')
      .select('id, exit_item_id, exit_reception_id, approval_status, rejected_kg, rejection_reason, product_return_id, humidity_pct, impurities_pct, color, sack_condition, appearance, notes, extra_data')
      .eq('cooperative_id', COOPERATIVE.id)

    // Kg ya comprometidos en homogeneizado, para saber cuánto queda libre para rechazar
    const { data: homoInputs } = await supabase
      .from('plant_homogenization_inputs')
      .select('source_exit_item_id, quantity_kg')
      .eq('cooperative_id', COOPERATIVE.id)

    const kgUsed = {}
    for (const h of (homoInputs ?? [])) {
      kgUsed[h.source_exit_item_id] = (kgUsed[h.source_exit_item_id] ?? 0) + Number(h.quantity_kg)
    }
    setKgUsedMap(kgUsed)

    const evalsByReception = {}
    for (const ev of (evals ?? [])) {
      if (!evalsByReception[ev.exit_reception_id]) evalsByReception[ev.exit_reception_id] = []
      evalsByReception[ev.exit_reception_id].push(ev)
    }

    setReceptions((receptionsData ?? []).map(r => ({ ...r, _evals: evalsByReception[r.id] || [] })))
    setLoading(false)
  }

  // ─── Rechazo de calidad por lote ────────────────────────────────────────────

  // Convierte una recepción (con sus items/evals anidados) en filas por lote individual.
  const buildLoteRows = (reception) => {
    const exitItems = reception.exit_registrations?.exit_items ?? []
    const evals = reception._evals ?? []
    return evals.map(ev => {
      const item = exitItems.find(it => it.id === ev.exit_item_id)
      const ri = reception.exit_reception_items?.find(r => r.exit_item_id === ev.exit_item_id)
      const receivedKg = Number(ri?.quantity_kg_received ?? item?.quantity_kg ?? 0)
      const kgUsed = kgUsedMap[ev.exit_item_id] ?? 0
      return {
        eval_id:              ev.id,
        exit_item_id:         ev.exit_item_id,
        reception_id:         reception.id,
        received_at:          reception.received_at,
        exit_code:            reception.exit_registrations?.exit_code ?? null,
        guia_remision:        reception.exit_registrations?.document_number ?? null,
        comprobante:          item?.item_document_number ?? null,
        production_batch_id:  item?.production_batch_id ?? null,
        batch_code:           item?.production_batches?.batch_code ?? '—',
        producer:             item?.production_batches?.producers
          ? `${item.production_batches.producers.first_name} ${item.production_batches.producers.last_name}`
          : '—',
        quantity_kg_received: receivedKg,
        kg_used:              kgUsed,
        kg_free:              Math.max(0, receivedKg - kgUsed), // lo que aún no fue a homogeneizado
        rejected_kg:          String(ev.rejected_kg ?? 0),
        rejection_reason:     ev.rejection_reason ?? '',
        notes:                ev.notes ?? '',
        approval_status:      ev.approval_status,
        product_return_id:    ev.product_return_id ?? null,
      }
    })
  }

  const todayStr = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const openApproval = (lote) => {
    setApprovalModal(lote)
    setError('')
    setRejectionEdits([{
      ...lote,
      status: lote.approval_status || 'aprobado',
      quantity_mode: 'kg', // 'kg' | 'sacos' -- solo aplica cuando status === 'rechazado'
      rejected_sacks: '0',
      return_date: todayStr(),
    }])
  }

  const updateRejectionEdit = (index, field, value) => {
    setRejectionEdits(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  // Al cambiar de estado, se limpian los campos que no aplican al nuevo estado
  // para no mandar al guardado datos de una selección anterior.
  const updateStatus = (index, status) => {
    setRejectionEdits(prev => prev.map((r, i) => {
      if (i !== index) return r
      if (status === 'rechazado') return { ...r, status, notes: '' }
      return { ...r, status, rejected_kg: '0', rejected_sacks: '0', quantity_mode: 'kg', rejection_reason: '' }
    }))
  }

  // Cambia el modo de captura del rechazo -- en 'sacos' se recalcula el kg
  // equivalente (1 saco = 50 kg, mismo criterio que usa la app móvil para
  // devoluciones); en 'kg' el número se carga directo.
  const updateQuantityMode = (index, mode) => {
    setRejectionEdits(prev => prev.map((r, i) => {
      if (i !== index) return r
      if (mode === 'sacos') {
        const sacks = parseInt(r.rejected_sacks, 10) || 0
        return { ...r, quantity_mode: mode, rejected_kg: String(sacks * 50) }
      }
      return { ...r, quantity_mode: mode }
    }))
  }

  const updateRejectedSacks = (index, sacks) => {
    setRejectionEdits(prev => prev.map((r, i) => {
      if (i !== index) return r
      const n = parseInt(sacks, 10)
      return { ...r, rejected_sacks: sacks, rejected_kg: Number.isFinite(n) && n > 0 ? String(n * 50) : '0' }
    }))
  }

  const discardWholeLote = async (index) => {
    const r = rejectionEdits[index]
    const usedNote = r.kg_used > 0
      ? ` (${r.kg_used} kg ya están en homogeneizado y no se pueden rechazar).`
      : '.'
    const loteRef = r.comprobante ? `lote con comprobante ${r.comprobante}` : 'este lote'
    const ok = await confirm({
      title: 'Descartar lote completo',
      message: `¿Descartar los ${r.kg_free} kg disponibles del ${loteRef}${usedNote}\n\nQuedará rechazado y no va a estar disponible para homogeneizado.`,
      confirmText: 'Descartar lote',
      danger: true,
    })
    if (!ok) return
    // El sobrante en kg libres no necesariamente cae en múltiplos exactos de
    // saco, así que este atajo siempre carga el rechazo en modo kg.
    setRejectionEdits(prev => prev.map((row, i) => i === index ? { ...row, rejected_kg: String(row.kg_free), quantity_mode: 'kg', rejected_sacks: '0' } : row))
  }

  const handleApproval = async () => {
    setError('')

    for (const r of rejectionEdits) {
      const kg = Number(r.rejected_kg)
      const ref = r.comprobante ?? r.batch_code
      if (r.status === 'rechazado') {
        if (r.rejected_kg === '' || isNaN(kg) || kg <= 0) {
          setError(`${ref}: indica los kg rechazados.`); return
        }
        if (kg > r.kg_free) {
          setError(`${ref}: no puede rechazar más de lo que queda libre (${r.kg_free} kg — ${r.kg_used} kg ya están en homogeneizado).`); return
        }
        if (!r.rejection_reason.trim()) {
          setError(`${ref}: indica el motivo del rechazo.`); return
        }
        if (!r.return_date) {
          setError(`${ref}: indica la fecha de devolución.`); return
        }
      } else if (r.status === 'aprobado_con_observaciones') {
        if (!r.notes.trim()) {
          setError(`${ref}: indica las observaciones.`); return
        }
      }
    }

    setSavingApproval(true)
    try {
      for (const r of rejectionEdits) {
        const payload = { approval_status: r.status }
        if (r.status === 'rechazado') {
          payload.rejected_kg      = Number(r.rejected_kg)
          payload.rejection_reason = r.rejection_reason.trim()
          payload.rejected_by      = webUser.id
          payload.notes            = null
        } else if (r.status === 'aprobado_con_observaciones') {
          payload.rejected_kg      = 0
          payload.rejection_reason = null
          payload.rejected_by      = null
          payload.notes            = r.notes.trim()
        } else {
          payload.rejected_kg      = 0
          payload.rejection_reason = null
          payload.rejected_by      = null
          payload.notes            = null
        }

        const { error: updateError } = await supabase
          .from('quality_evaluations')
          .update(payload)
          .eq('id', r.eval_id)
        if (updateError) throw new Error(`${r.comprobante ?? r.batch_code}: ${updateError.message}`)

        // Todo rechazo (total o parcial) de un lote de campo en Calidad
        // es, para este negocio, una devolución -- se registra en
        // product_returns para que aparezca en el historial de la app
        // móvil y pueda emitirse como formato FQD, sin pedirle al usuario
        // que lo cargue dos veces a mano. Por ahora el "cliente" es la
        // propia cooperativa (todavía no hay devolución de cliente final).
        //
        // Nunca se borra ni se pisa un rechazo anterior con datos nuevos
        // sin dejar rastro: si sigue "rechazado" y se está corrigiendo un
        // dato, se actualiza la MISMA devolución activa (mismo hecho). Si
        // se revierte el rechazo, la devolución vinculada se marca como
        // anulada (no se borra). Si más adelante se rechaza de nuevo, al
        // no haber ya una devolución activa vinculada, se crea una nueva
        // -- cada rechazo real queda como su propio hecho histórico.
        if (r.status === 'rechazado' && r.production_batch_id) {
          const returnPayload = {
            production_batch_id: r.production_batch_id,
            cooperative_id:       COOPERATIVE.id,
            client_name:          COOPERATIVE.name,
            return_date:          r.return_date,
            quantity_kg:          Number(r.rejected_kg),
            quantity_sacks:       r.quantity_mode === 'sacos' ? (parseInt(r.rejected_sacks, 10) || 0) : 0,
            return_reason:        r.rejection_reason.trim(),
          }

          // Se pregunta directo a la base si ya hay una devolución activa
          // para ESTE lote (no se confía en el product_return_id que viaja
          // en el estado del navegador -- si por lo que sea no se refrescó
          // a tiempo, terminaba duplicando en vez de actualizar).
          const { data: activeReturns } = await supabase
            .from('product_returns')
            .select('id')
            .eq('production_batch_id', r.production_batch_id)
            .eq('cooperative_id', COOPERATIVE.id)
            .is('voided_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
          const activeReturnId = activeReturns?.[0]?.id ?? null

          if (activeReturnId) {
            const { error: returnError } = await supabase
              .from('product_returns')
              .update(returnPayload)
              .eq('id', activeReturnId)
            if (returnError) throw new Error(`${r.comprobante ?? r.batch_code}: ${returnError.message}`)

            if (r.product_return_id !== activeReturnId) {
              await supabase.from('quality_evaluations').update({ product_return_id: activeReturnId }).eq('id', r.eval_id)
            }
          } else {
            const { data: newReturn, error: returnError } = await supabase
              .from('product_returns')
              .insert(returnPayload)
              .select('id')
              .single()
            if (returnError) throw new Error(`${r.comprobante ?? r.batch_code}: ${returnError.message}`)

            const { error: linkError } = await supabase
              .from('quality_evaluations')
              .update({ product_return_id: newReturn.id })
              .eq('id', r.eval_id)
            if (linkError) throw new Error(`${r.comprobante ?? r.batch_code}: ${linkError.message}`)
          }
        } else if (r.production_batch_id) {
          const { error: voidError } = await supabase
            .from('product_returns')
            .update({ voided_at: new Date().toISOString() })
            .eq('production_batch_id', r.production_batch_id)
            .eq('cooperative_id', COOPERATIVE.id)
            .is('voided_at', null)
          if (voidError) throw new Error(`${r.comprobante ?? r.batch_code}: ${voidError.message}`)
        }
      }

      setApprovalModal(null)
      loadData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingApproval(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  function matchesFilters(lote) {
    const receivedDate = lote.received_at ? lote.received_at.slice(0, 10) : null
    if (dateFrom && (!receivedDate || receivedDate < dateFrom)) return false
    if (dateTo   && (!receivedDate || receivedDate > dateTo))   return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const haystack = [lote.exit_code, lote.guia_remision, lote.comprobante, lote.batch_code, lote.producer]
        .filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  }

  function setQuickRange(days) {
    setActiveRange(days)
    if (days === null) { setDateFrom(''); setDateTo(''); return }
    const to = new Date()
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const from = new Date(to)
    from.setDate(from.getDate() - days)
    setDateFrom(fmt(from))
    setDateTo(fmt(to))
  }

  const filtersActive = search.trim() !== '' || dateFrom !== '' || dateTo !== ''
  const lotesFlat = receptions.flatMap(buildLoteRows)
  const sinRevisar = lotesFlat.filter(l => !l.approval_status).filter(matchesFilters)
  const revisadas  = lotesFlat.filter(l => !!l.approval_status).filter(matchesFilters)

  // Vista: la lista sigue trayendo el historial completo (incluye
  // anuladas, es el registro real) pero aquí solo se muestra el rechazo
  // vigente de cada lote -- las anuladas quedan en la base para auditoría,
  // simplemente no se listan en pantalla.
  const devolucionesVigentes = devoluciones.filter(d => !d.voided_at)

  // Para el historial de devoluciones: mismo criterio que en toda la app,
  // nunca mostrar el código interno del lote si hay comprobante de acopio.
  const comprobanteByBatchId = {}
  lotesFlat.forEach(l => { if (l.production_batch_id && l.comprobante) comprobanteByBatchId[l.production_batch_id] = l.comprobante })
  const guiaByBatchId = {}
  lotesFlat.forEach(l => { if (l.production_batch_id && l.guia_remision) guiaByBatchId[l.production_batch_id] = l.guia_remision })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Calidad — revisión de lotes</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            La condición del saco, humedad e impurezas ya se capturan al recepcionar. Aquí se revisa y, si corresponde, se rechazan kg por lote.
          </p>
        </div>
        <button className="btn small primary" onClick={toggleDevoluciones} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name={showDevoluciones ? 'chevronUp' : 'chevronDown'} size={14} />
          {showDevoluciones ? 'Ocultar devoluciones' : 'Historial de devoluciones'}
        </button>
      </div>

      {showDevoluciones && (
        <div className="card" style={{ marginTop: 16, marginBottom: 8 }}>
          <h4 style={{ margin: '0 0 4px' }}>Historial de devoluciones</h4>
          {loadingDevoluciones ? (
            <SkeletonList count={3} lines={1} />
          ) : devolucionesVigentes.length === 0 ? (
            <EmptyState message="Todavía no se registró ninguna devolución." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {devolucionesVigentes.map(d => {
                const pb = d.production_batches
                const producer = pb?.producers ? `${pb.producers.first_name} ${pb.producers.last_name}` : '—'
                const qtxt = d.quantity_sacks > 0 ? `${d.quantity_sacks} sacos (${Number(d.quantity_kg).toFixed(1)} kg)` : `${Number(d.quantity_kg).toFixed(1)} kg`
                return (
                  <div key={d.id} style={{
                    padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
                    background: '#fff',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6,
                  }}>
                    <div>
                      <strong style={{ fontSize: 13 }}>{producer}</strong>
                      <span className="muted small" style={{ marginLeft: 8, fontFamily: 'monospace' }}>G.R: {guiaByBatchId[d.production_batch_id] ?? '—'}</span>
                      <span style={{ marginLeft: 8, fontFamily: 'monospace', fontWeight: 700, color: 'var(--success)' }}>{comprobanteByBatchId[d.production_batch_id] ?? pb?.batch_code ?? '—'}</span>
                      <span className="muted small" style={{ marginLeft: 8 }}>{formatDate(d.return_date)} · {qtxt}</span>
                      {d.return_reason && <div className="muted small" style={{ marginTop: 2 }}>{d.return_reason}</div>}
                    </div>
                    <span className="tag dot error-tag" style={{ fontSize: 11 }}>Rechazado</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <SearchFilterBar
        search={search} onSearchChange={setSearch}
        searchPlaceholder="Código de salida, guía, productor, lote..."
        dateFrom={dateFrom} onDateFromChange={v => { setDateFrom(v); setActiveRange(null) }}
        dateTo={dateTo} onDateToChange={v => { setDateTo(v); setActiveRange(null) }}
        quickRanges={[{ days: 0, label: 'Hoy' }, { days: 7, label: '7 días' }, { days: 30, label: '30 días' }]}
        activeRange={activeRange} onQuickRange={setQuickRange}
        filtersActive={filtersActive} onClear={() => { setSearch(''); setQuickRange(null) }}
      />

      {loading ? (
        <div className="split">
          <SkeletonList count={2} />
          <SkeletonList count={2} />
        </div>
      ) : (
        <div className="split">
          {/* ── Sin revisar ── */}
          <div>
            <h3 style={{ margin: '0 0 12px' }}>
              Sin revisar
              <span className="tag warn" style={{ marginLeft: 8 }}>{sinRevisar.length}</span>
            </h3>
            {sinRevisar.length === 0 ? (
              <EmptyState message={filtersActive ? 'Ningún lote coincide con el filtro.' : 'No hay lotes sin revisar.'} />
            ) : (
              <div className="list">
                {sinRevisar.map(l => (
                  <div key={l.eval_id} className="item">
                    <header>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <strong style={l.guia_remision ? { fontFamily: 'monospace', color: '#000' } : { color: 'var(--warning)' }}>
                          {l.guia_remision ? `G.R: ${l.guia_remision}` : 'Sin G.R'}
                        </strong>
                        <strong style={l.comprobante ? { fontFamily: 'monospace', color: '#000', fontSize: 13 } : { color: 'var(--warning)', fontSize: 13 }}>
                          {l.comprobante ? `Comprobante: ${l.comprobante}` : 'Sin comprobante'}
                        </strong>
                      </div>
                      <span className="tag warn">Sin revisar</span>
                    </header>
                    <div className="meta" style={{ marginTop: 6 }}>
                      <div>{l.producer}</div>
                      <div>Recepcionado: {formatDate(l.received_at)} · {l.quantity_kg_received} kg</div>
                    </div>
                    <footer>
                      <button className="btn small primary" onClick={() => openApproval(l)}>
                        Revisar / Rechazar lote
                      </button>
                    </footer>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Revisadas ── */}
          <div>
            <h3 style={{ margin: '0 0 12px' }}>
              Revisadas
              <span className="tag ok" style={{ marginLeft: 8 }}>{revisadas.length}</span>
            </h3>
            {revisadas.length === 0 ? (
              <EmptyState message={filtersActive ? 'Ningún lote coincide con el filtro.' : 'Aún no hay lotes revisados.'} />
            ) : (
              <div className="list">
                {revisadas.map(l => {
                  const statusLabel = APPROVAL_LABELS[l.approval_status]
                  const isPartialRejection = l.approval_status === 'rechazado' && Number(l.rejected_kg) < l.quantity_kg_received
                  return (
                    <div key={l.eval_id} className="item">
                      <header>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <strong style={l.guia_remision ? { fontFamily: 'monospace', color: '#000' } : { color: 'var(--warning)' }}>
                            {l.guia_remision ? `G.R: ${l.guia_remision}` : 'Sin G.R'}
                          </strong>
                          <strong style={l.comprobante ? { fontFamily: 'monospace', color: '#000', fontSize: 13 } : { color: 'var(--warning)', fontSize: 13 }}>
                            {l.comprobante ? `Comprobante: ${l.comprobante}` : 'Sin comprobante'}
                          </strong>
                        </div>
                        <span className={isPartialRejection ? 'tag warn' : statusLabel.className}>
                          {isPartialRejection ? `Rechazo parcial (${Number(l.rejected_kg).toFixed(1)} kg)` : statusLabel.text}
                        </span>
                      </header>
                      <div className="meta" style={{ marginTop: 6 }}>
                        <div>{l.producer}</div>
                        <div>Recepcionado: {formatDate(l.received_at)} · {l.quantity_kg_received} kg</div>
                        {l.kg_used > 0 && (
                          <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 700 }}>
                            Ya se usaron {l.kg_used} kg de este lote en tamizado — la revisión ya no se puede editar.
                          </div>
                        )}
                      </div>
                      <footer>
                        <button
                          className="btn small outline"
                          onClick={() => openApproval(l)}
                          disabled={l.kg_used > 0}
                          title={l.kg_used > 0 ? 'No se puede editar: este lote ya se usó en tamizado' : undefined}
                        >
                          Editar revisión
                        </button>
                      </footer>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de rechazo por lote */}
      {approvalModal && (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', overflowY: 'auto', padding: '24px 0' }}>
          <div className="modal-content" style={{ maxWidth: 720 }}>
            <div className="modal-body">
              <h3 style={{ margin: '0 0 8px' }}>
                Revisión de calidad: lote {approvalModal.comprobante ?? approvalModal.batch_code}
              </h3>
              {approvalModal.guia_remision && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px', borderRadius: 8, marginBottom: 12,
                  background: 'rgba(15,76,92,0.10)', border: '1.5px solid var(--primary)',
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    Guía de remisión
                  </span>
                  <strong style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--primary-600)' }}>
                    {approvalModal.guia_remision}
                  </strong>
                </div>
              )}
              <p className="muted small" style={{ margin: '0 0 16px' }}>
                Elija el resultado de la revisión de este lote.
              </p>

              {rejectionEdits.map((r, i) => {
                const kg = Number(r.rejected_kg)
                const isFull = r.status === 'rechazado' && !isNaN(kg) && kg >= r.kg_free
                const remaining = !isNaN(kg) ? Math.max(0, r.kg_free - kg) : r.kg_free
                const borderColor = r.status === 'rechazado' ? '#dc2626' : r.status === 'aprobado_con_observaciones' ? 'var(--warning)' : 'var(--border)'
                return (
                  <div key={r.eval_id} style={{
                    border: `1.5px solid ${borderColor}`,
                    borderRadius: 10, overflow: 'hidden', marginBottom: 12,
                  }}>
                    <div style={{ background: 'rgba(15,76,92,0.10)', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <strong style={{ color: 'var(--primary-600)' }}>{r.producer}</strong>
                        {r.guia_remision && (
                          <span style={{ color: 'var(--primary-600)', marginLeft: 8, fontSize: 13 }}>
                            · Guía: <strong style={{ fontFamily: 'monospace' }}>{r.guia_remision}</strong>
                          </span>
                        )}
                        {r.comprobante && (
                          <span style={{ color: 'var(--primary-600)', marginLeft: 8, fontSize: 13 }}>
                            · Comprobante: <strong style={{ fontFamily: 'monospace' }}>{r.comprobante}</strong>
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 13, color: 'var(--primary-600)', fontWeight: 600 }}>
                        {r.quantity_kg_received} kg recibidos
                        {r.kg_used > 0 && <span style={{ fontWeight: 400 }}> · {r.kg_used} kg ya en homogeneizado</span>}
                      </span>
                    </div>

                    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                          Resultado
                        </label>
                        <select
                          className="input"
                          style={{ fontSize: 13, padding: '5px 8px', height: 'auto', width: 260 }}
                          value={r.status}
                          onChange={e => updateStatus(i, e.target.value)}
                        >
                          <option value="aprobado">Aprobado</option>
                          <option value="aprobado_con_observaciones">Aprobado con observaciones</option>
                          <option value="rechazado">Rechazado</option>
                        </select>
                      </div>

                      {r.status === 'aprobado_con_observaciones' && (
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: '#b45309', display: 'block', marginBottom: 4 }}>
                            Observaciones <span style={{ color: '#dc2626' }}>*</span>
                          </label>
                          <textarea
                            rows={2}
                            style={{ fontSize: 13 }}
                            value={r.notes}
                            onChange={e => updateRejectionEdit(i, 'notes', e.target.value)}
                            placeholder="Describe la observación..."
                          />
                        </div>
                      )}

                      {r.status === 'rechazado' && (
                        <div style={{
                          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
                          padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14,
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                            Paso 1 de 3 — Cantidad rechazada
                          </div>

                          {/* 1. Cuánto se rechaza */}
                          <div className="field" style={{ margin: 0 }}>
                            <label>¿En kg o en sacos?</label>
                            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                              <button type="button" className={`btn small ${r.quantity_mode === 'kg' ? 'primary' : 'outline'}`} onClick={() => updateQuantityMode(i, 'kg')}>Kilogramos</button>
                              <button type="button" className={`btn small ${r.quantity_mode === 'sacos' ? 'primary' : 'outline'}`} onClick={() => updateQuantityMode(i, 'sacos')}>Sacos</button>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              {r.quantity_mode === 'sacos' ? (
                                <input
                                  type="number" min="0" max={Math.floor(r.kg_free / 50)} step="1"
                                  style={{ maxWidth: 140 }}
                                  value={r.rejected_sacks}
                                  onChange={e => updateRejectedSacks(i, e.target.value)}
                                />
                              ) : (
                                <input
                                  type="number" min="0" max={r.kg_free} step="0.1"
                                  style={{ maxWidth: 140 }}
                                  value={r.rejected_kg}
                                  onChange={e => updateRejectionEdit(i, 'rejected_kg', e.target.value)}
                                />
                              )}
                              <button type="button" className="btn small outline" onClick={() => discardWholeLote(i)}>
                                Rechazar todo el lote ({r.kg_free.toFixed(1)} kg)
                              </button>
                            </div>
                            <p className="muted small" style={{ margin: '8px 0 0' }}>
                              {r.quantity_mode === 'sacos' && <>Equivalente: {r.rejected_kg} kg — </>}
                              Quedarían disponibles: <strong style={{ color: 'var(--success)' }}>{remaining.toFixed(1)} kg</strong>
                              {' '}<span className={isFull ? 'tag error-tag' : 'tag warn'} style={{ marginLeft: 4 }}>{isFull ? 'Rechazo total' : 'Rechazo parcial'}</span>
                            </p>
                          </div>

                          {/* 2. Cuándo se devuelve */}
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                            Paso 2 de 3 — Fecha de devolución
                          </div>
                          <div className="field" style={{ margin: 0, maxWidth: 200 }}>
                            <label>Fecha</label>
                            <DateInput value={r.return_date} onChange={e => updateRejectionEdit(i, 'return_date', e.target.value)} />
                          </div>

                          {/* 3. Por qué se rechaza */}
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                            Paso 3 de 3 — Motivo
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Motivo del rechazo <span style={{ color: '#dc2626' }}>*</span></label>
                            <textarea
                              rows={2}
                              value={r.rejection_reason}
                              onChange={e => updateRejectionEdit(i, 'rejection_reason', e.target.value)}
                              placeholder="Describe el motivo del rechazo..."
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{error}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => setApprovalModal(null)} disabled={savingApproval}>Cancelar</button>
              <button className="btn small primary" onClick={handleApproval} disabled={savingApproval}>
                {savingApproval ? 'Guardando...' : SAVE_BUTTON_LABELS[rejectionEdits[0]?.status] ?? 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  )
}
