import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { loteLabel } from '../lib/loteHelpers'
import { getLoteLabel, getLoteLabelLower } from '../lib/labels'
import { useConfirm } from '../hooks/useConfirm'
import { SkeletonList } from '../components/Skeleton'

// Formulario de "Registrar carga" -- Packing List (COA-GCA-RG-001). Distinto
// de "Registrar despacho" (Orden de Salida, COA-OIM-RG-007): son 2
// documentos físicos separados, con firmantes distintos (este lo firma
// Calidad/Supervisor al momento de cargar el camión; el despacho lo firma
// Comercialización al salir). Activa el estado 'cargado' de plant_containers
// al terminar -- estado que ya estaba en el esquema pero nunca se usaba.
//
// Mismo patrón que ForeignObjectControlModal/WeightSealControlModal: 1
// registro por contenedor que se va completando -- aquí con DOS listas que
// se arman de a una (pallets, personas presentes), más un formulario de
// datos generales + 2 checklists fijos (no repetidos en el tiempo, van como
// columnas simples en el mismo registro, no como catálogo aparte).

const ROLE_OPTIONS = ['Conductor contenedor', 'Operario', 'Supervisor']
const LADO_LABELS = { izquierda: 'Izquierda', derecha: 'Derecha' }

// Sugiere el lado con menos pallets hasta el momento, para ir
// balanceando la carga -- editable siempre, no fuerza nada (puede haber
// casos atípicos donde no convenga alternar).
function suggestLado(pallets) {
  const left = pallets.filter(p => p.lado === 'izquierda').length
  const right = pallets.filter(p => p.lado === 'derecha').length
  return left <= right ? 'izquierda' : 'derecha'
}

function emptyForm() {
  return {
    tara_kg: '', payload_kg: '', placa_camion: '', placa_carreta: '',
    precinto_inicial: '', precinto_linea: '', precinto_norandino: '', hora_inicio: '', hora_fin: '',
    documento_number: '',
    // Checklist vehículo/contenedor -- default según polaridad de cada ítem
    // (mismo criterio de "arranca marcado en el estado bueno" que el resto
    // de los checklists del sistema).
    limpio: true, abolladuras_internas: false, abolladuras_internas_cant: '',
    abolladuras_externas: false, abolladuras_externas_cant: '',
    contenedor_forrado: true, correcto_forrado: true, libre_olores: true, libre_plagas: true,
    observaciones_parte_interna: '', observaciones_parte_externa: '',
    // Checklist producto
    envases_limpios: true, peso_correcto: true, etiquetado_correcto: true, cierre_sellado_adecuado: true,
    accion_correctiva: '',
    final_observations: '',
  }
}

function valuesFromRecord(r) {
  const f = emptyForm()
  for (const key of Object.keys(f)) {
    if (r[key] != null) f[key] = r[key]
  }
  return f
}

function ToggleYesNo({ value, onChange, badWhenTrue }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button type="button" className={`btn small ${value === true ? 'primary' : 'outline'}`}
        style={value === true && badWhenTrue ? { background: '#fee2e2', borderColor: '#dc2626', color: '#dc2626' } : undefined}
        onClick={() => onChange(true)}>SI</button>
      <button type="button" className={`btn small ${value === false ? 'primary' : 'outline'}`}
        style={value === false && !badWhenTrue ? { background: '#fee2e2', borderColor: '#dc2626', color: '#dc2626' } : undefined}
        onClick={() => onChange(false)}>NO</button>
    </div>
  )
}

