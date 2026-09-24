import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../lib/config'
import {
  VEHICULO_CHECK_ITEMS, CARGA_CHECK_ITEMS, HERMETICIDAD_LABELS, DESINFECCION_LABELS,
} from '../lib/formatos/transportUnitControlsCaes'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { fetchMateriaPrimaTransporteReferencia } from '@panela/core/lib/formatos/registroTrazabilidad'
import { buildPrintHTMLEstiba } from '@panela/core/lib/formatos/estiba'
// pendiente de Fase 4 -- todavia vive en el src/ viejo (bucket 3, sin migrar).
import { formatDate, PACKAGING_TYPE_LABELS } from '@panela/core/lib/loteHelpers'
import { SkeletonList } from '@panela/core/components/Skeleton'
import EmptyState from '@panela/core/components/EmptyState'
import Icon from '@panela/core/components/Icon'
import { useConfirm } from '@panela/core/hooks/useConfirm'

// Control de la Unidad de Transporte (CAESP-PP-BPM-RE-CUT-001) -- SOLO
// CAES. A diferencia de Sellado/Envasado o Monitoreo del Tamizado (que
// viven por LOTE), este vive por CONTENEDOR/despacho -- aplica tanto a
// Nacional como a Exportación (el tramo Montero->Paita de una exportación
// también es un camión real). Es "registro plano": 0 a N controles por
// contenedor, uno por cada tramo de transporte real que haya ocurrido, sin
// forzar una cantidad fija de tramos -- ver migración 20260916130000.
//
// Los estibadores (lista chica, 2-3 personas por control) se manejan
// distinto según el modo: en un registro NUEVO se juntan en memoria y se
// insertan junto con el control al guardar (todavía no existe control_id
// real); en un registro YA GUARDADO se agregan/eliminan al toque contra la
// tabla hija, mismo criterio que ContainerLoadingModal.jsx con pallets/personas.

const HERMETICIDAD_OPTIONS = ['B', 'R', 'M']
const DESINFECCION_OPTIONS = ['cloro', 'alcohol']

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm() {
  const f = {
    control_date: todayISO(),
    lugar_partida: '', lugar_destino: '', guia_remision: '',
    transportista_razon_social: '', transportista_constancia_mtc: '', chofer_nombre: '', chofer_licencia: '',
    vehiculo_marca: '', vehiculo_placa: '', vehiculo_tipo: '',
    observaciones_vehiculo: '', accion_correctiva_vehiculo: '',
    presentacion: '', total_unidades: '', hermeticidad_carga: '', observaciones_carga: '',
    desinfeccion_producto: '', responsable_desinfeccion: '',
    observaciones_generales: '',
  }
  for (const item of VEHICULO_CHECK_ITEMS) f[item.code] = item.goodValue
  for (const item of CARGA_CHECK_ITEMS) f[item.code] = item.goodValue
  return f
}

function valuesFromRecord(r) {
  const f = emptyForm()
  for (const key of Object.keys(f)) {
    if (r[key] != null) f[key] = key === 'total_unidades' ? String(r[key]) : r[key]
  }
  return f
}

// Prefiltra la guía con la del Packing List-Nacional de este contenedor (si
// existe): el primer control que se cargue toma la guía "tramo interno", el
// resto toma la "tramo final" -- ambas deben coincidir con el Packing List
// (confirmado con el usuario), pero se sigue pudiendo editar libremente acá
// porque el CUT del tramo final normalmente se completa días después de
// que el Packing List ya se cerró (ver comentario en la migración).
async function suggestGuiaFromPackingList(containerId, isFirstControl) {
  const { data } = await supabase
    .from('plant_packing_list_nacional_caes')
    .select('guia_tramo_interno, guia_tramo_final')
    .eq('container_id', containerId)
    .maybeSingle()
  if (!data) return ''
  return (isFirstControl ? data.guia_tramo_interno : data.guia_tramo_final) ?? ''
}

