import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { UBICACIONES } from '../lib/formatos/tempHumedadAmbientesCaes'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'

// Control de Temperatura y Humedad de Ambientes (CAESP-PP-BPM-RE-RMP-003)
// -- SOLO CAES, ver COOPERATIVE.features.controlesPlantaCAES en
// lib/config.js. A diferencia de los demás controles planos de Fase 2 (1
// fila = 1 inspección suelta), acá el papel agrupa 4 ubicaciones fijas por
// fecha -- el historial lista por FECHA (no por fila), y el formulario
// llena las 4 ubicaciones juntas de una. Promedios calculados, no tipeados.

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyReadings() {
  const r = {}
  for (const u of UBICACIONES) r[u] = { t1: '', t2: '', t3: '', hr1: '', hr2: '', hr3: '', accion_correctiva: '', observaciones: '' }
  return r
}

function toNumOrNull(v) {
  const n = parseFloat(v)
  return v !== '' && !isNaN(n) ? n : null
}

function avg(values) {
  const nums = values.map(toNumOrNull).filter(v => v != null)
  if (nums.length === 0) return null
  return nums.reduce((s, v) => s + v, 0) / nums.length
}

export default function TempHumedadAmbientesCaesPage() {
  const webUser = useAuthStore(s => s.webUser)

  const [view, setView] = useState('history') // 'history' | 'form'
  const [dates, setDates] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [controlDate, setControlDate] = useState(todayISO())
  const [readings, setReadings] = useState(emptyReadings())

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_temp_humidity_control_caes')
      .select('control_date, ubicacion, t_promedio, hr_promedio')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('control_date', { ascending: false })
      .limit(200)
    const byDate = {}
    for (const r of (data ?? [])) {
      const entry = (byDate[r.control_date] ??= { control_date: r.control_date, count: 0 })
      entry.count++
    }
    setDates(Object.values(byDate))
    setLoadingHistory(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function startNew() {
    setControlDate(todayISO())
    setReadings(emptyReadings())
    setError('')
    setView('form')
  }

  async function startEdit(dateEntry) {
    setControlDate(dateEntry.control_date)
    const { data } = await supabase
      .from('plant_temp_humidity_control_caes')
      .select('ubicacion, t1, t2, t3, hr1, hr2, hr3, accion_correctiva, observaciones')
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('control_date', dateEntry.control_date)
    const next = emptyReadings()
    for (const r of (data ?? [])) {
      next[r.ubicacion] = {
        t1: r.t1 != null ? String(r.t1) : '', t2: r.t2 != null ? String(r.t2) : '', t3: r.t3 != null ? String(r.t3) : '',
        hr1: r.hr1 != null ? String(r.hr1) : '', hr2: r.hr2 != null ? String(r.hr2) : '', hr3: r.hr3 != null ? String(r.hr3) : '',
        accion_correctiva: r.accion_correctiva ?? '', observaciones: r.observaciones ?? '',
      }
    }
    setReadings(next)
    setError('')
    setView('form')
  }

  function updateReading(ubicacion, field, value) {
    setReadings(prev => ({ ...prev, [ubicacion]: { ...prev[ubicacion], [field]: value } }))
  }

  function isBlank(r) {
    return !r.t1 && !r.t2 && !r.t3 && !r.hr1 && !r.hr2 && !r.hr3 && !r.accion_correctiva.trim() && !r.observaciones.trim()
  }

  async function handleSave() {
    setError('')
    if (!controlDate) { setError('Seleccione la fecha.'); return }

    setSaving(true)
    try {
      await supabase.from('plant_temp_humidity_control_caes').delete()
        .eq('cooperative_id', COOPERATIVE.id).eq('control_date', controlDate)

      const rows = UBICACIONES.filter(u => !isBlank(readings[u])).map(u => {
        const r = readings[u]
        return {
          cooperative_id: COOPERATIVE.id, created_by: webUser.id, control_date: controlDate, ubicacion: u,
          t1: toNumOrNull(r.t1), t2: toNumOrNull(r.t2), t3: toNumOrNull(r.t3), t_promedio: avg([r.t1, r.t2, r.t3]),
          hr1: toNumOrNull(r.hr1), hr2: toNumOrNull(r.hr2), hr3: toNumOrNull(r.hr3), hr_promedio: avg([r.hr1, r.hr2, r.hr3]),
          accion_correctiva: r.accion_correctiva.trim() || null, observaciones: r.observaciones.trim() || null,
        }
      })
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('plant_temp_humidity_control_caes').insert(rows)
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
          <h2>Temperatura y Humedad de Ambientes</h2>
          <button className="btn primary" onClick={startNew}>+ Nuevo registro</button>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : dates.length === 0 ? (
          <EmptyState message="No hay registros de temperatura y humedad aún." />
        ) : (
          <div className="list">
            {dates.map(d => (
              <div key={d.control_date} className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{new Date(`${d.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="tag ok">{d.count}/{UBICACIONES.length} ubicaciones</span>
                    <button className="btn small outline" onClick={() => startEdit(d)}>Editar</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── FORMULARIO ───────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <h2>Registro de temperatura y humedad</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        <div className="field" style={{ margin: 0, maxWidth: 200 }}>
          <label>Fecha</label>
          <input type="date" value={controlDate} onChange={e => setControlDate(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 12 }}>
        {UBICACIONES.map(u => {
          const r = readings[u]
          const tProm = avg([r.t1, r.t2, r.t3])
          const hrProm = avg([r.hr1, r.hr2, r.hr3])
          const horaFields = [['t1', '8am'], ['t2', '2pm'], ['t3', '5pm']]
          const hrFields = [['hr1', '8am'], ['hr2', '2pm'], ['hr3', '5pm']]
          return (
            <div key={u} className="card">
              <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 15 }}>{u}</h3>

              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Temperatura (°C)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  {horaFields.map(([field, hora]) => (
                    <div key={field} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span className="muted" style={{ fontSize: 10 }}>{hora}</span>
                      <input
                        type="number" step="0.1" className="input" value={r[field]}
                        onChange={e => updateReading(u, field, e.target.value)}
                        style={{ width: 56, padding: '6px 4px', fontSize: 12, textAlign: 'center' }}
                      />
                    </div>
                  ))}
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginLeft: 'auto' }}>
                    {tProm != null ? `${tProm.toFixed(1)}°C prom.` : 'Sin promedio'}
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Humedad relativa (%)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  {hrFields.map(([field, hora]) => (
                    <div key={field} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span className="muted" style={{ fontSize: 10 }}>{hora}</span>
                      <input
                        type="number" step="0.1" className="input" value={r[field]}
                        onChange={e => updateReading(u, field, e.target.value)}
                        style={{ width: 56, padding: '6px 4px', fontSize: 12, textAlign: 'center' }}
                      />
                    </div>
                  ))}
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginLeft: 'auto' }}>
                    {hrProm != null ? `${hrProm.toFixed(1)}% prom.` : 'Sin promedio'}
                  </span>
                </div>
              </div>

              <div className="field" style={{ margin: '0 0 8px' }}>
                <label style={{ fontSize: 12 }}>Acción correctiva</label>
                <input type="text" value={r.accion_correctiva} onChange={e => updateReading(u, 'accion_correctiva', e.target.value)} style={{ fontSize: 12 }} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 12 }}>Observaciones</label>
                <input type="text" value={r.observaciones} onChange={e => updateReading(u, 'observaciones', e.target.value)} style={{ fontSize: 12 }} />
              </div>
            </div>
          )
        })}
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn small" onClick={() => setView('history')} disabled={saving}>Cancelar</button>
        <button className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar registro'}
        </button>
      </div>
    </div>
  )
}
