import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { ESTADO_TRAMPA_LABELS, INSECT_SPECIES_CAES } from '../lib/formatos/controlPlagasCaes'
import { getCoopCode, MONTH_NAMES } from '@panela/core/lib/formatos/shared'
import { loadLimpiezaGeneralAreas } from '@panela/core/lib/formConfig'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import MonthArrowSelect from '@panela/core/components/MonthArrowSelect'
import PeriodExistsBanner from '@panela/core/components/PeriodExistsBanner'

// Control de Roedores e Insectos (CAESP-PP-HYS-RE-CDP-001) -- SOLO CAES, ver
// COOPERATIVE.features.plagasEventosMensuales en lib/config.js. A
// diferencia de Control de Plagas de Norandino (ControlPlagasPage.jsx, 1
// control por fecha con catálogo fijo de 14 dispositivos + 10 especies),
// acá es un registro MENSUAL con dos listas libres de eventos -- cada
// trampa/insectocutor se evalúa varias veces durante el mes en fechas
// distintas. Mismo patrón "agregar N filas" que CloroResidualCaesPage.jsx,
// NO usa hooks/useGridControl.js. "Registrar hoy"/flechas de mes/aviso de
// duplicado calcan el patrón manual de CloroResidualCaesPage.jsx (year+month
// en vez de una sola fecha) -- no useMonthlyGridNavigation.js porque ese
// hook está atado a `header`/`updateIdentity` de useGridControl, que esta
// página no usa.

const ESTADO_CODES = ['sc', 'cp', 'ct', 'det']
const SPECIES_CODES = ['mo', 'a', 'ma']

let rowCounter = 0
function newRowKey() { return `row-${++rowCounter}` }

function emptyRodentRow(trapCode = '') {
  return { key: newRowKey(), trapCode, eventDate: '', trapActive: null, estado: [], observaciones: '' }
}
function emptyInsectRow(insectocutorCode = '') {
  return { key: newRowKey(), insectocutorCode, area: '', eventDate: '', species: [], observaciones: '' }
}

function toggleInArray(arr, value) {
  return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]
}

// Sugiere el siguiente código (T01, T02... / I01, I02...) según el número
// más alto ya usado en las filas del formulario -- sigue siendo editable a
// mano, no es un catálogo fijo (ver [[project_control_plagas_caes]]).
function nextCode(rows, field, prefix) {
  const max = rows.reduce((m, r) => {
    const match = /(\d+)\s*$/.exec((r[field] || '').trim())
    return Math.max(m, match ? parseInt(match[1], 10) : 0)
  }, 0)
  return `${prefix}${String(max + 1).padStart(2, '0')}`
}

