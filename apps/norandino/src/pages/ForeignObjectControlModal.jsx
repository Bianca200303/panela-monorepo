import { useState, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { loteLabel } from '@panela/core/lib/loteHelpers'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { getLoteLabelLower, getLoteLabelPluralLower } from '@panela/core/lib/labels'

const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE)
import { useConfirm } from '@panela/core/hooks/useConfirm'
import Icon from '@panela/core/components/Icon'
import { SkeletonList } from '@panela/core/components/Skeleton'

// Formulario de Control de Objetos Extraños (detector de metales, durante
// envasado). No es un formato oficial (no se emite documento con código,
// no lleva firmantes) -- es un registro interno por lote de envasado que
// se va completando con inspecciones periódicas durante el día, a criterio
// del responsable, hasta que se da por terminado.
//
// Cada inspección es una de dos cosas excluyentes, nunca las dos juntas
// (confirmado con el usuario 2026-08-24 -- antes se pedían las 4 cosas
// siempre juntas, pero en la práctica una inspección o es una prueba de
// calibración o es un rechazo real, nunca ambas a la vez):
//   'prueba'  -- calibración con una pieza de prueba (no hay producción
//                real de por medio). Pide test (F/NF/AI) + conformidad.
//   'rechazo' -- el detector separó una bolsa real de la línea. Pide
//                cantidad de bolsas separadas.
// "Cantidad de rechazos indicado en el equipo" no es un campo que se
// tipea -- es inspection_number, el correlativo que ya asigna la base de
// datos sola: el equipo físico también cuenta bolsa por bolsa, así que el
// correlativo del sistema ya equivale a leer el contador del equipo.

