import { useState, useEffect, Fragment } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { loteLabel } from '@panela/core/lib/loteHelpers'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { getLoteLabelLower } from '@panela/core/lib/labels'

const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
import { useConfirm } from '@panela/core/hooks/useConfirm'
import { SkeletonList } from '@panela/core/components/Skeleton'

// Formulario de Control de Pesos y Sellado (COA-PPA-GCA-RG-005) -- durante
// el envasado de un lote, cada hora se sacan 10 bolsas de muestra de la
// línea y se registra peso/sellado/limpieza de cada una. A diferencia de
// los controles SIG generales de planta (Higiene, Ambientes, Equipos,
// Verificación, Cloro Residual, Plagas), este está atado a un lote
// puntual -- mismo patrón que Control de Objetos Extraños
// (ForeignObjectControlModal.jsx): 1 formulario por (lote, fecha, turno)
// que se completa agregando "horas" una por una hasta darlo por terminado.
// A diferencia de Objetos Extraños, aquí SÍ se separa por turno (mañana y
// tarde pueden ser 2 formularios independientes el mismo día).
//
// El peso objetivo (nominal) es el packaging_kg real del lote convertido a
// gramos -- no un valor fijo de 500g -- porque el tamaño de bolsa varía
// por lote. Tolerancia: +1gr sobre el nominal; por debajo del nominal se
// resalta (el papel dice que esas bolsas se desechan).

const TURNOS = { manana: 'Mañana', tarde: 'Tarde' }
const MUESTRAS = Array.from({ length: 10 }, (_, i) => i + 1)
// Franjas horarias de planta, 7:00 a 22:00 -- por ahora una sola lista fija
// para ambos turnos (no se separa mañana/tarde todavía).
const HORA_OPTIONS = Array.from({ length: 15 }, (_, i) => `${7 + i}-${8 + i}`)

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptySamples() {
  // Sellado y limpieza arrancan en el estado "bueno" -- alcanza con tocar
  // las excepciones. El peso NO se defaultea: es una medición real, hay
  // que pesarla.
  return MUESTRAS.map(n => ({ muestra_number: n, pesoGr: '', sellado: 'A', limpieza: true }))
}

// Arma las 10 filas editables de una hora ya guardada, completando con los
// valores reales donde existan y en blanco donde no se tomó esa muestra --
// mismo criterio que emptySamples() para las que faltan.
function samplesFromCheck(check) {
  const byNumber = {}
  for (const s of check.samples) byNumber[s.muestra_number] = s
  return MUESTRAS.map(n => {
    const existing = byNumber[n]
    return existing
      ? { muestra_number: n, pesoGr: String(existing.peso_gr), sellado: existing.sellado, limpieza: existing.limpieza }
      : { muestra_number: n, pesoGr: '', sellado: 'A', limpieza: true }
  })
}

