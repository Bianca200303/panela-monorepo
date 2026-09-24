import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { loteLabel } from '@panela/core/lib/loteHelpers'
import { SIEVE_CHECK_ITEMS } from '../lib/formatos/monitoreoTamizadoCaes'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import { useConfirm } from '@panela/core/hooks/useConfirm'

// Monitoreo y Verificación del Tamizado / PCC (CAESP-PP-BPM-RE-CPR-002) --
// SOLO CAES. Modal por lote (antes vivía en el hub de "Controles de
// planta" con N° de lote de texto libre, y hubo un intento intermedio de
// atarlo al bunque -- ambos partían de la premisa equivocada de que el N°
// de lote del papel era materia prima. Se corrigió: el código del papel es
// el LOTE DE ENVASADO (decodificado como día juliano+año+correlativo
// anual, y porque CPR-007 Hermeticidad de Envases -- inequívocamente
// producto envasado -- comparte los mismos códigos en las mismas fechas),
// mismo criterio que SelladoEnvasadoCaesModal.jsx/
// HermeticidadEnvasesCaesModal.jsx. Ver migración 20260916100000.
//
// plant_batch_id (FK real) reemplaza al lote_code de texto libre -- ya no
// hace falta pedirlo/mostrarlo, el modal ya sabe de qué lote se trata.

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm() {
  const f = {
    monitoring_date: todayISO(),
    hubo_desviacion: false,
    causa_raiz: '',
    acciones_correctivas: '',
  }
  for (const item of SIEVE_CHECK_ITEMS) f[item.code] = true
  return f
}