// Prefiltra "Presentación" y "Total (unidades)" con los datos reales de
// envasado de los lotes de la orden -- solo cuando TODOS comparten el mismo
// tipo de empaque y kg por unidad (ej. todos "Saco 30kg"). Si el despacho
// mezcla presentaciones distintas entre lotes, no se adivina: se deja en
// blanco y el campo sigue siendo texto libre para describirlo a mano.
function suggestPresentacionFromOrders(orders) {
  const batches = (orders ?? []).flatMap(o => o.plant_production_batches ?? [])
  if (batches.length === 0) return { presentacion: '', totalUnidades: '' }
  const [first, ...rest] = batches
  const homogenea = rest.every(b =>
    b.packaging_type === first.packaging_type && Number(b.packaging_kg) === Number(first.packaging_kg)
  )
  if (!homogenea) return { presentacion: '', totalUnidades: '' }
  const tipo = PACKAGING_TYPE_LABELS[first.packaging_type] ?? first.packaging_type ?? ''
  const presentacion = first.packaging_kg != null ? `${tipo} ${first.packaging_kg}kg` : tipo
  const totalUnidades = batches.reduce((s, b) => s + Number(b.packaging_count ?? 0), 0)
  return { presentacion, totalUnidades: totalUnidades > 0 ? String(totalUnidades) : '' }
}

function CheckChip({ item, value, onChange }) {
  const ok = value === item.goodValue
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        width: '100%', padding: '8px 12px', borderRadius: 8,
        border: '1px solid var(--border)', background: '#fff',
        fontSize: 13, fontWeight: 500, color: 'var(--text)', textAlign: 'left', cursor: 'pointer',
      }}
    >
      {item.label}
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: 6, flexShrink: 0,
        background: ok ? 'var(--success)' : 'var(--danger)', color: '#fff',
      }}>
        <Icon name={ok ? 'check' : 'x'} size={14} />
      </span>
    </button>
  )
}

// Referencia de solo lectura (NUNCA editable, ver [[project_control_unidad_transporte_caes]]
// en memoria: es un documento firmado en el celular, no corresponde
// corregirlo desde una pantalla no relacionada) -- 1 fila colapsada por
// guía de remisión de materia prima que alimentó la producción de la
// orden, que expande al detalle exacto del control de transporte que se
// llenó en el celular (stowage_transport_inspections). Reusa
// buildPrintHTMLEstiba -- el mismo HTML que ya arma el PDF oficial FET y
// "Ver informe completo" -- en vez de reinventar el renderizado del detalle.
function MateriaPrimaReferenceRow({ entry }) {
  const [open, setOpen] = useState(false)
  const { exitReg, stowage, exitItems } = entry
  // Sin kg acá a propósito: exit_items.quantity_kg es lo que entró en TOTAL
  // por esa guía, no la porción que efectivamente terminó en esta orden (un
  // mismo ingreso de campo puede repartirse entre varios bunques y, de ahí,
  // entre varias órdenes distintas -- mostrar el total sería engañoso bajo
  // el título "Materia prima de ESTA orden"). El kg atribuido de verdad ya
  // se muestra en el Resumen de Trazabilidad (fetchRawMaterialInputsForOrder).
  const productores = [...new Set(
    exitItems.map(ei => {
      const p = ei.production_batches?.producers
      return p ? `${p.first_name} ${p.last_name}` : null
    }).filter(Boolean)
  )]

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          width: '100%', padding: '8px 12px', background: '#fff', border: 'none',
          fontSize: 12, textAlign: 'left', cursor: 'pointer',
        }}
      >
        <span>
          <strong>GR {exitReg.document_number ?? '—'}</strong>
          <span className="muted"> · {formatDate(exitReg.exit_date)} · {productores.join(', ') || '—'}</span>
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
      </button>
      {open && (
        stowage ? (
          <iframe
            srcDoc={buildPrintHTMLEstiba(COOPERATIVE, stowage.formato_codigo ?? '(borrador)', stowage.emitted_at, exitReg, stowage, exitItems, stowage.firmantes ?? [])}
            style={{ width: '100%', minHeight: 380, border: 'none', borderTop: '1px solid var(--border)', display: 'block' }}
            title={`FET-${exitReg.exit_code}`}
            onLoad={e => {
              try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 24 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ }
            }}
          />
        ) : (
          <p className="muted small" style={{ margin: 0, padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
            Sin control de unidad de transporte registrado en el celular para esta guía.
          </p>
        )
      )}
    </div>
  )
}

