import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Icon from '../components/Icon'
import { useConfirm } from '../hooks/useConfirm'

// Gestión de cupos de producción certificada por productor (requisito de la
// certificadora orgánica): cuánta panela con una certificación dada puede
// producir/vender un productor por año. El modelo de datos y el cálculo de
// consumo (producer_quotas + get_producer_quotas_by_year /
// get_producer_quota_statuses) ya existían para la app móvil -- esta página
// es la primera gestión desde el web, por eso restringida a admin_web
// (ver AdminRoute en App.jsx y la migración 20260806100000 que cerró la
// escritura de producer_quotas al rol admin).

const emptyForm = { quotaId: null, producerId: '', producerName: '', coopModuleId: '', certId: '', cupoKg: '', notes: '' }

function currentYear() { return new Date().getFullYear() }

// Mismos umbrales que la app móvil (producer_quota_status.dart /
// QUOTA_SYSTEM.md): ok < 80%, warning 80-99%, excedido = superado (>=100%).
// Se mantienen iguales aquí para que un cupo se vea "amarillo" en ambos
// lados a la vez, no que la web lo marque bien cuando el móvil ya alertó.
function pctTag(pct, superado) {
  if (superado) return <span className="tag error-tag">{pct}% · superado</span>
  if (pct >= 80) return <span className="tag warn">{pct}%</span>
  return <span className="tag ok">{pct}%</span>
}

