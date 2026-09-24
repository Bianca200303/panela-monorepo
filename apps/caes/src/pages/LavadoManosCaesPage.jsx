import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { REVISION_CODES } from '../lib/formatos/lavadoManosCaes'
import { loadLimpiezaGeneralAreas } from '@panela/core/lib/formConfig'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import PeriodExistsBanner from '@panela/core/components/PeriodExistsBanner'

// Lavado de Manos en la Operación de Tamizado (CAESP-PP-HYS-RE-HSP-004) --
// SOLO CAES, ver COOPERATIVE.features.controlesPlantaCAES en
// lib/config.js. 1 control por (cooperativa, fecha) -- Área/Hora inicio/
// Hora fin son datos de esa sesión, compartidos por varias personas
// evaluadas ese mismo día (aclarado por el usuario 2026-09-20: "en esa
// fecha hay más de una persona evaluada"). Mismo patrón "cabecera + N
// filas" que CloroResidualCaesPage.jsx -- NO usa hooks/useGridControl.js.
//
// Persona (quien está siendo evaluado, no un responsable aparte que no
// existe en el papel real): desplegable respaldado por plant_personnel,
// mismo catálogo y mismo patrón "+ agregar persona nueva" que
// HigienePersonalCaesPage.jsx.
//
// R1-R5: tri-estado (null = no aplica / true = conforme / false = no
// conforme) por persona, arrancan en true (conforme) -- mismo criterio de
// "arranca en bueno, destilde solo si falla" que el resto de los
// checklists de la app.

let rowCounter = 0
function newRowKey() { return `row-${++rowCounter}` }

function emptyPersonRow() {
  const r = { key: newRowKey(), personnelId: '', observaciones: '' }
  for (const c of REVISION_CODES) r[c] = true
  return r
}