export default function ContainerLoadingModal({ container, orders, webUser, onClose, onSaved }) {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL = getLoteLabel(COOPERATIVE)
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [record, setRecord] = useState(null)
  const [pallets, setPallets] = useState([])
  const [people, setPeople] = useState([])
  const [error, setError] = useState('')

  const [responsiblePerson, setResponsiblePerson] = useState('')
  const [starting, setStarting] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)

  const [palletForm, setPalletForm] = useState({ pallet_number: '', boxes_count: '', plant_batch_id: '', humidity_pct: '', lado: 'izquierda' })
  const [savingPallet, setSavingPallet] = useState(false)
  const [personForm, setPersonForm] = useState({ full_name: '', dni: '', role_label: '' })
  const [savingPerson, setSavingPerson] = useState(false)

  const batches = orders.flatMap(o => o.plant_production_batches ?? [])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    const { data: existing } = await supabase
      .from('plant_container_loadings')
      .select('*')
      .eq('container_id', container.id)
      .maybeSingle()

    if (existing) {
      setRecord(existing)
      setForm(valuesFromRecord(existing))
      const [{ data: palletsData }, { data: peopleData }] = await Promise.all([
        supabase
          .from('plant_container_loading_pallets')
          .select('*, plant_production_batches ( client_batch_number, batch_code, brand )')
          .eq('loading_id', existing.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('plant_container_loading_people')
          .select('*')
          .eq('loading_id', existing.id)
          .order('created_at', { ascending: true }),
      ])
      setPallets(palletsData ?? [])
      setPeople(peopleData ?? [])
      setPalletForm(f => ({ ...f, lado: suggestLado(palletsData ?? []) }))
    }
    setLoading(false)
  }

  async function handleStart() {
    if (!responsiblePerson.trim()) { setError('Ingrese el responsable.'); return }
    setError(''); setStarting(true)
    try {
      const { data: newRecord, error: insErr } = await supabase
        .from('plant_container_loadings')
        .insert({
          cooperative_id: COOPERATIVE.id,
          container_id: container.id,
          responsible_person: responsiblePerson.trim(),
          created_by: webUser.id,
        })
        .select('*')
        .single()
      if (insErr) throw new Error(insErr.message)
      setRecord(newRecord)
      setForm(emptyForm())
    } catch (e) { setError(e.message ?? 'Error al iniciar la carga') }
    finally { setStarting(false) }
  }

  function updateForm(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSaveForm() {
    setError(''); setSaving(true)
    try {
      const payload = { ...form }
      for (const k of ['tara_kg', 'payload_kg', 'abolladuras_internas_cant', 'abolladuras_externas_cant']) {
        payload[k] = payload[k] === '' ? null : Number(payload[k])
      }
      for (const k of ['placa_camion', 'placa_carreta', 'precinto_inicial', 'precinto_linea', 'precinto_norandino', 'documento_number',
        'observaciones_parte_interna', 'observaciones_parte_externa', 'accion_correctiva', 'final_observations']) {
        if (payload[k] === '') payload[k] = null
      }
      if (payload.hora_inicio === '') payload.hora_inicio = null
      if (payload.hora_fin === '') payload.hora_fin = null

      const { data: updated, error: updErr } = await supabase
        .from('plant_container_loadings')
        .update(payload)
        .eq('id', record.id)
        .select('*')
        .single()
      if (updErr) throw new Error(updErr.message)
      setRecord(updated)
    } catch (e) { setError(e.message ?? 'Error al guardar') }
    finally { setSaving(false) }
  }

  async function handleAddPallet() {
    if (!palletForm.pallet_number.trim()) { setError('Indique el N° de pallet.'); return }
    setError(''); setSavingPallet(true)
    try {
      const { data: newPallet, error: insErr } = await supabase
        .from('plant_container_loading_pallets')
        .insert({
          loading_id: record.id,
          pallet_number: palletForm.pallet_number.trim(),
          boxes_count: palletForm.boxes_count !== '' ? parseInt(palletForm.boxes_count, 10) : null,
          plant_batch_id: palletForm.plant_batch_id || null,
          humidity_pct: palletForm.humidity_pct !== '' ? parseFloat(palletForm.humidity_pct) : null,
          lado: palletForm.lado,
          created_by: webUser.id,
        })
        .select('*, plant_production_batches ( client_batch_number, batch_code, brand )')
        .single()
      if (insErr) throw new Error(insErr.code === '23505' ? 'Ya existe un pallet con ese número en este contenedor.' : insErr.message)
      const nextPallets = [...pallets, newPallet]
      setPallets(nextPallets)
      setPalletForm({ pallet_number: '', boxes_count: '', plant_batch_id: '', humidity_pct: '', lado: suggestLado(nextPallets) })
    } catch (e) { setError(e.message ?? 'Error al agregar el pallet') }
    finally { setSavingPallet(false) }
  }

  async function handleRemovePallet(id) {
    await supabase.from('plant_container_loading_pallets').delete().eq('id', id)
    setPallets(prev => prev.filter(p => p.id !== id))
  }

  async function handleAddPerson() {
    if (!personForm.full_name.trim()) { setError('Indique el nombre.'); return }
    setError(''); setSavingPerson(true)
    try {
      const { data: newPerson, error: insErr } = await supabase
        .from('plant_container_loading_people')
        .insert({
          loading_id: record.id,
          full_name: personForm.full_name.trim(),
          dni: personForm.dni.trim() || null,
          role_label: personForm.role_label.trim() || null,
        })
        .select('*')
        .single()
      if (insErr) throw new Error(insErr.message)
      setPeople(prev => [...prev, newPerson])
      setPersonForm({ full_name: '', dni: '', role_label: '' })
    } catch (e) { setError(e.message ?? 'Error al agregar la persona') }
    finally { setSavingPerson(false) }
  }

  async function handleRemovePerson(id) {
    await supabase.from('plant_container_loading_people').delete().eq('id', id)
    setPeople(prev => prev.filter(p => p.id !== id))
  }

  async function handleClose() {
    const ok = await confirm({
      title: 'Terminar carga',
      message: `¿Dar por terminada la carga de este contenedor? Se registraron${COOPERATIVE?.features?.pallets ? ` ${pallets.length} pallet(s) y` : ''} ${people.length} persona(s). El contenedor va a pasar a estado "Cargado".`,
      confirmText: 'Terminar carga',
    })
    if (!ok) return

    setError(''); setClosing(true)
    try {
      await handleSaveForm()
      const { error: updErr } = await supabase
        .from('plant_container_loadings')
        .update({ status: 'terminado', closed_by: webUser.id, closed_at: new Date().toISOString() })
        .eq('id', record.id)
      if (updErr) throw new Error(updErr.message)
      await supabase.from('plant_containers').update({ status: 'cargado' }).eq('id', container.id)
      onSaved?.()
      onClose()
    } catch (e) { setError(e.message ?? 'Error al cerrar la carga') }
    finally { setClosing(false) }
  }

  const isOpen = record?.status === 'en_progreso'

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 820 }}>
        <div className="modal-body">
          <h3 style={{ margin: '0 0 4px' }}>Registrar carga — Packing List</h3>
          <p className="muted small" style={{ margin: '0 0 16px' }}>
            Contenedor {container.container_number ?? 'sin número'}
          </p>

          {loading ? (
            <SkeletonList count={2} lines={1} />
          ) : !record ? (
            <>
              <div className="field">
                <label>Responsable</label>
                <input type="text" value={responsiblePerson} onChange={e => setResponsiblePerson(e.target.value)} placeholder="Nombre de quien completa el registro" />
              </div>
              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <span className={`tag dot ${isOpen ? 'info' : 'ok'}`}>{isOpen ? 'En progreso' : 'Terminado'}</span>
                <span className="muted small">Responsable: {record.responsible_person}</span>
              </div>

              <div className="card" style={{ marginBottom: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>Datos de la carga</h4>
                <div className="grid" style={{ gap: 8 }}>
                  <div className="field" style={{ margin: 0 }}><label>N° de documento</label><input type="text" disabled={!isOpen} value={form.documento_number} onChange={e => updateForm('documento_number', e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>Tara (kg)</label><input type="number" disabled={!isOpen} value={form.tara_kg} onChange={e => updateForm('tara_kg', e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>Payload (kg)</label><input type="number" disabled={!isOpen} value={form.payload_kg} onChange={e => updateForm('payload_kg', e.target.value)} /></div>
                </div>
                <div className="grid" style={{ gap: 8 }}>
                  <div className="field" style={{ margin: 0 }}><label>Placa de camión</label><input type="text" disabled={!isOpen} value={form.placa_camion} onChange={e => updateForm('placa_camion', e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>Placa de carreta</label><input type="text" disabled={!isOpen} value={form.placa_carreta} onChange={e => updateForm('placa_carreta', e.target.value)} /></div>
                </div>
                <div className="grid" style={{ gap: 8 }}>
                  <div className="field" style={{ margin: 0 }}><label>Precinto inicial</label><input type="text" disabled={!isOpen} value={form.precinto_inicial} onChange={e => updateForm('precinto_inicial', e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>Precinto de línea</label><input type="text" disabled={!isOpen} value={form.precinto_linea} onChange={e => updateForm('precinto_linea', e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>{COOPERATIVE?.features?.precintoPropioLabel ?? 'Precinto propio'}</label><input type="text" disabled={!isOpen} value={form.precinto_norandino} onChange={e => updateForm('precinto_norandino', e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>Hora inicio</label><input type="time" disabled={!isOpen} value={form.hora_inicio} onChange={e => updateForm('hora_inicio', e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>Hora fin</label><input type="time" disabled={!isOpen} value={form.hora_fin} onChange={e => updateForm('hora_fin', e.target.value)} /></div>
                </div>
              </div>

              <div className="card" style={{ marginBottom: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>Control y verificación del vehículo/contenedor</h4>
                <table className="table small">
                  <tbody>
                    <tr><td>Limpio</td><td><ToggleYesNo value={form.limpio} onChange={v => isOpen && updateForm('limpio', v)} /></td>
                        <td>Contenedor forrado</td><td><ToggleYesNo value={form.contenedor_forrado} onChange={v => isOpen && updateForm('contenedor_forrado', v)} /></td></tr>
                    <tr><td>Abolladuras internas</td><td style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <ToggleYesNo value={form.abolladuras_internas} badWhenTrue onChange={v => isOpen && updateForm('abolladuras_internas', v)} />
                          {form.abolladuras_internas && <input type="number" min="0" placeholder="N°" disabled={!isOpen} value={form.abolladuras_internas_cant} onChange={e => updateForm('abolladuras_internas_cant', e.target.value)} style={{ width: 60 }} />}
                        </td>
                        <td>Correcto forrado</td><td><ToggleYesNo value={form.correcto_forrado} onChange={v => isOpen && updateForm('correcto_forrado', v)} /></td></tr>
                    <tr><td>Abolladuras externas</td><td style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <ToggleYesNo value={form.abolladuras_externas} badWhenTrue onChange={v => isOpen && updateForm('abolladuras_externas', v)} />
                          {form.abolladuras_externas && <input type="number" min="0" placeholder="N°" disabled={!isOpen} value={form.abolladuras_externas_cant} onChange={e => updateForm('abolladuras_externas_cant', e.target.value)} style={{ width: 60 }} />}
                        </td>
                        <td>Libre de olores extraños</td><td><ToggleYesNo value={form.libre_olores} onChange={v => isOpen && updateForm('libre_olores', v)} /></td></tr>
                    <tr><td colSpan={2}></td><td>Libre de evidencia de plagas</td><td><ToggleYesNo value={form.libre_plagas} onChange={v => isOpen && updateForm('libre_plagas', v)} /></td></tr>
                  </tbody>
                </table>
                <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                  <div className="field" style={{ margin: 0 }}><label>Observaciones parte interna</label><input type="text" disabled={!isOpen} value={form.observaciones_parte_interna} onChange={e => updateForm('observaciones_parte_interna', e.target.value)} /></div>
                  <div className="field" style={{ margin: 0 }}><label>Observaciones parte externa</label><input type="text" disabled={!isOpen} value={form.observaciones_parte_externa} onChange={e => updateForm('observaciones_parte_externa', e.target.value)} /></div>
                </div>
              </div>

              <div className="card" style={{ marginBottom: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>Control y verificación del producto</h4>
                <table className="table small">
                  <tbody>
                    <tr><td>Envases limpios</td><td><ToggleYesNo value={form.envases_limpios} onChange={v => isOpen && updateForm('envases_limpios', v)} /></td>
                        <td>Correcto etiquetado y/o rotulado</td><td><ToggleYesNo value={form.etiquetado_correcto} onChange={v => isOpen && updateForm('etiquetado_correcto', v)} /></td></tr>
                    <tr><td>Peso correcto</td><td><ToggleYesNo value={form.peso_correcto} onChange={v => isOpen && updateForm('peso_correcto', v)} /></td>
                        <td>Cierre / sellado adecuado</td><td><ToggleYesNo value={form.cierre_sellado_adecuado} onChange={v => isOpen && updateForm('cierre_sellado_adecuado', v)} /></td></tr>
                  </tbody>
                </table>
                <div className="field" style={{ marginTop: 8 }}>
                  <label>Acción correctiva</label>
                  <input type="text" disabled={!isOpen} value={form.accion_correctiva} onChange={e => updateForm('accion_correctiva', e.target.value)} placeholder="Opcional" />
                </div>
              </div>

              {COOPERATIVE?.features?.pallets && (
              <div className="card" style={{ marginBottom: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>Pallets ({pallets.length})</h4>
                {pallets.length > 0 && (
                  <table className="table small" style={{ marginBottom: 10 }}>
                    <thead><tr><th>N° pallet</th><th>Lado</th><th>N° cajas</th><th>{LOTE_LABEL}</th><th>% Humedad</th>{isOpen && <th></th>}</tr></thead>
                    <tbody>
                      {pallets.map(p => (
                        <tr key={p.id}>
                          <td>{p.pallet_number}</td>
                          <td>{p.lado ? LADO_LABELS[p.lado] : '—'}</td>
                          <td>{p.boxes_count ?? '—'}</td>
                          <td>{p.plant_production_batches ? loteLabel(p.plant_production_batches) : '—'}</td>
                          <td>{p.humidity_pct ?? '—'}</td>
                          {isOpen && <td><button className="btn small outline" onClick={() => handleRemovePallet(p.id)}>Quitar</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {isOpen && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div className="field" style={{ margin: 0, width: 90 }}><label>N° pallet</label><input type="text" value={palletForm.pallet_number} onChange={e => setPalletForm(f => ({ ...f, pallet_number: e.target.value }))} /></div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Lado</label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" className={`btn small ${palletForm.lado === 'izquierda' ? 'primary' : 'outline'}`} onClick={() => setPalletForm(f => ({ ...f, lado: 'izquierda' }))}>Izquierda</button>
                        <button type="button" className={`btn small ${palletForm.lado === 'derecha' ? 'primary' : 'outline'}`} onClick={() => setPalletForm(f => ({ ...f, lado: 'derecha' }))}>Derecha</button>
                      </div>
                    </div>
                    <div className="field" style={{ margin: 0, width: 90 }}><label>N° cajas</label><input type="number" min="0" value={palletForm.boxes_count} onChange={e => setPalletForm(f => ({ ...f, boxes_count: e.target.value }))} /></div>
                    <div className="field" style={{ margin: 0, minWidth: 160 }}>
                      <label>{LOTE_LABEL}</label>
                      <select value={palletForm.plant_batch_id} onChange={e => setPalletForm(f => ({ ...f, plant_batch_id: e.target.value }))}>
                        <option value="">Sin {LOTE_LABEL_LOWER}</option>
                        {batches.map(b => <option key={b.id} value={b.id}>{loteLabel(b)} — {b.brand}</option>)}
                      </select>
                    </div>
                    <div className="field" style={{ margin: 0, width: 100 }}><label>% Humedad</label><input type="number" step="0.1" min="0" value={palletForm.humidity_pct} onChange={e => setPalletForm(f => ({ ...f, humidity_pct: e.target.value }))} /></div>
                    <button className="btn small primary" onClick={handleAddPallet} disabled={savingPallet}>+ Agregar pallet</button>
                  </div>
                )}
              </div>
              )}

              <div className="card" style={{ marginBottom: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>Personas presentes en el embarque ({people.length})</h4>
                {people.length > 0 && (
                  <table className="table small" style={{ marginBottom: 10 }}>
                    <thead><tr><th>Nombre</th><th>DNI</th><th>Función</th>{isOpen && <th></th>}</tr></thead>
                    <tbody>
                      {people.map(p => (
                        <tr key={p.id}>
                          <td>{p.full_name}</td><td>{p.dni ?? '—'}</td><td>{p.role_label ?? '—'}</td>
                          {isOpen && <td><button className="btn small outline" onClick={() => handleRemovePerson(p.id)}>Quitar</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {isOpen && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div className="field" style={{ margin: 0, minWidth: 180 }}><label>Nombre y apellido</label><input type="text" value={personForm.full_name} onChange={e => setPersonForm(f => ({ ...f, full_name: e.target.value }))} /></div>
                    <div className="field" style={{ margin: 0, width: 120 }}><label>DNI</label><input type="text" value={personForm.dni} onChange={e => setPersonForm(f => ({ ...f, dni: e.target.value }))} /></div>
                    <div className="field" style={{ margin: 0, minWidth: 160 }}>
                      <label>Función</label>
                      <input type="text" list="roles-list" value={personForm.role_label} onChange={e => setPersonForm(f => ({ ...f, role_label: e.target.value }))} />
                      <datalist id="roles-list">{ROLE_OPTIONS.map(r => <option key={r} value={r} />)}</datalist>
                    </div>
                    <button className="btn small primary" onClick={handleAddPerson} disabled={savingPerson}>+ Agregar persona</button>
                  </div>
                )}
              </div>

              <div className="field">
                <label>Observación final {!isOpen && '(cerrado)'}</label>
                <textarea rows={2} disabled={!isOpen} value={form.final_observations} onChange={e => updateForm('final_observations', e.target.value)} placeholder="Opcional" />
              </div>

              {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn small" onClick={onClose}>Cerrar</button>
          {!loading && !record && (
            <button className="btn small primary" onClick={handleStart} disabled={starting}>
              {starting ? 'Iniciando...' : 'Iniciar carga'}
            </button>
          )}
          {!loading && isOpen && (
            <>
              <button className="btn small outline" onClick={handleSaveForm} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar datos'}
              </button>
              <button className="btn small danger" onClick={handleClose} disabled={closing}>
                {closing ? 'Guardando...' : 'Terminar carga'}
              </button>
            </>
          )}
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}
