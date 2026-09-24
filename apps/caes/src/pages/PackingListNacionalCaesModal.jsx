import { useState, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useConfirm } from '@panela/core/hooks/useConfirm'

// Packing List-Nacional (CAESP-PP-BPM-RE-CPR-006) -- SOLO CAES. 1 registro
// por contenedor (UNIQUE), bloqueable -- mismo patrón que el Packing List
// real de exportación (ContainerLoadingModal.jsx / plant_container_loadings):
// se "Inicia" con un responsable, se completa, y se "Termina" (bloquea,
// reabrible). Antes esto vivía como texto suelto en
// plant_containers.extra_data, editable en cualquier momento sin ningún
// ciclo de vida -- ver migración 20260916120000.
//
// guia_tramo_interno/guia_tramo_final: deben coincidir con la guía del
// Control de Unidad de Transporte correspondiente (confirmado con el
// usuario) -- pero el Packing List se completa ANTES de que exista el CUT
// del tramo final en la práctica real (evidencia: PL firmado 23/06, CUT
// del tramo final recién 27/06), así que quedan como campos propios acá,
// no derivados. TransportUnitControlsCaesModal.jsx los toma de acá como
// sugerencia (prefill editable) al crear un control nuevo.

function emptyForm() {
  return { packing_list_numero: '', guia_tramo_interno: '', guia_tramo_final: '', final_observations: '' }
}

function valuesFromRecord(r) {
  const f = emptyForm()
  for (const key of Object.keys(f)) {
    if (r[key] != null) f[key] = r[key]
  }
  return f
}

export default function PackingListNacionalCaesModal({ container, webUser, onClose, onSaved }) {
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [record, setRecord] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [error, setError] = useState('')

  const [responsiblePerson, setResponsiblePerson] = useState('')
  const [starting, setStarting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    const { data: existing } = await supabase
      .from('plant_packing_list_nacional_caes')
      .select('*')
      .eq('container_id', container.id)
      .maybeSingle()
    if (existing) {
      setRecord(existing)
      setForm(valuesFromRecord(existing))
    }
    setLoading(false)
  }

  async function handleStart() {
    if (!responsiblePerson.trim()) { setError('Ingrese el responsable.'); return }
    setError(''); setStarting(true)
    try {
      const { data: newRecord, error: insErr } = await supabase
        .from('plant_packing_list_nacional_caes')
        .insert({
          cooperative_id: COOPERATIVE.id,
          container_id: container.id,
          responsible_person: responsiblePerson.trim(),
          created_by: webUser.id,
        })
        .select('*')
        .single()
      if (insErr) throw new Error(insErr.message)
      setRecord(newRecord)
      setForm(emptyForm())
    } catch (e) { setError(e.message ?? 'Error al iniciar el Packing List') }
    finally { setStarting(false) }
  }

  async function handleSaveForm() {
    setError(''); setSaving(true)
    try {
      const payload = {
        packing_list_numero: form.packing_list_numero.trim() || null,
        guia_tramo_interno: form.guia_tramo_interno.trim() || null,
        guia_tramo_final: form.guia_tramo_final.trim() || null,
        final_observations: form.final_observations.trim() || null,
      }
      const { data: updated, error: updErr } = await supabase
        .from('plant_packing_list_nacional_caes')
        .update(payload)
        .eq('id', record.id)
        .select('*')
        .single()
      if (updErr) throw new Error(updErr.message)
      setRecord(updated)
      onSaved?.()
    } catch (e) { setError(e.message ?? 'Error al guardar') }
    finally { setSaving(false) }
  }

  async function handleClose() {
    const ok = await confirm({
      title: 'Terminar Packing List',
      message: '¿Dar por terminado este Packing List-Nacional? Va a quedar bloqueado para edición hasta que se reabra.',
      confirmText: 'Terminar',
    })
    if (!ok) return
    setError(''); setClosing(true)
    try {
      const { data: updated, error: updErr } = await supabase
        .from('plant_packing_list_nacional_caes')
        .update({ status: 'terminado', closed_by: webUser.id, closed_at: new Date().toISOString() })
        .eq('id', record.id)
        .select('*')
        .single()
      if (updErr) throw new Error(updErr.message)
      setRecord(updated)
      onSaved?.()
    } catch (e) { setError(e.message ?? 'Error al terminar el Packing List') }
    finally { setClosing(false) }
  }

  async function handleReopen() {
    const ok = await confirm({
      title: 'Reabrir Packing List',
      message: '¿Reabrir este Packing List-Nacional para corregirlo?',
      confirmText: 'Reabrir',
    })
    if (!ok) return
    setError(''); setReopening(true)
    try {
      const { data: updated, error: updErr } = await supabase
        .from('plant_packing_list_nacional_caes')
        .update({ status: 'en_progreso', closed_by: null, closed_at: null })
        .eq('id', record.id)
        .select('*')
        .single()
      if (updErr) throw new Error(updErr.message)
      setRecord(updated)
      onSaved?.()
    } catch (e) { setError(e.message ?? 'Error al reabrir') }
    finally { setReopening(false) }
  }

  const isOpen = record?.status === 'en_progreso'

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 560 }}>
        <div className="modal-body">
          <h3 style={{ margin: '0 0 4px' }}>Packing List-Nacional</h3>
          <p className="muted small" style={{ margin: '0 0 16px' }}>Contenedor {container.container_number ?? 'sin número'}</p>

          {loading ? (
            <p className="muted small">Cargando...</p>
          ) : !record ? (
            <>
              <div className="field">
                <label>Responsable</label>
                <input type="text" value={responsiblePerson} onChange={e => setResponsiblePerson(e.target.value)} placeholder="Nombre de quien completa el formulario" />
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <span className={`tag dot ${isOpen ? 'info' : 'ok'}`}>{isOpen ? 'En progreso' : 'Terminado'}</span>
                <span className="muted small">Responsable: {record.responsible_person}</span>
              </div>

              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>N° de documento (Packing List)</label>
                  <input type="text" disabled={!isOpen} value={form.packing_list_numero} onChange={e => setForm({ ...form, packing_list_numero: e.target.value })} placeholder="Ej: N-25-90" />
                </div>
              </div>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Guía de remisión (tramo interno)</label>
                  <input type="text" disabled={!isOpen} value={form.guia_tramo_interno} onChange={e => setForm({ ...form, guia_tramo_interno: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Guía de remisión (tramo final)</label>
                  <input type="text" disabled={!isOpen} value={form.guia_tramo_final} onChange={e => setForm({ ...form, guia_tramo_final: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Observaciones {!isOpen && '(cerrado)'}</label>
                <textarea rows={2} disabled={!isOpen} value={form.final_observations} onChange={e => setForm({ ...form, final_observations: e.target.value })} />
              </div>
            </>
          )}

          {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
        </div>
        <div className="modal-actions">
          <button className="btn small" onClick={onClose}>Cerrar</button>
          {!loading && !record && (
            <button className="btn small primary" onClick={handleStart} disabled={starting}>
              {starting ? 'Iniciando...' : 'Iniciar Packing List'}
            </button>
          )}
          {!loading && isOpen && (
            <>
              <button className="btn small outline" onClick={handleSaveForm} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button className="btn small danger" onClick={handleClose} disabled={closing}>
                {closing ? 'Guardando...' : 'Terminar'}
              </button>
            </>
          )}
          {!loading && record && !isOpen && (
            <button className="btn small outline" onClick={handleReopen} disabled={reopening}>
              {reopening ? 'Reabriendo...' : 'Reabrir'}
            </button>
          )}
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}
