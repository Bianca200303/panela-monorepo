import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import PeriodExistsBanner from '@panela/core/components/PeriodExistsBanner'

// Control de Preparación de Soluciones (CAESP-PP-HYS-RE-HYS-003) -- SOLO
// CAES, ver COOPERATIVE.features.controlesPlantaCAES en lib/config.js.
// 1 control por (cooperativa, fecha, "Preparación de") -- en una misma
// fecha puede haber más de un control si son tipos de solución distintos
// (ej. Hipoclorito de Sodio Y Detergente el mismo día son 2 controles
// separados), pero varias preparaciones del MISMO tipo esa misma fecha son
// filas de un mismo control. Mismo patrón que CloroResidualCaesPage.jsx /
// LavadoManosCaesPage.jsx -- NO usa hooks/useGridControl.js.
//
// Responsable de preparación: desplegable respaldado por plant_personnel
// (mismo catálogo y mismo patrón "+ agregar persona nueva" que
// HigienePersonalCaesPage.jsx) -- antes era texto libre.

let rowCounter = 0
function newRowKey() { return `row-${++rowCounter}` }

function emptyEventRow() {
  return {
    key: newRowKey(), personnelId: '', concentracionInsumo: '', cantidadInsumo: '',
    resultadoVolumen: '', concentracionFinal: '', destinoUso: '',
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function PreparacionSolucionesCaesPage() {
  const webUser = useAuthStore(s => s.webUser)

  const [view, setView] = useState('history') // 'history' | 'form'
  const [controls, setControls] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [personnel, setPersonnel] = useState([])
  const [addingPerson, setAddingPerson] = useState(false)
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')

  const [editingId, setEditingId] = useState(null)
  const [controlDate, setControlDate] = useState(todayISO())
  const [preparacionDe, setPreparacionDe] = useState('')
  const [eventRows, setEventRows] = useState([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_solution_prep_controls_caes')
      .select(`
        id, control_date, preparacion_de,
        plant_solution_prep_events_caes ( id ),
        registered_by:web_users!pspcc_created_by_fkey ( first_name, last_name )
      `)
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

  function startNewControl() {
    setEditingId(null)
    setControlDate(todayISO())
    setPreparacionDe('')
    setEventRows([emptyEventRow()])
    setAddingPerson(false)
    setError('')
    setView('form')
  }

  async function startEditControl(control) {
    setEditingId(control.id)
    setControlDate(control.control_date)
    setPreparacionDe(control.preparacion_de ?? '')

    const { data: events } = await supabase
      .from('plant_solution_prep_events_caes')
      .select('personnel_id, concentracion_insumo, cantidad_insumo, resultado_volumen, concentracion_final, destino_uso')
      .eq('control_id', control.id)

    setEventRows((events ?? []).map(r => ({
      key: newRowKey(),
      personnelId: r.personnel_id,
      concentracionInsumo: r.concentracion_insumo ?? '',
      cantidadInsumo: r.cantidad_insumo ?? '',
      resultadoVolumen: r.resultado_volumen ?? '',
      concentracionFinal: r.concentracion_final ?? '',
      destinoUso: r.destino_uso ?? '',
    })))
    setAddingPerson(false)
    setError('')
    setView('form')
  }

  function updateEventRow(key, field, value) {
    setEventRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r))
  }

  function isEventRowBlank(r) {
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
      const payload = { control_date: controlDate, preparacion_de: preparacionDe.trim() || null }
      if (controlId) {
        const { error: updErr } = await supabase
          .from('plant_solution_prep_controls_caes')
          .update(payload)
          .eq('id', controlId)
        if (updErr) {
          if (updErr.code === '23505') throw new Error('Ya existe un control para esa fecha y ese tipo de preparación.')
          throw new Error(updErr.message)
        }
        await supabase.from('plant_solution_prep_events_caes').delete().eq('control_id', controlId)
      } else {
        const { data: newControl, error: insErr } = await supabase
          .from('plant_solution_prep_controls_caes')
          .insert({ cooperative_id: COOPERATIVE.id, created_by: webUser.id, ...payload })
          .select('id')
          .single()
        if (insErr) {
          if (insErr.code === '23505') throw new Error('Ya existe un control para esa fecha y ese tipo de preparación. Búsquelo en el historial y edítelo.')
          throw new Error(insErr.message)
        }
        controlId = newControl.id
      }

      const rowsToInsert = eventRows.filter(r => !isEventRowBlank(r)).map(r => ({
        control_id: controlId,
        personnel_id: r.personnelId,
        concentracion_insumo: r.concentracionInsumo.trim() || null,
        cantidad_insumo: r.cantidadInsumo.trim() || null,
        resultado_volumen: r.resultadoVolumen.trim() || null,
        concentracion_final: r.concentracionFinal.trim() || null,
        destino_uso: r.destinoUso.trim() || null,
      }))
      if (rowsToInsert.length > 0) {
        const { error: insErr } = await supabase.from('plant_solution_prep_events_caes').insert(rowsToInsert)
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

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>Preparación de Soluciones</h2>
          <button className="btn primary" onClick={startNewControl}>+ Nuevo registro</button>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay registros de preparación de soluciones aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const nEventos = c.plant_solution_prep_events_caes?.length ?? 0
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{new Date(`${c.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                      {c.preparacion_de && <span className="muted small" style={{ marginLeft: 8 }}>{c.preparacion_de}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="tag ok">{nEventos} preparación{nEventos !== 1 ? 'es' : ''}</span>
                      <button className="btn small outline" onClick={() => startEditControl(c)}>Editar</button>
                    </div>
                  </div>
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
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
  // La fecha SÍ se puede cambiar mientras se edita un registro guardado --
  // mismo criterio que LavadoManosCaesPage.jsx: no hay grilla cacheada
  // aparte que pueda desincronizarse del período (ese riesgo es específico
  // de useGridControl, ver [[project_higiene_personal_caes_registro_rapido]]
  // punto 4). Se compara contra cualquier OTRO control (id distinto) para
  // detectar tanto un choque al crear uno nuevo como al mover la fecha de
  // uno ya guardado. "Preparación de" sigue bloqueada -- no se pidió lo
  // mismo para ese campo.
  const existingForIdentity = controls.find(c =>
    c.id !== editingId && c.control_date === controlDate && (c.preparacion_de ?? '') === preparacionDe.trim())
  const dateChanged = editingId && controlDate !== controls.find(c => c.id === editingId)?.control_date

  return (
    <div>
      <div className="page-header">
        <h2>{editingId ? 'Editar' : 'Nuevo'} registro de preparación de soluciones</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        {editingId && (
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            "Preparación de" identifica a este control ya guardado y no se puede cambiar aquí. Para otro tipo de preparación, vuelva al historial y use "Editar" o "+ Nuevo registro".
          </p>
        )}
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Fecha</label>
            <input type="date" className="input" value={controlDate} onChange={e => setControlDate(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Preparación de</label>
            <input type="text" value={preparacionDe} onChange={e => setPreparacionDe(e.target.value)} placeholder="Ej: Hipoclorito de sodio" disabled={!!editingId} />
          </div>
        </div>
        {dateChanged && !existingForIdentity && (
          <p className="muted small" style={{ margin: '8px 0 0', color: 'var(--warning)' }}>
            Va a mover este registro a la fecha nueva ({new Date(`${controlDate}T00:00:00`).toLocaleDateString('es-PE')}). Guarde para confirmar el cambio.
          </p>
        )}
        {existingForIdentity && (
          <PeriodExistsBanner
            periodLabel={`${new Date(`${controlDate}T00:00:00`).toLocaleDateString('es-PE')}${preparacionDe.trim() ? ` — ${preparacionDe.trim()}` : ''}`}
            responsiblePerson={existingForIdentity.registered_by ? `${existingForIdentity.registered_by.first_name} ${existingForIdentity.registered_by.last_name}` : null}
            onOpen={() => startEditControl(existingForIdentity)}
          />
        )}
      </div>

      {!existingForIdentity && <>
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Preparaciones</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn small outline" onClick={() => setAddingPerson(v => !v)}>+ Nueva persona (catálogo)</button>
            <button className="btn small outline" onClick={() => setEventRows(prev => [...prev, emptyEventRow()])}>+ Agregar fila</button>
          </div>
        </div>
        {addingPerson && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <input type="text" className="input" placeholder="Nombre" value={newFirstName} onChange={e => setNewFirstName(e.target.value)} style={{ width: 160 }} />
            <input type="text" className="input" placeholder="Apellido" value={newLastName} onChange={e => setNewLastName(e.target.value)} style={{ width: 160 }} />
            <button type="button" className="btn small primary" onClick={handleAddPersonnel}>Agregar al catálogo</button>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Responsable</th>
                <th style={{ width: 100 }}>Concentración</th>
                <th style={{ width: 100 }}>Cantidad</th>
                <th style={{ width: 100 }}>Resultado (vol.)</th>
                <th style={{ width: 110 }}>Conc. final</th>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Observaciones</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {eventRows.map(r => (
                <tr key={r.key}>
                  <td>
                    <select className="input" style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} value={r.personnelId} onChange={e => updateEventRow(r.key, 'personnelId', e.target.value)}>
                      <option value="">Seleccionar...</option>
                      {personnel.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                    </select>
                  </td>
                  <td><input type="text" className="input" value={r.concentracionInsumo} onChange={e => updateEventRow(r.key, 'concentracionInsumo', e.target.value)} placeholder="Ej: 7.5%" style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td><input type="text" className="input" value={r.cantidadInsumo} onChange={e => updateEventRow(r.key, 'cantidadInsumo', e.target.value)} placeholder="Ej: 26.67ml" style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td><input type="text" className="input" value={r.resultadoVolumen} onChange={e => updateEventRow(r.key, 'resultadoVolumen', e.target.value)} placeholder="Ej: 20L" style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td><input type="text" className="input" value={r.concentracionFinal} onChange={e => updateEventRow(r.key, 'concentracionFinal', e.target.value)} placeholder="Ej: 100ppm" style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td><input type="text" className="input" value={r.destinoUso} onChange={e => updateEventRow(r.key, 'destinoUso', e.target.value)} placeholder="Ej: Utensilios de proceso" style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td>
                    <button className="btn small outline" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setEventRows(prev => prev.filter(x => x.key !== r.key))} title="Quitar fila">
                      <Icon name="x" size={11} />
                    </button>
                  </td>
                </tr>
              ))}
              {eventRows.length === 0 && (
                <tr><td colSpan={7} className="muted small" style={{ textAlign: 'center', padding: 10 }}>Sin filas -- click "+ Agregar fila".</td></tr>
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
          className="btn primary" onClick={handleSave} disabled={saving || !!existingForIdentity}
          title={existingForIdentity ? 'Elija una combinación de fecha/tipo que todavía no tenga control, o abra el existente' : undefined}
        >
          {saving ? 'Guardando...' : 'Guardar registro'}
        </button>
      </div>
    </div>
  )
}
