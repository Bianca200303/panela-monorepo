import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { loteLabel } from '@panela/core/lib/loteHelpers'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'

// Control de Hermeticidad de Envases (CAESP-PP-BPM-RE-CPR-007) -- SOLO
// CAES. Modal por lote (antes era un tab suelto en "Controles de planta")
// -- mismo motivo que SelladoEnvasadoCaesModal.jsx: muestreo AQL del
// producto ya envasado de un lote específico.

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

const ACCION_TOMADA_DEFAULT = 'Lote conforme'

function emptyForm() {
  return {
    control_date: todayISO(), tamano_lote: '', nivel_inspeccion: 'II', letra_codigo: '',
    nivel_calidad_aceptable: '2.5%', tamano_muestra: '', numero_aceptacion: '', numero_rechazo: '',
    producto_conforme: '', producto_no_conforme: '', accion_tomada: '', acciones_correctivas: '',
  }
}

function toIntOrNull(v) {
  const n = parseInt(v, 10)
  return v !== '' && !isNaN(n) ? n : null
}

export default function HermeticidadEnvasesCaesModal({ plantBatch, webUser, onClose }) {
  const [view, setView] = useState('history') // 'history' | 'form'
  const [rows, setRows] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_container_tightness_control_caes')
      .select('id, control_date, tamano_muestra, producto_conforme, producto_no_conforme, registered_by:web_users!pctcc_created_by_fkey ( first_name, last_name )')
      .eq('plant_batch_id', plantBatch.id)
      .order('control_date', { ascending: false })
    setRows(data ?? [])
    setLoadingHistory(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  // "Acción tomada" solo tiene sentido pedirla cuando hay algún producto no
  // conforme -- con 0/vacío se oculta y se guarda directo "Lote conforme",
  // sin mostrar el campo ni pedirle nada al usuario.
  const hayNoConforme = (toIntOrNull(form.producto_no_conforme) ?? 0) > 0

  function startNew() {
    setEditingId(null)
    setForm(emptyForm())
    setError('')
    setView('form')
  }

  async function startEdit(r) {
    setEditingId(r.id)
    const { data: full } = await supabase
      .from('plant_container_tightness_control_caes')
      .select('*')
      .eq('id', r.id)
      .single()
    setForm({
      control_date: full.control_date,
      tamano_lote: full.tamano_lote != null ? String(full.tamano_lote) : '',
      nivel_inspeccion: full.nivel_inspeccion ?? '',
      letra_codigo: full.letra_codigo ?? '',
      nivel_calidad_aceptable: full.nivel_calidad_aceptable ?? '',
      tamano_muestra: full.tamano_muestra != null ? String(full.tamano_muestra) : '',
      numero_aceptacion: full.numero_aceptacion != null ? String(full.numero_aceptacion) : '',
      numero_rechazo: full.numero_rechazo != null ? String(full.numero_rechazo) : '',
      producto_conforme: full.producto_conforme != null ? String(full.producto_conforme) : '',
      producto_no_conforme: full.producto_no_conforme != null ? String(full.producto_no_conforme) : '',
      accion_tomada: full.accion_tomada ?? '',
      acciones_correctivas: full.acciones_correctivas ?? '',
    })
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
        lote_code: loteLabel(plantBatch),
        tamano_lote: toIntOrNull(form.tamano_lote),
        nivel_inspeccion: form.nivel_inspeccion.trim() || null,
        letra_codigo: form.letra_codigo.trim() || null,
        nivel_calidad_aceptable: form.nivel_calidad_aceptable.trim() || null,
        tamano_muestra: toIntOrNull(form.tamano_muestra),
        numero_aceptacion: toIntOrNull(form.numero_aceptacion),
        numero_rechazo: toIntOrNull(form.numero_rechazo),
        producto_conforme: toIntOrNull(form.producto_conforme),
        producto_no_conforme: toIntOrNull(form.producto_no_conforme),
        accion_tomada: hayNoConforme ? (form.accion_tomada.trim() || null) : ACCION_TOMADA_DEFAULT,
        acciones_correctivas: hayNoConforme ? (form.acciones_correctivas.trim() || null) : null,
      }
      if (editingId) {
        const { error: updErr } = await supabase
          .from('plant_container_tightness_control_caes')
          .update(payload)
          .eq('id', editingId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { error: insErr } = await supabase
          .from('plant_container_tightness_control_caes')
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

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 640 }}>
        <div className="modal-body">
          {view === 'history' ? (
            <>
              <h3 style={{ margin: '0 0 4px' }}>Hermeticidad de Envases</h3>
              <p className="muted small" style={{ margin: '0 0 16px' }}>{loteLabel(plantBatch)} · {plantBatch.brand}</p>
              <button className="btn small primary" style={{ marginBottom: 12 }} onClick={startNew}>+ Nuevo registro</button>

              {loadingHistory ? (
                <SkeletonList count={2} lines={2} />
              ) : rows.length === 0 ? (
                <EmptyState message="No hay registros de hermeticidad de envases para este lote aún." />
              ) : (
                <div className="list">
                  {rows.map(r => {
                    const anyNoConforme = (r.producto_no_conforme ?? 0) > 0
                    return (
                      <div key={r.id} className="card">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                          <strong style={{ fontSize: 15 }}>{new Date(`${r.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {r.tamano_muestra != null && (
                              <span className={`tag ${anyNoConforme ? 'warn' : 'ok'}`}>
                                Muestra {r.tamano_muestra} · Conforme {r.producto_conforme ?? 0} · No conforme {r.producto_no_conforme ?? 0}
                              </span>
                            )}
                            <button className="btn small outline" onClick={() => startEdit(r)}>Editar</button>
                          </div>
                        </div>
                        <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
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
                  <label>Tamaño de lote</label>
                  <input type="number" min="0" value={form.tamano_lote} onChange={e => setForm({ ...form, tamano_lote: e.target.value })} />
                </div>
              </div>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Nivel de inspección</label>
                  <input type="text" value={form.nivel_inspeccion} onChange={e => setForm({ ...form, nivel_inspeccion: e.target.value })} placeholder="Ej: II" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Letra código</label>
                  <input type="text" value={form.letra_codigo} onChange={e => setForm({ ...form, letra_codigo: e.target.value })} placeholder="Ej: L" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Nivel de calidad aceptable</label>
                  <input type="text" value={form.nivel_calidad_aceptable} onChange={e => setForm({ ...form, nivel_calidad_aceptable: e.target.value })} placeholder="Ej: 2.5%" />
                </div>
              </div>

              <h4 style={{ margin: '12px 0 4px' }}>Plan de Muestreo</h4>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tamaño de muestra</label>
                  <input type="number" min="0" value={form.tamano_muestra} onChange={e => setForm({ ...form, tamano_muestra: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>N° aceptación</label>
                  <input type="number" min="0" value={form.numero_aceptacion} onChange={e => setForm({ ...form, numero_aceptacion: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>N° rechazo</label>
                  <input type="number" min="0" value={form.numero_rechazo} onChange={e => setForm({ ...form, numero_rechazo: e.target.value })} />
                </div>
              </div>

              <h4 style={{ margin: '12px 0 4px' }}>Resultados del Muestreo</h4>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>N° producto conforme</label>
                  <input type="number" min="0" value={form.producto_conforme} onChange={e => setForm({ ...form, producto_conforme: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>N° producto no conforme</label>
                  <input type="number" min="0" value={form.producto_no_conforme} onChange={e => setForm({ ...form, producto_no_conforme: e.target.value })} />
                </div>
              </div>
              {hayNoConforme && (
                <>
                  <div className="field">
                    <label>Acción tomada</label>
                    <input type="text" value={form.accion_tomada} onChange={e => setForm({ ...form, accion_tomada: e.target.value })} placeholder="Ej: Se retira y separa el producto no conforme" />
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
    </div>
  )
}
