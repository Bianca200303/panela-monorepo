import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'
import { pctToMgkg, mgkgToPct } from '../lib/loteHelpers'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Icon from '../components/Icon'
import SearchFilterBar from '../components/SearchFilterBar'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function comprobantesLabel(exitItems) {
  const comprobantes = [...new Set((exitItems ?? []).map(i => i.item_document_number).filter(Boolean))]
  if (comprobantes.length === 0) return 'Comprobante: —'
  if (comprobantes.length === 1) return `Comprobante: ${comprobantes[0]}`
  return `Comprobantes: ${comprobantes.join(', ')}`
}

const SACK_CONDITIONS = ['buena', 'regular', 'mala']
const APPEARANCES     = ['suelta', 'seca', 'cerosa']

export default function RecepcionPage() {
  const COOPERATIVE = useCooperative()
  const webUser = useAuthStore((s) => s.webUser)
  const [pendientes, setPendientes] = useState([])
  const [recibidas,  setRecibidas]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState(null)
  const [items,      setItems]      = useState([])
  const [notes,      setNotes]      = useState('')
  const [documentNumberEdit, setDocumentNumberEdit] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [receptionsMap, setReceptionsMap] = useState({})
  const [expandedIds,   setExpandedIds]   = useState(new Set())
  const [editingDocsId, setEditingDocsId] = useState(null)
  const [docsEdit,      setDocsEdit]      = useState({ documentNumber: '', items: {} })
  const [docsSaving,    setDocsSaving]    = useState(false)
  const [docsError,     setDocsError]     = useState('')
  const [kgUsedMap,     setKgUsedMap]     = useState({}) // exit_item_id -> kg ya usados en homogeneizado

  // Filtros
  const [search,      setSearch]      = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [activeRange, setActiveRange] = useState(null) // 0 | 7 | 30 | null
  const [onlyIncompletePendientes, setOnlyIncompletePendientes] = useState(false)
  const [onlyIncompleteRecibidas,  setOnlyIncompleteRecibidas]  = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: exits } = await supabase
      .from('exit_registrations')
      .select(`
        id, exit_code, exit_date, total_kg, document_number, destination,
        exit_items (
          id, quantity_kg, bags_count, item_document_number,
          production_batches (
            id, batch_code, harvest_date, process_date,
            plots ( code, name ),
            producers ( first_name, last_name, dni, coop_modules ( name ) )
          )
        )
      `)
      .eq('cooperative_id', COOPERATIVE.id)
      .ilike('destination', `%${COOPERATIVE.code}%`)
      .order('exit_date', { ascending: false })

    const { data: receptions } = await supabase
      .from('exit_receptions')
      .select(`
        id, exit_registration_id, received_at, notes, status,
        exit_reception_items ( id, exit_item_id, quantity_kg_sent, quantity_kg_received, discrepancy_reason, cert_status ),
        quality_evaluations ( id, exit_item_id, humidity_pct, impurities_pct, impurities_mgkg, sack_condition, appearance )
      `)
      .eq('cooperative_id', COOPERATIVE.id)

    const { data: homoInputs } = await supabase
      .from('plant_homogenization_inputs')
      .select('source_exit_item_id, quantity_kg')
      .eq('cooperative_id', COOPERATIVE.id)

    const kgUsed = {}
    for (const h of (homoInputs ?? [])) {
      kgUsed[h.source_exit_item_id] = (kgUsed[h.source_exit_item_id] ?? 0) + Number(h.quantity_kg)
    }
    setKgUsedMap(kgUsed)

    const receivedIds = new Set((receptions ?? []).map(r => r.exit_registration_id))
    const recMap = {}
    ;(receptions ?? []).forEach(r => { recMap[r.exit_registration_id] = r })

    const all = exits ?? []
    setPendientes(all.filter(e => !receivedIds.has(e.id)))
    // Recibidas se ordena por fecha de RECEPCIÓN (no por fecha de salida,
    // que es el orden que trae la consulta de exits) -- la recepción más
    // reciente primero.
    setRecibidas(
      all
        .filter(e => receivedIds.has(e.id))
        .sort((a, b) => (recMap[b.id]?.received_at ?? '').localeCompare(recMap[a.id]?.received_at ?? ''))
    )
    setReceptionsMap(recMap)
    setLoading(false)
  }

  function openModal(salida) {
    setSelected(salida)
    setNotes('')
    setError('')
    setDocumentNumberEdit(salida.document_number ?? '')
    setItems(salida.exit_items.map(item => {
      const pb  = item.production_batches
      const prod = pb?.producers
      return {
        exit_item_id:            item.id,
        // info (read-only)
        batch_code:              pb?.batch_code ?? '—',
        process_date:            pb?.process_date ?? pb?.harvest_date ?? null,
        producer:                prod ? `${prod.first_name} ${prod.last_name}` : '—',
        module:                  prod?.coop_modules?.name ?? '—',
        plot_code:               pb?.plots?.code ?? '—',
        bags_count:              item.bags_count ?? '—',
        quantity_kg_sent:        item.quantity_kg,
        // comprobante (editable, corrige lo capturado en móvil)
        comprobante_original:    item.item_document_number,
        comprobante_edit:        item.item_document_number ?? '',
        // recepción
        quantity_kg_received:    item.quantity_kg,
        discrepancy_reason:      '',
        // calidad
        sack_condition:          '',
        humidity_pct:            '',
        impurities_pct:          '',
        impurities_mgkg:         '',
        appearance:              '',
        // certificación
        cert_status:             '',
      }
    }))
  }

  function updateItem(i, field, value) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it))
  }

  function updateImpurezas(i, unit, value) {
    setItems(prev => prev.map((it, idx) => {
      if (idx !== i) return it
      return unit === 'pct'
        ? { ...it, impurities_pct: value, impurities_mgkg: pctToMgkg(value) }
        : { ...it, impurities_mgkg: value, impurities_pct: mgkgToPct(value) }
    }))
  }

  function matchesFilters(e) {
    if (dateFrom && e.exit_date < dateFrom) return false
    if (dateTo   && e.exit_date > dateTo)   return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const haystack = [
        e.exit_code,
        e.document_number,
        ...e.exit_items.flatMap(i => [
          i.production_batches?.batch_code,
          i.production_batches?.producers?.first_name,
          i.production_batches?.producers?.last_name,
          i.production_batches?.producers?.coop_modules?.name,
        ]),
      ].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  }

  // Falta guía de remisión (a nivel de la salida) o comprobante de acopio
  // (a nivel de alguno de sus lotes) -- se permite guardar así a propósito,
  // esto solo ayuda a encontrarlas después (tag + filtro). Aplica tanto a
  // pendientes como a recibidas, porque ambos datos se pueden completar en
  // cualquier momento (no dependen de haber recepcionado).
  function hasMissingDocs(e) {
    if (!e.document_number) return true
    return (e.exit_items ?? []).some(i => !i.item_document_number)
  }

  // Una GR recibida queda con datos de calidad faltantes cuando alguno de
  // sus lotes tiene humedad o impurezas sin registrar -- solo aplica a
  // recibidas, la calidad recién se carga al recepcionar.
  function hasMissingQuality(exitRegistrationId) {
    const reception = receptionsMap[exitRegistrationId]
    if (!reception) return false
    return (reception.quality_evaluations ?? []).some(q => q.humidity_pct == null || q.impurities_pct == null)
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

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function startEditDocs(salida) {
    const reception = receptionsMap[salida.id]
    const qualByItem = Object.fromEntries((reception?.quality_evaluations ?? []).map(q => [q.exit_item_id, q]))
    const riByItem   = Object.fromEntries((reception?.exit_reception_items ?? []).map(ri => [ri.exit_item_id, ri]))
    setDocsError('')
    setEditingDocsId(salida.id)
    setDocsEdit({
      documentNumber: salida.document_number ?? '',
      items: Object.fromEntries(salida.exit_items.map(it => {
        const qual = qualByItem[it.id]
        const ri   = riByItem[it.id]
        return [it.id, {
          comprobante:       it.item_document_number ?? '',
          kgRecibido:        ri ? String(ri.quantity_kg_received) : '',
          discrepancyReason: ri?.discrepancy_reason ?? '',
          sackCondition:     qual?.sack_condition ?? '',
          appearance:        qual?.appearance ?? '',
          humedad:           qual?.humidity_pct   != null ? String(qual.humidity_pct)   : '',
          impurezas:         qual?.impurities_pct != null ? String(qual.impurities_pct) : '',
          impurezasMgkg:     qual?.impurities_mgkg != null ? String(qual.impurities_mgkg) : '',
        }]
      })),
    })
    setExpandedIds(prev => new Set(prev).add(salida.id))
  }

  function cancelEditDocs() {
    setEditingDocsId(null)
    setDocsError('')
  }

  function updateItemEdit(itemId, field, value) {
    setDocsEdit(prev => ({ ...prev, items: { ...prev.items, [itemId]: { ...prev.items[itemId], [field]: value } } }))
  }

  function updateItemEditImpurezas(itemId, unit, value) {
    setDocsEdit(prev => ({
      ...prev,
      items: {
        ...prev.items,
        [itemId]: unit === 'pct'
          ? { ...prev.items[itemId], impurezas: value, impurezasMgkg: pctToMgkg(value) }
          : { ...prev.items[itemId], impurezasMgkg: value, impurezas: mgkgToPct(value) },
      },
    }))
  }

  async function saveEditDocs(salida) {
    setDocsError('')

    // Validar los lotes que todavía se pueden corregir
    for (const item of salida.exit_items) {
      if ((kgUsedMap[item.id] ?? 0) > 0) continue // ya usado, no se edita
      const edit = docsEdit.items[item.id]
      if (!edit) continue
      const ref = edit.comprobante || item.production_batches?.batch_code || ''
      if (edit.kgRecibido === '' || Number(edit.kgRecibido) < 0) {
        setDocsError(`Lote ${ref}: kg recibidos inválidos.`); return
      }
      const ri = receptionsMap[salida.id]?.exit_reception_items?.find(r => r.exit_item_id === item.id)
      if (Number(edit.kgRecibido) !== Number(ri?.quantity_kg_sent) && !edit.discrepancyReason.trim()) {
        setDocsError(`Lote ${ref}: hay discrepancia — indica el motivo.`); return
      }
      if (!edit.sackCondition) {
        setDocsError(`Lote ${ref}: selecciona la condición del saco.`); return
      }
      if (!edit.appearance) {
        setDocsError(`Lote ${ref}: selecciona el aspecto general.`); return
      }
    }

    setDocsSaving(true)
    try {
      const newDocNumber = docsEdit.documentNumber.trim() || null
      if (newDocNumber !== (salida.document_number ?? null)) {
        const { error } = await supabase
          .from('exit_registrations')
          .update({ document_number: newDocNumber })
          .eq('id', salida.id)
        if (error) throw error
      }

      const reception = receptionsMap[salida.id]
      const riByItem   = Object.fromEntries((reception?.exit_reception_items ?? []).map(ri => [ri.exit_item_id, ri]))
      const qualByItem = Object.fromEntries((reception?.quality_evaluations ?? []).map(q => [q.exit_item_id, q]))

      for (const item of salida.exit_items) {
        const edit = docsEdit.items[item.id]
        if (!edit) continue
        const locked = (kgUsedMap[item.id] ?? 0) > 0

        // Comprobante: documento, siempre editable
        const newComprobante = edit.comprobante.trim() || null
        if (newComprobante !== (item.item_document_number ?? null)) {
          const { error } = await supabase
            .from('exit_items')
            .update({ item_document_number: newComprobante })
            .eq('id', item.id)
          if (error) throw error
        }

        if (locked) continue // el resto solo se corrige mientras no se haya usado

        const ri = riByItem[item.id]
        if (ri) {
          const newKg     = Number(edit.kgRecibido)
          const newReason = newKg !== Number(ri.quantity_kg_sent) ? (edit.discrepancyReason.trim() || null) : null
          if (newKg !== Number(ri.quantity_kg_received) || newReason !== (ri.discrepancy_reason ?? null)) {
            const { error } = await supabase
              .from('exit_reception_items')
              .update({ quantity_kg_received: newKg, discrepancy_reason: newReason })
              .eq('id', ri.id)
            if (error) throw error
          }
        }

        const qual = qualByItem[item.id]
        if (qual) {
          const newHumedad       = edit.humedad       !== '' ? Number(edit.humedad)       : null
          const newImpurezas     = edit.impurezas     !== '' ? Number(edit.impurezas)     : null
          const newImpurezasMgkg = edit.impurezasMgkg !== '' ? Number(edit.impurezasMgkg) : null
          if (
            edit.sackCondition !== qual.sack_condition ||
            edit.appearance    !== qual.appearance ||
            newHumedad       !== (qual.humidity_pct ?? null) ||
            newImpurezas     !== (qual.impurities_pct ?? null) ||
            newImpurezasMgkg !== (qual.impurities_mgkg ?? null)
          ) {
            const { error } = await supabase
              .from('quality_evaluations')
              .update({
                sack_condition:  edit.sackCondition,
                appearance:      edit.appearance,
                humidity_pct:    newHumedad,
                impurities_pct:  newImpurezas,
                impurities_mgkg: newImpurezasMgkg,
              })
              .eq('id', qual.id)
            if (error) throw error
          }
        }
      }

      setEditingDocsId(null)
      await loadData()
    } catch (err) {
      setDocsError(err.message ?? 'Error al guardar')
    } finally {
      setDocsSaving(false)
    }
  }

  async function handleReceive() {
    setError('')
    for (const item of items) {
      const ref = item.comprobante_edit || item.batch_code
      if (item.quantity_kg_received === '' || Number(item.quantity_kg_received) < 0) {
        setError(`Lote ${ref}: kg recibidos inválidos.`); return
      }
      if (Number(item.quantity_kg_received) !== Number(item.quantity_kg_sent) && !item.discrepancy_reason.trim()) {
        setError(`Lote ${ref}: hay discrepancia — indica el motivo.`); return
      }
      if (!item.sack_condition) {
        setError(`Lote ${ref}: selecciona la condición del saco.`); return
      }
      if (!item.appearance) {
        setError(`Lote ${ref}: selecciona el aspecto general.`); return
      }
    }

    setSaving(true)
    try {
      // 1. Insertar recepción principal
      const { data: reception, error: e1 } = await supabase
        .from('exit_receptions')
        .insert({
          exit_registration_id: selected.id,
          cooperative_id:       COOPERATIVE.id,
          received_by:          webUser.id,
          notes:                notes || null,
          status:               'recepcionado',
        })
        .select('id').single()
      if (e1) throw e1

      // 2. Insertar items de recepción
      const { error: e2 } = await supabase
        .from('exit_reception_items')
        .insert(items.map(it => ({
          exit_reception_id:    reception.id,
          exit_item_id:         it.exit_item_id,
          quantity_kg_sent:     Number(it.quantity_kg_sent),
          quantity_kg_received: Number(it.quantity_kg_received),
          discrepancy_reason:   it.discrepancy_reason || null,
          cert_status:          it.cert_status.trim() || null,
        })))
      if (e2) throw e2

      // 3. Insertar evaluaciones de calidad (una por lote)
      const { error: e3 } = await supabase
        .from('quality_evaluations')
        .insert(items.map(it => ({
          exit_reception_id: reception.id,
          exit_item_id:      it.exit_item_id,
          cooperative_id:    COOPERATIVE.id,
          evaluated_by:      webUser.id,
          sack_condition:    it.sack_condition,
          appearance:        it.appearance,
          humidity_pct:      it.humidity_pct !== '' ? Number(it.humidity_pct) : null,
          impurities_pct:    it.impurities_pct !== '' ? Number(it.impurities_pct) : null,
          impurities_mgkg:   it.impurities_mgkg !== '' ? Number(it.impurities_mgkg) : null,
        })))
      if (e3) throw e3

      // 4. Actualizar guía de remisión si fue editada
      const newDocNumber = documentNumberEdit.trim() || null
      if (newDocNumber !== (selected.document_number ?? null)) {
        const { error: e4 } = await supabase
          .from('exit_registrations')
          .update({ document_number: newDocNumber })
          .eq('id', selected.id)
        if (e4) throw e4
      }

      // 5. Actualizar comprobantes de acopio que fueron ingresados o corregidos
      const toUpdateComprobante = items.filter(
        it => (it.comprobante_original ?? '') !== it.comprobante_edit.trim()
      )
      for (const it of toUpdateComprobante) {
        await supabase
          .from('exit_items')
          .update({ item_document_number: it.comprobante_edit.trim() || null })
          .eq('id', it.exit_item_id)
      }

      setSelected(null)
      loadData()
    } catch (err) {
      setError(err.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const filteredPendientes = pendientes.filter(matchesFilters).filter(e => !onlyIncompletePendientes || hasMissingDocs(e))
  const filteredRecibidas  = recibidas.filter(matchesFilters).filter(e => !onlyIncompleteRecibidas || hasMissingDocs(e) || hasMissingQuality(e.id))
  const filtersActive = search.trim() !== '' || dateFrom !== '' || dateTo !== ''

  return (
    <div>
      <h2 style={{ margin: '0 0 4px' }}>Recepción de materia prima</h2>
      <p className="muted small" style={{ margin: '0 0 24px' }}>
        Registra la llegada de lotes desde campo, verifica cantidades y condición de cada saco.
      </p>

      <SearchFilterBar
        search={search} onSearchChange={setSearch}
        searchPlaceholder="Código de salida, guía, productor, lote, módulo..."
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
          {/* ── Pendientes ── */}
          <div>
            <h3 style={{ margin: '0 0 12px' }}>
              Pendientes por recibir
              <span className="tag warn" style={{ marginLeft: 8 }}>{filteredPendientes.length}</span>
            </h3>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyIncompletePendientes} onChange={e => setOnlyIncompletePendientes(e.target.checked)} />
              Filtrar recepciones sin GR y comprobante de acopio
            </label>
            {filteredPendientes.length === 0 ? (
              <EmptyState message={filtersActive || onlyIncompletePendientes ? 'Ninguna salida coincide con el filtro.' : 'No hay salidas pendientes.'} />
            ) : (
              <div className="list">
                {filteredPendientes.map(e => {
                  const missingDocs = hasMissingDocs(e)
                  return (
                  <div key={e.id} className="item" style={missingDocs ? { borderLeft: '3px solid var(--warning)' } : undefined}>
                    <header>
                      <strong style={e.document_number ? undefined : { color: 'var(--warning)' }}>
                        {e.document_number ? `G.R: ${e.document_number}` : 'Sin G.R'}
                      </strong>
                      <span className="tag warn">Pendiente</span>
                      {missingDocs && (
                        <span className="tag warn" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="alertTriangle" size={12} /> Datos incompletos
                        </span>
                      )}
                    </header>
                    <div className="meta" style={{ marginTop: 6 }}>
                      <div>Fecha salida: {formatDate(e.exit_date)}</div>
                      <div>{e.exit_items.length} lote(s) · {e.total_kg} kg</div>
                      <div className="small" style={{ fontWeight: 600, color: 'var(--text)' }}>{comprobantesLabel(e.exit_items)}</div>
                      <div>
                        Módulos:{' '}
                        {[...new Set(e.exit_items
                          .map(i => i.production_batches?.producers?.coop_modules?.name)
                          .filter(Boolean)
                        )].join(', ') || '—'}
                      </div>
                    </div>
                    <footer>
                      <button className="btn small primary" onClick={() => openModal(e)}>
                        Recepcionar
                      </button>
                    </footer>
                  </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Recibidas ── */}
          <div>
            <h3 style={{ margin: '0 0 12px' }}>
              Recibidas
              <span className="tag ok" style={{ marginLeft: 8 }}>{filteredRecibidas.length}</span>
            </h3>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyIncompleteRecibidas} onChange={e => setOnlyIncompleteRecibidas(e.target.checked)} />
              Filtrar recepciones recibidas con datos incompletos
            </label>
            {filteredRecibidas.length === 0 ? (
              <EmptyState message={filtersActive || onlyIncompleteRecibidas ? 'Ninguna recepción coincide con el filtro.' : 'Aún no hay recepciones.'} />
            ) : (
              <div className="list">
                {filteredRecibidas.map(e => {
                  const reception = receptionsMap[e.id]
                  const isOpen    = expandedIds.has(e.id)
                  const isEditingDocs = editingDocsId === e.id
                  const exitItemsById = Object.fromEntries(e.exit_items.map(i => [i.id, i]))
                  const qualByItem    = {}
                  ;(reception?.quality_evaluations ?? []).forEach(q => { qualByItem[q.exit_item_id] = q })
                  const missingSomething = hasMissingDocs(e) || hasMissingQuality(e.id)

                  return (
                    <div key={e.id} className="item" style={missingSomething ? { borderLeft: '3px solid var(--warning)' } : undefined}>
                      <header>
                        <strong style={e.document_number ? undefined : { color: 'var(--warning)' }}>
                          {e.document_number ? `G.R: ${e.document_number}` : 'Sin G.R'}
                        </strong>
                        <span className="tag ok">Recibida</span>
                        {missingSomething && (
                          <span className="tag warn" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Icon name="alertTriangle" size={12} /> Datos incompletos
                          </span>
                        )}
                      </header>
                      <div className="meta" style={{ marginTop: 6 }}>
                        <div>Fecha salida: {formatDate(e.exit_date)}</div>
                        {reception?.received_at && <div>Recepcionada: <strong>{formatDate(reception.received_at)}</strong></div>}
                        <div>{e.exit_items.length} lote(s) · {e.total_kg} kg</div>
                        {isEditingDocs ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', flexWrap: 'wrap' }}>
                            <span style={{
                              fontSize: 11, fontWeight: 700, color: 'var(--primary)',
                              textTransform: 'uppercase', letterSpacing: 0.3,
                            }}>Guía de remisión</span>
                            <input
                              className="input"
                              style={{
                                fontSize: 13, padding: '5px 8px', height: 'auto', flex: '1 1 140px', minWidth: 0,
                                fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary-600)',
                                border: '1.5px solid var(--primary)', background: 'rgba(15,76,92,0.10)',
                              }}
                              placeholder="N° de guía"
                              value={docsEdit.documentNumber}
                              onChange={ev => setDocsEdit(prev => ({ ...prev, documentNumber: ev.target.value }))}
                            />
                          </div>
                        ) : (
                          <div className="small" style={{ fontWeight: 600, color: 'var(--text)' }}>{comprobantesLabel(e.exit_items)}</div>
                        )}
                        <div>
                          Módulos:{' '}
                          {[...new Set(e.exit_items
                            .map(i => i.production_batches?.producers?.coop_modules?.name)
                            .filter(Boolean)
                          )].join(', ') || '—'}
                        </div>
                      </div>

                      <footer style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="btn small outline" style={{ flex: '1 1 auto', whiteSpace: 'normal', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }} onClick={() => toggleExpand(e.id)}>
                          <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={13} />
                          {isOpen ? 'Ocultar detalle' : 'Ver detalle'}
                        </button>
                        {isEditingDocs ? (
                          <>
                            <button className="btn small primary" style={{ flex: '1 1 auto', whiteSpace: 'normal' }} onClick={() => saveEditDocs(e)} disabled={docsSaving}>
                              {docsSaving ? 'Guardando...' : 'Guardar'}
                            </button>
                            <button className="btn small" style={{ flex: '1 1 auto', whiteSpace: 'normal' }} onClick={cancelEditDocs} disabled={docsSaving}>
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button className="btn small outline" style={{ flex: '1 1 auto', whiteSpace: 'normal' }} onClick={() => startEditDocs(e)}>
                            Editar datos
                          </button>
                        )}
                      </footer>
                      {isEditingDocs && docsError && (
                        <p style={{ color: '#dc2626', fontSize: 12, margin: '8px 0 0', padding: '6px 10px', background: '#fee2e2', borderRadius: 6, border: '1px solid #fca5a5' }}>
                          {docsError}
                        </p>
                      )}

                      {isOpen && reception && (
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {(reception.exit_reception_items ?? []).map(ri => {
                            const exitItem = exitItemsById[ri.exit_item_id]
                            const pb      = exitItem?.production_batches
                            const prod    = pb?.producers
                            const qual    = qualByItem[ri.exit_item_id]
                            const hasDiff = Number(ri.quantity_kg_received) !== Number(ri.quantity_kg_sent)
                            const cap     = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'
                            const kgUsed  = kgUsedMap[ri.exit_item_id] ?? 0
                            const locked  = kgUsed > 0
                            const edit    = docsEdit.items[ri.exit_item_id] ?? {}
                            const editHasDiff = edit.kgRecibido !== '' && edit.kgRecibido != null && Number(edit.kgRecibido) !== Number(ri.quantity_kg_sent)
                            const showReadOnlyQuality = !isEditingDocs || locked
                            return (
                              <div key={ri.exit_item_id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', fontSize: 12 }}>

                                {/* Cabecera lote */}
                                <div style={{ background: 'rgba(15,76,92,0.10)', padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
                                  <strong style={{ fontFamily: 'monospace', color: 'var(--primary-600)' }}>{exitItem?.item_document_number ?? pb?.batch_code ?? '—'}</strong>
                                  {prod?.coop_modules?.name && <span style={{ color: 'var(--primary-600)' }}>· {prod.coop_modules.name}</span>}
                                </div>

                                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>

                                  {/* Origen */}
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '2px 16px' }}>
                                    <div><span style={{ fontWeight: 600, color: '#000' }}>Productor: </span>{prod ? `${prod.first_name} ${prod.last_name}` : '—'}</div>
                                    <div><span style={{ fontWeight: 600, color: '#000' }}>Parcela: </span>{pb?.plots?.code ?? '—'}</div>
                                    {!isEditingDocs && (
                                      exitItem?.item_document_number
                                        ? <div><span style={{ fontWeight: 600, color: '#000' }}>Comprobante: </span>{exitItem.item_document_number}</div>
                                        : <div><span style={{ fontWeight: 600, color: '#000' }}>Comprobante: </span><span style={{ color: 'var(--warning)' }}>sin registrar</span></div>
                                    )}
                                  </div>

                                  {/* Edición: comprobante siempre editable; el resto solo si aún no se usó */}
                                  {isEditingDocs && (
                                    <div style={{
                                      display: 'flex', flexDirection: 'column', gap: 10,
                                      padding: '8px 10px', background: 'rgba(15,76,92,0.10)', border: '1.5px solid var(--primary)', borderRadius: 8,
                                    }}>
                                      {locked && (
                                        <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
                                          Ya se usaron {kgUsed.toFixed(1)} kg de este lote en homogeneizado — solo se puede corregir el comprobante.
                                        </div>
                                      )}
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                                        <div>
                                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', display: 'block', marginBottom: 4 }}>
                                            Comprobante de acopio
                                          </label>
                                          <input
                                            className="input"
                                            style={{ fontSize: 12, padding: '5px 8px', height: 'auto', width: '100%', fontFamily: 'monospace', color: 'var(--primary-600)' }}
                                            placeholder="N° comprobante"
                                            value={edit.comprobante ?? ''}
                                            onChange={ev => updateItemEdit(ri.exit_item_id, 'comprobante', ev.target.value)}
                                          />
                                        </div>

                                        {!locked && (
                                          <>
                                            <div>
                                              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', display: 'block', marginBottom: 4 }}>
                                                Kg recibidos <span style={{ color: '#dc2626' }}>*</span>
                                              </label>
                                              <input
                                                type="number" min="0" step="0.1"
                                                className="input"
                                                style={{ fontSize: 12, padding: '5px 8px', height: 'auto', width: '100%', color: 'var(--primary-600)' }}
                                                value={edit.kgRecibido ?? ''}
                                                onChange={ev => updateItemEdit(ri.exit_item_id, 'kgRecibido', ev.target.value)}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', display: 'block', marginBottom: 4 }}>
                                                Condición del saco <span style={{ color: '#dc2626' }}>*</span>
                                              </label>
                                              <select
                                                className="input"
                                                style={{ fontSize: 12, padding: '5px 8px', height: 'auto', width: '100%', color: 'var(--primary-600)' }}
                                                value={edit.sackCondition ?? ''}
                                                onChange={ev => updateItemEdit(ri.exit_item_id, 'sackCondition', ev.target.value)}
                                              >
                                                <option value="">Seleccionar...</option>
                                                {SACK_CONDITIONS.map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
                                              </select>
                                            </div>
                                            <div>
                                              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', display: 'block', marginBottom: 4 }}>
                                                Aspecto general <span style={{ color: '#dc2626' }}>*</span>
                                              </label>
                                              <select
                                                className="input"
                                                style={{ fontSize: 12, padding: '5px 8px', height: 'auto', width: '100%', color: 'var(--primary-600)' }}
                                                value={edit.appearance ?? ''}
                                                onChange={ev => updateItemEdit(ri.exit_item_id, 'appearance', ev.target.value)}
                                              >
                                                <option value="">Seleccionar...</option>
                                                {APPEARANCES.map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
                                              </select>
                                            </div>
                                            <div>
                                              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', display: 'block', marginBottom: 4 }}>
                                                Humedad (%)
                                              </label>
                                              <input
                                                type="number" min="0" max="100" step="0.01"
                                                className="input"
                                                style={{ fontSize: 12, padding: '5px 8px', height: 'auto', width: '100%', color: 'var(--primary-600)' }}
                                                placeholder="0.00"
                                                value={edit.humedad ?? ''}
                                                onChange={ev => updateItemEdit(ri.exit_item_id, 'humedad', ev.target.value)}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', display: 'block', marginBottom: 4 }}>
                                                Impurezas (%)
                                              </label>
                                              <input
                                                type="number" min="0" step="0.0001"
                                                className="input"
                                                style={{ fontSize: 12, padding: '5px 8px', height: 'auto', width: '100%', color: 'var(--primary-600)' }}
                                                placeholder="0.00"
                                                value={edit.impurezas ?? ''}
                                                onChange={ev => updateItemEditImpurezas(ri.exit_item_id, 'pct', ev.target.value)}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', display: 'block', marginBottom: 4 }}>
                                                Impurezas (mg/kg)
                                              </label>
                                              <input
                                                type="number" min="0" step="0.01"
                                                className="input"
                                                style={{ fontSize: 12, padding: '5px 8px', height: 'auto', width: '100%', color: 'var(--primary-600)' }}
                                                placeholder="0.00"
                                                value={edit.impurezasMgkg ?? ''}
                                                onChange={ev => updateItemEditImpurezas(ri.exit_item_id, 'mgkg', ev.target.value)}
                                              />
                                            </div>
                                          </>
                                        )}
                                      </div>

                                      {!locked && editHasDiff && (
                                        <div>
                                          <label style={{ fontSize: 11, fontWeight: 700, color: '#b45309', display: 'block', marginBottom: 4 }}>
                                            Motivo discrepancia <span style={{ color: '#dc2626' }}>*</span>
                                          </label>
                                          <input
                                            type="text" className="input"
                                            style={{ fontSize: 12, padding: '5px 8px', height: 'auto', width: '100%' }}
                                            placeholder="Explica la diferencia de kilos"
                                            value={edit.discrepancyReason ?? ''}
                                            onChange={ev => updateItemEdit(ri.exit_item_id, 'discrepancyReason', ev.target.value)}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Recepción */}
                                  <div style={{ paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                                    <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', marginBottom: 4, color: '#000' }}>Recepción</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '2px 16px' }}>
                                      <div><span style={{ fontWeight: 600, color: '#000' }}>Enviados: </span>{ri.quantity_kg_sent} kg</div>
                                      <div>
                                        <span style={{ fontWeight: 600, color: hasDiff ? '#b45309' : '#000' }}>Recibidos: </span>
                                        <span style={{ color: hasDiff ? '#b45309' : '#000', fontWeight: hasDiff ? 700 : 400 }}>{ri.quantity_kg_received} kg</span>
                                      </div>
                                      {hasDiff && (
                                        <div style={{ color: '#b45309', fontWeight: 600 }}>
                                          {Number(ri.quantity_kg_received) > Number(ri.quantity_kg_sent) ? 'Sobran ' : 'Faltan '}
                                          {Math.abs(Number(ri.quantity_kg_sent) - Number(ri.quantity_kg_received)).toFixed(1)} kg
                                        </div>
                                      )}
                                    </div>
                                    {hasDiff && ri.discrepancy_reason && (
                                      <div style={{ marginTop: 3, color: '#b45309' }}>
                                        <span style={{ fontWeight: 600 }}>Motivo: </span>{ri.discrepancy_reason}
                                      </div>
                                    )}
                                  </div>

                                  {/* Calidad */}
                                  {qual && showReadOnlyQuality && (
                                    <div style={{ paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                                      <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', marginBottom: 4, color: '#000' }}>Calidad</div>
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '2px 16px' }}>
                                        <div><span style={{ fontWeight: 600, color: '#000' }}>Cond. saco: </span>{cap(qual.sack_condition)}</div>
                                        <div><span style={{ fontWeight: 600, color: '#000' }}>Aspecto: </span>{cap(qual.appearance)}</div>
                                        {qual.humidity_pct != null
                                          ? <div><span style={{ fontWeight: 600, color: '#000' }}>Humedad: </span>{qual.humidity_pct}%</div>
                                          : <div><span style={{ fontWeight: 600, color: '#000' }}>Humedad: </span><span style={{ color: 'var(--warning)' }}>sin registrar</span></div>
                                        }
                                        {qual.impurities_pct != null
                                          ? <div><span style={{ fontWeight: 600, color: '#000' }}>Impurezas: </span>{qual.impurities_pct}%</div>
                                          : <div><span style={{ fontWeight: 600, color: '#000' }}>Impurezas: </span><span style={{ color: 'var(--warning)' }}>sin registrar</span></div>
                                        }
                                        {COOPERATIVE?.features?.certificacion && ri.cert_status && <div><span style={{ fontWeight: 600, color: '#000' }}>Status certif.: </span>{ri.cert_status}</div>}
                                      </div>
                                    </div>
                                  )}

                                </div>
                              </div>
                            )
                          })}
                          {reception.notes && (
                            <div style={{ fontSize: 12, color: '#000', padding: '6px 10px', background: '#fffbeb', border: '1px solid #fef08a', borderRadius: 6 }}>
                              <span style={{ fontWeight: 600 }}>Observaciones: </span>{reception.notes}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ Modal de recepción ══════════════════════════════════════════════ */}
      {selected && (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', overflowY: 'auto', padding: '24px 0' }}>
          <div style={{ width: '100%', maxWidth: 860, margin: '0 auto', background: '#fff', borderRadius: 12, boxShadow: '0 8px 40px #0002' }}>

            {/* Cabecera */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="muted small" style={{ marginBottom: 2 }}>Recepcionar salida</div>
                  <h3 style={{ margin: '0 0 8px', fontSize: 20 }}>
                    {selected.document_number ? `G.R: ${selected.document_number}` : 'Sin G.R'}
                  </h3>
                  <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                    <span>Fecha de salida: <strong>{formatDate(selected.exit_date)}</strong></span>
                    <span>Total enviado: <strong>{selected.total_kg} kg</strong></span>
                  </div>

                  {/* Guía de remisión — destacada */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(15,76,92,0.10)', border: '1.5px solid var(--primary)',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
                      Guía de remisión
                    </span>
                    <input
                      className="input"
                      style={{
                        fontSize: 14, padding: '6px 10px', height: 'auto', width: 200,
                        fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary-600)',
                        background: '#fff', border: '1.5px solid var(--primary)',
                      }}
                      placeholder="N° de guía"
                      value={documentNumberEdit}
                      onChange={e => setDocumentNumberEdit(e.target.value)}
                    />
                  </div>
                </div>
                <button className="btn small" onClick={() => setSelected(null)} disabled={saving}>✕</button>
              </div>
            </div>

            {/* Lotes */}
            <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {items.map((item, i) => {
                const hasDiff = Number(item.quantity_kg_received) !== Number(item.quantity_kg_sent)
                return (
                  <div key={item.exit_item_id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>

                    {/* Info del lote */}
                    <div style={{ background: 'rgba(15,76,92,0.10)', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary-600)' }}>Lote</span>
                        <strong style={{ fontFamily: 'monospace', color: 'var(--primary-600)' }}>{item.comprobante_edit || item.batch_code}</strong>
                        <span style={{ color: 'var(--primary-600)' }}>·</span>
                        <span style={{ color: 'var(--primary-600)' }}>{item.module}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--text)', flexWrap: 'wrap' }}>
                        <span><span style={{ color: 'var(--muted)' }}>Productor: </span>{item.producer}</span>
                        <span><span style={{ color: 'var(--muted)' }}>Parcela: </span>{item.plot_code}</span>
                        <span><span style={{ color: 'var(--muted)' }}>F. producción: </span>{formatDate(item.process_date)}</span>
                        <span><span style={{ color: 'var(--muted)' }}>Sacos: </span><strong>{item.bags_count}</strong></span>
                        <span><span style={{ color: 'var(--muted)' }}>Kg enviados: </span><strong>{item.quantity_kg_sent}</strong></span>
                      </div>
                    </div>

                    {/* Campos editables */}
                    <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>

                      {/* Comprobante de acopio */}
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                          Comprobante de acopio
                          {item.comprobante_original && <span className="tag ok" style={{ marginLeft: 6, fontSize: 10 }}>registrado</span>}
                          {!item.comprobante_original && <span className="tag warn" style={{ marginLeft: 6, fontSize: 10 }}>pendiente</span>}
                        </label>
                        <input
                          className="input"
                          style={{ fontSize: 12, padding: '5px 8px', height: 'auto' }}
                          placeholder="Ingresar N° comprobante"
                          value={item.comprobante_edit}
                          onChange={e => updateItem(i, 'comprobante_edit', e.target.value)}
                        />
                      </div>

                      {/* Kg recibidos */}
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                          Kg recibidos <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        <input
                          type="number" min="0" step="0.1" className="input"
                          style={{ fontSize: 12, padding: '5px 8px', height: 'auto' }}
                          value={item.quantity_kg_received}
                          onChange={e => updateItem(i, 'quantity_kg_received', e.target.value)}
                        />
                        {hasDiff && (
                          <div style={{ fontSize: 11, color: '#b45309', marginTop: 3 }}>
                            {Number(item.quantity_kg_received) > Number(item.quantity_kg_sent) ? 'Sobran ' : 'Faltan '}
                            {Math.abs(Number(item.quantity_kg_sent) - Number(item.quantity_kg_received)).toFixed(1)} kg
                          </div>
                        )}
                      </div>

                      {/* Motivo discrepancia */}
                      {hasDiff && (
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={{ fontSize: 11, fontWeight: 600, color: '#b45309', display: 'block', marginBottom: 4 }}>
                            Motivo discrepancia <span style={{ color: '#dc2626' }}>*</span>
                          </label>
                          <input
                            type="text" className="input"
                            style={{ fontSize: 12, padding: '5px 8px', height: 'auto', width: '100%' }}
                            placeholder="Explica la diferencia de kilos"
                            value={item.discrepancy_reason}
                            onChange={e => updateItem(i, 'discrepancy_reason', e.target.value)}
                          />
                        </div>
                      )}

                      {/* Condición del saco */}
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                          Condición del saco <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        <select
                          className="input"
                          style={{ fontSize: 12, padding: '5px 8px', height: 'auto' }}
                          value={item.sack_condition}
                          onChange={e => updateItem(i, 'sack_condition', e.target.value)}
                        >
                          <option value="">Seleccionar...</option>
                          {SACK_CONDITIONS.map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
                        </select>
                      </div>

                      {/* Aspecto general */}
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                          Aspecto general <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        <select
                          className="input"
                          style={{ fontSize: 12, padding: '5px 8px', height: 'auto' }}
                          value={item.appearance}
                          onChange={e => updateItem(i, 'appearance', e.target.value)}
                        >
                          <option value="">Seleccionar...</option>
                          {APPEARANCES.map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
                        </select>
                      </div>

                      {/* Humedad */}
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                          Humedad (%)
                        </label>
                        <input
                          type="number" min="0" max="100" step="0.01" className="input"
                          style={{ fontSize: 12, padding: '5px 8px', height: 'auto' }}
                          placeholder="0.00"
                          value={item.humidity_pct}
                          onChange={e => updateItem(i, 'humidity_pct', e.target.value)}
                        />
                      </div>

                      {/* Impurezas -- % y mg/kg sincronizados: se puede cargar cualquiera
                          de los dos y el otro se completa solo por conversión (1% = 10000 mg/kg) */}
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                          Impurezas (%)
                        </label>
                        <input
                          type="number" min="0" step="0.0001" className="input"
                          style={{ fontSize: 12, padding: '5px 8px', height: 'auto' }}
                          placeholder="0.00"
                          value={item.impurities_pct}
                          onChange={e => updateImpurezas(i, 'pct', e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                          Impurezas (mg/kg)
                        </label>
                        <input
                          type="number" min="0" step="0.01" className="input"
                          style={{ fontSize: 12, padding: '5px 8px', height: 'auto' }}
                          placeholder="0.00"
                          value={item.impurities_mgkg}
                          onChange={e => updateImpurezas(i, 'mgkg', e.target.value)}
                        />
                      </div>

                      {/* Status de certificación -- solo Norandino, CAES no lo usa */}
                      {COOPERATIVE?.features?.certificacion && (
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                            Status certificación
                          </label>
                          <input
                            type="text" className="input"
                            style={{ fontSize: 12, padding: '5px 8px', height: 'auto' }}
                            placeholder="Ej: Vigente, En proceso, Suspendida..."
                            value={item.cert_status}
                            onChange={e => updateItem(i, 'cert_status', e.target.value)}
                          />
                        </div>
                      )}

                    </div>
                  </div>
                )
              })}
            </div>

            {/* Observaciones + acciones */}
            <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Observaciones generales <span className="muted small">(opcional)</span></label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Condición general del envío, incidencias, etc."
                />
              </div>

              {error && (
                <p style={{ color: '#dc2626', fontSize: 13, margin: 0, padding: '8px 12px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca' }}>
                  {error}
                </p>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn small" onClick={() => setSelected(null)} disabled={saving}>
                  Cancelar
                </button>
                <button className="btn small primary" onClick={handleReceive} disabled={saving}>
                  {saving ? 'Guardando...' : 'Confirmar recepción'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
