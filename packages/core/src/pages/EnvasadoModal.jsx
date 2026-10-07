import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { loteKg, loteLabel, packagingLabel, loteBunques } from '../lib/loteHelpers'
import { getLoteLabelLower, getBunqueLabelPlural } from '../lib/labels'
import { useCooperative } from '../lib/cooperativeContext'
import Icon from '../components/Icon'

// Registro de envasado: a diferencia del tamizado (por bunque), el envasado
// es por LOTE y hay exactamente 1 registro por lote. Es una reconfirmación
// de cierre: lo realmente envasado (QQ, cajas, bolsas o sacos) debe coincidir
// EXACTO con lo planificado al crear el lote (packaging_count, packaging_kg,
// boxes_count) -- no es un dato nuevo a planificar.

// Tolerancia de comparación QQ<->kg: solo cubre imprecisión de punto
// flotante, no es una tolerancia de negocio (el usuario pidió coincidencia
// exacta).
const FLOAT_EPSILON_KG = 0.01

// Turno por defecto según la hora actual -- el mediodía como corte entre
// mañana/tarde es una convención simple, se puede seguir editando igual.
function defaultTurno() {
  return new Date().getHours() < 12 ? 'manana' : 'tarde'
}

export default function EnvasadoModal({ plantBatch, order, kgPerQuintal, webUser, onClose, onSaved }) {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE, order)
  const BUNQUE_LABEL_PLURAL = getBunqueLabelPlural(COOPERATIVE)
  const isBolsa = plantBatch.packaging_type === 'bolsa'
  const isSaco = plantBatch.packaging_type === 'saco'
  const plannedKg = loteKg(plantBatch)
  const bunques = loteBunques(plantBatch)

  // Varios campos exigen coincidir EXACTO con lo ya planificado del lote
  // (packaging_count, boxes_count, el peso planificado) -- como el valor
  // "correcto" ya se conoce de antemano, se precarga para no hacer
  // escribir de nuevo un número que el sistema ya tiene. Sigue siendo
  // editable por si de verdad hubo una diferencia real.
  const defaultQq = kgPerQuintal > 0 ? (plannedKg / kgPerQuintal).toFixed(2) : ''

  const [form, setForm] = useState({
    envasado_turno: plantBatch.envasado_turno ?? defaultTurno(),
    envasado_qq: plantBatch.envasado_qq != null ? String(plantBatch.envasado_qq) : defaultQq,
    envasado_descarte_barrido_kg: plantBatch.envasado_descarte_barrido_kg != null ? String(plantBatch.envasado_descarte_barrido_kg) : '0',
    envasado_cajas_envasadas: plantBatch.envasado_cajas_envasadas != null ? String(plantBatch.envasado_cajas_envasadas) : (plantBatch.boxes_count != null ? String(plantBatch.boxes_count) : ''),
    envasado_cajas_descarte: plantBatch.envasado_cajas_descarte != null ? String(plantBatch.envasado_cajas_descarte) : '0',
    envasado_bolsas_envasadas: plantBatch.envasado_bolsas_envasadas != null ? String(plantBatch.envasado_bolsas_envasadas) : (plantBatch.packaging_type === 'bolsa' && plantBatch.packaging_count != null ? String(plantBatch.packaging_count) : ''),
    envasado_sacos_envasados: plantBatch.envasado_sacos_envasados != null ? String(plantBatch.envasado_sacos_envasados) : (plantBatch.packaging_type === 'saco' && plantBatch.packaging_count != null ? String(plantBatch.packaging_count) : ''),
    envasado_bolsas_rechazo_metal: plantBatch.envasado_bolsas_rechazo_metal != null ? String(plantBatch.envasado_bolsas_rechazo_metal) : '0',
    envasado_bolsas_descarte_fabrica: plantBatch.envasado_bolsas_descarte_fabrica != null ? String(plantBatch.envasado_bolsas_descarte_fabrica) : '0',
    envasado_bolsas_descarte_sellado: plantBatch.envasado_bolsas_descarte_sellado != null ? String(plantBatch.envasado_bolsas_descarte_sellado) : '0',
    envasado_bolsas_descarte_codificado: plantBatch.envasado_bolsas_descarte_codificado != null ? String(plantBatch.envasado_bolsas_descarte_codificado) : '0',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // El rechazo por detector de metales se registra inspección por inspección
  // en el formulario de Control de objetos extraños de este mismo lote --
  // aquí es de solo lectura. Un trigger de BD (recalc_batch_rechazo_metal,
  // ver 20260819100000_rechazo_metal_derivado_de_objetos_extranos.sql)
  // mantiene plantBatch.envasado_bolsas_rechazo_metal siempre sincronizado
  // con el total real de ese formulario -- no hace falta recalcularlo acá.
  // Nunca se escribe a mano en Envasado: si el número está mal, se corrige
  // yendo directo a Control de objetos extraños, no aquí.

  const qq = parseFloat(form.envasado_qq || 0)
  const envasadoKgEquiv = qq * kgPerQuintal
  const qqDiffKg = envasadoKgEquiv - plannedKg
  const qqOk = form.envasado_qq !== '' && Math.abs(qqDiffKg) <= FLOAT_EPSILON_KG

  const cajasOk = plantBatch.boxes_count == null ||
    (form.envasado_cajas_envasadas !== '' && parseInt(form.envasado_cajas_envasadas, 10) === plantBatch.boxes_count)

  const empaqueOk = isBolsa
    ? (plantBatch.packaging_count == null || (form.envasado_bolsas_envasadas !== '' && parseInt(form.envasado_bolsas_envasadas, 10) === plantBatch.packaging_count))
    : isSaco
      ? (plantBatch.packaging_count == null || (form.envasado_sacos_envasados !== '' && parseInt(form.envasado_sacos_envasados, 10) === plantBatch.packaging_count))
      : true

  const turnoOk = form.envasado_turno !== ''
  const canSave = turnoOk && qqOk && cajasOk && empaqueOk

  // Informativo, no bloqueante: cuánto de lo tamizado ya se refleja en el envasado.
  const tamizadaKg = Number(plantBatch.tamizada_kg ?? 0)
  const envasadoVsTamizadaPct = tamizadaKg > 0 ? (envasadoKgEquiv / tamizadaKg) * 100 : null

  const handleSave = async () => {
    setError('')
    if (!turnoOk) { setError('Seleccione el turno'); return }
    if (form.envasado_qq === '') { setError('Ingrese la panela envasada (QQ)'); return }
    if (!qqOk) {
      setError(`La panela envasada (${qq.toFixed(1)} QQ = ${envasadoKgEquiv.toFixed(1)} kg) no coincide con el peso planificado del ${LOTE_LABEL_LOWER} (${plannedKg.toFixed(1)} kg). Diferencia: ${qqDiffKg.toFixed(2)} kg.`)
      return
    }
    if (!cajasOk) {
      setError(`Cajas envasadas debe coincidir con las cajas planificadas del ${LOTE_LABEL_LOWER} (${plantBatch.boxes_count}).`)
      return
    }
    if (!empaqueOk) {
      const label = isBolsa ? 'Bolsas' : 'Sacos'
      setError(`${label} envasados debe coincidir con la cantidad planificada del ${LOTE_LABEL_LOWER} (${plantBatch.packaging_count}).`)
      return
    }

    const payload = {
      envasado_turno: form.envasado_turno,
      envasado_qq: qq,
      envasado_descarte_barrido_kg: parseFloat(form.envasado_descarte_barrido_kg || 0),
      envasado_cajas_envasadas: parseInt(form.envasado_cajas_envasadas, 10),
      envasado_cajas_descarte: parseInt(form.envasado_cajas_descarte || 0, 10),
      envasado_bolsas_envasadas: isBolsa ? parseInt(form.envasado_bolsas_envasadas, 10) : null,
      envasado_sacos_envasados: isSaco ? parseInt(form.envasado_sacos_envasados, 10) : null,
      envasado_bolsas_rechazo_metal: isBolsa ? parseInt(form.envasado_bolsas_rechazo_metal || 0, 10) : null,
      envasado_bolsas_descarte_fabrica: isBolsa ? parseInt(form.envasado_bolsas_descarte_fabrica || 0, 10) : null,
      envasado_bolsas_descarte_sellado: isBolsa ? parseInt(form.envasado_bolsas_descarte_sellado || 0, 10) : null,
      envasado_bolsas_descarte_codificado: isBolsa ? parseInt(form.envasado_bolsas_descarte_codificado || 0, 10) : null,
      envasado_registered_by: webUser.id,
      envasado_registered_at: new Date().toISOString(),
    }

    setSaving(true)
    try {
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
      <div className="modal-content envasado-modal" style={{ maxWidth: 640 }}>
        <div className="modal-body">
          <h3 style={{ margin: '0 0 4px' }}>Envasado: {loteLabel(plantBatch)}</h3>
          <p className="small" style={{ margin: '0 0 4px', color: '#000' }}>
            {plantBatch.brand} · {packagingLabel(plantBatch)} · {plannedKg.toFixed(1)} kg planificados
          </p>
          {bunques.length > 0 && (
            <p className="small" style={{ margin: '0 0 4px', color: '#000' }}>
              {BUNQUE_LABEL_PLURAL}: <strong>{bunques.map(b => b.bunque_number).join(', ')}</strong>
            </p>
          )}
          {tamizadaKg > 0 && (
            <p className="small" style={{ margin: '0 0 16px', color: '#000' }}>
              Panela tamizada del {LOTE_LABEL_LOWER}: <strong>{tamizadaKg.toFixed(1)} kg</strong>
              {envasadoVsTamizadaPct != null && (
                <span> · envasado registrado equivale al <strong>{envasadoVsTamizadaPct.toFixed(0)}%</strong> de lo tamizado (dato informativo, no bloquea).</span>
              )}
            </p>
          )}

          <div className="field">
            <label>Turno</label>
            <select value={form.envasado_turno} onChange={e => setForm({ ...form, envasado_turno: e.target.value })}>
              <option value="">Seleccione...</option>
              <option value="manana">Mañana</option>
              <option value="tarde">Tarde</option>
            </select>
          </div>

          <div className="grid" style={{ gap: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Panela envasada (QQ)</label>
              <input type="number" min="0" step="0.01" value={form.envasado_qq}
                style={{ borderColor: form.envasado_qq === '' || qqOk ? undefined : '#dc2626' }}
                onChange={e => setForm({ ...form, envasado_qq: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Descarte por barrido (kg)</label>
              <input type="number" min="0" step="0.1" value={form.envasado_descarte_barrido_kg}
                onChange={e => setForm({ ...form, envasado_descarte_barrido_kg: e.target.value })} />
            </div>
          </div>
          {form.envasado_qq !== '' && (
            <p className="muted small" style={{ margin: '4px 0 12px', color: qqOk ? 'var(--success)' : '#dc2626', display: 'flex', alignItems: 'center', gap: 5 }}>
              {envasadoKgEquiv.toFixed(1)} kg equivalentes de {plannedKg.toFixed(1)} kg planificados
              {qqOk ? <Icon name="check" size={13} /> : ` — no coincide (diferencia ${qqDiffKg.toFixed(2)} kg)`}
            </p>
          )}

          <div className="grid" style={{ gap: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Cajas envasadas {plantBatch.boxes_count != null && `(plan: ${plantBatch.boxes_count})`}</label>
              <input type="number" min="0" step="1" value={form.envasado_cajas_envasadas}
                style={{ borderColor: form.envasado_cajas_envasadas === '' || cajasOk ? undefined : '#dc2626' }}
                onChange={e => setForm({ ...form, envasado_cajas_envasadas: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Cajas de descarte</label>
              <input type="number" min="0" step="1" value={form.envasado_cajas_descarte}
                onChange={e => setForm({ ...form, envasado_cajas_descarte: e.target.value })} />
            </div>
          </div>

          {isBolsa && (
            <>
              <div className="field">
                <label>Bolsas envasadas {plantBatch.packaging_count != null && `(plan: ${plantBatch.packaging_count})`}</label>
                <input type="number" min="0" step="1" value={form.envasado_bolsas_envasadas}
                  style={{ borderColor: form.envasado_bolsas_envasadas === '' || empaqueOk ? undefined : '#dc2626' }}
                  onChange={e => setForm({ ...form, envasado_bolsas_envasadas: e.target.value })} />
              </div>
              <div className="grid" style={{ gap: 8 }}>
                {COOPERATIVE?.features?.detectorMetales && (
                  <div className="field" style={{ margin: 0 }}>
                    <label>Rechazo detector de metales</label>
                    <input type="number" value={form.envasado_bolsas_rechazo_metal} disabled />
                    <p className="muted small" style={{ margin: '4px 0 0' }}>
                      Para editar este campo, ve a la sección de Control de objetos extraños.
                    </p>
                  </div>
                )}
                <div className="field" style={{ margin: 0 }}>
                  <label>Descarte de fábrica</label>
                  <input type="number" min="0" step="1" value={form.envasado_bolsas_descarte_fabrica}
                    onChange={e => setForm({ ...form, envasado_bolsas_descarte_fabrica: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Descarte por sellado</label>
                  <input type="number" min="0" step="1" value={form.envasado_bolsas_descarte_sellado}
                    onChange={e => setForm({ ...form, envasado_bolsas_descarte_sellado: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Descarte por codificado</label>
                  <input type="number" min="0" step="1" value={form.envasado_bolsas_descarte_codificado}
                    onChange={e => setForm({ ...form, envasado_bolsas_descarte_codificado: e.target.value })} />
                </div>
              </div>
            </>
          )}

          {isSaco && (
            <div className="field">
              <label>Sacos envasados {plantBatch.packaging_count != null && `(plan: ${plantBatch.packaging_count})`}</label>
              <input type="number" min="0" step="1" value={form.envasado_sacos_envasados}
                style={{ borderColor: form.envasado_sacos_envasados === '' || empaqueOk ? undefined : '#dc2626' }}
                onChange={e => setForm({ ...form, envasado_sacos_envasados: e.target.value })} />
            </div>
          )}

          {error && <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}
        </div>
        <div className="modal-actions">
          <button className="btn small" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn small primary" onClick={handleSave} disabled={saving || !canSave}>
            {saving ? 'Guardando...' : 'Guardar envasado'}
          </button>
        </div>
      </div>
    </div>
  )
}