export default function MonitoreoTamizadoCaesModal({ plantBatch, webUser, onClose }) {
  const [view, setView] = useState('history') // 'history' | 'form'
  const [rows, setRows] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { confirm, dialog: confirmDialog } = useConfirm()

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_sieve_monitoring_caes')
      .select('id, monitoring_date, sin_abolladuras, sin_fisuras, sin_desgaste, sin_deformaciones, sin_obstrucciones, hubo_desviacion, causa_raiz, acciones_correctivas, registered_by:web_users!psmc_created_by_fkey ( first_name, last_name )')
      .eq('plant_batch_id', plantBatch.id)
      .order('monitoring_date', { ascending: false })
    setRows(data ?? [])
    setLoadingHistory(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function startNew() {
    setEditingId(null)
    setForm(emptyForm())
    setError('')
    setView('form')
  }

  function startEdit(r) {
    setEditingId(r.id)
    const f = {
      monitoring_date: r.monitoring_date,
      hubo_desviacion: r.hubo_desviacion,
      causa_raiz: r.causa_raiz ?? '',
      acciones_correctivas: r.acciones_correctivas ?? '',
    }
    for (const item of SIEVE_CHECK_ITEMS) f[item.code] = r[item.code]
    setForm(f)
    setError('')
    setView('form')
  }

  async function handleSave() {
    setError('')
    if (!form.monitoring_date) { setError('Seleccione la fecha.'); return }

    setSaving(true)
    try {
      const payload = {
        monitoring_date: form.monitoring_date,
        lote_code: loteLabel(plantBatch),
        hubo_desviacion: form.hubo_desviacion,
        causa_raiz: form.hubo_desviacion ? (form.causa_raiz.trim() || null) : null,
        acciones_correctivas: form.hubo_desviacion ? (form.acciones_correctivas.trim() || null) : null,
      }
      for (const item of SIEVE_CHECK_ITEMS) payload[item.code] = form[item.code]

      if (editingId) {
        const { error: updErr } = await supabase
          .from('plant_sieve_monitoring_caes')
          .update(payload)
          .eq('id', editingId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { error: insErr } = await supabase
          .from('plant_sieve_monitoring_caes')
          .insert({ cooperative_id: COOPERATIVE.id, created_by: webUser.id, plant_batch_id: plantBatch.id, ...payload })
        if (insErr) throw new Error(insErr.message)
      }

      setView('history')
      await loadHistory()
    } catch (err) {
      setError(err.message ?? 'Error al guardar el registro')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(r) {
    setError('')
    const fecha = new Date(`${r.monitoring_date}T00:00:00`).toLocaleDateString('es-PE')
    const ok = await confirm({
      title: 'Eliminar registro',
      message: `¿Eliminar el registro del ${fecha}?`,
      confirmText: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    setSaving(true)
    try {
      const { error: delErr } = await supabase
        .from('plant_sieve_monitoring_caes')
        .delete()
        .eq('id', r.id)
      if (delErr) throw new Error(delErr.message)
      await loadHistory()
    } catch (err) {
      setError(err.message ?? 'Error al eliminar el registro')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 640 }}>
        <div className="modal-body">
          {view === 'history' ? (
            <>
              <h3 style={{ margin: '0 0 4px' }}>Monitoreo y Verificación del Tamizado</h3>
              <p className="muted small" style={{ margin: '0 0 16px' }}>{loteLabel(plantBatch)} · {plantBatch.brand}</p>
              <button className="btn small primary" style={{ marginBottom: 12 }} onClick={startNew}>+ Nuevo registro</button>

              {loadingHistory ? (
                <SkeletonList count={2} lines={2} />
              ) : rows.length === 0 ? (
                <EmptyState message="No hay registros de monitoreo del tamizado para este lote aún." />
              ) : (
                <div className="list">
                  {rows.map(r => {
                    const nOk = SIEVE_CHECK_ITEMS.filter(item => r[item.code]).length
                    return (
                      <div key={r.id} className="card">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                          <strong style={{ fontSize: 15 }}>{new Date(`${r.monitoring_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className={`tag ${r.hubo_desviacion ? 'warn' : 'ok'}`}>
                              {nOk}/{SIEVE_CHECK_ITEMS.length} correcto{r.hubo_desviacion ? ' · con desviación' : ''}
                            </span>
                            <button className="btn small outline" onClick={() => startEdit(r)}>Editar</button>
                            <button className="btn small danger" style={{ padding: '2px 8px' }} disabled={saving} onClick={() => handleDelete(r)}>Eliminar</button>
                          </div>
                        </div>
                        <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                          {r.registered_by && `Registrado por: ${r.registered_by.first_name} ${r.registered_by.last_name}`}
                        </div>
                        {r.hubo_desviacion && r.causa_raiz && <div className="meta" style={{ fontSize: 12 }}>Causa raíz: {r.causa_raiz}</div>}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <h3 style={{ margin: '0 0 4px' }}>{editingId ? 'Editar' : 'Nuevo'} registro</h3>
              <p className="muted small" style={{ margin: '0 0 16px' }}>{loteLabel(plantBatch)} · {plantBatch.brand}</p>

              <div className="field" style={{ margin: 0 }}>
                <label>Fecha</label>
                <input type="date" value={form.monitoring_date} onChange={e => setForm({ ...form, monitoring_date: e.target.value })} />
              </div>

              <h4 style={{ margin: '12px 0 4px' }}>Verificación de Integridad del Tamiz</h4>
              <p className="muted small" style={{ margin: '0 0 8px' }}>Todos los ítems inician marcados como correcto; desmarque únicamente los que no cumplan.</p>
              <div className="grid" style={{ gap: 8 }}>
                {SIEVE_CHECK_ITEMS.map(item => {
                  const ok = form[item.code]
                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => setForm({ ...form, [item.code]: !ok })}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        width: '100%', padding: '8px 12px', borderRadius: 8,
                        border: '1px solid var(--border)', background: '#fff',
                        fontSize: 13, fontWeight: 500, color: 'var(--text)', textAlign: 'left', cursor: 'pointer',
                      }}
                    >
                      {item.label}
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                        background: ok ? 'var(--success)' : 'var(--danger)', color: '#fff',
                      }}>
                        <Icon name={ok ? 'check' : 'x'} size={14} />
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="field">
                <label>¿Hubo desviación?</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, hubo_desviacion: false })}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                      fontSize: 13, fontWeight: 600, border: '1.5px solid var(--success)',
                      background: !form.hubo_desviacion ? 'var(--success)' : '#fff',
                      color: !form.hubo_desviacion ? '#fff' : 'var(--success)',
                    }}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, hubo_desviacion: true })}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                      fontSize: 13, fontWeight: 600, border: '1.5px solid var(--danger)',
                      background: form.hubo_desviacion ? 'var(--danger)' : '#fff',
                      color: form.hubo_desviacion ? '#fff' : 'var(--danger)',
                    }}
                  >
                    Sí, hubo desviación
                  </button>
                </div>
              </div>
              {form.hubo_desviacion && (
                <>
                  <div className="field">
                    <label>Causa raíz</label>
                    <textarea rows={2} value={form.causa_raiz} onChange={e => setForm({ ...form, causa_raiz: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Acciones correctivas</label>
                    <textarea rows={2} value={form.acciones_correctivas} onChange={e => setForm({ ...form, acciones_correctivas: e.target.value })} />
                  </div>
                </>
              )}
            </>
          )}
          {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}
        </div>
        <div className="modal-actions">
          <button className="btn small" onClick={view === 'form' ? () => setView('history') : onClose} disabled={saving}>
            {view === 'form' ? 'Cancelar' : 'Cerrar'}
          </button>
          {view === 'form' && (
            <button className="btn small primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar registro'}
            </button>
          )}
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}
