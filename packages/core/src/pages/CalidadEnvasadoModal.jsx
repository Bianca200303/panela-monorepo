import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { loadCalidadEnvasadoOptions } from '../lib/formConfig'
import { loteLabel, packagingLabel, formatDate, pctToMgkg, mgkgToPct } from '../lib/loteHelpers'
import { getCoopCode } from '../lib/formatos/shared'

// Control de calidad del producto ya envasado: 1 registro por lote, editable
// (se puede volver a guardar si hubo que corregir algo). A diferencia del
// envasado, aquí no hay un valor planificado contra el cual coincidir --
// simplemente se completan los datos medidos más observaciones libres.
//
// CAES (COOPERATIVE.features.liberacionProductoTerminado, ver
// [[project_control_calidad_envasado]]/LPT-001 "Control y Liberación de
// Producto Terminado"): Color/Sabor/Textura no aparecen en su papel real, se
// sacan del formulario y del requisito para cerrar el lote -- en su lugar se
// completan 4 campos propios (unidades por lote, formato/presentación,
// muestreado por, resultado C/NC), todos informativos, no bloquean el
// cierre. Decidido con el usuario 2026-09-13.

export default function CalidadEnvasadoModal({ plantBatch, webUser, onClose, onSaved }) {
  const COOPERATIVE = useCooperative()
  const isLiberacion = !!COOPERATIVE?.features?.liberacionProductoTerminado
  const [form, setForm] = useState({
    calidad_humedad_pct: plantBatch.calidad_humedad_pct != null ? String(plantBatch.calidad_humedad_pct) : '',
    calidad_impurezas_pct: plantBatch.calidad_impurezas_pct != null ? String(plantBatch.calidad_impurezas_pct) : '',
    calidad_impurezas_mgkg: plantBatch.calidad_impurezas_mgkg != null ? String(plantBatch.calidad_impurezas_mgkg) : '',
    calidad_color: plantBatch.calidad_color ?? '',
    calidad_sabor: plantBatch.calidad_sabor ?? '',
    calidad_textura: plantBatch.calidad_textura ?? '',
    calidad_observaciones: plantBatch.calidad_observaciones ?? '',
    liberacion_unidades_por_lote: plantBatch.liberacion_unidades_por_lote != null ? String(plantBatch.liberacion_unidades_por_lote) : '',
    // Se prellena con el empaque planificado del lote (packagingLabel) --
    // mismo criterio que "Presentación" en SelladoEnvasadoCaesModal.jsx --
    // pero solo si todavía no se guardó un valor propio antes, y solo si
    // packagingLabel tiene datos reales (no el placeholder "—").
    liberacion_formato_presentacion: plantBatch.liberacion_formato_presentacion
      ?? (packagingLabel(plantBatch) !== '—' ? packagingLabel(plantBatch) : ''),
    liberacion_muestreado_por: plantBatch.liberacion_muestreado_por ?? '',
    liberacion_resultado: plantBatch.liberacion_resultado ?? '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [options, setOptions] = useState({ color: [], sabor: [], textura: [] })

  useEffect(() => { if (!isLiberacion) loadCalidadEnvasadoOptions(COOPERATIVE).then(setOptions) }, [])

  function updateImpurezas(unit, value) {
    setForm(f => unit === 'pct'
      ? { ...f, calidad_impurezas_pct: value, calidad_impurezas_mgkg: pctToMgkg(value) }
      : { ...f, calidad_impurezas_mgkg: value, calidad_impurezas_pct: mgkgToPct(value) })
  }

  const humedad = parseFloat(form.calidad_humedad_pct)
  const impurezas = parseFloat(form.calidad_impurezas_pct)
  const humedadOk = form.calidad_humedad_pct !== '' && !isNaN(humedad) && humedad >= 0 && humedad <= 100
  const impurezasOk = form.calidad_impurezas_pct !== '' && !isNaN(impurezas) && impurezas >= 0 && impurezas <= 100
  const canSave = humedadOk && impurezasOk && (isLiberacion ||
    (form.calidad_color.trim() !== '' && form.calidad_sabor.trim() !== '' && form.calidad_textura.trim() !== ''))

  const handleSave = async () => {
    setError('')
    if (!humedadOk) { setError('Ingrese un % de humedad válido (0 a 100)'); return }
    if (!impurezasOk) { setError('Ingrese un % de impurezas válido (0 a 100)'); return }
    if (!isLiberacion) {
      if (!form.calidad_color.trim()) { setError('Ingrese el color'); return }
      if (!form.calidad_sabor.trim()) { setError('Ingrese el sabor'); return }
      if (!form.calidad_textura.trim()) { setError('Ingrese la textura'); return }
    }

    setSaving(true)
    try {
      const payload = {
        calidad_humedad_pct: humedad,
        calidad_impurezas_pct: impurezas,
        calidad_impurezas_mgkg: form.calidad_impurezas_mgkg !== '' ? Number(form.calidad_impurezas_mgkg) : null,
        calidad_observaciones: form.calidad_observaciones.trim() || null,
        calidad_registered_by: webUser.id,
        calidad_registered_at: new Date().toISOString(),
      }
      if (isLiberacion) {
        const unidades = parseInt(form.liberacion_unidades_por_lote, 10)
        payload.liberacion_unidades_por_lote = form.liberacion_unidades_por_lote !== '' && !isNaN(unidades) ? unidades : null
        payload.liberacion_formato_presentacion = form.liberacion_formato_presentacion.trim() || null
        payload.liberacion_muestreado_por = form.liberacion_muestreado_por.trim() || null
        payload.liberacion_resultado = form.liberacion_resultado || null
        if (!plantBatch.liberacion_formato_codigo) {
          const { data: codigo, error: codeErr } = await supabase
            .rpc('generate_liberacion_control_code', { p_cooperative_id: COOPERATIVE.id, p_coop_code: getCoopCode(COOPERATIVE) })
          if (codeErr) throw new Error(codeErr.message)
          payload.liberacion_formato_codigo = codigo
        }
      } else {
        payload.calidad_color = form.calidad_color.trim()
        payload.calidad_sabor = form.calidad_sabor.trim()
        payload.calidad_textura = form.calidad_textura.trim()
      }
      const { error: updErr } = await supabase
        .from('plant_production_batches')
        .update(payload)
        .eq('id', plantBatch.id)
      if (updErr) throw new Error(updErr.message)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 560 }}>
        <div className="modal-body">
          <h3 style={{ margin: '0 0 4px' }}>{isLiberacion ? 'Liberación de producto terminado' : 'Control de calidad'}: {loteLabel(plantBatch)}</h3>
          <p className="small" style={{ margin: '0 0 16px', color: '#000' }}>
            {plantBatch.brand} · {packagingLabel(plantBatch)}
          </p>

          {isLiberacion && (plantBatch.envasado_registered_at || plantBatch.liberacion_formato_codigo) && (
            <p className="muted small" style={{ margin: '0 0 16px' }}>
              {plantBatch.envasado_registered_at && `Fecha de producción: ${formatDate(plantBatch.envasado_registered_at)}`}
              {plantBatch.envasado_registered_at && plantBatch.liberacion_formato_codigo && ' · '}
              {plantBatch.liberacion_formato_codigo}
            </p>
          )}

          <div className="grid" style={{ gap: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Humedad (%)</label>
              <input type="number" min="0" max="100" step="0.01" value={form.calidad_humedad_pct}
                style={{ borderColor: form.calidad_humedad_pct === '' || humedadOk ? undefined : '#dc2626' }}
                onChange={e => setForm({ ...form, calidad_humedad_pct: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Impurezas (%)</label>
              <input type="number" min="0" step="0.0001" value={form.calidad_impurezas_pct}
                style={{ borderColor: form.calidad_impurezas_pct === '' || impurezasOk ? undefined : '#dc2626' }}
                onChange={e => updateImpurezas('pct', e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Impurezas (mg/kg)</label>
              <input type="number" min="0" step="0.01" value={form.calidad_impurezas_mgkg}
                onChange={e => updateImpurezas('mgkg', e.target.value)} />
            </div>
          </div>

          {isLiberacion ? (
            <>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Unidades por lote</label>
                  <input type="number" min="0" step="1" value={form.liberacion_unidades_por_lote}
                    onChange={e => setForm({ ...form, liberacion_unidades_por_lote: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Formato / Presentación</label>
                  <input type="text" value={form.liberacion_formato_presentacion}
                    placeholder="Ej: Sacos laminado + papel kraft 25 kilos"
                    onChange={e => setForm({ ...form, liberacion_formato_presentacion: e.target.value })} />
                </div>
              </div>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Muestreado por</label>
                  <input type="text" value={form.liberacion_muestreado_por}
                    onChange={e => setForm({ ...form, liberacion_muestreado_por: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Resultado</label>
                  <select value={form.liberacion_resultado} onChange={e => setForm({ ...form, liberacion_resultado: e.target.value })}>
                    <option value="">Seleccione...</option>
                    <option value="conforme">Conforme</option>
                    <option value="no_conforme">No conforme</option>
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>Color</label>
                <select value={form.calidad_color} onChange={e => setForm({ ...form, calidad_color: e.target.value })}>
                  <option value="">Seleccione...</option>
                  {options.color.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Sabor</label>
                  <select value={form.calidad_sabor} onChange={e => setForm({ ...form, calidad_sabor: e.target.value })}>
                    <option value="">Seleccione...</option>
                    {options.sabor.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Textura</label>
                  <select value={form.calidad_textura} onChange={e => setForm({ ...form, calidad_textura: e.target.value })}>
                    <option value="">Seleccione...</option>
                    {options.textura.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          <div className="field">
            <label>Observaciones</label>
            <textarea rows={3} value={form.calidad_observaciones}
              onChange={e => setForm({ ...form, calidad_observaciones: e.target.value })} />
          </div>

          {plantBatch.calidad_registered_at && (
            <p className="muted small" style={{ margin: '0 0 0' }}>
              Último registro: {new Date(plantBatch.calidad_registered_at).toLocaleString('es-PE')}
            </p>
          )}

          {error && <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}
        </div>
        <div className="modal-actions">
          <button className="btn small" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn small primary" onClick={handleSave} disabled={saving || !canSave}>
            {saving ? 'Guardando...' : isLiberacion ? 'Guardar liberación' : 'Guardar control de calidad'}
          </button>
        </div>
      </div>
    </div>
  )
}
