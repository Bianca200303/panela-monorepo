import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'

// Registros ACTIVOS de un catálogo de la cooperativa, para elegirlos en un
// desplegable (se gestionan en Catálogos). Un solo lugar define qué tabla,
// columnas y orden usa cada catálogo, en vez de repetir la consulta en cada
// pantalla que lo necesita. Para sumar un catálogo nuevo basta con
// agregarlo a CATALOGS.
const CATALOGS = {
  personal: {
    table: 'plant_personnel',
    select: 'id, first_name, last_name',
    order: 'first_name',
    label: (p) => `${p.first_name} ${p.last_name ?? ''}`.trim(),
  },
  transportistas: {
    table: 'plant_transport_companies',
    select: 'id, razon_social, ruc, constancia_mtc',
    order: 'razon_social',
    label: (c) => c.razon_social,
  },
  balanzas: {
    table: 'plant_balances',
    select: 'id, code, area, equipment_name, error_maximo_permitido',
    order: 'code',
    label: (b) => b.code,
  },
}

export const catalogLabel = (kind, row) => CATALOGS[kind].label(row)

export function useActiveCatalog(kind) {
  const cooperative = useCooperative()
  const [rows, setRows] = useState([])
  useEffect(() => {
    const def = CATALOGS[kind]
    let cancelled = false
    supabase
      .from(def.table)
      .select(def.select)
      .eq('cooperative_id', cooperative.id)
      .eq('is_active', true)
      .order(def.order)
      .then(({ data }) => { if (!cancelled) setRows(data ?? []) })
    return () => { cancelled = true }
  }, [kind, cooperative.id])
  return rows
}