export default function TransportUnitControlsCaesModal({ container, orders, webUser, onClose }) {
  const { confirm, dialog: confirmDialog } = useConfirm()

  // Referencia informativa de materia prima (ver MateriaPrimaReferenceRow
  // arriba) -- se carga una sola vez al montar el modal, no en cada
  // "Nuevo registro" (no depende de qué control se está editando, es
  // siempre la misma materia prima de la orden).
  const [materiaPrimaRef, setMateriaPrimaRef] = useState([])
  const [loadingMateriaPrima, setLoadingMateriaPrima] = useState(true)
  useEffect(() => {
    let cancelled = false
    setLoadingMateriaPrima(true)
    fetchMateriaPrimaTransporteReferencia(orders)
      .then(rows => { if (!cancelled) setMateriaPrimaRef(rows) })
      .finally(() => { if (!cancelled) setLoadingMateriaPrima(false) })
    return () => { cancelled = true }
  }, [orders])

  const [view, setView] = useState('history') // 'history' | 'form'
  const [rows, setRows] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [estibadores, setEstibadores] = useState([]) // en memoria (nuevo) o ya guardados (edición)
  const [estibadorForm, setEstibadorForm] = useState({ full_name: '', dni: '' })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('plant_transport_unit_controls_caes')
      .select('*, estibadores:plant_transport_unit_control_estibadores_caes(*), registered_by:web_users!ptucc_created_by_fkey ( first_name, last_name )')
      .eq('container_id', container.id)
      .order('control_date', { ascending: false })
    setRows(data ?? [])
    setLoadingHistory(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  async function startNew() {
    setEditingId(null)
    setForm(emptyForm())
    setEstibadores([])
    setEstibadorForm({ full_name: '', dni: '' })
    setError('')
    setView('form')
    const guia = await suggestGuiaFromPackingList(container.id, rows.length === 0)
    const { presentacion, totalUnidades } = suggestPresentacionFromOrders(orders)
    setForm(f => ({
      ...f,
      ...(guia ? { guia_remision: guia } : {}),
      ...(presentacion ? { presentacion } : {}),
      ...(totalUnidades ? { total_unidades: totalUnidades } : {}),
    }))
  }

  function startEdit(r) {
    setEditingId(r.id)
    setForm(valuesFromRecord(r))
    setEstibadores(r.estibadores ?? [])
    setEstibadorForm({ full_name: '', dni: '' })
    setError('')
    setView('form')
  }

  function addEstibadorLocal() {
    if (!estibadorForm.full_name.trim()) { setError('Indique el nombre del estibador.'); return }
    setError('')
    setEstibadores(prev => [...prev, { ...estibadorForm, full_name: estibadorForm.full_name.trim(), dni: estibadorForm.dni.trim() || null, _local: true, id: `local-${Date.now()}` }])
    setEstibadorForm({ full_name: '', dni: '' })
  }

  async function addEstibadorPersisted() {
    if (!estibadorForm.full_name.trim()) { setError('Indique el nombre del estibador.'); return }
    setError('')
    try {
      const { data: newEst, error: insErr } = await supabase
        .from('plant_transport_unit_control_estibadores_caes')
        .insert({ control_id: editingId, full_name: estibadorForm.full_name.trim(), dni: estibadorForm.dni.trim() || null })
        .select('*')
        .single()
      if (insErr) throw new Error(insErr.message)
      setEstibadores(prev => [...prev, newEst])
      setEstibadorForm({ full_name: '', dni: '' })
    } catch (e) { setError(e.message ?? 'Error al agregar el estibador') }
  }

  function removeEstibadorLocal(id) {
    setEstibadores(prev => prev.filter(e => e.id !== id))
  }

  async function removeEstibadorPersisted(id) {
    await supabase.from('plant_transport_unit_control_estibadores_caes').delete().eq('id', id)
    setEstibadores(prev => prev.filter(e => e.id !== id))
  }

  async function handleSave() {
    setError('')
    if (!form.control_date) { setError('Seleccione la fecha.'); return }

    setSaving(true)
    try {
      const payload = {
        control_date: form.control_date,
        lugar_partida: form.lugar_partida.trim() || null,
        lugar_destino: form.lugar_destino.trim() || null,
        guia_remision: form.guia_remision.trim() || null,
        transportista_razon_social: form.transportista_razon_social.trim() || null,
        transportista_constancia_mtc: form.transportista_constancia_mtc.trim() || null,
        chofer_nombre: form.chofer_nombre.trim() || null,
        chofer_licencia: form.chofer_licencia.trim() || null,
        vehiculo_marca: form.vehiculo_marca.trim() || null,
        vehiculo_placa: form.vehiculo_placa.trim() || null,
        vehiculo_tipo: form.vehiculo_tipo.trim() || null,
        observaciones_vehiculo: form.observaciones_vehiculo.trim() || null,
        accion_correctiva_vehiculo: form.accion_correctiva_vehiculo.trim() || null,
        presentacion: form.presentacion.trim() || null,
        total_unidades: form.total_unidades !== '' ? parseInt(form.total_unidades, 10) : null,
        hermeticidad_carga: form.hermeticidad_carga || null,
        observaciones_carga: form.observaciones_carga.trim() || null,
        desinfeccion_producto: form.desinfeccion_producto || null,
        responsable_desinfeccion: form.responsable_desinfeccion.trim() || null,
        observaciones_generales: form.observaciones_generales.trim() || null,
      }
      for (const item of VEHICULO_CHECK_ITEMS) payload[item.code] = form[item.code]
      for (const item of CARGA_CHECK_ITEMS) payload[item.code] = form[item.code]

      if (editingId) {
        const { error: updErr } = await supabase
          .from('plant_transport_unit_controls_caes')
          .update(payload)
          .eq('id', editingId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { data: newControl, error: insErr } = await supabase
          .from('plant_transport_unit_controls_caes')
          .insert({ cooperative_id: COOPERATIVE.id, container_id: container.id, created_by: webUser.id, ...payload })
          .select('id')
          .single()
        if (insErr) throw new Error(insErr.message)
        if (estibadores.length > 0) {
          const { error: estErr } = await supabase
            .from('plant_transport_unit_control_estibadores_caes')
            .insert(estibadores.map(e => ({ control_id: newControl.id, full_name: e.full_name, dni: e.dni })))
          if (estErr) throw new Error(estErr.message)
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

  async function handleDelete(r) {
    setError('')
    const fecha = new Date(`${r.control_date}T00:00:00`).toLocaleDateString('es-PE')
    const ok = await confirm({
      title: 'Eliminar registro',
      message: `¿Eliminar el control de transporte del ${fecha}${r.lugar_destino ? ` (→ ${r.lugar_destino})` : ''}?`,
      confirmText: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    setSaving(true)
    try {
      const { error: delErr } = await supabase
        .from('plant_transport_unit_controls_caes')
        .delete()
        .eq('id', r.id)
      if (delErr) throw new Error(delErr.message)
      await loadHistory()
    } catch (err) {
      setError(err.message ?? 'Error al eliminar el registro')
    } finally {
      setSaving(false)
    }
  }

  const addEstibador = editingId ? addEstibadorPersisted : addEstibadorLocal
  const removeEstibador = editingId ? removeEstibadorPersisted : removeEstibadorLocal

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 720 }}>
        <div className="modal-body">
          {view === 'history' ? (
            <>
              <h3 style={{ margin: '0 0 4px' }}>Control de la Unidad de Transporte</h3>
              <p className="muted small" style={{ margin: '0 0 16px' }}>Contenedor {container.container_number ?? 'sin número'}</p>

              {(loadingMateriaPrima || materiaPrimaRef.length > 0) && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px' }}>Controles de transporte de la materia prima</h4>
                  {loadingMateriaPrima ? (
                    <SkeletonList count={1} lines={1} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {materiaPrimaRef.map(entry => (
                        <MateriaPrimaReferenceRow key={entry.exitReg.id} entry={entry} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button className="btn small primary" style={{ marginBottom: 12 }} onClick={startNew}>+ Nuevo registro</button>

              {loadingHistory ? (
                <SkeletonList count={2} lines={2} />
              ) : rows.length === 0 ? (
                <EmptyState message="No hay controles de unidad de transporte para este contenedor aún." />
              ) : (
                <div className="list">
                  {rows.map(r => (
                    <div key={r.id} className="card">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <strong style={{ fontSize: 15 }}>{new Date(`${r.control_date}T00:00:00`).toLocaleDateString('es-PE')}</strong>
                          {(r.lugar_partida || r.lugar_destino) && (
                            <span className="muted small" style={{ marginLeft: 8 }}>{r.lugar_partida ?? '—'} → {r.lugar_destino ?? '—'}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button className="btn small outline" onClick={() => startEdit(r)}>Editar</button>
                          <button className="btn small danger" style={{ padding: '2px 8px' }} disabled={saving} onClick={() => handleDelete(r)}>Eliminar</button>
                        </div>
                      </div>
                      <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                        {r.guia_remision && `Guía: ${r.guia_remision} · `}
                        {r.vehiculo_placa && `Placa: ${r.vehiculo_placa} · `}
                        {r.registered_by && `Registrado por: ${r.registered_by.first_name} ${r.registered_by.last_name}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <h3 style={{ margin: '0 0 4px' }}>{editingId ? 'Editar' : 'Nuevo'} control de transporte</h3>
              <p className="muted small" style={{ margin: '0 0 16px' }}>Contenedor {container.container_number ?? 'sin número'}</p>

              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Fecha</label>
                  <input type="date" value={form.control_date} onChange={e => setForm({ ...form, control_date: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>N° de guía de remisión</label>
                  <input type="text" value={form.guia_remision} onChange={e => setForm({ ...form, guia_remision: e.target.value })} />
                </div>
              </div>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Lugar o punto de partida</label>
                  <input type="text" value={form.lugar_partida} onChange={e => setForm({ ...form, lugar_partida: e.target.value })} placeholder="Dirección completa" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Lugar o punto de destino</label>
                  <input type="text" value={form.lugar_destino} onChange={e => setForm({ ...form, lugar_destino: e.target.value })} placeholder="Dirección completa" />
                </div>
              </div>

              <h4 style={{ margin: '12px 0 4px' }}>Datos del Transportista</h4>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Razón social del transportista</label>
                  <input type="text" value={form.transportista_razon_social} onChange={e => setForm({ ...form, transportista_razon_social: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>N° constancia de inscripción (MTC)</label>
                  <input type="text" value={form.transportista_constancia_mtc} onChange={e => setForm({ ...form, transportista_constancia_mtc: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Nombres y apellidos del chofer</label>
                  <input type="text" value={form.chofer_nombre} onChange={e => setForm({ ...form, chofer_nombre: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Licencia de conducir</label>
                  <input type="text" value={form.chofer_licencia} onChange={e => setForm({ ...form, chofer_licencia: e.target.value })} />
                </div>
              </div>

              <h4 style={{ margin: '12px 0 4px' }}>Datos del Vehículo</h4>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Marca</label>
                  <input type="text" value={form.vehiculo_marca} onChange={e => setForm({ ...form, vehiculo_marca: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Placa</label>
                  <input type="text" value={form.vehiculo_placa} onChange={e => setForm({ ...form, vehiculo_placa: e.target.value })} placeholder="Ej: P2J937 / TMF998" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tipo de vehículo</label>
                  <input type="text" value={form.vehiculo_tipo} onChange={e => setForm({ ...form, vehiculo_tipo: e.target.value })} placeholder="Ej: Camioneta, tráiler" />
                </div>
              </div>
              <div className="grid" style={{ gap: 8 }}>
                {VEHICULO_CHECK_ITEMS.map(item => (
                  <CheckChip key={item.code} item={item} value={form[item.code]} onChange={v => setForm({ ...form, [item.code]: v })} />
                ))}
              </div>
              <div className="field">
                <label>Observaciones del vehículo</label>
                <textarea rows={2} value={form.observaciones_vehiculo} onChange={e => setForm({ ...form, observaciones_vehiculo: e.target.value })} />
              </div>
              <div className="field">
                <label>Acción correctiva</label>
                <textarea rows={2} value={form.accion_correctiva_vehiculo} onChange={e => setForm({ ...form, accion_correctiva_vehiculo: e.target.value })} />
              </div>

              <h4 style={{ margin: '12px 0 4px' }}>Datos de la Carga</h4>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Presentación</label>
                  <input type="text" value={form.presentacion} onChange={e => setForm({ ...form, presentacion: e.target.value })} placeholder="Ej: Sacos 30kg" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Total (unidades)</label>
                  <input type="number" min="0" value={form.total_unidades} onChange={e => setForm({ ...form, total_unidades: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Verificación de la hermeticidad de la carga</label>
                  <select value={form.hermeticidad_carga} onChange={e => setForm({ ...form, hermeticidad_carga: e.target.value })}>
                    <option value="">Seleccione...</option>
                    {HERMETICIDAD_OPTIONS.map(v => <option key={v} value={v}>{HERMETICIDAD_LABELS[v]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid" style={{ gap: 8 }}>
                {CARGA_CHECK_ITEMS.map(item => (
                  <CheckChip key={item.code} item={item} value={form[item.code]} onChange={v => setForm({ ...form, [item.code]: v })} />
                ))}
              </div>
              <div className="field">
                <label>Observaciones de la carga</label>
                <textarea rows={2} value={form.observaciones_carga} onChange={e => setForm({ ...form, observaciones_carga: e.target.value })} />
              </div>

              <h4 style={{ margin: '12px 0 4px' }}>Desinfección del Vehículo</h4>
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Producto</label>
                  <select value={form.desinfeccion_producto} onChange={e => setForm({ ...form, desinfeccion_producto: e.target.value })}>
                    <option value="">Seleccione...</option>
                    {DESINFECCION_OPTIONS.map(v => <option key={v} value={v}>{DESINFECCION_LABELS[v]}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Responsable de la desinfección</label>
                  <input type="text" value={form.responsable_desinfeccion} onChange={e => setForm({ ...form, responsable_desinfeccion: e.target.value })} />
                </div>
              </div>

              <h4 style={{ margin: '12px 0 4px' }}>Estibadores</h4>
              {estibadores.length > 0 && (
                <table className="table small" style={{ marginBottom: 8 }}>
                  <thead><tr><th>Nombre</th><th>DNI</th><th></th></tr></thead>
                  <tbody>
                    {estibadores.map(e => (
                      <tr key={e.id}>
                        <td>{e.full_name}</td>
                        <td>{e.dni ?? '—'}</td>
                        <td><button className="btn small danger" style={{ padding: '2px 8px' }} onClick={() => removeEstibador(e.id)}>Quitar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="grid" style={{ gap: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Nombre y apellidos</label>
                  <input type="text" value={estibadorForm.full_name} onChange={e => setEstibadorForm({ ...estibadorForm, full_name: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>DNI</label>
                  <input type="text" value={estibadorForm.dni} onChange={e => setEstibadorForm({ ...estibadorForm, dni: e.target.value })} />
                </div>
              </div>
              <button className="btn small outline" style={{ marginBottom: 12 }} onClick={addEstibador}>+ Agregar estibador</button>

              <div className="field">
                <label>Observaciones generales</label>
                <textarea rows={2} value={form.observaciones_generales} onChange={e => setForm({ ...form, observaciones_generales: e.target.value })} />
              </div>
            </>
          )}
          {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}
        </div>
        <div className="modal-actions">
          <button className="btn small" onClick={view === 'form' ? () => setView('history') : onClose} disabled={saving}>
            {view === 'form' ? 'Cancelar' : 'Cerrar'}
          </button>
          {view === 'form' && (
            <button className="btn small primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar registro'}
            </button>
          )}
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}
