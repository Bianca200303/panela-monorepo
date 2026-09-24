import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { loteLabel, packagingLabel } from '@panela/core/lib/loteHelpers'
import { getCoopCode } from '@panela/core/lib/formatos/shared'
import { SEAL_CHECK_ITEMS, DESTINO_LABELS } from '../lib/formatos/selladoEnvasadoCaes'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import { useConfirm } from '@panela/core/hooks/useConfirm'

// Control de Sellado, Envasado y Empaque de Producto Terminado
// (CAESP-PP-BPM-RE-CPR-003) -- SOLO CAES. Modal por lote (antes era un tab
// suelto en "Controles de planta" -- se movió porque el papel real es una
// inspección del producto YA ENVASADO de un lote específico, mismo
// criterio que ForeignObjectControlModal.jsx/WeightSealControlModal.jsx de
// Norandino. Distinto de Monitoreo del Tamizado (CPR-002), que se quedó en
// el hub de Controles porque su "N° Lote" es materia prima, no lote de
// envasado -- ver [[project_despacho_nacional_caes]] y memoria de la
// reorganización BPM/HYS.
//
// plant_batch_id (FK real, migración 20260913280000) reemplaza al
// lote_code de texto libre que tenía como tab suelto -- ya no hace falta
// pedirlo/mostrarlo, el modal ya sabe de qué lote se trata.
//
// destino y cliente ya no se preguntan sueltos: la orden ya sabe si es
// Nacional/Exportación (plant_orders.sale_type) y quién es el cliente
// (plant_clients, elegido al crear la orden) -- destino se guarda directo
// del order.sale_type, y cliente/presentación arrancan prellenados (cliente
// de la orden, presentación con el empaque planificado del lote vía
// packagingLabel) -- ambos siguen editables, por si un registro puntual
// necesita otro dato.

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function nowHHMM() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function emptyForm(order, plantBatch) {
  const f = {
    control_date: todayISO(), control_time: nowHHMM(), presentacion: packagingLabel(plantBatch),
    cliente: order?.plant_clients?.name ?? '', observaciones: '', acciones_correctivas: '',
  }
  for (const item of SEAL_CHECK_ITEMS) f[item.code] = true
  return f
}

