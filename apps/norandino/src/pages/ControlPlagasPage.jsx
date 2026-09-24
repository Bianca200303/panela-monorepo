import { useState, useEffect, useCallback, Fragment } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { RODENT_TRAPS, RODENT_DEVICE_TYPE_LABELS, LIGHT_TRAPS, INSECT_SPECIES } from '../lib/formatos/controlPlagas'
import { getCoopCode } from '@panela/core/lib/formatos/shared'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'

// Control de Plagas (SIG-GIA-RG-007) -- registro por FECHA exacta,
// independiente de cualquier orden/lote: 1 control por fecha, con 2 tipos
// de dispositivo. Jaulas mecánicas y trampas de goma comparten columnas
// (Operatividad, Evidencia, Roedores atrapados, N° de roedor atrapado) --
// unificadas en RODENT_TRAPS con un deviceType. Trampas de luz llevan
// conteo por especie de insecto en 10 columnas fijas. El documento de una
// orden lo cruza por fecha exacta (ver quickDocs.js), mismo criterio que
// Higiene/Verificación/Cloro Residual.

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function toggleValue(current, value) {
  return current === value ? null : value
}

// Un control nuevo arranca con todo en el estado "bueno" (Operatividad
// ✓ Operativo, Evidencia y Atrapados en NO) -- solo aplica a controles
// nuevos, no al editar uno ya guardado, igual criterio que Verificación de
// Limpieza: alcanza con tocar las excepciones (1 click) en vez de marcar
// cada dispositivo/trampa una por una.
function buildDefaultRodentChecks() {
  const next = {}
  for (const trap of RODENT_TRAPS) {
    next[trap.code] = { operatividad: 'operativo', evidencia: 'no', atrapados: 'no', cantidadAtrapada: '', observations: '', correctiveAction: '' }
  }
  return next
}

function buildDefaultLightChecks() {
  const next = {}
  for (const trap of LIGHT_TRAPS) {
    const counts = {}
    for (const sp of INSECT_SPECIES) counts[sp.code] = ''
    next[trap.code] = { operatividad: 'operativo', counts, observations: '', correctiveAction: '' }
  }
  return next
}

function ToggleButton({ active, tone, onClick, children }) {
  const style = active
    ? (tone === 'bad' ? { color: '#991b1b', background: '#fef2f2', borderColor: '#991b1b' } : { color: '#166534', background: '#f0fdf4', borderColor: '#166534' })
    : { color: '#999', background: '#fff' }
  return (
    <button type="button" onClick={onClick} style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 700, fontSize: 11, ...style }}>
      {children}
    </button>
  )
}

