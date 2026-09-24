import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import { useAuthStore } from '@panela/core/store/authStore'
import { CLASIFICACION_ITEMS } from '../lib/formatos/manejoResiduosCaes'
import { loadLimpiezaGeneralAreas } from '@panela/core/lib/formConfig'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'

// Manejo de Residuos (CAESP-PP-HYS-RE-MDR-001) -- SOLO CAES, ver
// COOPERATIVE.features.controlesPlantaCAES en lib/config.js. Registro
// plano (fecha+hora), mismo patrón "historial de filas" que
// CalibracionBalanzasCaesPage.jsx. Último control de Fase 2.
//
// Clasificación de Residuo: los 4 checks arrancan marcados (mismo criterio
// "arranca en bueno" que el resto de los checklists de la app) y usan el
// estilo de botón con ícono coloreado (igual que SelladoEnvasadoCaesModal.jsx)
// en vez del checkbox nativo.
//
// Origen del residuo: pasó de texto libre a multi-selección (chips) del
// catálogo de áreas físicas de la planta CAES (mismo que Control de Plagas /
// Lavado de Manos) -- un mismo registro puede juntar residuos de varias
// áreas a la vez (migración 20260920130000, columna text[]).

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm() {
  const f = {
    control_date: todayISO(), control_time: '', origen_residuo: [], cantidad_bolsas: '',
    disposicion_recolector_municipal: true, disposicion_otro: '', observacion: '',
  }
  for (const item of CLASIFICACION_ITEMS) f[item.code] = true
  return f
}

function toggleInArray(arr, value) {
  return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]
}

function Chip({ label, active, onClick }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999,
        border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
        background: active ? 'var(--primary)' : '#fff', color: active ? '#fff' : 'var(--text)',
        fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

function toIntOrNull(v) {
  const n = parseInt(v, 10)
  return v !== '' && !isNaN(n) ? n : null
}

export default function ManejoResiduosCaesPage() {
  const webUser = useAuthStore(s => s.webUser)

  const [view, setView] = useState('history') // 'history' | 'form'
  const [rows, setRows] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [areaOptions, setAreaOptions] = useState([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadLimpiezaGeneralAreas(COOPERATIVE).then(groups => setAreaOptions(groups.map(g => g.area)))
  }, [])

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_waste_management_caes')
      .select('id, control_date, control_time, es_organico, es_aprovechable, es_no_aprovechable, es_peligroso, origen_residuo, cantidad_bolsas, registered_by:web_users!pwmc_created_by_fkey ( first_name, last_name )')
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

  function startEdit(r) {
    setEditingId(r.id)
    const f = {
      control_date: r.control_date, control_time: r.control_time ?? '', origen_residuo: r.origen_residuo ?? [],
      cantidad_bolsas: r.cantidad_bolsas != null ? String(r.cantidad_bolsas) : '',
      disposicion_recolector_municipal: r.disposicion_recolector_municipal ?? true,
      disposicion_otro: r.disposicion_otro ?? '', observacion: r.observacion ?? '',
    }
    for (const item of CLASIFICACION_ITEMS) f[item.code] = r[item.code]
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
        control_time: form.control_time || null,
        origen_residuo: form.origen_residuo.length > 0 ? form.origen_residuo : null,
        cantidad_bolsas: toIntOrNull(form.cantidad_bolsas),
        disposicion_recolector_municipal: form.disposicion_recolector_municipal,
        disposicion_otro: form.disposicion_recolector_municipal ? null : (form.disposicion_otro.trim() || null),
        observacion: form.observacion.trim() || null,
      }
      for (const item of CLASIFICACION_ITEMS) payload[item.code] = form[item.code]

      if (editingId) {
        const { error: updErr } = await supabase
          .from('plant_waste_management_caes')
          .update(payload)
          .eq('id', editingId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { error: insErr } = await supabase
          .from('plant_waste_management_caes')
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

  // ─── HISTORIAL ────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div>
        <div className="page-header">
          <h2>Manejo de Residuos</h2>
          <button className="btn primary" onClick={startNew}>+ Nuevo registro</button>
        </div>

        {loadingHistory ? (
          <SkeletonList count={3} lines={2} />
        ) : rows.length === 0 ? (
          <EmptyState message="No hay registros de manejo de residuos aún." />
        ) : (
          <div className="list">
            {rows.map(r => {
              const clasificaciones = CLASIFICACION_ITEMS.filter(item => r[item.code]).map(item => item.label)
              return (
                <div key={r.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>{new Date(`${r.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                      {r.control_time && <span className="muted small" style={{ marginLeft: 8 }}>{r.control_time}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.cantidad_bolsas != null && <span className="tag ok">{r.cantidad_bolsas} bolsa(s)</span>}
                      <button className="btn small outline" onClick={() => startEdit(r)}>Editar</button>
                    </div>
                  </div>
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                    {clasificaciones.length > 0 && `${clasificaciones.join(', ')} · `}
                    {(r.origen_residuo ?? []).length > 0 && `${r.origen_residuo.join(', ')} · `}
                    {r.registered_by && `Registrado por: ${r.registered_by.first_name} ${r.registered_by.last_name}`}
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
        <h2>{editingId ? 'Editar' : 'Nuevo'} registro de manejo de residuos</h2>
        <button className="btn small" onClick={() => setView('history')}>← Cancelar</button>
      </div>

      <div className="card">
        <div className="grid" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Fecha</label>
            <input type="date" value={form.control_date} onChange={e => setForm({ ...form, control_date: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Hora</label>
            <input type="time" value={form.control_time} onChange={e => setForm({ ...form, control_time: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Cantidad estimada (N° bolsas)</label>
            <input type="number" min="0" value={form.cantidad_bolsas} onChange={e => setForm({ ...form, cantidad_bolsas: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label>Clasificación de Residuo <span className="muted small" style={{ fontWeight: 400 }}>(todas arrancan marcadas)</span></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CLASIFICACION_ITEMS.map(item => {
              const ok = form[item.code]
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setForm({ ...form, [item.code]: !ok })}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 12px', borderRadius: 999,
                    border: '1px solid var(--border)', background: '#fff',
                    fontSize: 13, fontWeight: 500, color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {item.label}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    background: ok ? 'var(--success)' : 'var(--danger)', color: '#fff',
                  }}>
                    <Icon name={ok ? 'check' : 'x'} size={12} />
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="field">
          <label>Origen del residuo <span className="muted small" style={{ fontWeight: 400 }}>(puede elegir varias)</span></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {areaOptions.map(a => (
              <Chip key={a} label={a} active={form.origen_residuo.includes(a)} onClick={() => setForm({ ...form, origen_residuo: toggleInArray(form.origen_residuo, a) })} />
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="field" style={{ marginTop: 0 }}>
          <label>Disposición final</label>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
              <input type="radio" checked={form.disposicion_recolector_municipal} onChange={() => setForm({ ...form, disposicion_recolector_municipal: true })} />
              Recolector Municipal
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
              <input type="radio" checked={!form.disposicion_recolector_municipal} onChange={() => setForm({ ...form, disposicion_recolector_municipal: false })} />
              Otro
            </label>
            {!form.disposicion_recolector_municipal && (
              <input type="text" value={form.disposicion_otro} onChange={e => setForm({ ...form, disposicion_otro: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
            )}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Observación</label>
          <textarea rows={2} value={form.observacion} onChange={e => setForm({ ...form, observacion: e.target.value })} />
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
