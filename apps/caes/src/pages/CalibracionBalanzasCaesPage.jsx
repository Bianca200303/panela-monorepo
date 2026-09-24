import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { READING_POINTS, ESTADO_LABELS } from '../lib/formatos/calibracionBalanzasCaes'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'

// Verificación Interna de Calibración de Balanzas (CAESP-CC-PP-BPM-RE-MYC-002)
// -- SOLO CAES, ver COOPERATIVE.features.controlesPlantaCAES en
// lib/config.js. Registro plano (fecha+balanza), patrón "historial de
// filas" sin cabecera de control (mismo criterio que
// LavadoManosCaesPage.jsx/PreparacionSolucionesCaesPage.jsx/
// ManejoResiduosCaesPage.jsx). El error promedio se calcula solo a partir
// de las 5 lecturas (no se tipea a mano).

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm() {
  const f = { control_date: todayISO(), balance_code: '', area: '', equipment_name: '', error_maximo_permitido: '', peso_patron: '', estado: '', acciones_correctivas: '' }
  for (const p of READING_POINTS) { f[`${p}_peso`] = ''; f[`${p}_error`] = '' }
  return f
}

function toNumOrNull(v) {
  const n = parseFloat(v)
  return v !== '' && !isNaN(n) ? n : null
}

function computeErrorPromedio(form) {
  const values = READING_POINTS.map(p => toNumOrNull(form[`${p}_error`])).filter(v => v != null)
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

export default function CalibracionBalanzasCaesPage() {
  const webUser = useAuthStore(s => s.webUser)

  const [view, setView] = useState('history') // 'history' | 'form'
  const [rows, setRows] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_balance_calibration_caes')
      .select('id, control_date, balance_code, area, equipment_name, estado, registered_by:web_users!pbcc_created_by_fkey ( first_name, last_name )')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('control_date', { ascending: false })
      .limit(50)
    setRows(data ?? [])
    setLoadingHistory(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function startNew() {
    setEditingId(null)
    setForm(emptyForm())
    setError('')
    setView('form')
  }

  async function startEdit(r) {
    setEditingId(r.id)
    const { data: full } = await supabase
      .from('plant_balance_calibration_caes')
      .select('*')
      .eq('id', r.id)
      .single()
    const f = {
      control_date: full.control_date, balance_code: full.balance_code ?? '', area: full.area ?? '',
      equipment_name: full.equipment_name ?? '', error_maximo_permitido: full.error_maximo_permitido ?? '',
      peso_patron: full.peso_patron ?? '', estado: full.estado ?? '', acciones_correctivas: full.acciones_correctivas ?? '',
    }
    for (const p of READING_POINTS) {
      f[`${p}_peso`] = full[`${p}_peso`] != null ? String(full[`${p}_peso`]) : ''
      f[`${p}_error`] = full[`${p}_error`] != null ? String(full[`${p}_error`]) : ''
    }
    setForm(f)
    setError('')
    setView('form')
  }

  async function handleSave() {
    setError('')
    if (!form.control_date) { setError('Seleccione la fecha.'); return }

    setSaving(true)
    try {
      const payload = {
        control_date: form.control_date,
        balance_code: form.balance_code.trim() || null,
        area: form.area.trim() || null,
        equipment_name: form.equipment_name.trim() || null,
        error_maximo_permitido: form.error_maximo_permitido.trim() || null,
        peso_patron: form.peso_patron.trim() || null,
        error_promedio: computeErrorPromedio(form),
        estado: form.estado || null,
        acciones_correctivas: form.acciones_correctivas.trim() || null,
      }
      for (const p of READING_POINTS) {
        payload[`${p}_peso`] = toNumOrNull(form[`${p}_peso`])
        payload[`${p}_error`] = toNumOrNull(form[`${p}_error`])
      }

      if (editingId) {
        const { error: updErr } = await supabase
          .from('plant_balance_calibration_caes')
          .update(payload)
          .eq('id', editingId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { error: insErr } = await supabase
          .from('plant_balance_calibration_caes')
          .insert({ cooperative_id: COOPERATIVE.id, created_by: webUser.id, ...payload })
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

  const errorPromedio = computeErrorPromedio(form)

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>Calibración de Balanzas</h2>
          <button className="btn primary" onClick={startNew}>+ Nuevo registro</button>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : rows.length === 0 ? (
          <EmptyState message="No hay registros de calibración de balanzas aún." />
        ) : (
          <div className="list">
            {rows.map(r => (
              <div key={r.id} className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{new Date(`${r.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                    {r.balance_code && <span className="muted small" style={{ marginLeft: 8 }}>{r.balance_code}</span>}
                    {r.area && <span className="muted small" style={{ marginLeft: 8 }}>· {r.area}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {r.estado && <span className={`tag ${r.estado === 'conforme' ? 'ok' : 'warn'}`}>{ESTADO_LABELS[r.estado]}</span>}
                    <button className="btn small outline" onClick={() => startEdit(r)}>Editar</button>
                  </div>
                </div>
                <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                  {r.equipment_name && `${r.equipment_name} · `}
                  {r.registered_by && `Registrado por: ${r.registered_by.first_name} ${r.registered_by.last_name}`}
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
        <h2>{editingId ? 'Editar' : 'Nuevo'} registro de calibración de balanzas</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Fecha</label>
            <input type="date" value={form.control_date} onChange={e => setForm({ ...form, control_date: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Código de balanza</label>
            <input type="text" value={form.balance_code} onChange={e => setForm({ ...form, balance_code: e.target.value })} placeholder="Ej: BAG-012" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Área</label>
            <input type="text" value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} placeholder="Ej: Envasado" />
          </div>
        </div>
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Denominación del equipo</label>
            <input type="text" value={form.equipment_name} onChange={e => setForm({ ...form, equipment_name: e.target.value })} placeholder="Ej: Balanza electrónica (0.5g - 3kg)" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Error máximo permitido</label>
            <input type="text" value={form.error_maximo_permitido} onChange={e => setForm({ ...form, error_maximo_permitido: e.target.value })} placeholder="Ej: ±0.04" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Peso de pesa patrón</label>
            <input type="text" value={form.peso_patron} onChange={e => setForm({ ...form, peso_patron: e.target.value })} placeholder="Ej: 500g" />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Lectura de Balanza</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="table small">
            <thead>
              <tr>
                <th></th>
                {READING_POINTS.map(p => <th key={p}>{p.toUpperCase()}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600 }}>Peso</td>
                {READING_POINTS.map(p => (
                  <td key={p}>
                    <input type="number" step="0.01" value={form[`${p}_peso`]} onChange={e => setForm({ ...form, [`${p}_peso`]: e.target.value })} style={{ width: 80 }} />
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Error</td>
                {READING_POINTS.map(p => (
                  <td key={p}>
                    <input type="number" step="0.01" value={form[`${p}_error`]} onChange={e => setForm({ ...form, [`${p}_error`]: e.target.value })} style={{ width: 80 }} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          Error promedio (calculado): <strong>{errorPromedio != null ? errorPromedio.toFixed(2) : '—'}</strong>
        </p>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="field">
          <label>Estado</label>
          <select value={form.estado} onChange={e => setForm({ ...form, estado: e.target.value })}>
            <option value="">Seleccione...</option>
            <option value="conforme">Conforme</option>
            <option value="no_conforme">No conforme</option>
          </select>
        </div>
        <div className="field">
          <label>Acciones correctivas</label>
          <textarea rows={2} value={form.acciones_correctivas} onChange={e => setForm({ ...form, acciones_correctivas: e.target.value })} />
        </div>
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