export default function SelladoEnvasadoCaesModal({ plantBatch, order, webUser, onClose }) {
  const [view, setView] = useState('history') // 'history' | 'form'
  const [rows, setRows] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm(order, plantBatch))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { confirm, dialog: confirmDialog } = useConfirm()

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_packaging_seal_control_caes')
      .select('id, control_date, control_time, presentacion, destino, cliente, materias_extranas_ok, sellado_costura_ok, peso_completo_ok, fecha_vencimiento_ok, lote_legible_ok, limpieza_envase_ok, formato_codigo, registered_by:web_users!ppscc_created_by_fkey ( first_name, last_name )')
      .eq('plant_batch_id', plantBatch.id)
      .order('control_date', { ascending: false })
    setRows(data ?? [])
    setLoadingHistory(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function startNew() {
    setEditingId(null)
    setForm(emptyForm(order, plantBatch))
    setError('')
    setView('form')
  }

  function startEdit(r) {
    setEditingId(r.id)
    const f = {
      control_date: r.control_date, control_time: r.control_time ?? '', presentacion: r.presentacion ?? '',
      cliente: r.cliente ?? '',
      observaciones: r.observaciones ?? '', acciones_correctivas: r.acciones_correctivas ?? '',
    }
    for (const item of SEAL_CHECK_ITEMS) f[item.code] = r[item.code]
    setForm(f)
    setError('')
    setView('form')
  }

  async function handleSave() {
    setError('')
    if (!form.control_date) { setError('Seleccione la fecha.'); return }

    setSaving(true)
    try {
      const payload = {
        control_date: form.control_date,
        control_time: form.control_time || null,
        presentacion: form.presentacion.trim() || null,
        lote_code: loteLabel(plantBatch),
        destino: order?.sale_type ?? null,
        cliente: form.cliente.trim() || null,
        observaciones: form.observaciones.trim() || null,
        acciones_correctivas: form.acciones_correctivas.trim() || null,
      }
      for (const item of SEAL_CHECK_ITEMS) payload[item.code] = form[item.code]

      if (editingId) {
        const { error: updErr } = await supabase
          .from('plant_packaging_seal_control_caes')
          .update(payload)
          .eq('id', editingId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { data: codigo, error: codeErr } = await supabase
          .rpc('generate_packaging_seal_control_code', { p_cooperative_id: COOPERATIVE.id, p_coop_code: getCoopCode(COOPERATIVE) })
        if (codeErr) throw new Error(codeErr.message)
        const { error: insErr } = await supabase
          .from('plant_packaging_seal_control_caes')
          .insert({ cooperative_id: COOPERATIVE.id, created_by: webUser.id, plant_batch_id: plantBatch.id, formato_codigo: codigo, ...payload })
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
    const fecha = new Date(`${r.control_date}T00:00:00`).toLocaleDateString('es-PE')
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
        .from('plant_packaging_seal_control_caes')
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
              <h3 style={{ margin: '0 0 4px' }}>Sellado, Envasado y Empaque</h3>
              <p className="muted small" style={{ margin: '0 0 16px' }}>{loteLabel(plantBatch)} · {plantBatch.brand}</p>
              <button className="btn small primary" style={{ marginBottom: 12 }} onClick={startNew}>+ Nuevo registro</button>

              {loadingHistory ? (
                <SkeletonList count={2} lines={2} />
              ) : rows.length === 0 ? (
                <EmptyState message="No hay registros de sellado/envasado/empaque para este lote aún." />
              ) : (
                <div className="list">
                  {rows.map(r => {
                    const nOk = SEAL_CHECK_ITEMS.filter(item => r[item.code]).length
                    return (
                      <div key={r.id} className="card">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                          <div>
                            <strong style={{ fontSize: 15 }}>{new Date(`${r.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                            {r.control_time && <span className="muted small" style={{ marginLeft: 8 }}>{r.control_time}</span>}
                            {r.formato_codigo && <span className="muted small" style={{ marginLeft: 8 }}>{r.formato_codigo}</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className={`tag ${nOk === SEAL_CHECK_ITEMS.length ? 'ok' : 'warn'}`}>{nOk}/{SEAL_CHECK_ITEMS.length} conforme</span>
                            <button className="btn small outline" onClick={() => startEdit(r)}>Editar</button>
                            <button className="btn small danger" style={{ padding: '2px 8px' }} disabled={saving} onClick={() => handleDelete(r)}>Eliminar</button>
                          </div>
                        </div>
                        <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                          {r.presentacion && `${r.presentacion} · `}
                          {r.destino && `${DESTINO_LABELS[r.destino]} · `}
                          {r.cliente && `${r.cliente} · `}
                          {r.registered_by && `Registrado por: ${r.registered_by.first_name} ${r.registered_by.last_name}`}
                        </div>
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

              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Fecha</label>
                  <input type="date" value={form.control_date} onChange={e => setForm({ ...form, control_date: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Hora</label>
                  <input type="time" value={form.control_time} onChange={e => setForm({ ...form, control_time: e.target.value })} />
                </div>
              </div>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Presentación</label>
                  <input type="text" value={form.presentacion} onChange={e => setForm({ ...form, presentacion: e.target.value })}
                    placeholder="Ej: Caja de cartón corrugado (OXFAM) 14 und x 400g" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Cliente</label>
                  <input type="text" value={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.value })} />
                </div>
              </div>

              <h4 style={{ margin: '12px 0 4px' }}>Datos a Evaluar</h4>
              <p className="muted small" style={{ margin: '0 0 8px' }}>Todos los ítems inician marcados como Conforme; desmarque únicamente los que no cumplan.</p>
              <div className="grid" style={{ gap: 8 }}>
                {SEAL_CHECK_ITEMS.map(item => {
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
                <label>Observaciones</label>
                <textarea rows={2} value={form.observaciones} onChange={e => setForm({ ...form, observaciones: e.target.value })} />
              </div>
              <div className="field">
                <label>Acciones correctivas</label>
                <textarea rows={2} value={form.acciones_correctivas} onChange={e => setForm({ ...form, acciones_correctivas: e.target.value })} />
              </div>
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