// Click cicla: conforme -> no conforme -> no aplica -> conforme.
function nextRevisionState(current) {
  if (current === true) return false
  if (current === false) return null
  return true
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function RevisionCell({ value, onChange }) {
  const bg = value == null ? '#fff' : value ? 'var(--success)' : 'var(--danger)'
  const color = value == null ? 'var(--muted)' : '#fff'
  const iconName = value == null ? 'circle' : value ? 'check' : 'x'
  const title = value == null ? 'No aplica' : value ? 'Conforme' : 'No conforme'
  return (
    <button
      type="button" onClick={() => onChange(nextRevisionState(value))} title={title}
      style={{
        width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
        border: value == null ? '1px solid var(--border)' : 'none',
        background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon name={iconName} size={14} />
    </button>
  )
}

export default function LavadoManosCaesPage() {
  const webUser = useAuthStore(s => s.webUser)

  const [view, setView] = useState('history') // 'history' | 'form'
  const [controls, setControls] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [personnel, setPersonnel] = useState([])
  const [addingPerson, setAddingPerson] = useState(false)
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [areaOptions, setAreaOptions] = useState([])

  const [editingId, setEditingId] = useState(null)
  const [controlDate, setControlDate] = useState(todayISO())
  const [area, setArea] = useState('')
  const [horaInicio, setHoraInicio] = useState('')
  const [horaFin, setHoraFin] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [personRows, setPersonRows] = useState([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_handwashing_controls_caes')
      .select('id, control_date, area, plant_handwashing_person_checks_caes ( id ), registered_by:web_users!phwcc_created_by_fkey ( first_name, last_name )')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('control_date', { ascending: false })
      .limit(50)
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

  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => { loadPersonnel() }, [loadPersonnel])
  // Reusa el catálogo de áreas físicas de la planta CAES (mismo que Control
  // de Limpieza / el desplegable de Área en Control de Plagas CAES).
  useEffect(() => {
    loadLimpiezaGeneralAreas(COOPERATIVE).then(groups => setAreaOptions(groups.map(g => g.area)))
  }, [])

  function startNewControl() {
    setEditingId(null)
    setControlDate(todayISO())
    setArea('')
    setHoraInicio('')
    setHoraFin('')
    setObservaciones('')
    setPersonRows([emptyPersonRow()])
    setAddingPerson(false)
    setError('')
    setView('form')
  }

  function startToday() {
    const today = todayISO()
    const existing = controls.find(c => c.control_date === today)
    if (existing) {
      startEditControl(existing)
    } else {
      startNewControl()
    }
  }

  async function startEditControl(control) {
    setEditingId(control.id)
    setControlDate(control.control_date)

    const { data: header } = await supabase
      .from('plant_handwashing_controls_caes')
      .select('area, hora_inicio, hora_fin, observaciones')
      .eq('id', control.id)
      .single()
    setArea(header?.area ?? '')
    setHoraInicio(header?.hora_inicio ?? '')
    setHoraFin(header?.hora_fin ?? '')
    setObservaciones(header?.observaciones ?? '')

    const { data: rows } = await supabase
      .from('plant_handwashing_person_checks_caes')
      .select('personnel_id, r1, r2, r3, r4, r5, observaciones')
      .eq('control_id', control.id)

    setPersonRows((rows ?? []).map(r => {
      const row = { key: newRowKey(), personnelId: r.personnel_id, observaciones: r.observaciones ?? '' }
      for (const c of REVISION_CODES) row[c] = r[c]
      return row
    }))
    setAddingPerson(false)
    setError('')
    setView('form')
  }

  function updatePersonRow(key, field, value) {
    setPersonRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r))
  }

  function isPersonRowBlank(r) {
    return !r.personnelId
  }

  async function handleAddPersonnel() {
    if (!newFirstName.trim() || !newLastName.trim()) return
    const { data: newPerson, error: insErr } = await supabase
      .from('plant_personnel')
      .insert({ cooperative_id: COOPERATIVE.id, first_name: newFirstName.trim(), last_name: newLastName.trim() })
      .select('id, first_name, last_name, is_active')
      .single()
    if (insErr) return
    setPersonnel(prev => [...prev, newPerson].sort((a, b) => a.first_name.localeCompare(b.first_name)))
    setNewFirstName('')
    setNewLastName('')
    setAddingPerson(false)
  }

  async function handleSave() {
    setError('')
    if (!controlDate) { setError('Seleccione la fecha.'); return }

    setSaving(true)
    try {
      let controlId = editingId
      const payload = {
        control_date: controlDate,
        area: area.trim() || null,
        hora_inicio: horaInicio || null,
        hora_fin: horaFin || null,
        observaciones: observaciones.trim() || null,
      }
      if (controlId) {
        const { error: updErr } = await supabase
          .from('plant_handwashing_controls_caes')
          .update(payload)
          .eq('id', controlId)
        if (updErr) {
          if (updErr.code === '23505') throw new Error('Ya existe un control para esa fecha.')
          throw new Error(updErr.message)
        }
        await supabase.from('plant_handwashing_person_checks_caes').delete().eq('control_id', controlId)
      } else {
        const { data: newControl, error: insErr } = await supabase
          .from('plant_handwashing_controls_caes')
          .insert({ cooperative_id: COOPERATIVE.id, created_by: webUser.id, ...payload })
          .select('id')
          .single()
        if (insErr) {
          if (insErr.code === '23505') throw new Error('Ya existe un control para esa fecha. Búsquelo en el historial y edítelo.')
          throw new Error(insErr.message)
        }
        controlId = newControl.id
      }

      const rowsToInsert = personRows.filter(r => !isPersonRowBlank(r)).map(r => {
        const row = { control_id: controlId, personnel_id: r.personnelId, observaciones: r.observaciones.trim() || null }
        for (const c of REVISION_CODES) row[c] = r[c]
        return row
      })
      if (rowsToInsert.length > 0) {
        const { error: insErr } = await supabase.from('plant_handwashing_person_checks_caes').insert(rowsToInsert)
        if (insErr) {
          if (insErr.code === '23505') throw new Error('Hay una persona repetida en la lista.')
          throw new Error(insErr.message)
        }
      }

      setView('history')
      await loadHistory()
    } catch (err) {
      setError(err.message ?? 'Error al guardar el registro')
    } finally {
      setSaving(false)
    }
  }

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>Lavado de Manos</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={startToday}>Registrar hoy</button>
            <button className="btn small outline" onClick={startNewControl}>+ Nuevo registro</button>
          </div>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay registros de lavado de manos aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const nPersonas = c.plant_handwashing_person_checks_caes?.length ?? 0
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{new Date(`${c.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="tag ok">{nPersonas} persona{nPersonas !== 1 ? 's' : ''} evaluada{nPersonas !== 1 ? 's' : ''}</span>
                      <button className="btn small outline" onClick={() => startEditControl(c)}>Editar</button>
                    </div>
                  </div>
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                    {c.area && `${c.area} · `}
                    {c.registered_by && `Registrado por: ${c.registered_by.first_name} ${c.registered_by.last_name}`}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ─── FORMULARIO ───────────────────────────────────────────────────────────
  // A diferencia de los controles de grilla mensual (Higiene/Limpieza), acá
  // la fecha SÍ se puede cambiar mientras se edita un registro guardado --
  // no hay un "checks" cacheado aparte que quede desincronizado del período
  // (ver [[project_higiene_personal_caes_registro_rapido]] punto 4, ese
  // riesgo es específico de useGridControl). Se compara contra cualquier
  // OTRO control (id distinto) para poder detectar tanto un choque al crear
  // uno nuevo como al mover la fecha de uno ya guardado.
  const existingForDate = controls.find(c => c.control_date === controlDate && c.id !== editingId)
  const dateChanged = editingId && controlDate !== controls.find(c => c.id === editingId)?.control_date

  return (
    <div>
      <div className="page-header">
        <h2>{editingId ? 'Editar' : 'Nuevo'} registro de lavado de manos</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Fecha</label>
            <input type="date" className="input" value={controlDate} onChange={e => setControlDate(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Área</label>
            <select value={area} onChange={e => setArea(e.target.value)}>
              <option value="">Seleccionar...</option>
              {areaOptions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Hora inicio</label>
            <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Hora fin</label>
            <input type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Observaciones</label>
          <textarea rows={2} value={observaciones} onChange={e => setObservaciones(e.target.value)} />
        </div>
        {dateChanged && !existingForDate && (
          <p className="muted small" style={{ margin: '8px 0 0', color: 'var(--warning)' }}>
            Va a mover este registro a la fecha nueva ({new Date(`${controlDate}T00:00:00`).toLocaleDateString('es-PE')}). Guarde para confirmar el cambio.
          </p>
        )}
        {existingForDate && (
          <PeriodExistsBanner
            periodLabel={new Date(`${controlDate}T00:00:00`).toLocaleDateString('es-PE')}
            responsiblePerson={existingForDate.registered_by ? `${existingForDate.registered_by.first_name} ${existingForDate.registered_by.last_name}` : null}
            onOpen={() => startEditControl(existingForDate)}
          />
        )}
      </div>

      {!existingForDate && <>
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Personas evaluadas</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn small outline" onClick={() => setAddingPerson(v => !v)}>+ Nueva persona (catálogo)</button>
            <button className="btn small outline" onClick={() => setPersonRows(prev => [...prev, emptyPersonRow()])}>+ Agregar fila</button>
          </div>
        </div>
        {addingPerson && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <input type="text" className="input" placeholder="Nombre" value={newFirstName} onChange={e => setNewFirstName(e.target.value)} style={{ width: 160 }} />
            <input type="text" className="input" placeholder="Apellido" value={newLastName} onChange={e => setNewLastName(e.target.value)} style={{ width: 160 }} />
            <button type="button" className="btn small primary" onClick={handleAddPersonnel}>Agregar al catálogo</button>
          </div>
        )}
        <p className="muted small" style={{ margin: '0 0 8px' }}>Cada revisión arranca en Conforme -- click para ciclar a No conforme y, si no ocurrió, a No aplica.</p>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 180 }}>Nombre y Apellidos</th>
                {REVISION_CODES.map(c => <th key={c} style={{ width: 40 }}>{c.toUpperCase()}</th>)}
                <th style={{ textAlign: 'left', minWidth: 160 }}>Observaciones</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {personRows.map(r => (
                <tr key={r.key}>
                  <td>
                    <select className="input" style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} value={r.personnelId} onChange={e => updatePersonRow(r.key, 'personnelId', e.target.value)}>
                      <option value="">Seleccionar...</option>
                      {personnel.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                    </select>
                  </td>
                  {REVISION_CODES.map(c => (
                    <td key={c} style={{ textAlign: 'center' }}>
                      <RevisionCell value={r[c]} onChange={v => updatePersonRow(r.key, c, v)} />
                    </td>
                  ))}
                  <td><input type="text" className="input" value={r.observaciones} onChange={e => updatePersonRow(r.key, 'observaciones', e.target.value)} style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td>
                    <button className="btn small outline" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setPersonRows(prev => prev.filter(x => x.key !== r.key))} title="Quitar fila">
                      <Icon name="x" size={11} />
                    </button>
                  </td>
                </tr>
              ))}
              {personRows.length === 0 && (
                <tr><td colSpan={REVISION_CODES.length + 3} className="muted small" style={{ textAlign: 'center', padding: 10 }}>Sin filas -- click "+ Agregar fila".</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>}

      {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn small" onClick={() => setView('history')} disabled={saving}>Cancelar</button>
        <button
          className="btn primary" onClick={handleSave} disabled={saving || !!existingForDate}
          title={existingForDate ? 'Elija una fecha que todavía no tenga control, o abra el existente' : undefined}
        >
          {saving ? 'Guardando...' : 'Guardar registro'}
        </button>
      </div>
    </div>
  )
}