export default function WeightSealControlModal({ plantBatch, webUser, onClose }) {
  const { confirm, dialog: confirmDialog } = useConfirm()

  const nominalGr = plantBatch.packaging_kg ? Number(plantBatch.packaging_kg) * 1000 : null

  const [turno, setTurno] = useState('manana')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [checks, setChecks] = useState([]) // [{ ...check, samples: [...] }]
  const [error, setError] = useState('')

  const [responsiblePerson, setResponsiblePerson] = useState('')
  const [starting, setStarting] = useState(false)

  const [horaLabel, setHoraLabel] = useState('')
  const [samples, setSamples] = useState(emptySamples())
  const [savingCheck, setSavingCheck] = useState(false)

  const [editingCheckId, setEditingCheckId] = useState(null)
  const [editHoraLabel, setEditHoraLabel] = useState('')
  const [editSamples, setEditSamples] = useState(emptySamples())
  const [savingEditCheck, setSavingEditCheck] = useState(false)

  const [finalObservations, setFinalObservations] = useState('')
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)

  useEffect(() => { load() }, [turno])

  async function load() {
    setLoading(true)
    setError('')
    const { data: existingForm } = await supabase
      .from('plant_batch_weight_seal_forms')
      .select('*')
      .eq('plant_batch_id', plantBatch.id)
      .eq('control_date', todayStr())
      .eq('turno', turno)
      .maybeSingle()

    if (existingForm) {
      setForm(existingForm)
      const { data: checksData } = await supabase
        .from('plant_batch_weight_seal_checks')
        .select('*, plant_batch_weight_seal_samples ( * )')
        .eq('form_id', existingForm.id)
        .order('check_number', { ascending: true })
      setChecks((checksData ?? []).map(c => ({
        ...c,
        samples: (c.plant_batch_weight_seal_samples ?? []).sort((a, b) => a.muestra_number - b.muestra_number),
      })))
      setFinalObservations(existingForm.final_observations ?? '')
    } else {
      setForm(null)
      setChecks([])
      setFinalObservations('')
    }
    setHoraLabel('')
    setSamples(emptySamples())
    setLoading(false)
  }

  async function handleStart() {
    if (!responsiblePerson.trim()) { setError('Ingrese el nombre del responsable.'); return }
    setError(''); setStarting(true)
    try {
      const { data: newForm, error: insErr } = await supabase
        .from('plant_batch_weight_seal_forms')
        .insert({
          cooperative_id: COOPERATIVE.id,
          plant_batch_id: plantBatch.id,
          control_date: todayStr(),
          turno,
          responsible_person: responsiblePerson.trim(),
          created_by: webUser.id,
        })
        .select('*')
        .single()
      if (insErr) throw new Error(insErr.message)
      setForm(newForm)
    } catch (e) { setError(e.message ?? 'Error al iniciar el formulario') }
    finally { setStarting(false) }
  }

  function updateSample(muestraNumber, field, value) {
    setSamples(prev => prev.map(s => s.muestra_number === muestraNumber ? { ...s, [field]: value } : s))
  }

  async function handleAddCheck() {
    if (!horaLabel.trim()) { setError('Indique la hora (ej. 7-8).'); return }
    setError(''); setSavingCheck(true)
    try {
      const { data: newCheck, error: insErr } = await supabase
        .from('plant_batch_weight_seal_checks')
        .insert({ form_id: form.id, hora_label: horaLabel.trim(), created_by: webUser.id })
        .select('*')
        .single()
      if (insErr) throw new Error(insErr.message)

      const sampleRows = samples
        .filter(s => s.pesoGr !== '')
        .map(s => ({
          check_id: newCheck.id,
          muestra_number: s.muestra_number,
          peso_gr: Number(s.pesoGr),
          sellado: s.sellado,
          limpieza: s.limpieza,
        }))
      if (sampleRows.length > 0) {
        const { error: sampErr } = await supabase.from('plant_batch_weight_seal_samples').insert(sampleRows)
        if (sampErr) throw new Error(sampErr.message)
      }

      setChecks(prev => [...prev, { ...newCheck, samples: sampleRows.map(r => ({ ...r })) }])
      setHoraLabel('')
      setSamples(emptySamples())
    } catch (e) { setError(e.message ?? 'Error al guardar la hora') }
    finally { setSavingCheck(false) }
  }

  function startEditCheck(c) {
    setError('')
    setEditingCheckId(c.id)
    setEditHoraLabel(c.hora_label)
    setEditSamples(samplesFromCheck(c))
  }

  function cancelEditCheck() {
    setEditingCheckId(null)
  }

  function updateEditSample(muestraNumber, field, value) {
    setEditSamples(prev => prev.map(s => s.muestra_number === muestraNumber ? { ...s, [field]: value } : s))
  }

  // Mismo criterio que handleAddCheck para las muestras: se borran todas
  // las de esta hora y se insertan de nuevo según lo que quedó en el
  // formulario -- más simple que comparar cuál cambió, cuál se agregó y
  // cuál se sacó una por una.
  async function saveEditCheck(checkId) {
    if (!editHoraLabel.trim()) { setError('Indique la hora.'); return }
    setError(''); setSavingEditCheck(true)
    try {
      const { error: updErr } = await supabase
        .from('plant_batch_weight_seal_checks')
        .update({ hora_label: editHoraLabel.trim() })
        .eq('id', checkId)
      if (updErr) throw new Error(updErr.message)

      await supabase.from('plant_batch_weight_seal_samples').delete().eq('check_id', checkId)
      const sampleRows = editSamples
        .filter(s => s.pesoGr !== '')
        .map(s => ({
          check_id: checkId,
          muestra_number: s.muestra_number,
          peso_gr: Number(s.pesoGr),
          sellado: s.sellado,
          limpieza: s.limpieza,
        }))
      if (sampleRows.length > 0) {
        const { error: sampErr } = await supabase.from('plant_batch_weight_seal_samples').insert(sampleRows)
        if (sampErr) throw new Error(sampErr.message)
      }

      setChecks(prev => prev.map(c => c.id === checkId ? { ...c, hora_label: editHoraLabel.trim(), samples: sampleRows.map(r => ({ ...r })) } : c))
      setEditingCheckId(null)
    } catch (e) { setError(e.message ?? 'Error al guardar la hora') }
    finally { setSavingEditCheck(false) }
  }

  async function handleDeleteCheck(c) {
    const ok = await confirm({
      title: 'Eliminar hora',
      message: `¿Eliminar la hora ${c.hora_label}? Se van a borrar también sus ${c.samples.length} muestra(s).`,
      confirmText: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    setError('')
    try {
      const { error: delErr } = await supabase.from('plant_batch_weight_seal_checks').delete().eq('id', c.id)
      if (delErr) throw new Error(delErr.message)
      setChecks(prev => prev.filter(x => x.id !== c.id))
    } catch (e) { setError(e.message ?? 'Error al eliminar la hora') }
  }

  async function handleReopen() {
    const ok = await confirm({
      title: 'Reabrir formulario',
      message: `Se van a poder agregar y corregir horas nuevamente. ¿Reabrir el control de pesos y sellado de este ${LOTE_LABEL_LOWER}?`,
      confirmText: 'Reabrir formulario',
    })
    if (!ok) return

    setError(''); setReopening(true)
    try {
      const { data: updatedForm, error: updErr } = await supabase
        .from('plant_batch_weight_seal_forms')
        .update({ status: 'en_progreso', closed_by: null, closed_at: null })
        .eq('id', form.id)
        .select('*')
        .single()
      if (updErr) throw new Error(updErr.message)
      setForm(updatedForm)
    } catch (e) { setError(e.message ?? 'Error al reabrir el formulario') }
    finally { setReopening(false) }
  }

  async function handleClose() {
    const ok = await confirm({
      title: 'Terminar formulario',
      message: `¿Dar por terminado el control de pesos y sellado de este ${LOTE_LABEL_LOWER} (${TURNOS[turno]})? Se registraron ${checks.length} hora${checks.length !== 1 ? 's' : ''}. No se van a poder agregar más después de esto.`,
      confirmText: 'Terminar formulario',
    })
    if (!ok) return

    setError(''); setClosing(true)
    try {
      const { data: updatedForm, error: updErr } = await supabase
        .from('plant_batch_weight_seal_forms')
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

  const isOpen = form?.status === 'en_progreso'

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 760 }}>
        <div className="modal-body">
          <h3 style={{ margin: '0 0 4px' }}>Control de Pesos y Sellado</h3>
          <p className="muted small" style={{ margin: '0 0 12px' }}>
            {loteLabel(plantBatch)} · {plantBatch.brand} · {todayStr().split('-').reverse().join('/')}
            {nominalGr != null && ` · Peso nominal: ${nominalGr}g (+1g)`}
          </p>

          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {Object.entries(TURNOS).map(([v, lbl]) => (
              <button key={v} className={`btn small ${turno === v ? 'primary' : 'outline'}`} onClick={() => setTurno(v)}>{lbl}</button>
            ))}
          </div>

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
                <span className="muted small">{checks.length} hora{checks.length !== 1 ? 's' : ''} registrada{checks.length !== 1 ? 's' : ''}</span>
              </div>

              {checks.length > 0 && (
                <div style={{ overflowX: 'auto', marginBottom: 12 }}>
                  <table className="table small">
                    <thead>
                      <tr>
                        <th>Hora</th><th>Muestras</th><th>Peso min-max (g)</th><th>Sellado malo</th><th>Limpieza no OK</th>
                        {isOpen && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {checks.map(c => {
                        const pesos = c.samples.map(s => Number(s.peso_gr)).filter(v => !isNaN(v))
                        const badSellado = c.samples.filter(s => s.sellado === 'B').length
                        const badLimpieza = c.samples.filter(s => s.limpieza === false).length
                        const belowNominal = nominalGr != null && pesos.some(p => p < nominalGr)
                        return (
                          <Fragment key={c.id}>
                            <tr>
                              <td>{c.hora_label}</td>
                              <td>{c.samples.length}</td>
                              <td style={{ color: belowNominal ? '#dc2626' : undefined, fontWeight: belowNominal ? 700 : undefined }}>
                                {pesos.length > 0 ? `${Math.min(...pesos)} - ${Math.max(...pesos)}` : '—'}
                              </td>
                              <td style={{ color: badSellado > 0 ? '#dc2626' : undefined }}>{badSellado}</td>
                              <td style={{ color: badLimpieza > 0 ? '#dc2626' : undefined }}>{badLimpieza}</td>
                              {isOpen && (
                                <td>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <button className="btn small outline" style={{ padding: '2px 8px' }} onClick={() => editingCheckId === c.id ? cancelEditCheck() : startEditCheck(c)}>
                                      {editingCheckId === c.id ? 'Cancelar' : 'Editar'}
                                    </button>
                                    <button className="btn small danger" style={{ padding: '2px 8px' }} onClick={() => handleDeleteCheck(c)}>Eliminar</button>
                                  </div>
                                </td>
                              )}
                            </tr>
                            {editingCheckId === c.id && (
                              <tr>
                                <td colSpan={isOpen ? 6 : 5} style={{ background: '#f9fafb', padding: '10px 12px' }}>
                                  <div className="field" style={{ margin: '0 0 10px', maxWidth: 160 }}>
                                    <label>Hora</label>
                                    <select value={editHoraLabel} onChange={e => setEditHoraLabel(e.target.value)}>
                                      <option value="">Elegir hora...</option>
                                      {HORA_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
                                    </select>
                                  </div>
                                  <div style={{ overflowX: 'auto' }}>
                                    <table className="table small" style={{ minWidth: '100%' }}>
                                      <thead>
                                        <tr><th>Muestra</th><th>Peso (g)</th><th>Sellado</th><th>Limpieza</th></tr>
                                      </thead>
                                      <tbody>
                                        {editSamples.map(s => {
                                          const isLow = nominalGr != null && s.pesoGr !== '' && Number(s.pesoGr) < nominalGr
                                          return (
                                            <tr key={s.muestra_number}>
                                              <td>{s.muestra_number}</td>
                                              <td>
                                                <input
                                                  type="number" step="0.1" min="0" value={s.pesoGr}
                                                  onChange={e => updateEditSample(s.muestra_number, 'pesoGr', e.target.value)}
                                                  style={{ width: 80, fontSize: 12, color: isLow ? '#dc2626' : undefined, fontWeight: isLow ? 700 : undefined }}
                                                />
                                              </td>
                                              <td>
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                  <button type="button" className={`btn small ${s.sellado === 'A' ? 'primary' : 'outline'}`} onClick={() => updateEditSample(s.muestra_number, 'sellado', 'A')}>A</button>
                                                  <button type="button" className={`btn small ${s.sellado === 'B' ? 'danger' : 'outline'}`} onClick={() => updateEditSample(s.muestra_number, 'sellado', 'B')}>B</button>
                                                </div>
                                              </td>
                                              <td>
                                                <input type="checkbox" checked={s.limpieza} onChange={e => updateEditSample(s.muestra_number, 'limpieza', e.target.checked)} />
                                              </td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                                    <button className="btn small primary" onClick={() => saveEditCheck(c.id)} disabled={savingEditCheck}>
                                      {savingEditCheck ? 'Guardando...' : 'Guardar hora'}
                                    </button>
                                    <button className="btn small outline" onClick={cancelEditCheck} disabled={savingEditCheck}>Cancelar</button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {isOpen && (
                <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary-600)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>
                    Nueva hora
                  </div>
                  <div className="field" style={{ margin: '0 0 10px', maxWidth: 160 }}>
                    <label>Hora</label>
                    <select value={horaLabel} onChange={e => setHoraLabel(e.target.value)}>
                      <option value="">Elegir hora...</option>
                      {HORA_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table small" style={{ minWidth: '100%' }}>
                      <thead>
                        <tr><th>Muestra</th><th>Peso (g)</th><th>Sellado</th><th>Limpieza</th></tr>
                      </thead>
                      <tbody>
                        {samples.map(s => {
                          const isLow = nominalGr != null && s.pesoGr !== '' && Number(s.pesoGr) < nominalGr
                          return (
                            <tr key={s.muestra_number}>
                              <td>{s.muestra_number}</td>
                              <td>
                                <input
                                  type="number" step="0.1" min="0" value={s.pesoGr}
                                  onChange={e => updateSample(s.muestra_number, 'pesoGr', e.target.value)}
                                  style={{ width: 80, fontSize: 12, color: isLow ? '#dc2626' : undefined, fontWeight: isLow ? 700 : undefined }}
                                />
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button type="button" className={`btn small ${s.sellado === 'A' ? 'primary' : 'outline'}`} onClick={() => updateSample(s.muestra_number, 'sellado', 'A')}>A</button>
                                  <button type="button" className={`btn small ${s.sellado === 'B' ? 'danger' : 'outline'}`} onClick={() => updateSample(s.muestra_number, 'sellado', 'B')}>B</button>
                                </div>
                              </td>
                              <td>
                                <input type="checkbox" checked={s.limpieza} onChange={e => updateSample(s.muestra_number, 'limpieza', e.target.checked)} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted small" style={{ margin: '6px 0 0' }}>Sellado: A = buen sellado, B = mal sellado (mucho aire / extremo quemado). Deje el peso en blanco si esa muestra no se tomó.</p>
                  <button className="btn small primary" onClick={handleAddCheck} disabled={savingCheck} style={{ marginTop: 10 }}>
                    {savingCheck ? 'Guardando...' : '+ Agregar hora'}
                  </button>
                </div>
              )}

              <div className="field">
                <label>Observación final {!isOpen && '(cerrado)'}</label>
                <textarea
                  rows={2}
                  value={finalObservations}
                  onChange={e => setFinalObservations(e.target.value)}
                  placeholder="Notas del turno (opcional)"
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
