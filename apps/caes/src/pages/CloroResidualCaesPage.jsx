import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { CLORO_CAES_MIN_PPM, CLORO_CAES_MAX_PPM } from '../lib/formatos/cloroResidualCaes'
import { getCoopCode } from '@panela/core/lib/formatos/shared'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import PeriodExistsBanner from '@panela/core/components/PeriodExistsBanner'

// Control de Consumo de Cloro y Verificación de Cloro Residual
// (CAESP-PP-HYS-RE-CDA-001) -- SOLO CAES, ver
// COOPERATIVE.features.cloroPreparacionMonitoreo en lib/config.js. A
// diferencia del Cloro Residual de Norandino (CloroResidualPage.jsx, 1
// lectura ppm por punto fijo por fecha), acá el papel real trae DOS listas
// independientes de eventos por fecha -- varias preparaciones/cloraciones y
// varios monitoreos por día, con el punto de muestreo en texto libre (no
// hay catálogo fijo de puntos). Por eso NO usa hooks/useGridControl.js --
// es "agregar N filas" en dos tablas, no una grilla área/ítem.

let rowCounter = 0
function newRowKey() { return `row-${++rowCounter}` }

function emptyPrepRow() {
  return { key: newRowKey(), hora: '', concentracion: '', aguaL: '', cloroMl: '', responsable: '', observaciones: '' }
}
function emptyMonitoringRow() {
  return { key: newRowKey(), hora: '', punto: '', ppm: '', responsable: '', accionesCorrectivas: '' }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function belowOrAboveLimit(ppm) {
  if (ppm == null || ppm === '') return false
  const n = Number(ppm)
  return n < CLORO_CAES_MIN_PPM || n > CLORO_CAES_MAX_PPM
}

export default function CloroResidualCaesPage() {
  const webUser = useAuthStore(s => s.webUser)

  const [view, setView] = useState('history') // 'history' | 'form'
  const [controls, setControls] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [controlDate, setControlDate] = useState(todayISO())
  const [observations, setObservations] = useState('')
  const [prepRows, setPrepRows] = useState([])
  const [monitoringRows, setMonitoringRows] = useState([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_chlorine_controls_caes')
      .select(`
        id, control_date, observations, formato_codigo,
        plant_chlorine_prep_events_caes ( id ),
        plant_chlorine_monitoring_events_caes ( result_ppm ),
        registered_by:web_users!pccc_created_by_fkey ( first_name, last_name )
      `)
      .eq('cooperative_id', COOPERATIVE.id)
      .order('control_date', { ascending: false })
      .limit(50)
    setControls(data ?? [])
    setLoadingHistory(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function startNewControl() {
    setEditingId(null)
    setControlDate(todayISO())
    setObservations('')
    setPrepRows([emptyPrepRow()])
    setMonitoringRows([emptyMonitoringRow()])
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
    setObservations(control.observations ?? '')

    const [{ data: prep }, { data: monitoring }] = await Promise.all([
      supabase.from('plant_chlorine_prep_events_caes')
        .select('event_time, concentracion_deseada_ppm, cantidad_agua_l, cantidad_cloro_ml, responsable_cloracion, observations')
        .eq('control_id', control.id),
      supabase.from('plant_chlorine_monitoring_events_caes')
        .select('event_time, sampling_point, result_ppm, responsable_medicion, corrective_action')
        .eq('control_id', control.id),
    ])

    setPrepRows((prep ?? []).map(r => ({
      key: newRowKey(),
      hora: r.event_time ?? '',
      concentracion: r.concentracion_deseada_ppm != null ? String(r.concentracion_deseada_ppm) : '',
      aguaL: r.cantidad_agua_l != null ? String(r.cantidad_agua_l) : '',
      cloroMl: r.cantidad_cloro_ml != null ? String(r.cantidad_cloro_ml) : '',
      responsable: r.responsable_cloracion ?? '',
      observaciones: r.observations ?? '',
    })))
    setMonitoringRows((monitoring ?? []).map(r => ({
      key: newRowKey(),
      hora: r.event_time ?? '',
      punto: r.sampling_point ?? '',
      ppm: r.result_ppm != null ? String(r.result_ppm) : '',
      responsable: r.responsable_medicion ?? '',
      accionesCorrectivas: r.corrective_action ?? '',
    })))
    setError('')
    setView('form')
  }

  function updatePrepRow(key, field, value) {
    setPrepRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r))
  }
  function updateMonitoringRow(key, field, value) {
    setMonitoringRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r))
  }
  function removePrepRow(key) {
    setPrepRows(prev => prev.filter(r => r.key !== key))
  }
  function removeMonitoringRow(key) {
    setMonitoringRows(prev => prev.filter(r => r.key !== key))
  }

  function isPrepRowBlank(r) {
    return !r.hora && !r.concentracion && !r.aguaL && !r.cloroMl && !r.responsable.trim() && !r.observaciones.trim()
  }
  function isMonitoringRowBlank(r) {
    return !r.hora && !r.punto.trim() && !r.ppm && !r.responsable.trim() && !r.accionesCorrectivas.trim()
  }

  async function handleSave() {
    setError('')
    if (!controlDate) { setError('Seleccione la fecha.'); return }

    setSaving(true)
    try {
      let controlId = editingId
      const payload = { control_date: controlDate, observations: observations.trim() || null }
      if (controlId) {
        const { error: updErr } = await supabase
          .from('plant_chlorine_controls_caes')
          .update(payload)
          .eq('id', controlId)
        if (updErr) {
          if (updErr.code === '23505') throw new Error('Ya existe un control para esa fecha.')
          throw new Error(updErr.message)
        }
        await Promise.all([
          supabase.from('plant_chlorine_prep_events_caes').delete().eq('control_id', controlId),
          supabase.from('plant_chlorine_monitoring_events_caes').delete().eq('control_id', controlId),
        ])
      } else {
        const { data: codigo, error: codeErr } = await supabase
          .rpc('generate_chlorine_control_caes_code', { p_cooperative_id: COOPERATIVE.id, p_coop_code: getCoopCode(COOPERATIVE) })
        if (codeErr) throw new Error(codeErr.message)
        const { data: newControl, error: insErr } = await supabase
          .from('plant_chlorine_controls_caes')
          .insert({ cooperative_id: COOPERATIVE.id, created_by: webUser.id, formato_codigo: codigo, ...payload })
          .select('id')
          .single()
        if (insErr) {
          if (insErr.code === '23505') throw new Error('Ya existe un control para esa fecha. Búsquelo en el historial y edítelo.')
          throw new Error(insErr.message)
        }
        controlId = newControl.id
      }

      const prepToInsert = prepRows.filter(r => !isPrepRowBlank(r)).map(r => ({
        control_id: controlId,
        event_time: r.hora || null,
        concentracion_deseada_ppm: r.concentracion !== '' ? Number(r.concentracion) : null,
        cantidad_agua_l: r.aguaL !== '' ? Number(r.aguaL) : null,
        cantidad_cloro_ml: r.cloroMl !== '' ? Number(r.cloroMl) : null,
        responsable_cloracion: r.responsable.trim() || null,
        observations: r.observaciones.trim() || null,
      }))
      const monitoringToInsert = monitoringRows.filter(r => !isMonitoringRowBlank(r)).map(r => ({
        control_id: controlId,
        event_time: r.hora || null,
        sampling_point: r.punto.trim() || null,
        result_ppm: r.ppm !== '' ? Number(r.ppm) : null,
        responsable_medicion: r.responsable.trim() || null,
        corrective_action: r.accionesCorrectivas.trim() || null,
      }))

      if (prepToInsert.length > 0) {
        const { error: insErr } = await supabase.from('plant_chlorine_prep_events_caes').insert(prepToInsert)
        if (insErr) throw new Error(insErr.message)
      }
      if (monitoringToInsert.length > 0) {
        const { error: insErr } = await supabase.from('plant_chlorine_monitoring_events_caes').insert(monitoringToInsert)
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
          <h2>Control de Cloro Residual</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={startToday}>Registrar hoy</button>
            <button className="btn small outline" onClick={startNewControl}>+ Nuevo control</button>
          </div>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay controles de cloro registrados aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const nPrep = c.plant_chlorine_prep_events_caes?.length ?? 0
              const results = (c.plant_chlorine_monitoring_events_caes ?? []).map(r => r.result_ppm).filter(v => v != null)
              const anyOutOfRange = results.some(belowOrAboveLimit)
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{new Date(`${c.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`tag ${anyOutOfRange ? 'warn' : 'ok'}`}>
                        {nPrep} preparación{nPrep !== 1 ? 'es' : ''} · {results.length} monitoreo{results.length !== 1 ? 's' : ''}{anyOutOfRange ? ' · fuera de rango' : ''}
                      </span>
                      <button className="btn small outline" onClick={() => startEditControl(c)}>Editar</button>
                    </div>
                  </div>
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                    {c.formato_codigo && <>Código de Control: <strong style={{ fontFamily: 'monospace' }}>{c.formato_codigo}</strong> · </>}
                    {c.registered_by && `Registrado por: ${c.registered_by.first_name} ${c.registered_by.last_name}`}
                  </div>
                  {c.observations && <div className="meta" style={{ fontSize: 12 }}>Observaciones: {c.observations}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ─── FORMULARIO ───────────────────────────────────────────────────────────
  const existingForDate = !editingId ? controls.find(c => c.control_date === controlDate) : null

  return (
    <div>
      <div className="page-header">
        <h2>{editingId ? 'Editar' : 'Nuevo'} control de cloro residual</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Fecha</label>
            <input type="date" className="input" value={controlDate} onChange={e => setControlDate(e.target.value)} disabled={!!editingId} />
          </div>
        </div>
        <div className="field">
          <label>Observaciones</label>
          <textarea rows={2} value={observations} onChange={e => setObservations(e.target.value)} />
        </div>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Preparación / Cloración</h3>
          <button className="btn small outline" onClick={() => setPrepRows(prev => [...prev, emptyPrepRow()])}>+ Agregar fila</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Hora</th>
                <th style={{ width: 110 }}>Conc. deseada (ppm)</th>
                <th style={{ width: 100 }}>Agua a clorar (L)</th>
                <th style={{ width: 110 }}>Cloro a adicionar (ml)</th>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Responsable</th>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Observaciones</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {prepRows.map(r => (
                <tr key={r.key}>
                  <td><input type="time" value={r.hora} onChange={e => updatePrepRow(r.key, 'hora', e.target.value)} style={{ width: '100%', fontSize: 12 }} /></td>
                  <td><input type="number" step="0.01" min="0" value={r.concentracion} onChange={e => updatePrepRow(r.key, 'concentracion', e.target.value)} style={{ width: '100%', fontSize: 12 }} /></td>
                  <td><input type="number" step="0.01" min="0" value={r.aguaL} onChange={e => updatePrepRow(r.key, 'aguaL', e.target.value)} style={{ width: '100%', fontSize: 12 }} /></td>
                  <td><input type="number" step="0.01" min="0" value={r.cloroMl} onChange={e => updatePrepRow(r.key, 'cloroMl', e.target.value)} style={{ width: '100%', fontSize: 12 }} /></td>
                  <td><input type="text" value={r.responsable} onChange={e => updatePrepRow(r.key, 'responsable', e.target.value)} style={{ width: '100%', fontSize: 12 }} /></td>
                  <td><input type="text" value={r.observaciones} onChange={e => updatePrepRow(r.key, 'observaciones', e.target.value)} style={{ width: '100%', fontSize: 12 }} /></td>
                  <td>
                    <button className="btn small outline" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => removePrepRow(r.key)} title="Quitar fila">
                      <Icon name="x" size={11} />
                    </button>
                  </td>
                </tr>
              ))}
              {prepRows.length === 0 && (
                <tr><td colSpan={7} className="muted small" style={{ textAlign: 'center', padding: 10 }}>Sin filas -- click "+ Agregar fila".</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Monitoreo de Cloro Residual</h3>
          <button className="btn small outline" onClick={() => setMonitoringRows(prev => [...prev, emptyMonitoringRow()])}>+ Agregar fila</button>
        </div>
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          Límite: {CLORO_CAES_MIN_PPM} - {CLORO_CAES_MAX_PPM} ppm de cloro libre residual. Un resultado fuera de ese rango se resalta en rojo.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Hora</th>
                <th style={{ textAlign: 'left', minWidth: 180 }}>Punto de muestreo</th>
                <th style={{ width: 100 }}>Resultado (ppm)</th>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Responsable</th>
                <th style={{ textAlign: 'left', minWidth: 180 }}>Acciones correctivas</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {monitoringRows.map(r => {
                const outOfRange = belowOrAboveLimit(r.ppm)
                return (
                  <tr key={r.key}>
                    <td><input type="time" value={r.hora} onChange={e => updateMonitoringRow(r.key, 'hora', e.target.value)} style={{ width: '100%', fontSize: 12 }} /></td>
                    <td><input type="text" value={r.punto} onChange={e => updateMonitoringRow(r.key, 'punto', e.target.value)} placeholder="Ej: Zona de Envasado" style={{ width: '100%', fontSize: 12 }} /></td>
                    <td>
                      <input
                        type="number" step="0.01" min="0" value={r.ppm}
                        onChange={e => updateMonitoringRow(r.key, 'ppm', e.target.value)}
                        style={{ width: '100%', fontSize: 12, color: outOfRange ? '#dc2626' : undefined, fontWeight: outOfRange ? 700 : undefined }}
                      />
                    </td>
                    <td><input type="text" value={r.responsable} onChange={e => updateMonitoringRow(r.key, 'responsable', e.target.value)} style={{ width: '100%', fontSize: 12 }} /></td>
                    <td>
                      <input
                        type="text" value={r.accionesCorrectivas}
                        onChange={e => updateMonitoringRow(r.key, 'accionesCorrectivas', e.target.value)}
                        placeholder={outOfRange ? 'Requerido (fuera de rango)' : 'Opcional'}
                        style={{ width: '100%', fontSize: 12 }}
                      />
                    </td>
                    <td>
                      <button className="btn small outline" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => removeMonitoringRow(r.key)} title="Quitar fila">
                        <Icon name="x" size={11} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {monitoringRows.length === 0 && (
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
          className="btn primary"
          onClick={handleSave}
          disabled={saving || !!existingForDate}
          title={existingForDate ? 'Elija una fecha que todavía no tenga control, o abra el existente' : undefined}
        >
          {saving ? 'Guardando...' : 'Guardar control'}
        </button>
      </div>
    </div>
  )
}
