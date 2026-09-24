import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { loadHigienePersonalAreas } from '@panela/core/lib/formConfig'
import { HYGIENE_CRITERIA } from '../lib/formatos/saludHigienePersonal'
import { getCoopCode } from '@panela/core/lib/formatos/shared'
import { useConfirm } from '@panela/core/hooks/useConfirm'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import DateInput from '@panela/core/components/DateInput'

// Control de Salud e Higiene del Personal (SIG-GIA-RG-005) -- registro
// independiente de cualquier orden/lote: 1 control por (fecha, turno,
// área), con un roster de personal de planta y sus 9 criterios de
// higiene. No lleva relación a plant_orders a propósito -- un mismo
// control puede aplicar a varios contenedores activos ese día; el
// documento de una orden lo cruza por fecha (ver quickDocs.js).

const TURNOS = { manana: 'Mañana', tarde: 'Tarde' }
const STATUS_LABEL = { cumple: 'Cumple', no_cumple: 'No cumple', na: 'No aplica' }

// Click cicla: cumple -> no_cumple -> no aplica -> cumple. Mismo patrón ya
// usado en los controles de checklist en grilla (ver LimpiezaAmbientesPage.jsx),
// más amigable que abrir un <select> por cada criterio de cada trabajador.
const HYGIENE_STATUS_CYCLE = ['cumple', 'no_cumple', 'na']
function nextHygieneStatus(current) {
  const idx = HYGIENE_STATUS_CYCLE.indexOf(current)
  return HYGIENE_STATUS_CYCLE[(idx + 1) % HYGIENE_STATUS_CYCLE.length]
}
function hygieneCellStyle(status) {
  if (status === 'cumple') return { color: '#166534', background: '#dcfce7', borderColor: 'var(--success)' }
  if (status === 'no_cumple') return { color: '#991b1b', background: '#fee2e2', borderColor: '#dc2626' }
  return { color: 'var(--primary-600)', background: 'rgba(15,76,92,0.10)', borderColor: 'var(--primary)' }
}
function hygieneCellSymbol(status) {
  if (status === 'cumple') return '✓'
  if (status === 'no_cumple') return '✕'
  return 'N/A'
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return new Date(+y, +m - 1, +d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function defaultCriteria() {
  return Object.fromEntries(HYGIENE_CRITERIA.map(c => [c.code, 'cumple']))
}

// % de cumplimiento de un control ya guardado (historial) -- solo cuenta
// trabajadores que asistieron, y de sus criterios excluye "no aplica"
// (no es lo mismo no aplicar que no cumplir).
function calcCompliance(workers) {
  let total = 0, ok = 0
  for (const w of (workers ?? [])) {
    if (!w.attended) continue
    for (const c of (w.plant_hygiene_control_criteria ?? [])) {
      if (c.status === 'na') continue
      total++
      if (c.status === 'cumple') ok++
    }
  }
  return total === 0 ? null : Math.round((ok / total) * 100)
}

function complianceTag(pct) {
  if (pct === null) return null
  const cls = pct === 100 ? 'ok' : pct >= 75 ? 'warn' : 'error-tag'
  return <span className={`tag ${cls}`}>{pct}% cumplimiento</span>
}

export default function HigienePage() {
  const webUser = useAuthStore(s => s.webUser)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [view, setView] = useState('history') // 'history' | 'form'
  const [controls, setControls] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [personnel, setPersonnel] = useState([])
  const [areas, setAreas] = useState([])

  const [editingId, setEditingId] = useState(null)
  const [controlDate, setControlDate] = useState(todayStr())
  const [turno, setTurno] = useState('manana')
  const [area, setArea] = useState('')
  const [responsiblePerson, setResponsiblePerson] = useState('')
  const [observations, setObservations] = useState('')
  // roster: { [personnelId]: { attended: bool, criteria: { item_code: status } } }
  const [roster, setRoster] = useState({})
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_hygiene_controls')
      .select(`
        id, control_date, turno, area, responsible_person, observations, formato_codigo,
        plant_hygiene_control_workers (
          attended,
          plant_personnel ( first_name, last_name ),
          plant_hygiene_control_criteria ( item_code, status )
        ),
        registered_by:web_users!phc_created_by_fkey ( first_name, last_name )
      `)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('control_date', { ascending: false })
      .order('turno')
      .order('area')
      .limit(100)
    setControls(data ?? [])
    setLoadingHistory(false)
  }, [])

  const loadPersonnel = useCallback(async () => {
    const { data } = await supabase
      .from('plant_personnel')
      .select('id, first_name, last_name, is_active')
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('is_active', true)
      .order('first_name')
    setPersonnel(data ?? [])
  }, [])

  useEffect(() => { loadHistory(); loadPersonnel(); loadHigienePersonalAreas(COOPERATIVE).then(setAreas) }, [loadHistory, loadPersonnel])

  function rosterFromPersonnelList(list) {
    const next = {}
    for (const p of list) next[p.id] = { attended: true, criteria: defaultCriteria() }
    return next
  }

  function startNewControl() {
    setEditingId(null)
    setControlDate(todayStr())
    setTurno('manana')
    // Sin default -- si quedara preseleccionada la primera área de la
    // lista, es fácil guardar dos controles con la misma fecha+turno+área
    // sin darse cuenta (choca con el UNIQUE de la tabla). Obliga a elegir.
    setArea('')
    setResponsiblePerson('')
    setObservations('')
    setRoster(rosterFromPersonnelList(personnel))
    setNewFirstName('')
    setNewLastName('')
    setError('')
    setView('form')
  }

  async function startEditControl(control) {
    setEditingId(control.id)
    setControlDate(control.control_date)
    setTurno(control.turno)
    setArea(control.area)
    setResponsiblePerson(control.responsible_person ?? '')
    setObservations(control.observations ?? '')

    // Necesitamos los personnel_id reales (no vienen en el historial
    // resumido de arriba), así que se piden de nuevo con la relación completa.
    const { data: workers } = await supabase
      .from('plant_hygiene_control_workers')
      .select('personnel_id, attended, plant_hygiene_control_criteria ( item_code, status )')
      .eq('control_id', control.id)

    const next = rosterFromPersonnelList(personnel)
    for (const w of (workers ?? [])) {
      next[w.personnel_id] = {
        attended: w.attended,
        criteria: {
          ...defaultCriteria(),
          ...Object.fromEntries((w.plant_hygiene_control_criteria ?? []).map(c => [c.item_code, c.status])),
        },
      }
    }
    setRoster(next)
    setNewFirstName('')
    setNewLastName('')
    setError('')
    setView('form')
  }

  function toggleAttended(personnelId) {
    setRoster(prev => ({ ...prev, [personnelId]: { ...prev[personnelId], attended: !prev[personnelId]?.attended } }))
  }

  function setCriterionStatus(personnelId, itemCode, status) {
    setRoster(prev => ({
      ...prev,
      [personnelId]: { ...prev[personnelId], criteria: { ...prev[personnelId]?.criteria, [itemCode]: status } },
    }))
  }

  async function handleAddPersonnel() {
    if (!newFirstName.trim() || !newLastName.trim()) { setError('Ingrese nombre y apellido del trabajador.'); return }
    setError('')
    try {
      const { data: newPerson, error: insErr } = await supabase
        .from('plant_personnel')
        .insert({ cooperative_id: COOPERATIVE.id, first_name: newFirstName.trim(), last_name: newLastName.trim() })
        .select('id, first_name, last_name, is_active')
        .single()
      if (insErr) throw new Error(insErr.message)
      setPersonnel(prev => [...prev, newPerson].sort((a, b) => a.first_name.localeCompare(b.first_name)))
      setRoster(prev => ({ ...prev, [newPerson.id]: { attended: true, criteria: defaultCriteria() } }))
      setNewFirstName('')
      setNewLastName('')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDeactivatePersonnel(person) {
    const ok = await confirm({
      title: 'Dar de baja del catálogo',
      message: `¿Dar de baja a ${person.first_name} ${person.last_name}? No va a aparecer en los próximos controles, pero se conservan sus registros anteriores.`,
      confirmText: 'Dar de baja',
    })
    if (!ok) return
    await supabase.from('plant_personnel').update({ is_active: false }).eq('id', person.id)
    setPersonnel(prev => prev.filter(p => p.id !== person.id))
    setRoster(prev => {
      const next = { ...prev }
      delete next[person.id]
      return next
    })
  }

  async function handleSave() {
    setError('')
    if (!controlDate) { setError('Seleccione la fecha.'); return }
    if (!area) { setError('Seleccione el área.'); return }
    if (!responsiblePerson.trim()) { setError('Ingrese el responsable.'); return }

    setSaving(true)
    try {
      let controlId = editingId
      if (controlId) {
        const { error: updErr } = await supabase
          .from('plant_hygiene_controls')
          .update({
            control_date: controlDate, turno, area,
            responsible_person: responsiblePerson.trim(),
            observations: observations.trim() || null,
          })
          .eq('id', controlId)
        if (updErr) throw new Error(updErr.message)
        await supabase.from('plant_hygiene_control_workers').delete().eq('control_id', controlId)
      } else {
        const { data: codigo, error: codeErr } = await supabase
          .rpc('generate_hygiene_control_code', { p_cooperative_id: COOPERATIVE.id, p_coop_code: getCoopCode(COOPERATIVE) })
        if (codeErr) throw new Error(codeErr.message)
        const { data: newControl, error: insErr } = await supabase
          .from('plant_hygiene_controls')
          .insert({
            cooperative_id: COOPERATIVE.id,
            control_date: controlDate, turno, area,
            responsible_person: responsiblePerson.trim(),
            observations: observations.trim() || null,
            created_by: webUser.id, formato_codigo: codigo,
          })
          .select('id')
          .single()
        if (insErr) {
          if (insErr.code === '23505') {
            throw new Error('Ya existe un control para esta fecha, turno y área. Búsquelo en el historial y edítelo, o cambie la fecha/turno/área.')
          }
          throw new Error(insErr.message)
        }
        controlId = newControl.id
      }

      for (const [personnelId, entry] of Object.entries(roster)) {
        const { data: newWorker, error: workerErr } = await supabase
          .from('plant_hygiene_control_workers')
          .insert({ control_id: controlId, personnel_id: personnelId, attended: entry.attended })
          .select('id')
          .single()
        if (workerErr) throw new Error(workerErr.message)

        if (entry.attended) {
          const { error: critErr } = await supabase
            .from('plant_hygiene_control_criteria')
            .insert(HYGIENE_CRITERIA.map(c => ({
              control_worker_id: newWorker.id,
              item_code: c.code,
              status: entry.criteria?.[c.code] ?? 'cumple',
            })))
          if (critErr) throw new Error(critErr.message)
        }
      }

      setView('history')
      await loadHistory()
    } catch (err) {
      setError(err.message ?? 'Error al guardar el control')
    } finally {
      setSaving(false)
    }
  }

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>Salud e Higiene del Personal</h2>
          <button className="btn primary" onClick={startNewControl}>+ Nuevo control</button>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay controles de higiene registrados aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const pct = calcCompliance(c.plant_hygiene_control_workers)
              const nWorkers = c.plant_hygiene_control_workers?.length ?? 0
              const nAttended = (c.plant_hygiene_control_workers ?? []).filter(w => w.attended).length
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{formatDate(c.control_date)}</strong>
                      <span className="muted small" style={{ marginLeft: 8 }}>{TURNOS[c.turno] ?? c.turno} · {c.area}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {complianceTag(pct)}
                      <button className="btn small outline" onClick={() => startEditControl(c)}>Editar</button>
                    </div>
                  </div>
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                    {c.formato_codigo && <>Código de Control: <strong style={{ fontFamily: 'monospace' }}>{c.formato_codigo}</strong> · </>}
                    Responsable: {c.responsible_person ?? '—'} · {nAttended}/{nWorkers} trabajador{nWorkers !== 1 ? 'es' : ''} presente{nAttended !== 1 ? 's' : ''}
                    {c.registered_by && ` · Registrado por: ${c.registered_by.first_name} ${c.registered_by.last_name}`}
                  </div>
                  {c.observations && <div className="meta" style={{ fontSize: 12 }}>Observaciones: {c.observations}</div>}
                </div>
              )
            })}
          </div>
        )}
        {confirmDialog}
      </div>
    )
  }

  // ─── FORMULARIO ───────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <h2>{editingId ? 'Editar control' : 'Nuevo control'} de higiene</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Fecha</label>
            <DateInput value={controlDate} onChange={e => setControlDate(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Turno</label>
            <select value={turno} onChange={e => setTurno(e.target.value)}>
              <option value="manana">Mañana</option>
              <option value="tarde">Tarde</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Área</label>
            <select value={area} onChange={e => setArea(e.target.value)}>
              <option value="">Seleccione...</option>
              {areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Responsable</label>
            <input type="text" value={responsiblePerson} onChange={e => setResponsiblePerson(e.target.value)} placeholder="Nombre de quien completa el control" />
          </div>
        </div>
        <div className="field">
          <label>Observaciones</label>
          <textarea rows={2} value={observations} onChange={e => setObservations(e.target.value)} placeholder="Ej: el Sr. Juan Pérez no asistió a laborar" />
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Personal</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" placeholder="Nombre" value={newFirstName} onChange={e => setNewFirstName(e.target.value)} style={{ width: 130 }} />
            <input type="text" placeholder="Apellido" value={newLastName} onChange={e => setNewLastName(e.target.value)} style={{ width: 130 }} />
            <button className="btn small outline" onClick={handleAddPersonnel}>+ Agregar al catálogo</button>
          </div>
        </div>
        <p className="muted small" style={{ margin: '0 0 10px' }}>
          Cada criterio arranca en ✓ (cumple) — clic en la celda para ciclar: ✓ cumple → ✕ no cumple → N/A → ✓ cumple.
        </p>

        {personnel.length === 0 ? (
          <p className="muted small">Todavía no hay personal cargado -- agregue el primero arriba.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table small">
              <thead>
                <tr>
                  <th>Asistió</th>
                  <th style={{ textAlign: 'left' }}>Nombre</th>
                  {HYGIENE_CRITERIA.map(c => <th key={c.code}>{c.label}</th>)}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {personnel.map(p => {
                  const entry = roster[p.id] ?? { attended: true, criteria: defaultCriteria() }
                  return (
                    <tr key={p.id} style={{ opacity: entry.attended ? 1 : 0.5 }}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={!!entry.attended} onChange={() => toggleAttended(p.id)} />
                      </td>
                      <td>{p.first_name} {p.last_name}</td>
                      {HYGIENE_CRITERIA.map(c => {
                        const status = entry.criteria?.[c.code] ?? 'cumple'
                        return (
                          <td key={c.code} style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              disabled={!entry.attended}
                              onClick={() => setCriterionStatus(p.id, c.code, nextHygieneStatus(status))}
                              title={`${STATUS_LABEL[status]} — clic para cambiar`}
                              style={{
                                width: 34, height: 26, borderRadius: 6, border: '1px solid',
                                fontWeight: 700, fontSize: status === 'na' ? 10 : 14,
                                cursor: entry.attended ? 'pointer' : 'not-allowed',
                                ...hygieneCellStyle(status),
                              }}
                            >
                              {hygieneCellSymbol(status)}
                            </button>
                          </td>
                        )
                      })}
                      <td>
                        <button
                          className="btn small outline"
                          style={{ fontSize: 11, padding: '2px 6px' }}
                          onClick={() => handleDeactivatePersonnel(p)}
                          title="Dar de baja del catálogo"
                        >
                          <Icon name="x" size={11} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn small" onClick={() => setView('history')} disabled={saving}>Cancelar</button>
        <button className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar control'}
        </button>
      </div>
      {confirmDialog}
    </div>
  )
}
