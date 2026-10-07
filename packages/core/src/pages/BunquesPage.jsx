import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'
import { loadKgPerSacoTamizado } from '../lib/formConfig'
import { loteLabel, packagingLabel } from '../lib/loteHelpers'
import { getLoteLabel, getLoteLabelLower, getVentaTag, getLoteLabelPluralLower, getBunqueLabel, getBunqueLabelLower, getBunqueLabelPlural, getBunqueLabelPluralLower } from '../lib/labels'
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

// Lotes de envasado de órdenes COMPLETADAS a los que este bunque ya
// repartió: ese reparto queda fijo, y también la materia prima y el
// resultado del bunque (cambiarlos alteraría la trazabilidad de una orden
// cerrada). Para corregir hay que reabrir la orden. La base de datos lo
// refuerza con triggers (20261005120000_bloquear_reparto_orden_completada.sql).
function lockedLoteIds(bunque) {
  return new Set((bunque.plant_bunque_batch_allocations ?? [])
    .filter(a => a.plant_batch?.plant_orders?.status === 'completado')
    .map(a => a.plant_batch.id))
}

function allocLoteLabel(alloc) {
  const b = alloc.plant_batch
  if (!b) return '—'
  const ord = b.plant_orders
  const ordLabel = ord?.client_order_number || ord?.order_code
  return `${b.client_batch_number || b.batch_code}${ordLabel ? ` (orden ${ordLabel})` : ''}`
}

// Avance de los 3 pasos de un bunque (materia prima → tamizado → reparto),
// en la tarjeta de la lista y arriba del editor. done = verde con ✓,
// partial = ámbar (ej. reparto incompleto), pending = contorno azul.
const STEP_STYLES = {
  done:    { background: 'var(--success)', color: '#fff', border: '1px solid var(--success)' },
  partial: { background: 'var(--warning)', color: '#fff', border: '1px solid var(--warning)' },
  pending: { background: '#fff', color: 'var(--primary)', border: '1px solid var(--primary)' },
}
function StepProgress({ steps, numbered = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {steps.map((s, i) => (
        <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {i > 0 && <Icon name="chevronRight" size={12} />}
          <span style={{ ...STEP_STYLES[s.state], borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {s.state === 'done' && <Icon name="check" size={11} />}
            {numbered ? `${i + 1}. ${s.label}` : s.label}
          </span>
        </span>
      ))}
    </div>
  )
}

// Encabezado de cada paso dentro del editor ("1. Materia prima ..."). Se
// muestra un solo paso abierto a la vez: los demás quedan como una línea
// con su resumen, y se abren con un clic (es un div, no un button, para
// que siga funcionando dentro del fieldset deshabilitado de un bunque con
// orden completada -- ahí se puede mirar cada paso, no editarlo).
function StepTitle({ n, title, done, open = true, summary, onOpen, disabled = false, children }) {
  const closedClickable = !open && !disabled
  return (
    <div
      onClick={closedClickable ? onOpen : undefined}
      role={closedClickable ? 'button' : undefined}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6,
        marginBottom: open ? 8 : 0,
        ...(open ? {} : {
          padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff',
          cursor: closedClickable ? 'pointer' : 'default', opacity: disabled ? 0.6 : 1,
        }),
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: '#000', display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: '#fff', background: done ? 'var(--success)' : 'var(--primary)', flexShrink: 0,
        }}>
          {done ? <Icon name="check" size={11} /> : n}
        </span>
        {title}
        {!open && summary && <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— {summary}</span>}
      </div>
      {open ? children : closedClickable && <span style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>Abrir</span>}
    </div>
  )
}