const TEST_TYPE_LABELS = { F: 'Ferroso (F)', NF: 'No ferroso (NF)', AI: 'Acero inoxidable (AI)' }
const CHECK_TYPE_LABELS = { prueba: 'Prueba', rechazo: 'Rechazo real' }

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nowTimeStr() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function ForeignObjectControlModal({ plantBatch, webUser, onClose, onSaved }) {
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null) // fila de plant_batch_foreign_object_forms, o null si no existe hoy
  const [checks, setChecks] = useState([])
  const [siblings, setSiblings] = useState([])
  const [error, setError] = useState('')

  const [responsiblePerson, setResponsiblePerson] = useState('')
  const [starting, setStarting] = useState(false)

  const [checkTime, setCheckTime] = useState(nowTimeStr())
  const [checkType, setCheckType] = useState('prueba')
  const [bagsSeparated, setBagsSeparated] = useState('0')
  const [testType, setTestType] = useState('F')
  const [conforme, setConforme] = useState(true)
  const [savingCheck, setSavingCheck] = useState(false)

  const [editingCheckId, setEditingCheckId] = useState(null)
  const [editCheckForm, setEditCheckForm] = useState({ check_time: '', check_type: 'prueba', bags_separated: '0', test_type: 'F', conforme: true })
  const [savingEditCheck, setSavingEditCheck] = useState(false)

  const [finalObservations, setFinalObservations] = useState('')
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    const { data: existingForm } = await supabase
      .from('plant_batch_foreign_object_forms')
      .select('*')
      .eq('plant_batch_id', plantBatch.id)
      .eq('control_date', todayStr())
      .maybeSingle()

    if (existingForm) {
      setForm(existingForm)
      const { data: checksData } = await supabase
        .from('plant_batch_foreign_object_checks')
        .select('*')
        .eq('form_id', existingForm.id)
        .order('inspection_number', { ascending: true })
      setChecks(checksData ?? [])
      setFinalObservations(existingForm.final_observations ?? '')
    }

    // Lotes hermanos de la misma orden -- para ver de un vistazo si ya
    // tienen su propio formulario del día, sin salir de este modal.
    if (plantBatch.order_id) {
      const { data: batchesData } = await supabase
        .from('plant_production_batches')
        .select('id, batch_code, client_batch_number, brand')
        .eq('order_id', plantBatch.order_id)
      const otherBatches = (batchesData ?? []).filter(b => b.id !== plantBatch.id)
      if (otherBatches.length) {
        const { data: siblingForms } = await supabase
          .from('plant_batch_foreign_object_forms')
          .select('plant_batch_id, status')
          .in('plant_batch_id', otherBatches.map(b => b.id))
          .eq('control_date', todayStr())
        const statusByBatch = {}
        ;(siblingForms ?? []).forEach(f => { statusByBatch[f.plant_batch_id] = f.status })
        setSiblings(otherBatches.map(b => ({ ...b, status: statusByBatch[b.id] ?? null })))
      }
    }
    setLoading(false)
  }

  async function handleStart() {
    if (!responsiblePerson.trim()) { setError('Ingrese el nombre del responsable.'); return }
    setError(''); setStarting(true)
    try {
      const { data: newForm, error: insErr } = await supabase
        .from('plant_batch_foreign_object_forms')
        .insert({
          cooperative_id: COOPERATIVE.id,
          plant_batch_id: plantBatch.id,
          control_date: todayStr(),
          responsible_person: responsiblePerson.trim(),
        })
        .select('*')
        .single()
      if (insErr) throw new Error(insErr.message)
      setForm(newForm)
    } catch (e) { setError(e.message ?? 'Error al iniciar el formulario') }
    finally { setStarting(false) }
  }

  async function handleAddCheck() {
    if (!checkTime) { setError('Indique la hora de la inspección.'); return }
    let bags = 0
    if (checkType === 'rechazo') {
      bags = parseInt(bagsSeparated, 10)
      if (isNaN(bags) || bags < 0) { setError('La cantidad de bolsas separadas no es válida.'); return }
    }
    setError(''); setSavingCheck(true)
    try {
      const { data: newCheck, error: insErr } = await supabase
        .from('plant_batch_foreign_object_checks')
        .insert({
          form_id: form.id,
          check_time: checkTime,
          check_type: checkType,
          bags_separated: bags,
          test_type: checkType === 'prueba' ? testType : null,
          conforme: checkType === 'prueba' ? conforme : null,
        })
        .select('*')
        .single()
      if (insErr) throw new Error(insErr.message)
      setChecks(prev => [...prev, newCheck])
      setCheckTime(nowTimeStr())
      setCheckType('prueba')
      setBagsSeparated('0')
      setTestType('F')
      setConforme(true)
      // El total de bolsas separadas alimenta envasado_bolsas_rechazo_metal
      // vía trigger de BD -- avisamos al padre para que refresque su copia
      // del lote y no quede desfasada la próxima vez que se abra Envasado.
      onSaved?.()
    } catch (e) { setError(e.message ?? 'Error al guardar la inspección') }
    finally { setSavingCheck(false) }
  }

  async function handleClose() {
    const ok = await confirm({
      title: 'Terminar formulario',
      message: `¿Dar por terminado el control de objetos extraños de este ${LOTE_LABEL_LOWER}? Se registraron ${checks.length} inspección${checks.length !== 1 ? 'es' : ''}. No se van a poder agregar más después de esto.`,
      confirmText: 'Terminar formulario',
    })
    if (!ok) return

    setError(''); setClosing(true)
    try {
      const { data: updatedForm, error: updErr } = await supabase
        .from('plant_batch_foreign_object_forms')
        .update({
          status: 'terminado',
          final_observations: finalObservations.trim() || null,
          closed_by: webUser.id,
          closed_at: new Date().toISOString(),
        })
        .eq('id', form.id)
        .select('*')
        .single()
      if (updErr) throw new Error(updErr.message)
      setForm(updatedForm)
    } catch (e) { setError(e.message ?? 'Error al cerrar el formulario') }
    finally { setClosing(false) }
  }

  async function handleReopen() {
    const ok = await confirm({
      title: 'Reabrir formulario',
      message: `Se van a poder agregar y corregir inspecciones nuevamente. ¿Reabrir el control de objetos extraños de este ${LOTE_LABEL_LOWER}?`,
      confirmText: 'Reabrir formulario',
    })
    if (!ok) return

    setError(''); setReopening(true)
    try {
      const { data: updatedForm, error: updErr } = await supabase
        .from('plant_batch_foreign_object_forms')
        .update({ status: 'en_progreso', closed_by: null, closed_at: null })
        .eq('id', form.id)
        .select('*')
        .single()
      if (updErr) throw new Error(updErr.message)
      setForm(updatedForm)
    } catch (e) { setError(e.message ?? 'Error al reabrir el formulario') }
    finally { setReopening(false) }
  }

  function startEditCheck(c) {
    setError('')
    setEditingCheckId(c.id)
    setEditCheckForm({
      check_time: c.check_time.slice(0, 5),
      check_type: c.check_type,
      bags_separated: String(c.bags_separated),
      test_type: c.test_type ?? 'F',
      conforme: c.conforme ?? true,
    })
  }

  function cancelEditCheck() {
    setEditingCheckId(null)
  }

  async function saveEditCheck(checkId) {
    if (!editCheckForm.check_time) { setError('Indique la hora de la inspección.'); return }
    let bags = 0
    if (editCheckForm.check_type === 'rechazo') {
      bags = parseInt(editCheckForm.bags_separated, 10)
      if (isNaN(bags) || bags < 0) { setError('La cantidad de bolsas separadas no es válida.'); return }
    }
    setError(''); setSavingEditCheck(true)
    try {
      const { data: updatedCheck, error: updErr } = await supabase
        .from('plant_batch_foreign_object_checks')
        .update({
          check_time: editCheckForm.check_time,
          bags_separated: bags,
          test_type: editCheckForm.check_type === 'prueba' ? editCheckForm.test_type : null,
          conforme: editCheckForm.check_type === 'prueba' ? editCheckForm.conforme : null,
        })
        .eq('id', checkId)
        .select('*')
        .single()
      if (updErr) throw new Error(updErr.message)
      setChecks(prev => prev.map(c => c.id === checkId ? updatedCheck : c))
      setEditingCheckId(null)
      onSaved?.()
    } catch (e) { setError(e.message ?? 'Error al guardar la inspección') }
    finally { setSavingEditCheck(false) }
  }

  async function handleDeleteCheck(c) {
    const ok = await confirm({
      title: 'Eliminar inspección',
      message: `¿Eliminar la inspección N° ${c.inspection_number}?`,
      confirmText: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    setError('')
    try {
      const { error: delErr } = await supabase.from('plant_batch_foreign_object_checks').delete().eq('id', c.id)
      if (delErr) throw new Error(delErr.message)
      setChecks(prev => prev.filter(x => x.id !== c.id))
      onSaved?.()
    } catch (e) { setError(e.message ?? 'Error al eliminar la inspección') }
  }

  const isOpen = form?.status === 'en_progreso'

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 640 }}>
        <div className="modal-body">
          <h3 style={{ margin: '0 0 4px' }}>Control de objetos extraños</h3>
          <p className="muted small" style={{ margin: '0 0 16px' }}>
            {loteLabel(plantBatch)} · {plantBatch.brand} · {todayStr().split('-').reverse().join('/')}
          </p>

          {loading ? (
            <SkeletonList count={2} lines={1} />
          ) : !form ? (
            <>
              <div className="field">
                <label>Responsable</label>
                <input type="text" value={responsiblePerson} onChange={e => setResponsiblePerson(e.target.value)} placeholder="Nombre de quien completa el formulario" />
              </div>
              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <span className={`tag dot ${isOpen ? 'info' : 'ok'}`}>{isOpen ? 'En progreso' : 'Terminado'}</span>
                <span className="muted small">Responsable: {form.responsible_person}</span>
                <span className="muted small">{checks.length} inspección{checks.length !== 1 ? 'es' : ''}</span>
              </div>

              {siblings.length > 0 && (
                <div style={{ marginBottom: 12, padding: '8px 10px', background: '#f9fafb', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div className="muted small" style={{ marginBottom: 4 }}>Otros {LOTE_LABEL_PLURAL_LOWER} de esta misma orden hoy:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {siblings.map(s => (
                      <span key={s.id} className={`tag ${s.status === 'terminado' ? 'ok' : s.status === 'en_progreso' ? 'info' : ''}`} style={{ fontSize: 11 }}>
                        {loteLabel(s)}: {s.status === 'terminado' ? 'Terminado' : s.status === 'en_progreso' ? 'En progreso' : 'Sin formulario'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {checks.length > 0 && (
                <table className="table small" style={{ marginBottom: 12 }}>
                  <thead>
                    <tr>
                      <th>N°</th><th>Hora</th><th>Tipo</th><th>Bolsas separadas</th><th>Test</th><th>Conforme</th>
                      {isOpen && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map(c => {
                      if (editingCheckId === c.id) {
                        return (
                          <tr key={c.id}>
                            <td>{c.inspection_number}</td>
                            <td>
                              <input type="time" value={editCheckForm.check_time}
                                onChange={e => setEditCheckForm({ ...editCheckForm, check_time: e.target.value })}
                                style={{ width: 100 }} />
                            </td>
                            <td className="muted small">{CHECK_TYPE_LABELS[editCheckForm.check_type]}</td>
                            <td>
                              {editCheckForm.check_type === 'rechazo' ? (
                                <input type="number" min="0" step="1" value={editCheckForm.bags_separated}
                                  onChange={e => setEditCheckForm({ ...editCheckForm, bags_separated: e.target.value })}
                                  style={{ width: 70 }} />
                              ) : <span className="muted small">—</span>}
                            </td>
                            <td>
                              {editCheckForm.check_type === 'prueba' ? (
                                <select value={editCheckForm.test_type}
                                  onChange={e => setEditCheckForm({ ...editCheckForm, test_type: e.target.value })}>
                                  <option value="F">Ferroso (F)</option>
                                  <option value="NF">No ferroso (NF)</option>
                                  <option value="AI">Acero inoxidable (AI)</option>
                                </select>
                              ) : <span className="muted small">—</span>}
                            </td>
                            <td>
                              {editCheckForm.check_type === 'prueba' ? (
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button type="button" className={`btn small ${editCheckForm.conforme ? 'primary' : 'outline'}`} style={{ padding: '2px 8px' }}
                                    onClick={() => setEditCheckForm({ ...editCheckForm, conforme: true })}>Conforme</button>
                                  <button type="button" className={`btn small ${!editCheckForm.conforme ? 'danger' : 'outline'}`} style={{ padding: '2px 8px' }}
                                    onClick={() => setEditCheckForm({ ...editCheckForm, conforme: false })}>No conforme</button>
                                </div>
                              ) : <span className="muted small">—</span>}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn small primary" style={{ padding: '2px 8px' }} disabled={savingEditCheck} onClick={() => saveEditCheck(c.id)}>Guardar</button>
                                <button className="btn small outline" style={{ padding: '2px 8px' }} disabled={savingEditCheck} onClick={cancelEditCheck}>Cancelar</button>
                              </div>
                            </td>
                          </tr>
                        )
                      }
                      return (
                        <tr key={c.id}>
                          <td>{c.inspection_number}</td>
                          <td>{c.check_time.slice(0, 5)}</td>
                          <td>
                            <span className={`tag ${c.check_type === 'rechazo' ? 'warn' : 'info'}`} style={{ fontSize: 11 }}>
                              {CHECK_TYPE_LABELS[c.check_type]}
                            </span>
                          </td>
                          <td>{c.check_type === 'rechazo' ? c.bags_separated : <span className="muted small">—</span>}</td>
                          <td>{c.check_type === 'prueba' ? TEST_TYPE_LABELS[c.test_type] : <span className="muted small">—</span>}</td>
                          <td>
                            {c.check_type === 'prueba' ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: c.conforme ? 'var(--success)' : '#dc2626' }}>
                                <Icon name={c.conforme ? 'check' : 'x'} size={13} />
                                {c.conforme ? 'Conforme' : 'No conforme'}
                              </span>
                            ) : <span className="muted small">—</span>}
                          </td>
                          {isOpen && (
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn small outline" style={{ padding: '2px 8px' }} onClick={() => startEditCheck(c)}>Editar</button>
                                <button className="btn small danger" style={{ padding: '2px 8px' }} onClick={() => handleDeleteCheck(c)}>Eliminar</button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {isOpen && (
                <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 14px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary-600)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    Nueva inspección
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Tipo de inspección</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className={`btn small ${checkType === 'prueba' ? 'primary' : 'outline'}`} onClick={() => setCheckType('prueba')}>
                        Prueba (calibración)
                      </button>
                      <button type="button" className={`btn small ${checkType === 'rechazo' ? 'primary' : 'outline'}`} onClick={() => setCheckType('rechazo')}>
                        Rechazo real
                      </button>
                    </div>
                  </div>
                  <div className="grid" style={{ gap: 8 }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Hora</label>
                      <input type="time" value={checkTime} onChange={e => setCheckTime(e.target.value)} />
                    </div>
                    {checkType === 'rechazo' ? (
                      <div className="field" style={{ margin: 0 }}>
                        <label>Bolsas separadas</label>
                        <input type="number" min="0" step="1" value={bagsSeparated} onChange={e => setBagsSeparated(e.target.value)} />
                      </div>
                    ) : (
                      <div className="field" style={{ margin: 0 }}>
                        <label>Tipo de test</label>
                        <select value={testType} onChange={e => setTestType(e.target.value)}>
                          <option value="F">Ferroso (F)</option>
                          <option value="NF">No ferroso (NF)</option>
                          <option value="AI">Acero inoxidable (AI)</option>
                        </select>
                      </div>
                    )}
                  </div>
                  {checkType === 'prueba' && (
                    <div className="field" style={{ margin: 0 }}>
                      <label>¿El detector reconoció la prueba?</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className={`btn small ${conforme ? 'primary' : 'outline'}`} onClick={() => setConforme(true)}>Conforme</button>
                        <button type="button" className={`btn small ${!conforme ? 'danger' : 'outline'}`} onClick={() => setConforme(false)}>No conforme</button>
                      </div>
                    </div>
                  )}
                  <button className="btn small primary" onClick={handleAddCheck} disabled={savingCheck} style={{ alignSelf: 'flex-start' }}>
                    {savingCheck ? 'Guardando...' : '+ Agregar inspección'}
                  </button>
                </div>
              )}

              <div className="field">
                <label>Observación final {!isOpen && '(cerrado)'}</label>
                <textarea
                  rows={2}
                  value={finalObservations}
                  onChange={e => setFinalObservations(e.target.value)}
                  placeholder="Notas del día (opcional)"
                  disabled={!isOpen}
                />
              </div>

              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn small" onClick={onClose}>Cerrar</button>
          {!loading && !form && (
            <button className="btn small primary" onClick={handleStart} disabled={starting}>
              {starting ? 'Iniciando...' : 'Iniciar formulario'}
            </button>
          )}
          {!loading && isOpen && (
            <button className="btn small danger" onClick={handleClose} disabled={closing}>
              {closing ? 'Guardando...' : 'Terminar formulario'}
            </button>
          )}
          {!loading && form && !isOpen && (
            <button className="btn small outline" onClick={handleReopen} disabled={reopening}>
              {reopening ? 'Reabriendo...' : 'Reabrir formulario'}
            </button>
          )}
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}
