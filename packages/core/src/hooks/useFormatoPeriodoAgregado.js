import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { useAuthStore } from '../store/authStore'
import { openPrintWindow, getCoopCode } from '../lib/formatos/shared'
import { resolveFirmantesFromUserIds } from '../lib/firmanteHelpers'
import { usePeriodPresets } from './usePeriodPresets'
import { useFirmantes } from './useFirmantes'
import { useHistorialFilter } from './useHistorialFilter'

const DEFAULT_HISTORIAL_SELECT =
  'id, formato_codigo, module_id, date_from, date_to, emitted_by_name, emitted_at, status, firmantes, coop_modules(name)'

// Estado y ciclo completo de los formatos "un documento por módulo + período
// completo" (Control de Plagas, Cloro Residual, Limpieza y Desinfección,
// Mantenimiento de Equipos, Seguimiento de Salud): historial, búsqueda de
// registros, firmantes automáticos/manuales, emisión, ver y reimprimir.
//
// fetchRecords(moduleId, dateFrom, dateTo) y fetchViewData(formato) son la
// única parte específica de cada dominio -- deben devolver filas con
// `created_by` para que los firmantes automáticos se resuelvan solos.
export function useFormatoPeriodoAgregado({
  historialTable,
  historialSelect = DEFAULT_HISTORIAL_SELECT,
  rpcName,
  fetchRecords,
  fetchViewData,
  buildPrintHTML,
}) {
  const COOPERATIVE = useCooperative()
  const { webUser } = useAuthStore()
  const [searchParams] = useSearchParams()
  const docFromUrl = searchParams.get('doc') ?? ''

  const [modules, setModules]     = useState([])
  const [moduleId, setModuleId]   = useState('')
  const [historial, setHistorial] = useState([])
  const [loadingHist, setLoadingHist] = useState(true)

  const [records, setRecords]         = useState(null)
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [savedCode, setSavedCode]         = useState(null)
  const [savedEmittedAt, setSavedEmittedAt] = useState(null)
  const [emitting, setEmitting]           = useState(false)
  const [emitError, setEmitError]         = useState('')

  const [viewing, setViewing]         = useState(null)
  const [reprinting, setReprinting]   = useState(null)

  const period    = usePeriodPresets(() => { setRecords(null); setSavedCode(null); setSearchError('') })
  const firmantes = useFirmantes()
  const histFilterState = useHistorialFilter(historial, docFromUrl)

  useEffect(() => { loadHistorial(); loadModules() }, [])

  async function loadModules() {
    const { data } = await supabase.from('coop_modules').select('id, name')
      .eq('cooperative_id', COOPERATIVE.id).order('name')
    setModules(data ?? [])
  }

  async function loadHistorial() {
    setLoadingHist(true)
    const { data } = await supabase
      .from(historialTable)
      .select(historialSelect)
      .eq('cooperative_id', COOPERATIVE.id).eq('status', 'emitted')
      .order('emitted_at', { ascending: false })
    setHistorial(data ?? [])
    setLoadingHist(false)
  }

  async function handleSearch() {
    if (!moduleId) { setSearchError('Selecciona un módulo.'); return }
    if (!period.dateFrom || !period.dateTo) { setSearchError('Selecciona un período.'); return }
    setSearchError(''); setLoadingRecords(true); setRecords(null); setSavedCode(null); setSavedEmittedAt(null)
    try {
      const rows = await fetchRecords(moduleId, period.dateFrom, period.dateTo)
      setRecords(rows)
      firmantes.setFirmantes(await resolveFirmantesFromUserIds(COOPERATIVE, rows.map(r => r.created_by)))
    } catch (e) { setSearchError(e.message ?? 'Error al buscar') }
    finally { setLoadingRecords(false) }
  }

  async function handleEmit() {
    setEmitting(true); setEmitError('')
    try {
      const { data, error: e } = await supabase.rpc(rpcName, {
        p_coop_code:       getCoopCode(COOPERATIVE),
        p_cooperative_id:  COOPERATIVE.id,
        p_module_id:       moduleId,
        p_date_from:       period.dateFrom,
        p_date_to:         period.dateTo,
        p_emitted_by:      webUser?.id ?? null,
        p_emitted_by_name: webUser ? `${webUser.first_name} ${webUser.last_name}` : null,
        p_firmantes:       firmantes.firmantes,
      })
      if (e) throw e
      setSavedCode(data.formato_codigo)
      setSavedEmittedAt(new Date().toISOString())
      await loadHistorial()
    } catch (e) { setEmitError(e.message ?? 'Error al emitir') }
    finally { setEmitting(false) }
  }

  async function handleView(f) {
    setViewing({ formato: f, records: null, firmantes: [] })
    const { records: recs, firmantes: fms } = await fetchViewData(f)
    setViewing({ formato: f, records: recs, firmantes: fms })
  }

  async function handleReprint(f) {
    setReprinting(f.id)
    try {
      const { records: recs, firmantes: fms } = await fetchViewData(f)
      const moduleName = f.coop_modules?.name ?? modules.find(m => m.id === f.module_id)?.name ?? '—'
      const html = buildPrintHTML(f.formato_codigo, moduleName, f.date_from, f.date_to, f.emitted_at, recs, fms)
      openPrintWindow(html, f.formato_codigo)
    } finally { setReprinting(null) }
  }

  const moduleName  = modules.find(m => m.id === moduleId)?.name ?? '—'
  const previewHTML = records !== null
    ? buildPrintHTML(savedCode ?? null, moduleName, period.dateFrom, period.dateTo, savedEmittedAt, records, firmantes.firmantes)
    : null

  return {
    docFromUrl,
    modules, moduleId, setModuleId,
    historial, loadingHist,
    ...histFilterState,
    ...period,
    records, loadingRecords, searchError, handleSearch,
    ...firmantes,
    savedCode, savedEmittedAt, emitting, emitError, handleEmit,
    viewing, setViewing, handleView,
    reprinting, handleReprint,
    previewHTML,
  }
}