export default function ControlPlagasCaesPage() {
  const webUser = useAuthStore(s => s.webUser)

  const [view, setView] = useState('history') // 'history' | 'form'
  const [controls, setControls] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [ceboProducto, setCeboProducto] = useState('')
  const [ceboCantidad, setCeboCantidad] = useState('')
  const [insectoProducto, setInsectoProducto] = useState('')
  const [insectoCantidad, setInsectoCantidad] = useState('')
  const [observations, setObservations] = useState('')
  const [rodentRows, setRodentRows] = useState([])
  const [insectRows, setInsectRows] = useState([])
  const [areaOptions, setAreaOptions] = useState([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reusa el catálogo de áreas físicas de la planta CAES (mismo que Control
  // de Limpieza, form_configurations "limpieza_general_areas") en vez de un
  // catálogo propio -- el insectocutor se ubica en una de esas áreas reales.
  useEffect(() => {
    loadLimpiezaGeneralAreas(COOPERATIVE).then(groups => setAreaOptions(groups.map(g => g.area)))
  }, [])

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_pest_controls_caes')
      .select(`
        id, year, month, cebo_producto, insecto_producto, formato_codigo,
        plant_pest_rodent_events_caes ( id ),
        plant_pest_insect_events_caes ( id ),
        registered_by:web_users!ppcc_created_by_fkey ( first_name, last_name )
      `)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(50)
    setControls(data ?? [])
    setLoadingHistory(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function startNewControl() {
    setEditingId(null)
    const now = new Date()
    setYear(now.getFullYear())
    setMonth(now.getMonth() + 1)
    setCeboProducto('')
    setCeboCantidad('')
    setInsectoProducto('')
    setInsectoCantidad('')
    setObservations('')
    setRodentRows([emptyRodentRow('T01')])
    setInsectRows([emptyInsectRow('I01')])
    setError('')
    setView('form')
  }

  function startToday() {
    const now = new Date()
    const existing = controls.find(c => c.year === now.getFullYear() && c.month === now.getMonth() + 1)
    if (existing) {
      startEditControl(existing)
    } else {
      startNewControl()
    }
  }

  function shiftMonth(delta) {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setMonth(m)
    setYear(y)
  }

  async function startEditControl(control) {
    setEditingId(control.id)
    setYear(control.year)
    setMonth(control.month)
    setCeboProducto(control.cebo_producto ?? '')
    setCeboCantidad(control.cebo_cantidad ?? '')
    setInsectoProducto(control.insecto_producto ?? '')
    setInsectoCantidad(control.insecto_cantidad ?? '')
    setObservations(control.observations ?? '')

    const [{ data: rodent }, { data: insect }] = await Promise.all([
      supabase.from('plant_pest_rodent_events_caes')
        .select('trap_code, event_date, trap_active, estado, observations')
        .eq('control_id', control.id),
      supabase.from('plant_pest_insect_events_caes')
        .select('insectocutor_code, area, event_date, species, observations')
        .eq('control_id', control.id),
    ])

    setRodentRows((rodent ?? []).map(r => ({
      key: newRowKey(), trapCode: r.trap_code ?? '', eventDate: r.event_date ?? '',
      trapActive: r.trap_active, estado: r.estado ?? [], observaciones: r.observations ?? '',
    })))
    setInsectRows((insect ?? []).map(r => ({
      key: newRowKey(), insectocutorCode: r.insectocutor_code ?? '', area: r.area ?? '', eventDate: r.event_date ?? '',
      species: r.species ?? [], observaciones: r.observations ?? '',
    })))
    setError('')
    setView('form')
  }

  function updateRodentRow(key, field, value) {
    setRodentRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r))
  }
  function updateInsectRow(key, field, value) {
    setInsectRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r))
  }

  function isRodentRowBlank(r) {
    return !r.trapCode.trim() && !r.eventDate && r.trapActive == null && r.estado.length === 0 && !r.observaciones.trim()
  }
  function isInsectRowBlank(r) {
    return !r.insectocutorCode.trim() && !r.area.trim() && !r.eventDate && r.species.length === 0 && !r.observaciones.trim()
  }

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      let controlId = editingId
      const payload = {
        year, month,
        cebo_producto: ceboProducto.trim() || null,
        cebo_cantidad: ceboCantidad.trim() || null,
        insecto_producto: insectoProducto.trim() || null,
        insecto_cantidad: insectoCantidad.trim() || null,
        observations: observations.trim() || null,
      }
      if (controlId) {
        const { error: updErr } = await supabase
          .from('plant_pest_controls_caes')
          .update(payload)
          .eq('id', controlId)
        if (updErr) {
          if (updErr.code === '23505') throw new Error('Ya existe un control para ese año y mes.')
          throw new Error(updErr.message)
        }
        await Promise.all([
          supabase.from('plant_pest_rodent_events_caes').delete().eq('control_id', controlId),
          supabase.from('plant_pest_insect_events_caes').delete().eq('control_id', controlId),
        ])
      } else {
        const { data: codigo, error: codeErr } = await supabase
          .rpc('generate_pest_control_caes_code', { p_cooperative_id: COOPERATIVE.id, p_coop_code: getCoopCode(COOPERATIVE) })
        if (codeErr) throw new Error(codeErr.message)
        const { data: newControl, error: insErr } = await supabase
          .from('plant_pest_controls_caes')
          .insert({ cooperative_id: COOPERATIVE.id, created_by: webUser.id, formato_codigo: codigo, ...payload })
          .select('id')
          .single()
        if (insErr) {
          if (insErr.code === '23505') throw new Error('Ya existe un control para ese año y mes. Búsquelo en el historial y edítelo.')
          throw new Error(insErr.message)
        }
        controlId = newControl.id
      }

      const rodentToInsert = rodentRows.filter(r => !isRodentRowBlank(r)).map(r => ({
        control_id: controlId,
        trap_code: r.trapCode.trim() || null,
        event_date: r.eventDate || null,
        trap_active: r.trapActive,
        estado: r.estado,
        observations: r.observaciones.trim() || null,
      }))
      const insectToInsert = insectRows.filter(r => !isInsectRowBlank(r)).map(r => ({
        control_id: controlId,
        insectocutor_code: r.insectocutorCode.trim() || null,
        area: r.area.trim() || null,
        event_date: r.eventDate || null,
        species: r.species,
        observations: r.observaciones.trim() || null,
      }))

      if (rodentToInsert.length > 0) {
        const { error: insErr } = await supabase.from('plant_pest_rodent_events_caes').insert(rodentToInsert)
        if (insErr) throw new Error(insErr.message)
      }
      if (insectToInsert.length > 0) {
        const { error: insErr } = await supabase.from('plant_pest_insect_events_caes').insert(insectToInsert)
        if (insErr) throw new Error(insErr.message)
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
          <h2>Control de Roedores e Insectos</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={startToday}>Registrar hoy</button>
            <button className="btn small outline" onClick={startNewControl}>+ Nuevo control</button>
          </div>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay controles de plagas registrados aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const nRodent = c.plant_pest_rodent_events_caes?.length ?? 0
              const nInsect = c.plant_pest_insect_events_caes?.length ?? 0
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{MONTH_NAMES[c.month - 1]} {c.year}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="tag ok">{nRodent} evaluación{nRodent !== 1 ? 'es' : ''} roedores · {nInsect} insectocutor{nInsect !== 1 ? 'es' : ''}</span>
                      <button className="btn small outline" onClick={() => startEditControl(c)}>Editar</button>
                    </div>
                  </div>
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                    {c.formato_codigo && <>Código de Control: <strong style={{ fontFamily: 'monospace' }}>{c.formato_codigo}</strong> · </>}
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
  const existingForMonth = !editingId ? controls.find(c => c.year === year && c.month === month) : null

  return (
    <div>
      <div className="page-header">
        <h2>{editingId ? 'Editar' : 'Nuevo'} control de plagas</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        {editingId && (
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            Mes y año identifican a este control ya guardado y no se pueden cambiar aquí. Para otro período, vuelva al historial y use "Editar".
          </p>
        )}
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Mes</label>
            <MonthArrowSelect month={month} disabled={!!editingId} onShift={shiftMonth} onChangeMonth={setMonth} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Año</label>
            <input type="number" value={year} disabled={!!editingId} onChange={e => setYear(parseInt(e.target.value, 10) || year)} style={{ width: 100 }} />
          </div>
        </div>
        {existingForMonth && (
          <PeriodExistsBanner
            periodLabel={`${MONTH_NAMES[month - 1]} ${year}`}
            responsiblePerson={existingForMonth.registered_by ? `${existingForMonth.registered_by.first_name} ${existingForMonth.registered_by.last_name}` : null}
            onOpen={() => startEditControl(existingForMonth)}
          />
        )}
        <div className="field">
          <label>Observaciones</label>
          <textarea rows={2} value={observations} onChange={e => setObservations(e.target.value)} />
        </div>
      </div>

      {!existingForMonth && <>
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Control de Roedores</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="text" className="input" placeholder="Producto (cebo)" value={ceboProducto} onChange={e => setCeboProducto(e.target.value)} style={{ width: 160, height: 'auto', padding: '6px 10px' }} />
            <input type="text" className="input" placeholder="Cantidad" value={ceboCantidad} onChange={e => setCeboCantidad(e.target.value)} style={{ width: 100, height: 'auto', padding: '6px 10px' }} />
            <button className="btn small outline" onClick={() => setRodentRows(prev => [...prev, emptyRodentRow(nextCode(prev, 'trapCode', 'T'))])}>+ Agregar fila</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>N° Trampa</th>
                <th style={{ width: 130 }}>Fecha</th>
                <th style={{ width: 70 }}>Activa</th>
                <th style={{ minWidth: 220 }}>Estado</th>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Observaciones</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {rodentRows.map(r => (
                <tr key={r.key}>
                  <td><input type="text" className="input" value={r.trapCode} onChange={e => updateRodentRow(r.key, 'trapCode', e.target.value)} placeholder="Ej: T01" style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td><input type="date" className="input" value={r.eventDate} onChange={e => updateRodentRow(r.key, 'eventDate', e.target.value)} style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox" checked={r.trapActive === true}
                      onChange={e => updateRodentRow(r.key, 'trapActive', e.target.checked)}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                      {ESTADO_CODES.map(code => (
                        <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <input type="checkbox" checked={r.estado.includes(code)} onChange={() => updateRodentRow(r.key, 'estado', toggleInArray(r.estado, code))} />
                          {ESTADO_TRAMPA_LABELS[code]}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td><input type="text" className="input" value={r.observaciones} onChange={e => updateRodentRow(r.key, 'observaciones', e.target.value)} style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td>
                    <button className="btn small outline" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setRodentRows(prev => prev.filter(x => x.key !== r.key))} title="Quitar fila">
                      <Icon name="x" size={11} />
                    </button>
                  </td>
                </tr>
              ))}
              {rodentRows.length === 0 && (
                <tr><td colSpan={6} className="muted small" style={{ textAlign: 'center', padding: 10 }}>Sin filas -- click "+ Agregar fila".</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Control de Insectos</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="text" className="input" placeholder="Producto" value={insectoProducto} onChange={e => setInsectoProducto(e.target.value)} style={{ width: 160, height: 'auto', padding: '6px 10px' }} />
            <input type="text" className="input" placeholder="Cantidad" value={insectoCantidad} onChange={e => setInsectoCantidad(e.target.value)} style={{ width: 100, height: 'auto', padding: '6px 10px' }} />
            <button className="btn small outline" onClick={() => setInsectRows(prev => [...prev, emptyInsectRow(nextCode(prev, 'insectocutorCode', 'I'))])}>+ Agregar fila</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>N° Insectocutor</th>
                <th style={{ textAlign: 'left', minWidth: 140 }}>Área</th>
                <th style={{ width: 130 }}>Fecha</th>
                <th style={{ minWidth: 160 }}>Especies</th>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Observaciones</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {insectRows.map(r => (
                <tr key={r.key}>
                  <td><input type="text" className="input" value={r.insectocutorCode} onChange={e => updateInsectRow(r.key, 'insectocutorCode', e.target.value)} placeholder="Ej: I01" style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td>
                    <select className="input" value={r.area} onChange={e => updateInsectRow(r.key, 'area', e.target.value)} style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }}>
                      <option value="">Seleccionar...</option>
                      {areaOptions.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </td>
                  <td><input type="date" className="input" value={r.eventDate} onChange={e => updateInsectRow(r.key, 'eventDate', e.target.value)} style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                      {SPECIES_CODES.map(code => (
                        <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <input type="checkbox" checked={r.species.includes(code)} onChange={() => updateInsectRow(r.key, 'species', toggleInArray(r.species, code))} />
                          {INSECT_SPECIES_CAES[code]}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td><input type="text" className="input" value={r.observaciones} onChange={e => updateInsectRow(r.key, 'observaciones', e.target.value)} style={{ width: '100%', fontSize: 12, padding: '4px 8px', height: 'auto' }} /></td>
                  <td>
                    <button className="btn small outline" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setInsectRows(prev => prev.filter(x => x.key !== r.key))} title="Quitar fila">
                      <Icon name="x" size={11} />
                    </button>
                  </td>
                </tr>
              ))}
              {insectRows.length === 0 && (
                <tr><td colSpan={6} className="muted small" style={{ textAlign: 'center', padding: 10 }}>Sin filas -- click "+ Agregar fila".</td></tr>
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
          className="btn primary" onClick={handleSave} disabled={saving || !!existingForMonth}
          title={existingForMonth ? 'Elija un mes que todavía no tenga control, o abra el existente' : undefined}
        >
          {saving ? 'Guardando...' : 'Guardar control'}
        </button>
      </div>
    </div>
  )
}