export default function ControlPlagasPage() {
  const webUser = useAuthStore(s => s.webUser)

  const [view, setView] = useState('history') // 'history' | 'form'
  const [controls, setControls] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [controlDate, setControlDate] = useState(todayISO())
  const [responsiblePerson, setResponsiblePerson] = useState('')
  // rodentChecks: { [deviceCode]: { operatividad, evidencia, atrapados, cantidadAtrapada, observations, correctiveAction } }
  const [rodentChecks, setRodentChecks] = useState({})
  // lightChecks: { [trapCode]: { operatividad, counts: { [speciesCode]: number }, observations, correctiveAction } }
  const [lightChecks, setLightChecks] = useState({})
  // 3er sub-control del papel físico (los otros 2 son Roedores/Trampas de
  // luz arriba) -- no tiene catálogo de dispositivos, solo un estado
  // correcto/no correcto + observaciones para el control del día.
  const [ambientesOk, setAmbientesOk] = useState(null) // 'correcto' | 'no_correcto' | null
  const [ambientesObservaciones, setAmbientesObservaciones] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_pest_controls')
      .select('id, control_date, responsible_person, formato_codigo, ambientes_equipo_personal_ok, plant_rodent_trap_checks ( atrapados ), plant_light_trap_checks ( id ), registered_by:web_users!ppc_created_by_fkey ( first_name, last_name )')
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
    setResponsiblePerson('')
    setRodentChecks(buildDefaultRodentChecks())
    setLightChecks(buildDefaultLightChecks())
    setAmbientesOk(null)
    setAmbientesObservaciones('')
    setError('')
    setView('form')
  }

  async function startEditControl(control) {
    setEditingId(control.id)
    setControlDate(control.control_date)
    setResponsiblePerson(control.responsible_person ?? '')

    const { data: fullControl } = await supabase
      .from('plant_pest_controls')
      .select('ambientes_equipo_personal_ok, ambientes_equipo_personal_observaciones')
      .eq('id', control.id)
      .single()
    setAmbientesOk(fullControl?.ambientes_equipo_personal_ok ?? null)
    setAmbientesObservaciones(fullControl?.ambientes_equipo_personal_observaciones ?? '')

    const [{ data: rodentRows }, { data: lightRows }] = await Promise.all([
      supabase.from('plant_rodent_trap_checks').select('device_type, device_code, operatividad, evidencia, atrapados, cantidad_atrapada, observations, corrective_action').eq('control_id', control.id),
      supabase.from('plant_light_trap_checks').select('*').eq('control_id', control.id),
    ])

    const nextRodent = {}
    for (const r of (rodentRows ?? [])) {
      nextRodent[r.device_code] = {
        operatividad: r.operatividad, evidencia: r.evidencia, atrapados: r.atrapados,
        cantidadAtrapada: r.cantidad_atrapada != null ? String(r.cantidad_atrapada) : '',
        observations: r.observations ?? '', correctiveAction: r.corrective_action ?? '',
      }
    }
    const nextLight = {}
    for (const r of (lightRows ?? [])) {
      const counts = {}
      for (const sp of INSECT_SPECIES) counts[sp.code] = r[`${sp.code}_count`] != null ? String(r[`${sp.code}_count`]) : ''
      nextLight[r.trap_code] = {
        operatividad: r.operatividad, counts,
        observations: r.observations ?? '', correctiveAction: r.corrective_action ?? '',
      }
    }

    setRodentChecks(nextRodent)
    setLightChecks(nextLight)
    setError('')
    setView('form')
  }

  function updateRodent(code, field, value) {
    setRodentChecks(prev => ({
      ...prev,
      [code]: { operatividad: null, evidencia: null, atrapados: null, cantidadAtrapada: '', observations: '', correctiveAction: '', ...(prev[code] ?? {}), [field]: value },
    }))
  }

  function updateLight(code, field, value) {
    setLightChecks(prev => ({
      ...prev,
      [code]: { operatividad: null, counts: {}, observations: '', correctiveAction: '', ...(prev[code] ?? {}), [field]: value },
    }))
  }

  function updateLightCount(code, speciesCode, value) {
    setLightChecks(prev => {
      const current = prev[code] ?? { operatividad: null, counts: {}, observations: '', correctiveAction: '' }
      return { ...prev, [code]: { ...current, counts: { ...current.counts, [speciesCode]: value } } }
    })
  }

  async function handleSave() {
    setError('')
    if (!responsiblePerson.trim()) { setError('Ingrese el responsable.'); return }

    setSaving(true)
    try {
      let controlId = editingId
      const ambientesPayload = {
        ambientes_equipo_personal_ok: ambientesOk,
        ambientes_equipo_personal_observaciones: ambientesObservaciones.trim() || null,
      }
      if (controlId) {
        const { error: updErr } = await supabase
          .from('plant_pest_controls')
          .update({ control_date: controlDate, responsible_person: responsiblePerson.trim(), ...ambientesPayload })
          .eq('id', controlId)
        if (updErr) {
          if (updErr.code === '23505') throw new Error('Ya existe un control para esa fecha.')
          throw new Error(updErr.message)
        }
        await Promise.all([
          supabase.from('plant_rodent_trap_checks').delete().eq('control_id', controlId),
          supabase.from('plant_light_trap_checks').delete().eq('control_id', controlId),
        ])
      } else {
        const { data: codigo, error: codeErr } = await supabase
          .rpc('generate_pest_control_code', { p_cooperative_id: COOPERATIVE.id, p_coop_code: getCoopCode(COOPERATIVE) })
        if (codeErr) throw new Error(codeErr.message)
        const { data: newControl, error: insErr } = await supabase
          .from('plant_pest_controls')
          .insert({ cooperative_id: COOPERATIVE.id, control_date: controlDate, responsible_person: responsiblePerson.trim(), created_by: webUser.id, formato_codigo: codigo, ...ambientesPayload })
          .select('id')
          .single()
        if (insErr) {
          if (insErr.code === '23505') throw new Error('Ya existe un control para esa fecha. Búsquelo en el historial y edítelo.')
          throw new Error(insErr.message)
        }
        controlId = newControl.id
      }

      const rodentRows = []
      for (const trap of RODENT_TRAPS) {
        const v = rodentChecks[trap.code]
        if (!v) continue
        const hasData = v.operatividad || v.evidencia || v.atrapados || v.cantidadAtrapada !== '' || v.observations || v.correctiveAction
        if (!hasData) continue
        rodentRows.push({
          control_id: controlId, device_type: trap.deviceType, device_code: trap.code,
          operatividad: v.operatividad || null, evidencia: v.evidencia || null, atrapados: v.atrapados || null,
          cantidad_atrapada: v.cantidadAtrapada !== '' ? parseInt(v.cantidadAtrapada, 10) : null,
          observations: v.observations?.trim() || null, corrective_action: v.correctiveAction?.trim() || null,
        })
      }
      if (rodentRows.length > 0) {
        const { error: e1 } = await supabase.from('plant_rodent_trap_checks').insert(rodentRows)
        if (e1) throw new Error(e1.message)
      }

      const lightRows = []
      for (const trap of LIGHT_TRAPS) {
        const v = lightChecks[trap.code]
        if (!v) continue
        const anyCount = INSECT_SPECIES.some(sp => (v.counts?.[sp.code] ?? '') !== '')
        const hasData = v.operatividad || anyCount || v.observations || v.correctiveAction
        if (!hasData) continue
        const row = {
          control_id: controlId, trap_code: trap.code, operatividad: v.operatividad || null,
          observations: v.observations?.trim() || null, corrective_action: v.correctiveAction?.trim() || null,
        }
        for (const sp of INSECT_SPECIES) {
          const raw = v.counts?.[sp.code]
          row[`${sp.code}_count`] = raw !== '' && raw != null ? parseInt(raw, 10) : null
        }
        lightRows.push(row)
      }
      if (lightRows.length > 0) {
        const { error: e2 } = await supabase.from('plant_light_trap_checks').insert(lightRows)
        if (e2) throw new Error(e2.message)
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
          <h2>Control de Plagas</h2>
          <button className="btn primary" onClick={startNewControl}>+ Nuevo control</button>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : controls.length === 0 ? (
          <EmptyState message="No hay controles de plagas registrados aún." />
        ) : (
          <div className="list">
            {controls.map(c => {
              const anyCaught = (c.plant_rodent_trap_checks ?? []).some(r => r.atrapados === 'si')
              return (
                <div key={c.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{new Date(`${c.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {anyCaught && <span className="tag warn">Con captura de roedores</span>}
                      <button className="btn small outline" onClick={() => startEditControl(c)}>Editar</button>
                    </div>
                  </div>
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                    {c.formato_codigo && <>Código de Control: <strong style={{ fontFamily: 'monospace' }}>{c.formato_codigo}</strong> · </>}
                    Responsable: {c.responsible_person ?? '—'}
                    {c.registered_by && ` · Registrado por: ${c.registered_by.first_name} ${c.registered_by.last_name}`}
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
  return (
    <div>
      <div className="page-header">
        <h2>{editingId ? 'Editar' : 'Nuevo'} control de plagas</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Fecha</label>
            <input type="date" value={controlDate} onChange={e => setControlDate(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Responsable</label>
            <input type="text" value={responsiblePerson} onChange={e => setResponsiblePerson(e.target.value)} placeholder="Nombre de quien completa el control" />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Roedores</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 150 }}>Dispositivo</th>
                <th style={{ width: 70 }}>Operatividad</th>
                <th style={{ width: 70 }}>Evidencia</th>
                <th style={{ width: 80 }}>Atrapados</th>
                <th style={{ width: 70 }}>N° roedor</th>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Observaciones</th>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Acción Correctiva</th>
              </tr>
            </thead>
            <tbody>
              {['jaula', 'trampa_goma'].map(deviceType => (
                <Fragment key={deviceType}>
                  <tr><td colSpan={7} style={{ background: '#f3f4f6', fontWeight: 700, fontSize: 12, padding: '4px 6px' }}>{RODENT_DEVICE_TYPE_LABELS[deviceType]}</td></tr>
                  {RODENT_TRAPS.filter(t => t.deviceType === deviceType).map(trap => {
                    const v = rodentChecks[trap.code] ?? {}
                    return (
                      <tr key={trap.code}>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{trap.label}</td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                            <ToggleButton active={v.operatividad === 'operativo'} onClick={() => updateRodent(trap.code, 'operatividad', toggleValue(v.operatividad, 'operativo'))}>✓</ToggleButton>
                            <ToggleButton active={v.operatividad === 'no_operativo'} tone="bad" onClick={() => updateRodent(trap.code, 'operatividad', toggleValue(v.operatividad, 'no_operativo'))}>✗</ToggleButton>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                            <ToggleButton active={v.evidencia === 'si'} onClick={() => updateRodent(trap.code, 'evidencia', toggleValue(v.evidencia, 'si'))}>✓</ToggleButton>
                            <ToggleButton active={v.evidencia === 'no'} tone="bad" onClick={() => updateRodent(trap.code, 'evidencia', toggleValue(v.evidencia, 'no'))}>✗</ToggleButton>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                            <ToggleButton active={v.atrapados === 'si'} onClick={() => updateRodent(trap.code, 'atrapados', toggleValue(v.atrapados, 'si'))}>✓</ToggleButton>
                            <ToggleButton active={v.atrapados === 'no'} tone="bad" onClick={() => updateRodent(trap.code, 'atrapados', toggleValue(v.atrapados, 'no'))}>✗</ToggleButton>
                          </div>
                        </td>
                        <td>
                          <input type="number" min="0" value={v.cantidadAtrapada ?? ''} onChange={e => updateRodent(trap.code, 'cantidadAtrapada', e.target.value)} style={{ width: '100%', fontSize: 12 }} />
                        </td>
                        <td>
                          <input type="text" value={v.observations ?? ''} onChange={e => updateRodent(trap.code, 'observations', e.target.value)} style={{ width: '100%', fontSize: 12 }} />
                        </td>
                        <td>
                          <input type="text" value={v.correctiveAction ?? ''} onChange={e => updateRodent(trap.code, 'correctiveAction', e.target.value)} style={{ width: '100%', fontSize: 12 }} />
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Insectos — Trampas de luz</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 150 }}>Trampa</th>
                <th style={{ width: 70 }}>Operatividad</th>
                {INSECT_SPECIES.map(sp => <th key={sp.code} title={sp.fullLabel} style={{ width: 40 }}>{sp.label}</th>)}
                <th style={{ textAlign: 'left', minWidth: 160 }}>Observaciones</th>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Acción Correctiva</th>
              </tr>
            </thead>
            <tbody>
              {LIGHT_TRAPS.map(trap => {
                const v = lightChecks[trap.code] ?? {}
                return (
                  <tr key={trap.code}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{trap.label}<br /><span className="muted small">Lugar: {trap.place}</span></td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                        <ToggleButton active={v.operatividad === 'operativo'} onClick={() => updateLight(trap.code, 'operatividad', toggleValue(v.operatividad, 'operativo'))}>✓</ToggleButton>
                        <ToggleButton active={v.operatividad === 'no_operativo'} tone="bad" onClick={() => updateLight(trap.code, 'operatividad', toggleValue(v.operatividad, 'no_operativo'))}>✗</ToggleButton>
                      </div>
                    </td>
                    {INSECT_SPECIES.map(sp => (
                      <td key={sp.code}>
                        <input type="number" min="0" value={v.counts?.[sp.code] ?? ''} onChange={e => updateLightCount(trap.code, sp.code, e.target.value)} style={{ width: 36, fontSize: 12 }} />
                      </td>
                    ))}
                    <td>
                      <input type="text" value={v.observations ?? ''} onChange={e => updateLight(trap.code, 'observations', e.target.value)} style={{ width: '100%', fontSize: 12 }} />
                    </td>
                    <td>
                      <input type="text" value={v.correctiveAction ?? ''} onChange={e => updateLight(trap.code, 'correctiveAction', e.target.value)} style={{ width: '100%', fontSize: 12 }} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          MD: mosca doméstica · MC: mosca de carne · AB: abeja · E: escarabajo · P: polilla · Z: zancudo · MQ: mosquito · AV: avispa · L: luciérnagas
        </p>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Inspección de Ambientes, Equipo y Personal</h3>
        <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
          <ToggleButton active={ambientesOk === 'correcto'} onClick={() => setAmbientesOk(toggleValue(ambientesOk, 'correcto'))}>✓</ToggleButton>
          <ToggleButton active={ambientesOk === 'no_correcto'} tone="bad" onClick={() => setAmbientesOk(toggleValue(ambientesOk, 'no_correcto'))}>✗</ToggleButton>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Observaciones</label>
          <input type="text" value={ambientesObservaciones} onChange={e => setAmbientesObservaciones(e.target.value)} style={{ width: '100%', fontSize: 12 }} />
        </div>
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn small" onClick={() => setView('history')} disabled={saving}>Cancelar</button>
        <button className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar control'}
        </button>
      </div>
    </div>
  )
}