export default function CuposProduccionPage() {
  const COOPERATIVE_ID = useCooperative().id
  const [year, setYear] = useState(currentYear())
  const [tab, setTab] = useState('tabla') // 'tabla' | 'buscar'
  const [certs, setCerts] = useState([])
  const [modules, setModules] = useState([])
  const [quotas, setQuotas] = useState([])
  const [tableSearch, setTableSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [producerQuery, setProducerQuery] = useState('')
  const [producerResults, setProducerResults] = useState([])
  const [selectedProducer, setSelectedProducer] = useState(null) // { id, first_name, last_name, dni, coop_module_id }

  const [modalForm, setModalForm] = useState(null) // null | emptyForm shape
  const [modalError, setModalError] = useState('')
  const [saving, setSaving] = useState(false)

  // Carga masiva -- refleja las queries operacionales de QUOTA_SYSTEM.md
  // (secciones 1 y 6) que hasta ahora se corrían a mano por SQL Editor.
  const [showBulk, setShowBulk] = useState(false)
  const [bulkModuleId, setBulkModuleId] = useState('')
  const [bulkCertId, setBulkCertId] = useState('')
  const [bulkCupoKg, setBulkCupoKg] = useState('')
  const [bulkModuleCount, setBulkModuleCount] = useState(null)
  const [bulkError, setBulkError] = useState('')
  const [bulkResult, setBulkResult] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [copySaving, setCopySaving] = useState(false)

  const loadCerts = useCallback(() =>
    supabase
      .from('batch_certs')
      .select('id, name')
      .eq('cooperative_id', COOPERATIVE_ID)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setCerts(data ?? []))
  , [])

  const loadModules = useCallback(() =>
    supabase
      .from('coop_modules')
      .select('id, name')
      .eq('cooperative_id', COOPERATIVE_ID)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setModules(data ?? []))
  , [])

  const loadQuotas = useCallback((y) => {
    setLoading(true)
    return supabase
      .rpc('get_producer_quotas_by_year', { p_year: y })
      .then(({ data, error }) => {
        if (error) console.error(error)
        setQuotas(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => { loadCerts(); loadModules() }, [loadCerts, loadModules])
  useEffect(() => { loadQuotas(year) }, [year, loadQuotas])

  // Cuenta productores activos del módulo elegido en la carga masiva, para
  // mostrar "Aplicar a N productores" antes de confirmar.
  useEffect(() => {
    if (!bulkModuleId) { setBulkModuleCount(null); return }
    supabase
      .from('producers')
      .select('id', { count: 'exact', head: true })
      .eq('cooperative_id', COOPERATIVE_ID)
      .eq('coop_module_id', bulkModuleId)
      .eq('is_active', true)
      .then(({ count }) => setBulkModuleCount(count ?? 0))
  }, [bulkModuleId])

  // Búsqueda de productor -- solo dispara desde 2 caracteres para no traer
  // el catálogo completo en cada tecla.
  useEffect(() => {
    if (producerQuery.trim().length < 2) { setProducerResults([]); return }
    const q = producerQuery.trim()
    const timer = setTimeout(() => {
      supabase
        .from('producers')
        // Un mismo DNI puede existir como más de un producer_id -- cada
        // registro de productor pertenece a un módulo específico (ver
        // QUOTA_SYSTEM.md), así que el módulo hay que mostrarlo para no
        // asignar el cupo al registro equivocado.
        .select('id, first_name, last_name, dni, coop_module_id, coop_modules(name)')
        .eq('cooperative_id', COOPERATIVE_ID)
        .eq('is_active', true)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,dni.ilike.%${q}%`)
        .order('first_name')
        .limit(20)
        .then(({ data }) => setProducerResults(data ?? []))
    }, 250)
    return () => clearTimeout(timer)
  }, [producerQuery])

  const producerQuotasInTab = selectedProducer
    ? quotas.filter(q => q.producer_id === selectedProducer.id)
    : []

  // Filtro en el propio cliente (los cupos del año ya están todos cargados
  // en memoria) -- así se busca directo en la tabla sin depender del tab
  // "Buscar productor" (que además sirve para otra cosa: asignar un cupo
  // nuevo a un productor que todavía no tiene ninguno).
  const tableQuery = tableSearch.trim().toLowerCase()
  const filteredQuotas = tableQuery
    ? quotas.filter(q =>
        q.producer_name?.toLowerCase().includes(tableQuery) ||
        q.producer_dni?.toLowerCase().includes(tableQuery))
    : quotas

  const openNewQuota = (producer = null) => {
    setModalError('')
    setModalForm({
      ...emptyForm,
      producerId: producer?.id ?? '',
      producerName: producer ? `${producer.first_name} ${producer.last_name}` : '',
      coopModuleId: producer?.coop_module_id ?? '',
    })
  }

  const openEditQuota = (row) => {
    setModalError('')
    setModalForm({
      quotaId: row.quota_id,
      producerId: row.producer_id,
      producerName: row.producer_name,
      coopModuleId: null, // no se toca en edición
      certId: row.cert_id,
      cupoKg: String(row.cupo_kg),
      notes: row.notes ?? '',
    })
  }

  const handlePickProducerInModal = (producer) => {
    setModalForm(f => ({
      ...f,
      producerId: producer.id,
      producerName: `${producer.first_name} ${producer.last_name}`,
      coopModuleId: producer.coop_module_id,
    }))
    setProducerQuery('')
    setProducerResults([])
  }

  const handleSaveQuota = async () => {
    setModalError('')
    if (!modalForm.producerId) { setModalError('Elija un productor.'); return }
    if (!modalForm.certId) { setModalError('Elija una certificación.'); return }
    const cupoKg = Number(modalForm.cupoKg)
    if (!cupoKg || cupoKg <= 0) { setModalError('El cupo debe ser un número mayor a 0.'); return }

    setSaving(true)
    try {
      if (modalForm.quotaId) {
        const { error } = await supabase
          .from('producer_quotas')
          .update({ cupo_kg: cupoKg, notes: modalForm.notes.trim() || null })
          .eq('id', modalForm.quotaId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('producer_quotas')
          .insert({
            producer_id: modalForm.producerId,
            batch_cert_id: modalForm.certId,
            cooperative_id: COOPERATIVE_ID,
            coop_module_id: modalForm.coopModuleId,
            cupo_kg: cupoKg,
            year,
            notes: modalForm.notes.trim() || null,
          })
        if (error) {
          if (error.code === '23505') throw new Error('Este productor ya tiene un cupo cargado para esa certificación en ese año.')
          throw error
        }
      }
      setModalForm(null)
      loadQuotas(year)
    } catch (err) {
      setModalError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteQuota = async (row) => {
    const ok = await confirm({
      title: 'Eliminar cupo',
      message: `¿Eliminar el cupo de ${row.cert_name} de ${row.producer_name} para ${year}?`,
      confirmText: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    await supabase.from('producer_quotas').delete().eq('id', row.quota_id)
    loadQuotas(year)
  }

  // Copia todos los cupos de (year - 1) a year. No pisa los que ya existan
  // para year (mismo criterio que "ON CONFLICT DO NOTHING" de
  // QUOTA_SYSTEM.md §6) -- si alguien ya ajustó un cupo puntual para el año
  // nuevo, la copia no lo revierte.
  const handleCopyPreviousYear = async () => {
    setBulkError(''); setBulkResult('')
    const ok = await confirm({
      title: 'Copiar cupos del año anterior',
      message: `¿Copiar todos los cupos de ${year - 1} a ${year}? Los productores que ya tengan cupo cargado para ${year} en esa certificación no se van a modificar.`,
      confirmText: 'Copiar',
    })
    if (!ok) return
    setCopySaving(true)
    try {
      const { data: prev, error: fetchErr } = await supabase
        .from('producer_quotas')
        .select('producer_id, batch_cert_id, coop_module_id, cupo_kg')
        .eq('cooperative_id', COOPERATIVE_ID)
        .eq('year', year - 1)
      if (fetchErr) throw fetchErr
      if (!prev || prev.length === 0) { setBulkError(`No hay cupos cargados para ${year - 1}.`); return }

      const rows = prev.map(q => ({
        producer_id: q.producer_id,
        batch_cert_id: q.batch_cert_id,
        cooperative_id: COOPERATIVE_ID,
        coop_module_id: q.coop_module_id,
        cupo_kg: q.cupo_kg,
        year,
        notes: `Cupo ${year} — copiado de ${year - 1}`,
      }))
      const { data: inserted, error: upsertErr } = await supabase
        .from('producer_quotas')
        .upsert(rows, { onConflict: 'producer_id,batch_cert_id,year', ignoreDuplicates: true })
        .select('id')
      if (upsertErr) throw upsertErr

      loadQuotas(year)
      setBulkResult(`Se copiaron ${inserted?.length ?? 0} de ${rows.length} cupos de ${year - 1} a ${year}.`)
    } catch (err) {
      setBulkError(err.message)
    } finally {
      setCopySaving(false)
    }
  }

  // Asigna el mismo cupo a todos los productores activos de un módulo, para
  // una certificación y año. Mismo criterio de no-sobreescritura que la
  // copia de año anterior.
  const handleBulkAssign = async () => {
    setBulkError(''); setBulkResult('')
    if (!bulkModuleId) { setBulkError('Elija un módulo.'); return }
    if (!bulkCertId) { setBulkError('Elija una certificación.'); return }
    const cupoKg = Number(bulkCupoKg)
    if (!cupoKg || cupoKg <= 0) { setBulkError('El cupo debe ser un número mayor a 0.'); return }

    setBulkSaving(true)
    try {
      const { data: producersInModule, error: prodErr } = await supabase
        .from('producers')
        .select('id')
        .eq('cooperative_id', COOPERATIVE_ID)
        .eq('coop_module_id', bulkModuleId)
        .eq('is_active', true)
      if (prodErr) throw prodErr
      if (!producersInModule || producersInModule.length === 0) { setBulkError('Ese módulo no tiene productores activos.'); return }

      const rows = producersInModule.map(p => ({
        producer_id: p.id,
        batch_cert_id: bulkCertId,
        cooperative_id: COOPERATIVE_ID,
        coop_module_id: bulkModuleId,
        cupo_kg: cupoKg,
        year,
      }))
      const { data: inserted, error: upsertErr } = await supabase
        .from('producer_quotas')
        .upsert(rows, { onConflict: 'producer_id,batch_cert_id,year', ignoreDuplicates: true })
        .select('id')
      if (upsertErr) throw upsertErr

      loadQuotas(year)
      setBulkCupoKg('')
      setBulkResult(`Se asignó el cupo a ${inserted?.length ?? 0} de ${producersInModule.length} productores del módulo (los que ya tenían cupo para esa certificación en ${year} no se modificaron).`)
    } catch (err) {
      setBulkError(err.message)
    } finally {
      setBulkSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Cupos de producción por certificación</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Límite anual de panela certificada que puede producir cada productor, por certificación.
          </p>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Año</label>
          <input
            type="number"
            className="input"
            style={{ width: 110 }}
            value={year}
            onChange={e => setYear(Number(e.target.value) || currentYear())}
          />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <button
          className="btn small outline"
          onClick={() => setShowBulk(s => !s)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', padding: 0, background: 'none' }}
        >
          <Icon name={showBulk ? 'chevronUp' : 'chevronDown'} size={16} />
          <strong>Carga masiva de cupos {year}</strong>
        </button>

        {showBulk && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <p className="muted small" style={{ margin: '0 0 6px' }}>
                Copia todos los cupos de {year - 1} a {year} (no pisa los que ya tengan cupo cargado este año).
              </p>
              <button className="btn small primary" onClick={handleCopyPreviousYear} disabled={copySaving}>
                {copySaving ? 'Copiando...' : `Copiar cupos de ${year - 1} a ${year}`}
              </button>
            </div>

            <div>
              <p className="muted small" style={{ margin: '0 0 6px' }}>
                Asigne el mismo cupo a todos los productores activos de un módulo, para una certificación.
              </p>
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
                  <label>Cupo (kg)</label>
                  <input type="number" className="input" min="0" step="0.1" value={bulkCupoKg} onChange={e => setBulkCupoKg(e.target.value)} />
                </div>
              </div>
              <button className="btn small primary" style={{ marginTop: 8 }} onClick={handleBulkAssign} disabled={bulkSaving}>
                {bulkSaving
                  ? 'Aplicando...'
                  : bulkModuleCount != null
                    ? `Aplicar a ${bulkModuleCount} productor(es) del módulo`
                    : 'Aplicar'}
              </button>
            </div>

            {bulkError && <p style={{ color: '#dc2626', fontSize: 13, margin: 0 }}>{bulkError}</p>}
            {bulkResult && <p style={{ color: 'var(--success)', fontSize: 13, margin: 0 }}>{bulkResult}</p>}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <button className={`btn small ${tab === 'tabla' ? 'primary' : 'outline'}`} onClick={() => setTab('tabla')}>
          Todos los productores
        </button>
        <button className={`btn small ${tab === 'buscar' ? 'primary' : 'outline'}`} onClick={() => setTab('buscar')}>
          Buscar productor
        </button>
      </div>

      {tab === 'tabla' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <strong>Cupos {year} <span className="muted small">({filteredQuotas.length}{tableQuery ? ` de ${quotas.length}` : ''})</span></strong>
            <button className="btn small primary" onClick={() => openNewQuota()}>+ Nuevo cupo</button>
          </div>
          {quotas.length > 0 && (
            <input
              type="text"
              className="input"
              placeholder="Buscar por nombre o DNI en esta tabla..."
              value={tableSearch}
              onChange={e => setTableSearch(e.target.value)}
              style={{ marginBottom: 10 }}
            />
          )}
          {loading ? (
            <SkeletonList count={4} lines={1} />
          ) : quotas.length === 0 ? (
            <EmptyState message={`Todavía no hay cupos cargados para ${year}.`} />
          ) : filteredQuotas.length === 0 ? (
            <EmptyState icon="search" message="Ningún cupo coincide con la búsqueda." />
          ) : (
            <div style={{ maxHeight: 480, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="table small">
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', top: 0 }}>Productor</th>
                    <th style={{ position: 'sticky', top: 0 }}>DNI</th>
                    <th style={{ position: 'sticky', top: 0 }}>Módulo</th>
                    <th style={{ position: 'sticky', top: 0 }}>Certificación</th>
                    <th style={{ position: 'sticky', top: 0 }}>Cupo kg</th>
                    <th style={{ position: 'sticky', top: 0 }}>Acumulado kg</th>
                    <th style={{ position: 'sticky', top: 0 }}>Disponible kg</th>
                    <th style={{ position: 'sticky', top: 0 }}>% usado</th>
                    <th style={{ position: 'sticky', top: 0 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotas.map(row => (
                    <tr key={row.quota_id}>
                      <td>{row.producer_name}</td>
                      <td>{row.producer_dni}</td>
                      <td>{row.module_name ?? '—'}</td>
                      <td>{row.cert_name}</td>
                      <td>{Number(row.cupo_kg).toFixed(1)}</td>
                      <td>{Number(row.acumulado_kg).toFixed(1)}</td>
                      <td>{Number(row.disponible_kg).toFixed(1)}</td>
                      <td>{pctTag(row.porcentaje_usado, row.superado)}</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button className="btn small primary" onClick={() => openEditQuota(row)}>Editar</button>
                        <button className="btn small danger primary" onClick={() => handleDeleteQuota(row)}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'buscar' && (
        <div className="card">
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Buscar productor por nombre o DNI</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="input"
                placeholder="Ej: Juan Pérez o 12345678"
                value={selectedProducer ? `${selectedProducer.first_name} ${selectedProducer.last_name}` : producerQuery}
                onChange={e => { setSelectedProducer(null); setProducerQuery(e.target.value) }}
              />
              {producerResults.length > 0 && !selectedProducer && (
                <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, padding: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {producerResults.map(p => (
                    <div
                      key={p.id}
                      style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 6 }}
                      onClick={() => { setSelectedProducer(p); setProducerQuery('') }}
                    >
                      {p.first_name} {p.last_name} <span className="muted small">DNI {p.dni} · {p.coop_modules?.name ?? 'sin módulo'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {!selectedProducer ? (
            <EmptyState icon="search" message="Busque un productor para ver o asignar sus cupos." />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong>{selectedProducer.first_name} {selectedProducer.last_name} <span className="muted small">DNI {selectedProducer.dni} · {selectedProducer.coop_modules?.name ?? 'sin módulo'}</span></strong>
                <button className="btn small primary" onClick={() => openNewQuota(selectedProducer)}>+ Asignar cupo</button>
              </div>
              {producerQuotasInTab.length === 0 ? (
                <EmptyState message={`Sin cupos asignados para ${year}.`} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {producerQuotasInTab.map(row => (
                    <div key={row.quota_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, flexWrap: 'wrap', gap: 6 }}>
                      <span>
                        <strong>{row.cert_name}</strong>{' '}
                        <span className="muted small">{Number(row.acumulado_kg).toFixed(1)} / {Number(row.cupo_kg).toFixed(1)} kg</span>
                      </span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {pctTag(row.porcentaje_usado, row.superado)}
                        <button className="btn small primary" onClick={() => openEditQuota(row)}>Editar</button>
                        <button className="btn small danger primary" onClick={() => handleDeleteQuota(row)}>Eliminar</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Modal: Nuevo/Editar cupo ── */}
      {modalForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-body">
              <h3 style={{ margin: '0 0 16px' }}>{modalForm.quotaId ? 'Editar cupo' : 'Nuevo cupo'} · {year}</h3>

              {!modalForm.quotaId && !modalForm.producerId && (
                <div className="field">
                  <label>Productor *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Buscar por nombre o DNI..."
                    value={producerQuery}
                    onChange={e => setProducerQuery(e.target.value)}
                  />
                  {producerResults.length > 0 && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                      {producerResults.map(p => (
                        <div
                          key={p.id}
                          style={{ padding: '6px 8px', cursor: 'pointer' }}
                          onClick={() => handlePickProducerInModal(p)}
                        >
                          {p.first_name} {p.last_name} <span className="muted small">DNI {p.dni} · {p.coop_modules?.name ?? 'sin módulo'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {modalForm.producerId && (
                <div className="field">
                  <label>Productor</label>
                  <input type="text" className="input" value={modalForm.producerName} disabled />
                </div>
              )}

              <div className="field">
                <label>Certificación *</label>
                <select
                  className="input"
                  value={modalForm.certId}
                  disabled={!!modalForm.quotaId}
                  onChange={e => setModalForm(f => ({ ...f, certId: e.target.value }))}
                >
                  <option value="">Seleccionar...</option>
                  {certs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="field">
                <label>Cupo (kg) *</label>
                <input
                  type="number"
                  className="input"
                  min="0"
                  step="0.1"
                  value={modalForm.cupoKg}
                  onChange={e => setModalForm(f => ({ ...f, cupoKg: e.target.value }))}
                />
              </div>

              <div className="field">
                <label>Notas</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Opcional"
                  value={modalForm.notes}
                  onChange={e => setModalForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {modalError && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{modalError}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn small" onClick={() => { setModalForm(null); setProducerQuery(''); setProducerResults([]) }} disabled={saving}>Cancelar</button>
              <button className="btn small primary" onClick={handleSaveQuota} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cupo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  )
}
