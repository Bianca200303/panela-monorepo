import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'
import { loadKgPerSacoTamizado } from '../lib/formConfig'
import { loteLabel, packagingLabel } from '../lib/loteHelpers'
import { getLoteLabel, getLoteLabelLower, getLoteLabelPluralLower, getBunqueLabel, getBunqueLabelLower, getBunqueLabelPlural, getBunqueLabelPluralLower } from '../lib/labels'
import Icon from '../components/Icon'
import { useConfirm } from '../hooks/useConfirm'
import { SkeletonList } from '../components/Skeleton'

// Gestión de bunques -- Fase 2 de [[project_bunques_tamizado]]. El bunque
// deja de ser hijo de un lote de envasado (HomogenizadoBunquesModal.jsx,
// retirado) y pasa a ser un recurso independiente de planta: se crea, se
// cargan sus insumos (lotes de campo) y su resultado de tamizado
// (tamizada/reproceso/descarte, la merma se calcula sola) -- igual que
// antes -- y RECIÉN AHÍ se reparte ("Repartir a lotes") a uno o varios
// lotes de envasado por kg, sin restricción de que compartan la misma
// orden (confirmado con el usuario: en la operación real puede pasar
// cualquiera de las dos). El reparto se guarda junto con insumos y
// resultado en el mismo "Guardar bunque", como ya funcionaba con
// insumos+resultado.

const APPEARANCE_TAG = {
  seca:   { label: 'Seca',   cls: 'ok' },
  suelta: { label: 'Suelta', cls: 'info' },
  cerosa: { label: 'Cerosa', cls: 'warn' },
}

// Disponible de un lote de origen, opcionalmente sumando de vuelta lo que
// el propio bunque en edición ya tiene asignado (para no contarlo dos
// veces mientras se decide cuánto usar antes de guardar). Ya no hace falta
// recorrer órdenes/lotes para encontrarlo -- kg_available de la vista es
// plant-wide, y lo único que hay que revertir es el uso del bunque que se
// está editando, que ya está cargado en memoria.
function getAvailableKg(stockItem, editingBunque) {
  let available = Number(stockItem.kg_available ?? 0)
  if (editingBunque) {
    const own = (editingBunque.plant_homogenization_inputs ?? []).find(h => h.source_exit_item_id === stockItem.exit_item_id)
    if (own) available += Number(own.quantity_kg)
  }
  return Math.max(0, available)
}

function allocLoteLabel(alloc) {
  const b = alloc.plant_batch
  if (!b) return '—'
  const ord = b.plant_orders
  const ordLabel = ord?.client_order_number || ord?.order_code
  return `${b.client_batch_number || b.batch_code}${ordLabel ? ` (orden ${ordLabel})` : ''}`
}