// Ayuda corta detrás de un "i": se ve al pasar el mouse (title) o al
// tocarla (para celular). Reemplaza los párrafos de explicación largos.
function Hint({ text }) {
  const [show, setShow] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <span
        title={text}
        aria-label={text}
        onClick={e => { e.stopPropagation(); setShow(s => !s) }}
        style={{
          width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--primary)', color: 'var(--primary)',
          fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'help', fontStyle: 'italic', fontFamily: 'serif', background: '#fff',
        }}
      >i</span>
      {show && (
        <span style={{
          position: 'absolute', top: 20, left: 0, zIndex: 20, width: 260, padding: '8px 10px', borderRadius: 8,
          background: '#fff', border: '1px solid var(--primary)', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          fontSize: 12, fontWeight: 400, color: 'var(--text)', fontStyle: 'normal', textTransform: 'none', lineHeight: 1.4,
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

// Etiqueta de color con el tipo de venta del lote (CAES) -- el reparto de
// un bunque puede mezclar lotes de órdenes nacionales y de exportación.
// Azul = exportación, verde = nacional. No muestra nada en Norandino.
function VentaTag({ cooperative, order }) {
  const text = getVentaTag(cooperative, order)
  if (!text) return null
  return (
    <span className={`tag ${order.sale_type === 'nacional' ? 'ok' : 'info'}`} style={{ fontSize: 10, padding: '0 6px', marginLeft: 6 }}>
      {text}
    </span>
  )
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
  // Selector Exportación/Nacional del reparto (solo cooperativas que
  // distinguen, CAES): filtra la búsqueda de lotes y define los títulos.
  // Arranca en el tipo de la orden de contexto si se llegó desde una.
  const porVenta = !!COOPERATIVE?.features?.loteLabelPorVenta
  const [ventaFiltro, setVentaFiltro] = useState('exportacion')
  const repartoVenta = porVenta ? { sale_type: ventaFiltro } : undefined
  const emptyResultForm = { tamizada_kg: '', reproceso_kg: '0', descarte_kg: '', tamizada_sacos: '', reproceso_sacos: '', descarte_sacos: '' }
  const [resultForm, setResultForm] = useState(emptyResultForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingNumberId, setEditingNumberId] = useState(null)
  const [editingNumberValue, setEditingNumberValue] = useState('')
  const [kgPerSaco, setKgPerSaco] = useState(50)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [exitPrompt, setExitPrompt] = useState(null) // bunque con cambios sin guardar que se intenta cerrar
  const [openStep, setOpenStep] = useState(1) // paso abierto en el editor (los demás quedan plegados)
  // "Ingresar en sacos": un solo interruptor cambia todos los campos de kg
  // a sacos (el kg se calcula solo y es lo que se guarda). Se recuerda en
  // este navegador -- es una preferencia de quien carga, no un dato.
  const [modoSacos, setModoSacosState] = useState(() => {
    try { return localStorage.getItem('bunques_modo_sacos') === '1' } catch { return false }
  })
  const setModoSacos = (v) => {
    setModoSacosState(v)
    try { localStorage.setItem('bunques_modo_sacos', v ? '1' : '0') } catch { /* sin storage: solo dura la sesión */ }
  }
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
      // Vaciar los sacos vacía también el kg: en modo sacos el kg no se ve
      // editable, no puede quedar un valor viejo escondido.
      [kgField]: sacosValue === '' ? '' : !isNaN(sacos) && sacos >= 0 ? String(Math.round(sacos * kgPerSaco * 100) / 100) : f[kgField],
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
            plant_orders ( order_code, client_order_number, sale_type, status ) )
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
      .select('id, batch_code, client_batch_number, brand, packaging_type, plant_orders ( order_code, client_order_number, sale_type, status )')
      .eq('id', contextLoteId)
      .maybeSingle()
      .then(({ data }) => {
        setContextLote(data ?? null)
        if (data?.plant_orders?.sale_type) setVentaFiltro(data.plant_orders.sale_type)
      })
  }, [contextLoteId])

  // Búsqueda de lotes de envasado para repartir (por N° de lote), con
  // debounce -- puede haber cientos en toda la planta, no se cargan todos
  // de una. Sin nada escrito no se deja la lista vacía (esa fue la queja:
  // "si no atinamos [con el texto] no hay forma fácil de buscar") -- se
  // muestran de entrada los lotes de órdenes en_proceso (el caso más común,
  // igual criterio que usa Órdenes) para poder elegir sin tipear nada;
  // escribir 2+ caracteres cambia a búsqueda por N° en cualquier orden NO
  // completada -- el reparto de una orden completada está bloqueado (ver
  // 20261005120000_bloquear_reparto_orden_completada.sql), para corregirlo
  // hay que reabrir la orden.
  useEffect(() => {
    const q = loteSearch.trim()
    let active = true
    const t = setTimeout(async () => {
      let query = supabase
        .from('plant_production_batches')
        .select('id, batch_code, client_batch_number, brand, packaging_type, plant_orders!inner ( order_code, client_order_number, status, sale_type )')
        .eq('cooperative_id', COOPERATIVE.id)
      query = q.length >= 2
        ? query.or(`batch_code.ilike.%${q}%,client_batch_number.ilike.%${q}%`).neq('plant_orders.status', 'completado')
        : query.eq('plant_orders.status', 'en_proceso')
      if (porVenta) query = query.eq('plant_orders.sale_type', ventaFiltro)
      const { data } = await query.order('created_at', { ascending: false }).limit(15)
      if (active) setLoteResults(data ?? [])
    }, q.length >= 2 ? 300 : 0)
    return () => { active = false; clearTimeout(t) }
  }, [loteSearch, ventaFiltro, porVenta])

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
      .map(a => ({ plant_batch_id: a.plant_batch.id, kg: String(a.kg), label: allocLoteLabel(a), sale_type: a.plant_batch.plant_orders?.sale_type }))
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

    // Un borrador local nunca puede pisar lo bloqueado por una orden
    // completada: materia prima, resultado y filas de reparto cerradas
    // vuelven siempre a lo guardado.
    const locked = lockedLoteIds(bunque)
    let draft = loadBunqueDraft(bunque.id)
    if (draft && locked.size > 0) {
      draft = {
        editingInputs: savedState.editingInputs,
        resultForm: savedState.resultForm,
        repartoRows: [
          ...existingRepartos.filter(r => locked.has(r.plant_batch_id)),
          ...(draft.repartoRows ?? []).filter(r => !locked.has(r.plant_batch_id)),
        ],
      }
    }
    const initial = draft ?? savedState
    setEditingInputs(initial.editingInputs)
    setResultForm(initial.resultForm)
    setRepartoRows(initial.repartoRows ?? [])
    // El selector Exportación/Nacional arranca en el tipo de lo que este
    // bunque ya tiene repartido, para que el título coincida con la tabla.
    const tipoRepartido = (initial.repartoRows ?? []).find(r => r.sale_type)?.sale_type
    if (tipoRepartido) setVentaFiltro(tipoRepartido)
    setRestoredDraft(draft != null && JSON.stringify(draft) !== savedSnapshotRef.current)
    // Abre directamente el primer paso que falta completar.
    const hasInputsSaved = (initial.editingInputs ?? []).some(h => parseFloat(h.quantity_kg) > 0)
    const hasResultSaved = initial.resultForm?.tamizada_kg !== '' && initial.resultForm?.descarte_kg !== ''
    setOpenStep(!hasInputsSaved ? 1 : !hasResultSaved ? 2 : 3)
    setExpandedBunqueId(bunque.id)
  }

  // Al cerrar con cambios sin guardar se ofrecen 3 salidas (antes solo
  // había "Guardar" o quedarse, sin forma de descartar).
  const attemptCollapseBunque = (bunque) => {
    if (isDirty) { setExitPrompt(bunque); return }
    setExpandedBunqueId(null)
  }

  const discardAndCollapse = (bunque) => {
    clearBunqueDraft(bunque.id)
    setExitPrompt(null)
    setError('')
    setExpandedBunqueId(null)
  }

  const saveAndCollapse = async (bunque) => {
    setExitPrompt(null)
    await handleSaveBunque(bunque)
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
      setOpenStep(1)
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
      message: `¿Eliminar el ${BUNQUE_LABEL_LOWER} ${bunque.bunque_number}? Se van a borrar también las guías de materia prima que tenga asignadas.`,
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
        sacos: avail > 0 ? String(Math.round((avail / kgPerSaco) * 100) / 100) : '',
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
      if (sacosValue === '') {
        kg = ''
      } else if (!isNaN(sacos) && sacos >= 0) {
        kg = String(Math.min(Math.round(sacos * kgPerSaco * 100) / 100, avail))
      }
      return { ...h, sacos: sacosValue, quantity_kg: kg }
    }))
  }

  const addRepartoLote = (pb) => {
    if (repartoRows.some(r => r.plant_batch_id === pb.id)) return
    if (pb.plant_orders?.status === 'completado') return
    const ord = pb.plant_orders
    const label = `${loteLabel(pb)} — ${pb.brand ?? ''}${ord ? ` (orden ${ord.client_order_number || ord.order_code})` : ''}`
    setRepartoRows([...repartoRows, { plant_batch_id: pb.id, kg: '', label, sale_type: ord?.sale_type }])
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
      setError('Paso 1: marque al menos una guía de materia prima y escriba cuántos kg usar.')
      return false
    }
    for (const h of filtered) {
      const stockItem = stockItems.find(s => s.exit_item_id === h.source_exit_item_id)
      const avail = stockItem ? getAvailableKg(stockItem, bunque) : 0
      const qty = parseFloat(h.quantity_kg)
      if (qty > avail + 0.01) {
        const code = stockItem?.comprobante_acopio ?? stockItem?.guia_remision ?? h.source_exit_item_id
        setError(`La guía ${code} no tiene suficiente cantidad disponible — disponible: ${avail.toFixed(2)} kg, solicitado: ${qty.toFixed(2)} kg`)
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
        setError(`La panela tamizada (${tam.toFixed(2)} kg) no puede superar el total de materia prima de este ${BUNQUE_LABEL_LOWER} (${total.toFixed(2)} kg). No es físicamente posible producir más de lo que se mezcló.`)
        return false
      }
      const merma = total - tam - rep - des
      if (merma < -0.01) {
        setError(`La suma tamizada + reproceso + descarte (${(tam + rep + des).toFixed(2)} kg) supera el total de materia prima de este ${BUNQUE_LABEL_LOWER} (${total.toFixed(2)} kg). Revise los valores ingresados.`)
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

    // Con reparto a una orden completada, la materia prima, el resultado y
    // esas filas de reparto quedan fijos: no se reescriben (la base de
    // datos además lo rechazaría). Solo se guarda el reparto abierto.
    const locked = lockedLoteIds(bunque)
    const repartoAbierto = repartoFiltered.filter(r => !locked.has(r.plant_batch_id))

    setSaving(true)
    try {
      if (locked.size === 0) {
        const { error: delInErr } = await supabase.from('plant_homogenization_inputs').delete().eq('bunque_id', bunque.id)
        if (delInErr) throw new Error(delInErr.message)
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
      }

      let delRep = supabase.from('plant_bunque_batch_allocations').delete().eq('bunque_id', bunque.id)
      if (locked.size > 0) delRep = delRep.not('plant_batch_id', 'in', `(${[...locked].join(',')})`)
      const { error: delRepErr } = await delRep
      if (delRepErr) throw new Error(delRepErr.message)
      if (repartoAbierto.length > 0) {
        const { error: repErr } = await supabase
          .from('plant_bunque_batch_allocations')
          .insert(repartoAbierto.map(r => ({
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
    // El filtro "sin repartir" es para ocultar bunques YA tamizados y
    // completamente repartidos (nada pendiente) -- un bunque recién creado
    // (tamizada_kg todavía null, ni siquiera tamizado) no es lo mismo que
    // uno "sin nada pendiente", y no debe esconderse o desaparece de la
    // lista apenas se crea (bug real: encontrado en vivo, hacía que se
    // cresee bunques vacíos repetidos porque el recién creado no aparecía).
    if (soloConDisponible && b.tamizada_kg != null && bunqueSinRepartir(b) <= 0.01) return false
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
            <VentaTag cooperative={COOPERATIVE} order={contextLote.plant_orders} />
          </span>
        </div>
      )}

      {activeCampaign === null && (
        <p className="muted small" style={{ margin: '0 0 12px' }}>
          No hay una campaña activa configurada (Catálogos → Campañas) — el número de {BUNQUE_LABEL_LOWER} no se puede sugerir automáticamente ni filtrar por campaña, pero se puede seguir cargando a mano.
        </p>
      )}

      {/* Crear y buscar van separados: son dos acciones distintas y antes,
          en la misma fila y con el mismo peso, se confundían. */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Crear nuevo {BUNQUE_LABEL_LOWER}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 160, maxWidth: 360 }}>
            <label>N° de {BUNQUE_LABEL_LOWER}{activeCampaign ? <span className="muted small"> — campaña {activeCampaign.year}</span> : null}</label>
            <input
              type="text"
              placeholder="Ej: 055"
              value={newBunqueNumber}
              style={isDuplicateNumber ? { borderColor: 'var(--warning)', background: '#fffbeb' } : undefined}
              onChange={e => setNewBunqueNumber(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newBunqueNumber.trim() && !saving) handleCreateBunque() }}
            />
          </div>
          <button
            className="btn primary"
            onClick={handleCreateBunque}
            disabled={saving || !newBunqueNumber.trim()}
            title={!newBunqueNumber.trim() ? `Escriba primero el N° de ${BUNQUE_LABEL_LOWER}` : undefined}
          >
            + Crear {BUNQUE_LABEL_LOWER}
          </button>
        </div>
        {isDuplicateNumber && (
          <p style={{ color: 'var(--warning)', fontSize: 12, margin: '8px 0 0' }}>
            Ya existe un {BUNQUE_LABEL_LOWER} con el número "{newBunqueNumber.trim()}" en esta campaña — se puede crear igual si es intencional.
          </p>
        )}
        {expandedBunqueId == null && error && <p style={{ color: '#dc2626', fontSize: 14, margin: '8px 0 0' }}>{error}</p>}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="field" style={{ margin: 0, flex: 1, minWidth: 160, maxWidth: 260 }}>
          <label>Buscar {BUNQUE_LABEL_LOWER} por N°</label>
          <input type="text" placeholder="Filtrar por número..." value={bunqueFilter} onChange={e => setBunqueFilter(e.target.value)} />
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', paddingBottom: 8 }}>
          <input type="checkbox" checked={soloConDisponible} onChange={e => setSoloConDisponible(e.target.checked)} />
          Mostrar solo {BUNQUE_LABEL_PLURAL_LOWER} con kg sin repartir
        </label>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{BUNQUE_LABEL} {bunque.bunque_number}</span>
                  <button className="btn small outline" style={{ fontSize: 11, padding: '1px 8px' }} onClick={() => startEditNumber(bunque)}>Cambiar N°</button>
                  {/* Resumen de kg en una sola línea -- el detalle (reparto
                      por lote, reproceso/descarte) se ve al abrir el bunque. */}
                  <span className="muted small">
                    {!hasInputs
                      ? 'sin materia prima'
                      : !hasResult
                        ? `${savedInputKg.toFixed(2)} kg de materia prima`
                        : <>
                            {savedInputKg.toFixed(2)} kg → {Number(bunque.tamizada_kg).toFixed(2)} kg tamizada ·{' '}
                            <span style={{ color: savedInputKg > 0 && (Number(bunque.merma_kg) / savedInputKg * 100) > 5 ? 'var(--warning)' : undefined }}>
                              merma {savedInputKg > 0 ? (Number(bunque.merma_kg) / savedInputKg * 100).toFixed(1) : '0'}%
                            </span>
                          </>}
                  </span>
                </div>
              )}
              <StepProgress steps={[
                { label: 'Materia prima', state: hasInputs ? 'done' : 'pending' },
                { label: 'Tamizado', state: hasResult ? 'done' : 'pending' },
                { label: 'Reparto', state: !hasResult ? 'pending' : sinRepartir > 0.01 ? 'partial' : 'done' },
              ]} />
            </div>

            <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className={`btn small ${isExpanded ? 'outline' : 'primary'}`}
                onClick={() => isExpanded ? attemptCollapseBunque(bunque) : openBunqueEditor(bunque)}
              >
                {isExpanded
                  ? 'Cerrar'
                  : !hasInputs ? 'Empezar: elegir materia prima'
                  : !hasResult ? 'Continuar: registrar tamizado'
                  : sinRepartir > 0.01 ? 'Continuar: repartir'
                  : 'Ver / editar'}
              </button>
              {!hasResult && (
                <button className="btn small danger primary" disabled={saving} onClick={() => handleDeleteBunque(bunque)}>
                  Eliminar {BUNQUE_LABEL_LOWER}
                </button>
              )}
              {hasResult && sinRepartir > 0.01 && (
                <span style={{ color: 'var(--warning)', fontSize: 12, fontWeight: 600 }}>{sinRepartir.toFixed(2)} kg sin repartir</span>
              )}
              {allocs.some(a => a.plant_batch?.plant_orders?.status === 'completado') && (
                <span style={{ color: 'var(--primary)', fontSize: 12 }}>Repartido a orden completada</span>
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

              // Lo que impediría guardar, calculado en vivo con las MISMAS
              // reglas de handleSaveBunque (que sigue validando igual, como
              // respaldo) -- así el botón Guardar se desactiva y se explica
              // antes, en vez de mostrar el error recién al hacer clic.
              const inputsConKg = editingInputs.filter(h => parseFloat(h.quantity_kg) > 0)
              const inputsSinKg = editingInputs.filter(h => !(parseFloat(h.quantity_kg) > 0))
              const inputsExcedidos = editingInputs.filter(h => {
                const s = stockItems.find(x => x.exit_item_id === h.source_exit_item_id)
                return parseFloat(h.quantity_kg) > (s ? getAvailableKg(s, bunque) : 0) + 0.01
              })
              const tamVacio = resultForm.tamizada_kg === ''
              const desVacio = resultForm.descarte_kg === ''
              const resultadoIncompleto = tamVacio !== desVacio
              const hayNegativo = ['tamizada_kg', 'reproceso_kg', 'descarte_kg'].some(k => parseFloat(resultForm[k]) < 0)
              const repartoConKg = repartoRows.filter(r => parseFloat(r.kg) > 0)
              const repartoSinKg = repartoRows.filter(r => !(parseFloat(r.kg) > 0))
              const faltantes = [
                inputsConKg.length === 0 && 'Paso 1: marque al menos una guía de materia prima y escriba cuántos kg usar.',
                inputsExcedidos.length > 0 && 'Paso 1: hay guías con más kg que los disponibles (en rojo).',
                resultadoIncompleto && tamVacio && 'Paso 2: falta "Panela tamizada" (o borre también Descarte si todavía no hay resultado).',
                resultadoIncompleto && desVacio && 'Paso 2: falta "Descarte" — si no hubo descarte, escriba 0.',
                hayNegativo && 'Paso 2: hay valores negativos.',
                tamExcede && 'Paso 2: la panela tamizada supera el total de materia prima.',
                sumaExcede && !tamExcede && 'Paso 2: tamizada + reproceso + descarte supera el total de materia prima.',
                !hasVals && repartoConKg.length > 0 && 'Paso 3: para repartir, primero complete el paso 2.',
                repartoExcede && 'Paso 3: lo repartido supera la panela tamizada.',
              ].filter(Boolean)
              const avisos = [
                inputsSinKg.length > 0 && `${inputsSinKg.length} guía(s) marcada(s) sin kg — no se van a guardar.`,
                hasVals && repartoSinKg.length > 0 && `${repartoSinKg.length} ${getLoteLabelLower(COOPERATIVE)}(s) del reparto sin kg — no se van a guardar.`,
              ].filter(Boolean)
              const paso1Ok = inputsConKg.length > 0 && inputsExcedidos.length === 0
              const paso2Ok = hasVals && balanceOk && !hayNegativo
              const paso3State = !paso2Ok ? 'pending' : repartoTotalLive >= tam - 0.01 && tam > 0 ? 'done' : repartoTotalLive > 0 ? 'partial' : 'pending'
              const locked = lockedLoteIds(bunque)
              const bloqueadoPorOrden = locked.size > 0

              return (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  {bloqueadoPorOrden && (
                    <div style={{ background: 'rgba(15,76,92,0.08)', border: '1px solid var(--primary)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, fontSize: 13, color: 'var(--primary)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <Icon name="alertTriangle" size={14} />
                      <span>
                        Repartido a una <strong>orden completada</strong>: solo puede repartir los kg libres. Para corregir lo demás, reabra la orden.
                      </span>
                    </div>
                  )}
                  {restoredDraft && (
                    <div style={{ background: '#fffbeb', border: '1px solid var(--warning)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, fontSize: 12, color: '#b45309' }}>
                      Se recuperó un borrador sin guardar. Revíselo y guarde.
                    </div>
                  )}
                  {!bloqueadoPorOrden && openStep !== 3 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={modoSacos} onChange={e => setModoSacos(e.target.checked)} />
                        Ingresar en sacos ({kgPerSaco} kg c/u)
                        <Hint text="El kg se calcula solo y es lo que se guarda. Si la balanza da otro número, desactive esta opción y corrija el kg." />
                      </label>
                    </div>
                  )}

                  {/* Pasos 1 y 2 en solo lectura si hay reparto a una orden
                      completada (fieldset disabled desactiva todos los
                      campos de adentro de una vez). */}
                  <fieldset disabled={bloqueadoPorOrden} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  {/* ── Paso 1: Materia prima ── */}
                  <StepTitle
                    n={1} title="Materia prima" done={paso1Ok}
                    open={openStep === 1} onOpen={() => setOpenStep(1)}
                    summary={inputsConKg.length > 0 ? `${liveTotal.toFixed(2)} kg de ${inputsConKg.length} guía(s)` : 'sin elegir todavía'}
                  >
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: '#fff', background: 'var(--primary)',
                      borderRadius: 6, padding: '4px 10px',
                    }}>
                      Total: {liveTotal.toFixed(2)} kg
                      {editingInputs.length > 0 && <span style={{ fontWeight: 400 }}> ({editingInputs.length} guía{editingInputs.length === 1 ? '' : 's'})</span>}
                    </div>
                  </StepTitle>
                  {openStep === 1 && (<>
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
                          <th style={{ whiteSpace: 'nowrap' }}>
                            Guía <Hint text="Pase el mouse sobre una guía para ver su comprobante de acopio, módulo y kg recibidos." />
                          </th>
                          <th>Productor</th>
                          <th>Tipo</th>
                          <th>Disponible (kg)</th>
                          <th>{modoSacos ? 'Sacos a usar' : 'Kg a usar'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleStockItems.length === 0 && (
                          <tr><td colSpan={6} className="muted small" style={{ textAlign: 'center', padding: '10px 0' }}>
                            {grSearch.trim() ? 'Ninguna guía coincide con la búsqueda.' : 'No quedan guías con kg disponibles para usar.'}
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
                              <td title={`Comprobante de acopio: ${src.comprobante_acopio ?? '—'} · Módulo: ${src.module_name ?? '—'} · Recibido: ${Number(src.quantity_kg_received ?? 0).toFixed(2)} kg`} style={{ cursor: 'help' }}>
                                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary-600)' }}>
                                  {src.guia_remision ?? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>sin guía</span>}
                                </div>
                              </td>
                              <td>{src.producer_name ?? '-'}</td>
                              <td>
                                {APPEARANCE_TAG[src.appearance] ? (
                                  <span className={`tag ${APPEARANCE_TAG[src.appearance].cls}`}>{APPEARANCE_TAG[src.appearance].label}</span>
                                ) : <span className="muted small">—</span>}
                              </td>
                              <td>
                                <span style={{ color: avail <= 0 ? '#dc2626' : avail < 50 ? 'var(--warning)' : 'var(--success)', fontWeight: 600 }}>
                                  {avail.toFixed(2)}
                                </span>
                              </td>
                              <td>
                                {selected ? (() => {
                                  const qty = parseFloat(selected.quantity_kg)
                                  const over = !isNaN(qty) && qty > avail + 0.01
                                  const empty = !(qty > 0)
                                  const cellStyle = {
                                    width: 80, padding: '5px 8px', borderRadius: 6,
                                    border: `1px solid ${over ? '#dc2626' : empty ? 'var(--warning)' : 'var(--border)'}`,
                                    background: over ? '#fee2e2' : empty ? '#fffbeb' : undefined,
                                  }
                                  if (modoSacos) {
                                    return (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                                        <input
                                          type="number" min="0" step="1" placeholder={empty ? "sacos" : `≈ ${(qty / kgPerSaco).toFixed(1)}`}
                                          title={over ? `Máximo disponible: ${avail.toFixed(2)} kg` : empty ? 'Escriba los sacos a usar' : undefined}
                                          value={selected.sacos ?? ''}
                                          style={{ ...cellStyle, width: 70 }}
                                          onChange={e => updateSacos(exitItemId, e.target.value, avail)}
                                        />
                                        <span className="muted small">= {empty ? '—' : `${qty.toFixed(2)} kg`}</span>
                                      </div>
                                    )
                                  }
                                  return (
                                    <input
                                      type="number"
                                      min="0.1"
                                      step="0.01"
                                      placeholder="kg"
                                      title={over ? `Máximo disponible: ${avail.toFixed(2)} kg` : empty ? 'Escriba los kg a usar' : undefined}
                                      value={selected.quantity_kg}
                                      style={cellStyle}
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
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {paso1Ok && !bloqueadoPorOrden && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <button className="btn small primary" onClick={() => setOpenStep(2)}>Siguiente: resultado del tamizado</button>
                    </div>
                  )}
                  </>)}

                  {/* ── Paso 2: Resultado del tamizado ── */}
                  <div style={{ marginTop: 10 }}>
                    <StepTitle
                      n={2} done={paso2Ok}
                      title={openStep === 2
                        ? <>Resultado del tamizado {liveTotal > 0 && <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(sobre {liveTotal.toFixed(2)} kg)</span>}
                            <Hint text="Si todavía no tiene el resultado, déjelo en blanco y guarde: puede completarlo después." /></>
                        : 'Resultado del tamizado'}
                      open={openStep === 2} onOpen={() => setOpenStep(2)}
                      summary={hasVals ? `tamizada ${tam.toFixed(2)} kg · merma ${Math.max(0, merma).toFixed(2)} kg${balanceOk ? '' : ' · no cierra'}` : 'sin resultado todavía'}
                    />
                  </div>
                  {openStep === 2 && (<>
                  {liveTotal === 0 && (
                    <p className="muted small" style={{ margin: '0 0 8px' }}>Primero elija la materia prima (paso 1).</p>
                  )}
                  {/* Un solo campo por dato: en kg, o en sacos si está activo
                      "Ingresar en sacos" (el kg se calcula y se muestra al lado). */}
                  <div className="grid" style={{ gap: 8 }}>
                    {[
                      { kg: 'tamizada_kg', sacos: 'tamizada_sacos', label: 'Panela tamizada', req: true,
                        warn: resultadoIncompleto && tamVacio, err: tamExcede, falta: 'Falta este dato.' },
                      { kg: 'reproceso_kg', sacos: 'reproceso_sacos', label: 'Reproceso', req: false },
                      { kg: 'descarte_kg', sacos: 'descarte_sacos', label: 'Descarte', req: true,
                        warn: resultadoIncompleto && desVacio, falta: 'Falta este dato — si no hubo descarte, escriba 0.' },
                    ].map(c => {
                      const style = c.warn ? { borderColor: 'var(--warning)', background: '#fffbeb' } : c.err ? { borderColor: '#dc2626', background: '#fee2e2' } : undefined
                      return (
                        <div key={c.kg} className="field" style={{ margin: 0 }}>
                          <label>
                            {c.label} ({modoSacos ? 'sacos' : 'kg'}){c.req ? ' *' : <span className="muted small"> — opcional</span>}
                          </label>
                          {modoSacos ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input type="number" min="0" step="1" value={resultForm[c.sacos]} style={style}
                                placeholder={c.warn && c.kg === 'descarte_kg' ? 'Si no hubo, 0' : resultForm[c.kg] !== '' ? `≈ ${(Number(resultForm[c.kg]) / kgPerSaco).toFixed(1)}` : undefined}
                                onChange={e => applySacos(c.kg, c.sacos, e.target.value)} />
                              <span className="muted small" style={{ whiteSpace: 'nowrap' }}>= {resultForm[c.kg] === '' ? '—' : `${Number(resultForm[c.kg]).toFixed(2)} kg`}</span>
                            </div>
                          ) : (
                            <input type="number" min="0" step="0.01" value={resultForm[c.kg]} style={style}
                              placeholder={c.warn && c.kg === 'descarte_kg' ? 'Si no hubo, 0' : undefined}
                              onChange={e => applyKg(c.kg, c.sacos, e.target.value)} />
                          )}
                          {c.warn && <span style={{ color: 'var(--warning)', fontSize: 12 }}>{c.falta}</span>}
                        </div>
                      )
                    })}
                  </div>
                  {hasVals && (
                    <div style={{ marginTop: 10, fontSize: 13 }}>
                      {/* Balance compacto: una barra + una línea. El detalle
                          de cada parte está en el title de su tramo. */}
                      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: 'rgba(15,76,92,0.10)', marginBottom: 6 }}>
                        {repartos.filter(r => r.kg > 0).map(r => (
                          <div key={r.label} style={{ width: `${pct(r.kg)}%`, background: r.color }} title={`${r.label}: ${r.kg.toFixed(2)} kg`} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: repartos[3].color }} />
                          Merma <strong>{Math.max(0, merma).toFixed(2)} kg</strong>
                          {liveTotal > 0 && <span className="muted">({(Math.max(0, merma) / liveTotal * 100).toFixed(1)}%)</span>}
                          <Hint text="La merma se calcula sola: materia prima − tamizada − reproceso − descarte. Pase el mouse sobre la barra para ver cada parte." />
                        </span>
                        <span style={{ fontWeight: 700, color: balanceOk ? 'var(--success)' : '#dc2626', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon name={balanceOk ? 'check' : 'x'} size={12} />
                          {balanceOk ? 'cierra el balance' : 'no cierra el balance'}
                        </span>
                      </div>
                      {tamExcede && (
                        <p style={{ color: '#dc2626', margin: '6px 0 0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="x" size={13} />
                          La panela tamizada supera el total de materia prima — no es físicamente posible. Revise los kg.
                        </p>
                      )}
                      {sumaExcede && !tamExcede && (
                        <p style={{ color: '#dc2626', margin: '6px 0 0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="x" size={13} />
                          La suma tamizada + reproceso + descarte supera el total de materia prima de este {BUNQUE_LABEL_LOWER}. Revise los kg.
                        </p>
                      )}
                    </div>
                  )}
                  {paso2Ok && !bloqueadoPorOrden && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <button className="btn small primary" onClick={() => setOpenStep(3)}>Siguiente: repartir</button>
                    </div>
                  )}
                  </>)}

                  </fieldset>

                  {/* ── Paso 3: Repartir a lotes ── se ve siempre (para que se
                      sepa que existe), bloqueado hasta completar el paso 2. */}
                  {!hasVals ? (
                    <div style={{ marginTop: 10 }}>
                      <StepTitle n={3} title="Repartir" done={false} open={false} disabled summary="se habilita al terminar el paso 2" />
                    </div>
                  ) : openStep !== 3 ? (
                    <div style={{ marginTop: 10 }}>
                      <StepTitle
                        n={3} title="Repartir" done={paso3State === 'done'} open={false} onOpen={() => setOpenStep(3)}
                        summary={`${repartoTotalLive.toFixed(2)} de ${tam.toFixed(2)} kg repartidos`}
                      />
                    </div>
                  ) : (
                    <div style={{ marginTop: 10 }}>
                      <StepTitle
                        n={3} done={paso3State === 'done'}
                        title={<>Repartir a {getLoteLabelPluralLower(COOPERATIVE, repartoVenta)}
                          <Hint text={`Puede repartir a uno o varios ${LOTE_LABEL_PLURAL_LOWER}, de cualquier orden. No hace falta repartir todo ahora: lo que falte queda "sin repartir" y se completa después.`} /></>}
                      >
                        <div style={{
                          fontSize: 13, fontWeight: 700, color: '#fff',
                          background: repartoExcede ? '#dc2626' : 'var(--primary)',
                          borderRadius: 6, padding: '4px 10px',
                        }}>
                          Repartido: {repartoTotalLive.toFixed(2)} / {tam.toFixed(2)} kg
                          {!repartoExcede && tam - repartoTotalLive > 0.01 && <span style={{ fontWeight: 400 }}> · faltan {(tam - repartoTotalLive).toFixed(2)}</span>}
                        </div>
                      </StepTitle>
                      {porVenta && (
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                          {[['exportacion', 'Exportación'], ['nacional', 'Nacional']].map(([value, text]) => (
                            <button
                              key={value}
                              className={`btn small ${ventaFiltro === value ? 'primary' : 'outline'}`}
                              onClick={() => setVentaFiltro(value)}
                            >
                              {text}
                            </button>
                          ))}
                        </div>
                      )}
                      {contextLote && contextLote.plant_orders?.status !== 'completado' && !repartoRows.some(r => r.plant_batch_id === contextLote.id) && (
                        <button
                          className="btn small primary"
                          style={{ marginBottom: 8 }}
                          onClick={() => addRepartoLote(contextLote)}
                        >
                          + Agregar {loteLabel(contextLote)} (el {getLoteLabelLower(COOPERATIVE, contextLote.plant_orders)} que abriste)
                        </button>
                      )}
                      {repartoRows.length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                          <table className="table small" style={{ marginBottom: 8 }}>
                            <thead><tr><th>{LOTE_LABEL}</th><th>Kg</th><th></th></tr></thead>
                            <tbody>
                              {repartoRows.map(r => locked.has(r.plant_batch_id) ? (
                                <tr key={r.plant_batch_id}>
                                  <td>
                                    {r.label}<VentaTag cooperative={COOPERATIVE} order={r} />
                                    <div style={{ fontSize: 11, color: 'var(--primary)' }}>Orden completada — reábrala para corregir</div>
                                  </td>
                                  <td><strong>{Number(r.kg).toFixed(2)}</strong></td>
                                  <td></td>
                                </tr>
                              ) : (
                                <tr key={r.plant_batch_id}>
                                  <td>{r.label}<VentaTag cooperative={COOPERATIVE} order={r} /></td>
                                  <td>
                                    <input
                                      type="number" min="0.01" step="0.01" value={r.kg} placeholder="kg"
                                      style={{
                                        width: 90, padding: '5px 8px', borderRadius: 6,
                                        border: `1px solid ${parseFloat(r.kg) > 0 ? 'var(--border)' : 'var(--warning)'}`,
                                        background: parseFloat(r.kg) > 0 ? undefined : '#fffbeb',
                                      }}
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
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          Buscar {getLoteLabelLower(COOPERATIVE, repartoVenta)} por N°
                          <Hint text="Sin escribir nada se muestran los lotes de órdenes en proceso. Escriba 2 o más caracteres para buscar por N° en cualquier orden no completada." />
                        </label>
                        <input
                          type="text"
                          placeholder="N° de lote..."
                          value={loteSearch}
                          onChange={e => setLoteSearch(e.target.value)}
                        />
                      </div>
                      {visibleLoteResults.length === 0 && (
                        <p className="muted small" style={{ margin: '6px 0 0' }}>
                          {loteSearch.trim().length >= 2 ? 'Ningún lote coincide.' : porVenta ? 'No hay lotes en proceso de este tipo.' : 'No hay lotes en proceso.'}
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
                                <VentaTag cooperative={COOPERATIVE} order={pb.plant_orders} />
                              </span>
                              <button className="btn small primary" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); addRepartoLote(pb) }}>+ Agregar</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Qué falta para poder guardar -- se ve ANTES de hacer
                      clic, junto al botón (que queda desactivado). */}
                  {faltantes.length > 0 && (
                    <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fee2e2', fontSize: 13, color: '#b91c1c' }}>
                      <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Icon name="alertTriangle" size={14} /> Para poder guardar, corrija:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {faltantes.map(f => <li key={f}>{f}</li>)}
                      </ul>
                    </div>
                  )}
                  {avisos.length > 0 && (
                    <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--warning)', background: '#fffbeb', fontSize: 12, color: '#b45309' }}>
                      {avisos.map(a => <div key={a}>{a}</div>)}
                    </div>
                  )}
                  {error && <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {isDirty && <span className="muted small" style={{ color: 'var(--warning)' }}>Cambios sin guardar</span>}
                    <button className="btn small" onClick={() => attemptCollapseBunque(bunque)} disabled={saving}>Cerrar</button>
                    <button
                      className="btn small primary"
                      onClick={() => handleSaveBunque(bunque)}
                      disabled={saving || faltantes.length > 0}
                      title={faltantes.length > 0 ? 'Revise la lista de arriba: hay datos por corregir' : undefined}
                    >
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
      {exitPrompt && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 440 }}>
            <div className="modal-body">
              <h3 style={{ margin: '0 0 8px' }}>Cambios sin guardar</h3>
              <p style={{ margin: 0, fontSize: 14 }}>
                El {BUNQUE_LABEL_LOWER} {exitPrompt.bunque_number} tiene cambios sin guardar. ¿Qué desea hacer?
              </p>
            </div>
            <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
              <button className="btn small" onClick={() => setExitPrompt(null)} autoFocus>Seguir editando</button>
              <button className="btn small danger primary" onClick={() => discardAndCollapse(exitPrompt)}>Descartar cambios</button>
              <button className="btn small primary" onClick={() => saveAndCollapse(exitPrompt)} disabled={saving}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