// El número de bunque es continuo a nivel de toda la planta pero SÍ
// reinicia por campaña productiva (campaigns.is_active, ver
// CatalogosPage.jsx) -- es un dato que el usuario ingresa a mano y el
// sistema no debe forzar ni bloquear. Esto solo calcula una sugerencia
// ("+1" sobre el mayor número numérico ya usado en la campaña vigente).
const draftKey = (bunqueId) => `bunque_draft_${bunqueId}`
function loadBunqueDraft(bunqueId) {
  try {
    const raw = localStorage.getItem(draftKey(bunqueId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveBunqueDraft(bunqueId, draft) {
  try { localStorage.setItem(draftKey(bunqueId), JSON.stringify(draft)) } catch { /* localStorage no disponible, no es crítico */ }
}
function clearBunqueDraft(bunqueId) {
  try { localStorage.removeItem(draftKey(bunqueId)) } catch { /* no-op */ }
}

// hasCampaign distingue "campaña activa sin ningún número cargado todavía"
// (sugiere '01', el primero) de "sin campaña activa" (no sugiere nada --
// banner propio, se carga a mano, ver activeCampaign === null más abajo).
function suggestNextBunqueNumber(numbers, hasCampaign) {
  let maxNum = 0
  let width = 3
  for (const n of numbers) {
    const match = /^(\d+)$/.exec((n ?? '').trim())
    if (match && parseInt(match[1], 10) > maxNum) {
      maxNum = parseInt(match[1], 10)
      width = match[1].length
    }
  }
  if (maxNum > 0) return String(maxNum + 1).padStart(width, '0')
  return hasCampaign ? '01' : ''
}

export default function BunquesPage() {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL = getLoteLabel(COOPERATIVE)
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
  const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE)
  const BUNQUE_LABEL = getBunqueLabel(COOPERATIVE)
  const BUNQUE_LABEL_LOWER = getBunqueLabelLower(COOPERATIVE)
  const BUNQUE_LABEL_PLURAL = getBunqueLabelPlural(COOPERATIVE)
  const BUNQUE_LABEL_PLURAL_LOWER = getBunqueLabelPluralLower(COOPERATIVE)
  const webUser = useAuthStore(s => s.webUser)
  const [bunques, setBunques] = useState([])
  const [searchParams] = useSearchParams()
  const contextLoteId = searchParams.get('lote')
  const [contextLote, setContextLote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bunqueFilter, setBunqueFilter] = useState('')
  // Al llegar desde el botón "Repartir a este lote" de una orden, arranca
  // mostrando solo los bunques con algo pendiente de repartir -- si se entra
  // directo a /bunques (gestión general) se ve todo, para no esconder
  // bunques recién creados o todavía sin resultado.
  const [soloConDisponible, setSoloConDisponible] = useState(!!contextLoteId)
  const [stockItems, setStockItems] = useState([])
  const [newBunqueNumber, setNewBunqueNumber] = useState('')
  const [allBunqueNumbers, setAllBunqueNumbers] = useState([])
  const [activeCampaign, setActiveCampaign] = useState(undefined) // undefined = cargando; null = no hay campaña activa
  const [expandedBunqueId, setExpandedBunqueId] = useState(null)
  const [editingInputs, setEditingInputs] = useState([])
  const [grSearch, setGrSearch] = useState('')
  const [loteSearch, setLoteSearch] = useState('')
  const [loteResults, setLoteResults] = useState([])
  const [repartoRows, setRepartoRows] = useState([])
  const emptyResultForm = { tamizada_kg: '', reproceso_kg: '0', descarte_kg: '', tamizada_sacos: '', reproceso_sacos: '', descarte_sacos: '' }
  const [resultForm, setResultForm] = useState(emptyResultForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingNumberId, setEditingNumberId] = useState(null)
  const [editingNumberValue, setEditingNumberValue] = useState('')
  const [kgPerSaco, setKgPerSaco] = useState(50)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const { confirm, dialog: confirmDialog } = useConfirm()

  // Punto de comparación para saber si hay cambios sin guardar: lo que
  // realmente está guardado en la base (nunca el borrador restaurado).
  const savedSnapshotRef = useRef(null)
  const isDirty = expandedBunqueId != null &&
    savedSnapshotRef.current != null &&
    JSON.stringify({ editingInputs, resultForm, repartoRows }) !== savedSnapshotRef.current

  const applySacos = (kgField, sacosField, sacosValue) => {
    const sacos = parseFloat(sacosValue)
    setResultForm(f => ({
      ...f,
      [sacosField]: sacosValue,
      [kgField]: !isNaN(sacos) && sacos >= 0 ? String(Math.round(sacos * kgPerSaco * 100) / 100) : f[kgField],
    }))
  }

  const applyKg = (kgField, sacosField, kgValue) => {
    const kg = parseFloat(kgValue)
    setResultForm(f => ({
      ...f,
      [kgField]: kgValue,
      [sacosField]: !isNaN(kg) && kg >= 0 ? String(Math.round((kg / kgPerSaco) * 100) / 100) : f[sacosField],
    }))
  }

  const loadBunques = async (campaign) => {
    if (!campaign) { setBunques([]); return [] }
    const { data } = await supabase
      .from('plant_batch_bunques')
      .select(`
        id, bunque_number, tamizada_kg, reproceso_kg, descarte_kg, merma_kg,
        tamizada_sacos, reproceso_sacos, descarte_sacos, processed_at,
        plant_homogenization_inputs ( id, source_exit_item_id, quantity_kg ),
        plant_bunque_batch_allocations (
          id, kg,
          plant_batch:plant_production_batches ( id, batch_code, client_batch_number, brand, packaging_type,
            plant_orders ( order_code, client_order_number ) )
        )
      `)
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('campaign_id', campaign.id)
      .order('created_at', { ascending: false })
    setBunques(data ?? [])
    return data ?? []
  }

  const loadStock = async () => {
    const { data } = await supabase
      .from('v_plant_available_stock')
      .select('*')
      .eq('cooperative_id', COOPERATIVE.id)
      .order('received_at', { ascending: false })
    setStockItems(data ?? [])
  }

  const loadAllBunqueNumbers = async (campaign) => {
    if (!campaign) {
      setAllBunqueNumbers([])
      return []
    }
    const { data } = await supabase
      .from('plant_batch_bunques')
      .select('bunque_number')
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('campaign_id', campaign.id)
    const numbers = (data ?? []).map(b => b.bunque_number)
    setAllBunqueNumbers(numbers)
    return numbers
  }

  const loadActiveCampaign = async () => {
    const { data } = await supabase
      .from('campaigns')
      .select('id, year')
      .eq('cooperative_id', COOPERATIVE.id)
      .eq('is_active', true)
      .maybeSingle()
    setActiveCampaign(data ?? null)
    return data ?? null
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([
      loadActiveCampaign().then(campaign =>
        Promise.all([
          loadBunques(campaign),
          loadAllBunqueNumbers(campaign).then(numbers => setNewBunqueNumber(suggestNextBunqueNumber(numbers, !!campaign))),
        ])
      ),
      loadStock(),
      loadKgPerSacoTamizado(COOPERATIVE).then(setKgPerSaco),
    ]).finally(() => setLoading(false))
  }, [])

  // Lote de contexto -- llegó desde el botón "Repartir a este lote" de la
  // tarjeta de una orden (Órdenes). Se muestra como aviso fijo arriba de
  // todo, para no perder de vista a qué lote se está repartiendo mientras
  // se navega la lista de bunques.
  useEffect(() => {
    if (!contextLoteId) { setContextLote(null); return }
    supabase
      .from('plant_production_batches')
      .select('id, batch_code, client_batch_number, brand, packaging_type, plant_orders ( order_code, client_order_number )')
      .eq('id', contextLoteId)
      .maybeSingle()
      .then(({ data }) => setContextLote(data ?? null))
  }, [contextLoteId])

  // Búsqueda de lotes de envasado para repartir (por N° de lote), con
  // debounce -- puede haber cientos en toda la planta, no se cargan todos
  // de una. Sin nada escrito no se deja la lista vacía (esa fue la queja:
  // "si no atinamos [con el texto] no hay forma fácil de buscar") -- se
  // muestran de entrada los lotes de órdenes en_proceso (el caso más común,
  // igual criterio que usa Órdenes) para poder elegir sin tipear nada;
  // escribir 2+ caracteres cambia a búsqueda por N° en CUALQUIER orden
  // (incluidas completadas, para poder corregir un reparto viejo).
  useEffect(() => {
    const q = loteSearch.trim()
    let active = true
    const t = setTimeout(async () => {
      let query = supabase
        .from('plant_production_batches')
        .select('id, batch_code, client_batch_number, brand, packaging_type, plant_orders!inner ( order_code, client_order_number, status )')
        .eq('cooperative_id', COOPERATIVE.id)
      query = q.length >= 2
        ? query.or(`batch_code.ilike.%${q}%,client_batch_number.ilike.%${q}%`)
        : query.eq('plant_orders.status', 'en_proceso')
      const { data } = await query.order('created_at', { ascending: false }).limit(15)
      if (active) setLoteResults(data ?? [])
    }, q.length >= 2 ? 300 : 0)
    return () => { active = false; clearTimeout(t) }
  }, [loteSearch])

  // Guarda el borrador en cada cambio mientras hay un bunque abierto.
  useEffect(() => {
    if (expandedBunqueId == null) return
    saveBunqueDraft(expandedBunqueId, { editingInputs, resultForm, repartoRows })
  }, [expandedBunqueId, editingInputs, resultForm, repartoRows])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const isDuplicateNumber = newBunqueNumber.trim() !== '' && allBunqueNumbers.includes(newBunqueNumber.trim())

  const openBunqueEditor = (bunque) => {
    setError('')
    setGrSearch('')
    setLoteSearch('')
    setLoteResults([])
    const existing = bunque.plant_homogenization_inputs ?? []
    const existingRepartos = (bunque.plant_bunque_batch_allocations ?? [])
      .filter(a => a.plant_batch)
      .map(a => ({ plant_batch_id: a.plant_batch.id, kg: String(a.kg), label: allocLoteLabel(a) }))
    const savedState = {
      editingInputs: existing.map(h => ({ source_exit_item_id: h.source_exit_item_id, quantity_kg: String(h.quantity_kg) })),
      resultForm: {
        tamizada_kg: bunque.tamizada_kg != null ? String(bunque.tamizada_kg) : '',
        reproceso_kg: bunque.reproceso_kg != null ? String(bunque.reproceso_kg) : '0',
        descarte_kg: bunque.descarte_kg != null ? String(bunque.descarte_kg) : '',
        tamizada_sacos: bunque.tamizada_sacos != null ? String(bunque.tamizada_sacos) : '',
        reproceso_sacos: bunque.reproceso_sacos != null ? String(bunque.reproceso_sacos) : '',
        descarte_sacos: bunque.descarte_sacos != null ? String(bunque.descarte_sacos) : '',
      },
      repartoRows: existingRepartos,
    }
    savedSnapshotRef.current = JSON.stringify(savedState)

    const draft = loadBunqueDraft(bunque.id)
    const initial = draft ?? savedState
    setEditingInputs(initial.editingInputs)
    setResultForm(initial.resultForm)
    setRepartoRows(initial.repartoRows ?? [])
    setRestoredDraft(draft != null && JSON.stringify(draft) !== savedSnapshotRef.current)
    setExpandedBunqueId(bunque.id)
  }

  const attemptCollapseBunque = async (bunque) => {
    if (isDirty) {
      const ok = await confirm({
        title: 'Cambios sin guardar',
        message: `Este ${BUNQUE_LABEL_LOWER} tiene cambios sin guardar. ¿Desea guardarlos antes de salir?`,
        confirmText: 'Guardar',
      })
      if (!ok) return
      await handleSaveBunque(bunque)
      return
    }
    setExpandedBunqueId(null)
  }

  const handleCreateBunque = async () => {
    setError('')
    if (!newBunqueNumber.trim()) {
      setError(`Ingrese el número de ${BUNQUE_LABEL_LOWER}`)
      return
    }
    setSaving(true)
    try {
      const { data: newBunque, error: insErr } = await supabase
        .from('plant_batch_bunques')
        .insert({
          bunque_number: newBunqueNumber.trim(),
          cooperative_id: COOPERATIVE.id,
          campaign_id: activeCampaign?.id ?? null,
        })
        .select('id')
        .single()
      if (insErr) throw new Error(insErr.message)

      const numbers = await loadAllBunqueNumbers(activeCampaign)
      setNewBunqueNumber(suggestNextBunqueNumber(numbers, !!activeCampaign))
      await loadBunques(activeCampaign)
      setEditingInputs([])
      setGrSearch('')
      setResultForm(emptyResultForm)
      setRepartoRows([])
      setExpandedBunqueId(newBunque.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const startEditNumber = (bunque) => {
    setError('')
    setEditingNumberId(bunque.id)
    setEditingNumberValue(bunque.bunque_number)
  }

  const cancelEditNumber = () => {
    setEditingNumberId(null)
    setEditingNumberValue('')
  }

  const saveEditNumber = async (bunqueId) => {
    if (!editingNumberValue.trim()) {
      setError(`Ingrese el número de ${BUNQUE_LABEL_LOWER}`)
      return
    }
    setSaving(true)
    try {
      const { error: updErr } = await supabase
        .from('plant_batch_bunques')
        .update({ bunque_number: editingNumberValue.trim() })
        .eq('id', bunqueId)
      if (updErr) throw new Error(updErr.message)
      cancelEditNumber()
      await loadBunques(activeCampaign)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Solo se puede borrar un bunque que todavía no tiene resultado de
  // tamizado registrado (y por lo tanto no tiene reparto -- el reparto
  // solo existe una vez que hay resultado). Borrarlo con resultado ya
  // cargado escondería un error real en vez de corregirlo: para eso está
  // "Editar bunque".
  const handleDeleteBunque = async (bunque) => {
    setError('')
    const ok = await confirm({
      title: `Eliminar ${BUNQUE_LABEL_LOWER}`,
      message: `¿Eliminar el ${BUNQUE_LABEL_LOWER} ${bunque.bunque_number}? Se van a borrar también los insumos que tenga asignados.`,
      confirmText: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    setSaving(true)
    try {
      const { error: delErr } = await supabase
        .from('plant_batch_bunques')
        .delete()
        .eq('id', bunque.id)
      if (delErr) throw new Error(delErr.message)
      clearBunqueDraft(bunque.id)
      if (expandedBunqueId === bunque.id) setExpandedBunqueId(null)
      await loadBunques(activeCampaign)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleSource = (exitItemId, avail) => {
    const exists = editingInputs.find(h => h.source_exit_item_id === exitItemId)
    if (exists) {
      setEditingInputs(editingInputs.filter(h => h.source_exit_item_id !== exitItemId))
    } else {
      setEditingInputs([...editingInputs, {
        source_exit_item_id: exitItemId,
        quantity_kg: avail > 0 ? avail.toFixed(2) : '',
      }])
    }
  }

  const updateQty = (exitItemId, qty) => {
    setEditingInputs(editingInputs.map(h => {
      if (h.source_exit_item_id !== exitItemId) return h
      const kgNum = parseFloat(qty)
      const approxSacos = !isNaN(kgNum) && kgNum >= 0 ? String(Math.round((kgNum / kgPerSaco) * 100) / 100) : h.sacos
      return { ...h, quantity_kg: qty, sacos: approxSacos }
    }))
  }

  const updateSacos = (exitItemId, sacosValue, avail) => {
    const sacos = parseFloat(sacosValue)
    setEditingInputs(editingInputs.map(h => {
      if (h.source_exit_item_id !== exitItemId) return h
      let kg = h.quantity_kg
      if (!isNaN(sacos) && sacos >= 0) {
        kg = String(Math.min(Math.round(sacos * kgPerSaco * 100) / 100, avail))
      }
      return { ...h, sacos: sacosValue, quantity_kg: kg }
    }))
  }

  const addRepartoLote = (pb) => {
    if (repartoRows.some(r => r.plant_batch_id === pb.id)) return
    const ord = pb.plant_orders
    const label = `${loteLabel(pb)} — ${pb.brand ?? ''}${ord ? ` (orden ${ord.client_order_number || ord.order_code})` : ''}`
    setRepartoRows([...repartoRows, { plant_batch_id: pb.id, kg: '', label }])
    setLoteSearch('')
    setLoteResults([])
  }

  const updateRepartoKg = (plantBatchId, kg) => {
    setRepartoRows(rows => rows.map(r => r.plant_batch_id === plantBatchId ? { ...r, kg } : r))
  }

  const removeReparto = (plantBatchId) => {
    setRepartoRows(rows => rows.filter(r => r.plant_batch_id !== plantBatchId))
  }

  // Un solo guardado: insumos + resultado + reparto a lotes juntos.
  // Devuelve true/false según si el guardado se confirmó -- lo necesitan
  // los cierres "guardar al salir".
  const handleSaveBunque = async (bunque) => {
    setError('')
    const filtered = editingInputs.filter(h => parseFloat(h.quantity_kg) > 0)
    if (filtered.length === 0) {
      setError('Selecciona al menos un lote de origen con kg > 0')
      return false
    }
    for (const h of filtered) {
      const stockItem = stockItems.find(s => s.exit_item_id === h.source_exit_item_id)
      const avail = stockItem ? getAvailableKg(stockItem, bunque) : 0
      const qty = parseFloat(h.quantity_kg)
      if (qty > avail + 0.01) {
        const code = stockItem?.comprobante_acopio ?? stockItem?.guia_remision ?? h.source_exit_item_id
        setError(`El lote de origen ${code} no tiene suficiente cantidad disponible — disponible: ${avail.toFixed(2)} kg, solicitado: ${qty.toFixed(2)} kg`)
        return false
      }
    }
    const total = filtered.reduce((s, h) => s + parseFloat(h.quantity_kg), 0)

    const hasResultVals = resultForm.tamizada_kg !== '' || resultForm.descarte_kg !== ''
    let bunqueUpdate = null
    let tam = 0
    if (hasResultVals) {
      tam = parseFloat(resultForm.tamizada_kg)
      const rep = parseFloat(resultForm.reproceso_kg || 0)
      const des = parseFloat(resultForm.descarte_kg)
      if (isNaN(tam) || tam < 0) { setError('El valor de panela tamizada no puede ser negativo'); return false }
      if (isNaN(rep) || rep < 0) { setError('El valor de reproceso no puede ser negativo'); return false }
      if (isNaN(des) || des < 0) { setError('El valor de descarte no puede ser negativo'); return false }
      if (tam > total + 0.01) {
        setError(`La panela tamizada (${tam.toFixed(2)} kg) no puede superar el total de insumos de este ${BUNQUE_LABEL_LOWER} (${total.toFixed(2)} kg). No es físicamente posible producir más de lo que se mezcló.`)
        return false
      }
      const merma = total - tam - rep - des
      if (merma < -0.01) {
        setError(`La suma tamizada + reproceso + descarte (${(tam + rep + des).toFixed(2)} kg) supera el total de insumos de este ${BUNQUE_LABEL_LOWER} (${total.toFixed(2)} kg). Revise los valores ingresados.`)
        return false
      }
      bunqueUpdate = {
        tamizada_kg: tam,
        reproceso_kg: rep,
        descarte_kg: des,
        merma_kg: Math.max(0, merma),
        tamizada_sacos:  resultForm.tamizada_sacos  !== '' ? parseInt(resultForm.tamizada_sacos)  : null,
        reproceso_sacos: resultForm.reproceso_sacos !== '' ? parseInt(resultForm.reproceso_sacos) : null,
        descarte_sacos:  resultForm.descarte_sacos  !== '' ? parseInt(resultForm.descarte_sacos)  : null,
        processed_by: webUser.id,
        processed_at: new Date().toISOString(),
      }
    }

    const repartoFiltered = repartoRows.filter(r => parseFloat(r.kg) > 0 && r.plant_batch_id)
    const repartoTotal = repartoFiltered.reduce((s, r) => s + parseFloat(r.kg), 0)
    if (!hasResultVals && repartoFiltered.length > 0) {
      setError(`No se puede repartir a ${LOTE_LABEL_PLURAL_LOWER} sin antes registrar el resultado del tamizado (panela tamizada).`)
      return false
    }
    if (hasResultVals && repartoTotal > tam + 0.01) {
      setError(`El reparto a ${LOTE_LABEL_PLURAL_LOWER} (${repartoTotal.toFixed(2)} kg) no puede superar la panela tamizada de este ${BUNQUE_LABEL_LOWER} (${tam.toFixed(2)} kg).`)
      return false
    }

    setSaving(true)
    try {
      await supabase.from('plant_homogenization_inputs').delete().eq('bunque_id', bunque.id)
      const { error: insErr } = await supabase
        .from('plant_homogenization_inputs')
        .insert(filtered.map(h => ({
          bunque_id: bunque.id,
          source_exit_item_id: h.source_exit_item_id,
          quantity_kg: parseFloat(h.quantity_kg),
          cooperative_id: COOPERATIVE.id,
        })))
      if (insErr) throw new Error(insErr.message)

      if (bunqueUpdate) {
        const { error: updErr } = await supabase
          .from('plant_batch_bunques')
          .update(bunqueUpdate)
          .eq('id', bunque.id)
        if (updErr) throw new Error(updErr.message)
      }

      await supabase.from('plant_bunque_batch_allocations').delete().eq('bunque_id', bunque.id)
      if (repartoFiltered.length > 0) {
        const { error: repErr } = await supabase
          .from('plant_bunque_batch_allocations')
          .insert(repartoFiltered.map(r => ({
            bunque_id: bunque.id,
            plant_batch_id: r.plant_batch_id,
            kg: parseFloat(r.kg),
            cooperative_id: COOPERATIVE.id,
          })))
        if (repErr) throw new Error(repErr.message)
      }

      clearBunqueDraft(bunque.id)
      setExpandedBunqueId(null)
      await Promise.all([loadBunques(activeCampaign), loadStock()])
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const getVisibleStockItems = (editingBunque) => stockItems.filter(src => {
    if (grSearch.trim() && !(src.guia_remision ?? '').toLowerCase().includes(grSearch.trim().toLowerCase())) return false
    const selected = editingInputs.some(h => h.source_exit_item_id === src.exit_item_id)
    if (selected) return true
    return getAvailableKg(src, editingBunque) > 0
  })

  const bunqueSinRepartir = (b) => {
    const repartidoTotal = (b.plant_bunque_batch_allocations ?? []).reduce((s, a) => s + Number(a.kg), 0)
    return Math.max(0, Number(b.tamizada_kg ?? 0) - repartidoTotal)
  }

  const visibleBunques = bunques.filter(b => {
    if (bunqueFilter.trim() && !b.bunque_number.toLowerCase().includes(bunqueFilter.trim().toLowerCase())) return false
    if (soloConDisponible && bunqueSinRepartir(b) <= 0.01) return false
    return true
  })

  if (loading) {
    return (
      <div>
        <div className="page-header"><h2>Gestión de {BUNQUE_LABEL_PLURAL}</h2></div>
        <SkeletonList count={4} lines={2} />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h2>Gestión de {BUNQUE_LABEL_PLURAL}</h2>
      </div>
      <p className="muted small" style={{ margin: '0 0 16px' }}>
        El {BUNQUE_LABEL_LOWER} es un recurso de planta, independiente de cualquier {LOTE_LABEL_LOWER}: se cargan sus insumos (lotes de campo) y su resultado de tamizado, y su resultado se reparte a uno o varios {LOTE_LABEL_PLURAL_LOWER} por kg — de cualquier orden.
      </p>

      {contextLote && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: 'rgba(15,76,92,0.10)', border: '1px solid var(--primary)', borderRadius: 8,
          padding: '10px 14px', marginBottom: 16,
        }}>
          <Icon name="chevronRight" size={16} />
          <span style={{ fontSize: 13 }}>
            Repartiendo para: <strong>{loteLabel(contextLote)}</strong> — {contextLote.brand} · {packagingLabel(contextLote)}
            {contextLote.plant_orders ? ` · orden ${contextLote.plant_orders.client_order_number || contextLote.plant_orders.order_code}` : ''}
          </span>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={soloConDisponible} onChange={e => setSoloConDisponible(e.target.checked)} />
          Mostrar solo {BUNQUE_LABEL_PLURAL_LOWER} con kg sin repartir
        </label>
      </div>

      {activeCampaign === null && (
        <p className="muted small" style={{ margin: '0 0 12px' }}>
          No hay una campaña activa configurada (Catálogos → Campañas) — el número de {BUNQUE_LABEL_LOWER} no se puede sugerir automáticamente ni filtrar por campaña, pero se puede seguir cargando a mano.
        </p>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
            <label>N° de {BUNQUE_LABEL_LOWER}{activeCampaign ? <span className="muted small"> — campaña {activeCampaign.year}</span> : null}</label>
            <input
              type="text"
              placeholder="Ej: 055"
              value={newBunqueNumber}
              style={isDuplicateNumber ? { borderColor: 'var(--warning)', background: '#fffbeb' } : undefined}
              onChange={e => setNewBunqueNumber(e.target.value)}
            />
          </div>
          <button className="btn primary" onClick={handleCreateBunque} disabled={saving}>
            + Nuevo {BUNQUE_LABEL_LOWER}
          </button>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
            <label>Buscar {BUNQUE_LABEL_LOWER} N°</label>
            <input type="text" placeholder="Filtrar por número..." value={bunqueFilter} onChange={e => setBunqueFilter(e.target.value)} />
          </div>
        </div>
        {isDuplicateNumber && (
          <p style={{ color: 'var(--warning)', fontSize: 12, margin: '8px 0 0' }}>
            Ya existe un {BUNQUE_LABEL_LOWER} con el número "{newBunqueNumber.trim()}" en esta campaña — se puede crear igual si es intencional.
          </p>
        )}
        {expandedBunqueId == null && error && <p style={{ color: '#dc2626', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
      </div>

      {visibleBunques.length === 0 && (
        <p className="muted small">
          {bunqueFilter.trim() ? `Ningún ${BUNQUE_LABEL_LOWER} coincide con la búsqueda.` : `Todavía no se creó ningún ${BUNQUE_LABEL_LOWER} en esta campaña.`}
        </p>
      )}

      {/* Suele haber muchísimos bunques -- se scrollea esta lista sola en vez
          de estirar toda la página, para que "N° de bunque"/"Buscar bunque
          N°" arriba queden siempre a mano. */}
      <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 }}>
      {visibleBunques.map(bunque => {
        const savedInputKg = (bunque.plant_homogenization_inputs ?? []).reduce((s, h) => s + Number(h.quantity_kg), 0)
        const hasInputs = savedInputKg > 0
        const hasResult = bunque.tamizada_kg != null
        const isExpanded = expandedBunqueId === bunque.id
        const allocs = bunque.plant_bunque_batch_allocations ?? []
        const repartidoTotal = allocs.reduce((s, a) => s + Number(a.kg), 0)
        const sinRepartir = Math.max(0, Number(bunque.tamizada_kg ?? 0) - repartidoTotal)

        return (
          <div key={bunque.id} style={{ background: '#f9fafb', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              {editingNumberId === bunque.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{BUNQUE_LABEL}</span>
                  <input
                    type="text"
                    autoFocus
                    value={editingNumberValue}
                    onChange={e => setEditingNumberValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveEditNumber(bunque.id)
                      if (e.key === 'Escape') cancelEditNumber()
                    }}
                    style={{ width: 90, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)' }}
                  />
                  <button className="btn small primary" disabled={saving} onClick={() => saveEditNumber(bunque.id)}>Guardar</button>
                  <button className="btn small outline" disabled={saving} onClick={cancelEditNumber}>Cancelar</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{BUNQUE_LABEL} {bunque.bunque_number}</span>
                  <button className="btn small primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => startEditNumber(bunque)}>Editar número</button>
                </div>
              )}
              <span className={`tag ${hasResult ? 'ok' : hasInputs ? 'info' : 'warn'}`} style={{ fontSize: 11 }}>
                {hasResult ? 'Completo' : hasInputs ? 'Con insumos, falta resultado' : 'Sin insumos'}
              </span>
            </div>

            {hasInputs && (
              <div className="meta" style={{ fontSize: 12, marginTop: 4 }}>
                Insumos: {savedInputKg.toFixed(2)} kg · {(bunque.plant_homogenization_inputs ?? []).length} fuente(s)
              </div>
            )}
            {hasResult && (
              <div className="meta" style={{ fontSize: 12 }}>
                Tamizada {bunque.tamizada_kg} kg · Reproceso {bunque.reproceso_kg ?? 0} kg · Descarte {bunque.descarte_kg} kg · Merma {bunque.merma_kg} kg
                {savedInputKg > 0 && (
                  <span style={{ marginLeft: 6, color: (Number(bunque.merma_kg) / savedInputKg * 100) > 5 ? 'var(--warning)' : 'inherit' }}>
                    ({(Number(bunque.merma_kg) / savedInputKg * 100).toFixed(2)}% merma)
                  </span>
                )}
              </div>
            )}
            {hasResult && (
              <div className="meta" style={{ fontSize: 12 }}>
                {allocs.length > 0
                  ? <>Repartido a: {allocs.map(a => `${allocLoteLabel(a)} (${Number(a.kg).toFixed(2)} kg)`).join(', ')}</>
                  : <span style={{ color: 'var(--warning)' }}>Todavía sin repartir a ningún {LOTE_LABEL_LOWER}</span>}
                {sinRepartir > 0.01 && <span style={{ color: 'var(--warning)' }}> · {sinRepartir.toFixed(2)} kg sin repartir</span>}
              </div>
            )}

            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <button
                className="btn small primary"
                onClick={() => isExpanded ? attemptCollapseBunque(bunque) : openBunqueEditor(bunque)}
              >
                Editar {BUNQUE_LABEL_LOWER}
              </button>
              {!hasResult && (
                <button className="btn small danger primary" disabled={saving} onClick={() => handleDeleteBunque(bunque)}>
                  Eliminar {BUNQUE_LABEL_LOWER}
                </button>
              )}
            </div>

            {isExpanded && (() => {
              const visibleStockItems = getVisibleStockItems(bunque)
              const liveTotal = editingInputs.reduce((s, h) => s + (parseFloat(h.quantity_kg) || 0), 0)
              const tam = parseFloat(resultForm.tamizada_kg || 0)
              const rep = parseFloat(resultForm.reproceso_kg || 0)
              const des = parseFloat(resultForm.descarte_kg || 0)
              const hasVals = resultForm.tamizada_kg !== '' && resultForm.descarte_kg !== ''
              const merma = liveTotal - tam - rep - des
              const tamExcede = hasVals && tam > liveTotal + 0.01
              const sumaExcede = hasVals && merma < -0.01
              const balanceOk = !tamExcede && !sumaExcede
              const bloqueado = tamExcede || sumaExcede
              const pct = v => liveTotal > 0 ? (Math.max(0, v) / liveTotal) * 100 : 0
              const repartos = [
                { label: 'Tamizado', kg: tam, color: 'var(--success)' },
                { label: 'Reproceso', kg: rep, color: 'var(--primary)' },
                { label: 'Descarte', kg: des, color: 'var(--warning)' },
                { label: 'Merma', kg: Math.max(0, merma), color: bloqueado ? '#dc2626' : '#6b7280' },
              ]
              const repartoTotalLive = repartoRows.reduce((s, r) => s + (parseFloat(r.kg) || 0), 0)
              const repartoExcede = hasVals && repartoTotalLive > tam + 0.01
              const visibleLoteResults = loteResults.filter(pb => !repartoRows.some(r => r.plant_batch_id === pb.id))

              return (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  {restoredDraft && (
                    <div style={{ background: '#fffbeb', border: '1px solid var(--warning)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, fontSize: 12, color: '#b45309' }}>
                      Se restauró un borrador sin guardar de este {BUNQUE_LABEL_LOWER}. Revise los datos y guarde con "Guardar {BUNQUE_LABEL_LOWER}" para confirmarlos.
                    </div>
                  )}
                  {/* ── Insumos ── */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#000' }}>
                      Insumos de este {BUNQUE_LABEL_LOWER}
                    </div>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: '#fff', background: 'var(--primary)',
                      borderRadius: 6, padding: '4px 10px',
                    }}>
                      Total seleccionado: {liveTotal.toFixed(2)} kg
                      {editingInputs.length > 0 && <span style={{ fontWeight: 400 }}> ({editingInputs.length} lote{editingInputs.length === 1 ? '' : 's'})</span>}
                    </div>
                  </div>
                  <div className="field" style={{ margin: '0 0 10px' }}>
                    <label>Buscar por guía de remisión</label>
                    <input
                      type="text"
                      placeholder="Escriba el N° de guía de remisión..."
                      value={grSearch}
                      onChange={e => setGrSearch(e.target.value)}
                    />
                  </div>
                  {/* Suele haber muchísimos insumos disponibles -- se
                      scrollea esta tabla sola (alto + ancho) en vez de
                      abrumar la pantalla, el buscador de guía queda siempre
                      visible arriba. */}
                  <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '50vh' }}>
                    <table className="table small">
                      <thead>
                        <tr>
                          <th>Usar</th>
                          <th>Guía de remisión</th>
                          <th>Comprobante acopio</th>
                          <th>Módulo</th>
                          <th>Productor</th>
                          <th>Tipo</th>
                          <th>Recibido (kg)</th>
                          <th>Disponible (kg)</th>
                          <th>Kg a usar</th>
                          <th>o sacos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleStockItems.length === 0 && (
                          <tr><td colSpan={10} className="muted small" style={{ textAlign: 'center', padding: '10px 0' }}>
                            {grSearch.trim() ? 'Ninguna guía coincide con la búsqueda.' : 'No quedan lotes con disponible para usar.'}
                          </td></tr>
                        )}
                        {visibleStockItems.map(src => {
                          const exitItemId = src.exit_item_id
                          const avail = getAvailableKg(src, bunque)
                          const selected = editingInputs.find(h => h.source_exit_item_id === exitItemId)
                          return (
                            <tr key={exitItemId} style={{ opacity: avail <= 0 && !selected ? 0.4 : 1 }}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={!!selected}
                                  disabled={avail <= 0 && !selected}
                                  onChange={() => toggleSource(exitItemId, avail)}
                                />
                              </td>
                              <td>
                                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary-600)' }}>
                                  {src.guia_remision ?? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>sin guía</span>}
                                </div>
                              </td>
                              <td>
                                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--success)' }}>
                                  {src.comprobante_acopio ?? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>sin comprobante</span>}
                                </div>
                              </td>
                              <td>{src.module_name ?? <span className="muted small">—</span>}</td>
                              <td>{src.producer_name ?? '-'}</td>
                              <td>
                                {APPEARANCE_TAG[src.appearance] ? (
                                  <span className={`tag ${APPEARANCE_TAG[src.appearance].cls}`}>{APPEARANCE_TAG[src.appearance].label}</span>
                                ) : <span className="muted small">—</span>}
                              </td>
                              <td>{Number(src.quantity_kg_received ?? 0).toFixed(2)}</td>
                              <td>
                                <span style={{ color: avail <= 0 ? '#dc2626' : avail < 50 ? 'var(--warning)' : 'var(--success)', fontWeight: 600 }}>
                                  {avail.toFixed(2)}
                                </span>
                              </td>
                              <td>
                                {selected ? (() => {
                                  const qty = parseFloat(selected.quantity_kg)
                                  const over = !isNaN(qty) && qty > avail + 0.01
                                  return (
                                    <input
                                      type="number"
                                      min="0.1"
                                      step="0.01"
                                      value={selected.quantity_kg}
                                      style={{
                                        width: 80, padding: '5px 8px', borderRadius: 6,
                                        border: `1px solid ${over ? '#dc2626' : 'var(--border)'}`,
                                        background: over ? '#fee2e2' : undefined,
                                      }}
                                      onChange={e => updateQty(exitItemId, e.target.value)}
                                      onBlur={e => {
                                        const v = parseFloat(e.target.value)
                                        if (!isNaN(v) && v > avail + 0.01) updateQty(exitItemId, avail.toFixed(2))
                                        else if (isNaN(v) || v <= 0) updateQty(exitItemId, '')
                                      }}
                                    />
                                  )
                                })() : <span className="muted small">—</span>}
                              </td>
                              <td>
                                {selected ? (
                                  <input
                                    type="number" min="0" step="1" placeholder="cant."
                                    value={selected.sacos ?? ''}
                                    style={{ width: 70, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
                                    onChange={e => updateSacos(exitItemId, e.target.value, avail)}
                                  />
                                ) : <span className="muted small">—</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted small" style={{ margin: '4px 0 0' }}>
                    "o sacos" calcula el kg automáticamente ({kgPerSaco} kg por saco). El kg es el dato que se guarda — editable si la balanza da otro número.
                  </p>

                  {/* ── Resultado del tamizado ── */}
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#000', margin: '16px 0 8px' }}>
                    Resultado del tamizado {liveTotal > 0 && <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(sobre {liveTotal.toFixed(2)} kg de insumos elegidos arriba)</span>}
                  </div>
                  <p className="muted small" style={{ margin: '0 0 8px' }}>
                    Opcional: si todavía no se sabe, dejar en blanco y completar más tarde editando el {BUNQUE_LABEL_LOWER}.
                  </p>
                  <div className="grid" style={{ gap: 8 }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Panela tamizada (kg)</label>
                      <input type="number" min="0" step="0.01" value={resultForm.tamizada_kg}
                        onChange={e => applyKg('tamizada_kg', 'tamizada_sacos', e.target.value)} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span className="muted small">o por sacos:</span>
                        <input type="number" min="0" step="1" placeholder="cant." style={{ width: 70, fontSize: 12, padding: '3px 6px', height: 'auto' }}
                          value={resultForm.tamizada_sacos}
                          onChange={e => applySacos('tamizada_kg', 'tamizada_sacos', e.target.value)} />
                        <span className="muted small">× {kgPerSaco} kg</span>
                      </div>
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Reproceso (kg)</label>
                      <input type="number" min="0" step="0.01" value={resultForm.reproceso_kg}
                        onChange={e => applyKg('reproceso_kg', 'reproceso_sacos', e.target.value)} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span className="muted small">o por sacos:</span>
                        <input type="number" min="0" step="1" placeholder="cant." style={{ width: 70, fontSize: 12, padding: '3px 6px', height: 'auto' }}
                          value={resultForm.reproceso_sacos}
                          onChange={e => applySacos('reproceso_kg', 'reproceso_sacos', e.target.value)} />
                        <span className="muted small">× {kgPerSaco} kg</span>
                      </div>
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Descarte (kg)</label>
                      <input type="number" min="0" step="0.01" value={resultForm.descarte_kg}
                        onChange={e => applyKg('descarte_kg', 'descarte_sacos', e.target.value)} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span className="muted small">o por sacos:</span>
                        <input type="number" min="0" step="1" placeholder="cant." style={{ width: 70, fontSize: 12, padding: '3px 6px', height: 'auto' }}
                          value={resultForm.descarte_sacos}
                          onChange={e => applySacos('descarte_kg', 'descarte_sacos', e.target.value)} />
                        <span className="muted small">× {kgPerSaco} kg</span>
                      </div>
                    </div>
                  </div>
                  <p className="muted small" style={{ margin: '6px 0 0' }}>
                    Los sacos son solo para calcular el kg más rápido. El kg de arriba es el que se guarda y el que manda en el balance — si la balanza da otro número, corregir ahí antes de guardar.
                  </p>
                  {hasVals && (
                    <div style={{ marginTop: 10, padding: '12px 14px', background: 'rgba(15,76,92,0.10)', borderRadius: 8, border: '1px solid var(--primary)', fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase' }}>
                          Cómo se reparten los {liveTotal.toFixed(2)} kg
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: balanceOk ? 'var(--success)' : '#dc2626', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon name={balanceOk ? 'check' : 'x'} size={12} />
                          {balanceOk ? 'cierra el balance' : 'no cierra el balance'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', border: '2px solid #fff', marginBottom: 10 }}>
                        {repartos.filter(r => r.kg > 0).map(r => (
                          <div key={r.label} style={{ width: `${pct(r.kg)}%`, background: r.color }} title={`${r.label}: ${r.kg.toFixed(2)} kg`} />
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
                        {repartos.map(r => (
                          <div key={r.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, background: r.color, marginTop: 3, flexShrink: 0 }} />
                            <div>
                              <div style={{ color: 'var(--primary-600)', fontSize: 11 }}>{r.label}{r.label === 'Merma' && <span> (calculada)</span>}</div>
                              <strong style={{ fontSize: 14 }}>{r.kg.toFixed(2)} kg</strong>
                            </div>
                          </div>
                        ))}
                      </div>
                      {tamExcede && (
                        <p style={{ color: '#dc2626', margin: '6px 0 0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="x" size={13} />
                          La panela tamizada supera el total de insumos — no es físicamente posible.
                        </p>
                      )}
                      {sumaExcede && !tamExcede && (
                        <p style={{ color: '#dc2626', margin: '6px 0 0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="x" size={13} />
                          La suma tamizada + reproceso + descarte supera el total de insumos de este {BUNQUE_LABEL_LOWER}.
                        </p>
                      )}
                    </div>
                  )}

                  {/* ── Repartir a lotes ── */}
                  {hasVals && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#000' }}>
                          Repartir a {LOTE_LABEL_PLURAL_LOWER}
                        </div>
                        <div style={{
                          fontSize: 13, fontWeight: 700, color: '#fff',
                          background: repartoExcede ? '#dc2626' : 'var(--primary)',
                          borderRadius: 6, padding: '4px 10px',
                        }}>
                          Repartido: {repartoTotalLive.toFixed(2)} / {tam.toFixed(2)} kg
                        </div>
                      </div>
                      <p className="muted small" style={{ margin: '0 0 8px' }}>
                        A qué {LOTE_LABEL_LOWER}(s) va la panela tamizada de este {BUNQUE_LABEL_LOWER} — puede repartirse a más de uno, de cualquier orden. No hace falta repartir el 100% ahora: lo que falte queda "sin repartir" y se puede completar más adelante.
                      </p>
                      {contextLote && !repartoRows.some(r => r.plant_batch_id === contextLote.id) && (
                        <button
                          className="btn small primary"
                          style={{ marginBottom: 8 }}
                          onClick={() => addRepartoLote(contextLote)}
                        >
                          + Agregar {loteLabel(contextLote)} (el {LOTE_LABEL_LOWER} que abriste)
                        </button>
                      )}
                      {repartoRows.length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                          <table className="table small" style={{ marginBottom: 8 }}>
                            <thead><tr><th>{LOTE_LABEL}</th><th>Kg</th><th></th></tr></thead>
                            <tbody>
                              {repartoRows.map(r => (
                                <tr key={r.plant_batch_id}>
                                  <td>{r.label}</td>
                                  <td>
                                    <input
                                      type="number" min="0.01" step="0.01" value={r.kg}
                                      style={{ width: 90, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
                                      onChange={e => updateRepartoKg(r.plant_batch_id, e.target.value)}
                                    />
                                  </td>
                                  <td>
                                    <button className="btn small outline" onClick={() => removeReparto(r.plant_batch_id)}>Quitar</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {repartoExcede && (
                        <p style={{ color: '#dc2626', margin: '0 0 8px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="x" size={13} />
                          El reparto supera la panela tamizada de este {BUNQUE_LABEL_LOWER}.
                        </p>
                      )}
                      <div className="field" style={{ margin: 0 }}>
                        <label>Buscar {LOTE_LABEL_LOWER} (por N° de {LOTE_LABEL_LOWER})</label>
                        <input
                          type="text"
                          placeholder={`Dejar vacío para ver los ${LOTE_LABEL_PLURAL_LOWER} en proceso, o escribir el N° de ${LOTE_LABEL_LOWER}...`}
                          value={loteSearch}
                          onChange={e => setLoteSearch(e.target.value)}
                        />
                        <p className="muted small" style={{ margin: '4px 0 0' }}>
                          {loteSearch.trim().length >= 2
                            ? `Buscando por N° de ${LOTE_LABEL_LOWER} en cualquier orden (incluidas completadas).`
                            : `Mostrando ${LOTE_LABEL_PLURAL_LOWER} de órdenes en proceso — escriba 2 o más caracteres para buscar por N° en cualquier orden.`}
                        </p>
                      </div>
                      {visibleLoteResults.length === 0 && (
                        <p className="muted small" style={{ margin: '6px 0 0' }}>
                          {loteSearch.trim().length >= 2 ? `Ningún ${LOTE_LABEL_LOWER} coincide con la búsqueda.` : `No hay ${LOTE_LABEL_PLURAL_LOWER} en proceso por ahora — escriba el N° del ${LOTE_LABEL_LOWER} que busca.`}
                        </p>
                      )}
                      {visibleLoteResults.length > 0 && (
                        <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginTop: 6, maxHeight: 180, overflowY: 'auto' }}>
                          {visibleLoteResults.map(pb => (
                            <div
                              key={pb.id}
                              style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                              onClick={() => addRepartoLote(pb)}
                            >
                              <span style={{ fontSize: 12 }}>
                                {loteLabel(pb)} — {pb.brand} · {packagingLabel(pb)}{pb.plant_orders ? ` · orden ${pb.plant_orders.client_order_number || pb.plant_orders.order_code}` : ''}
                              </span>
                              <button className="btn small primary" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); addRepartoLote(pb) }}>+ Agregar</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {error && <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
                    {isDirty && <span className="muted small" style={{ color: 'var(--warning)' }}>Cambios sin guardar</span>}
                    <button className="btn small" onClick={() => attemptCollapseBunque(bunque)} disabled={saving}>Cancelar</button>
                    <button className="btn small primary" onClick={() => handleSaveBunque(bunque)} disabled={saving || bloqueado || repartoExcede}>
                      {saving ? 'Guardando...' : `Guardar ${BUNQUE_LABEL_LOWER}`}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        )
      })}
      </div>
      {confirmDialog}
    </div>
  )
}
