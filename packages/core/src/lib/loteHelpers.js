// Helpers puros sobre un lote de planta (plant_production_batches), usados
// por OrdenesPage.jsx, EmbarquePage.jsx, ReportesPage.jsx y BunquesPage.jsx.
// Viven aquí (y no en OrdenesPage.jsx) para que todos esos módulos puedan
// importarlos sin crear una dependencia circular entre ellos.

export const PACKAGING_TYPE_LABELS = { bolsa: 'Bolsa', saco: 'Saco' }

// Impurezas: algunas cooperativas lo anotan en % y otras en mg/kg -- son la
// misma magnitud a distinta escala (1% = 10000 mg/kg), así que en vez de
// pedir la unidad se cargan dos campos sincronizados (el que se tipea
// completa el otro por conversión exacta) y se guardan ambos. Usado por
// RecepcionPage.jsx (quality_evaluations) y CalidadEnvasadoModal.jsx
// (plant_production_batches) -- mismo par de columnas _pct/_mgkg en las
// dos tablas.
const MGKG_PER_PCT = 10000

export function pctToMgkg(pct) {
  if (pct === '' || pct == null || isNaN(Number(pct))) return ''
  return String(Math.round(Number(pct) * MGKG_PER_PCT * 100) / 100)
}

export function mgkgToPct(mgkg) {
  if (mgkg === '' || mgkg == null || isNaN(Number(mgkg))) return ''
  return String(Math.round(Number(mgkg) / MGKG_PER_PCT * 1000000) / 1000000)
}

// Fuente de verdad de si una orden es de venta Nacional: order.sale_type
// (elegido al crear la orden, ver OrdenesPage.jsx) -- NUNCA se infiere de
// si algún campo del contenedor está o no completado (booking, guía de
// transporte), porque eso puede estar simplemente sin llenar todavía en
// una orden de Exportación real, lo que la clasificaría mal como Nacional.
// Usado por EmbarquePage.jsx, ContainerCard.jsx y ordenSalida.js -- vive
// acá (no en cada archivo por separado) para que los tres compartan
// exactamente el mismo criterio, ver [[project_despacho_nacional_caes]].
export function isOrderNacional(cooperative, order) {
  return !!cooperative?.features?.ventaNacionalExportacion && order?.sale_type === 'nacional'
}

// Formatea una fecha "solo fecha" (columna date, ej. "2026-07-22") en hora
// local, y un timestamp completo (ej. filled_at) tal cual viene. Se movió
// aquí (antes vivía duplicada en OrdenesPage.jsx) al separar Órdenes de
// Embarque, para que ambas páginas la compartan sin duplicar.
export function formatDate(dateStr) {
  if (!dateStr) return '-'
  // Fechas "solo fecha" se parsean como medianoche UTC -- en una zona
  // horaria detrás de UTC (Perú, UTC-5) eso cae en el día anterior al
  // mostrarlo en hora local. Se fuerza a hora local agregando la hora
  // explícita, igual que ya hace fmtDate() en formatoUtils.js. Los
  // timestamps completos (que ya traen "T" y hora real) se dejan tal cual.
  const d = dateStr.includes('T') ? new Date(dateStr) : new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Kg de un lote pedido = cantidad de bolsas/sacos × kg por unidad.
// Las cajas son un dato de conteo logístico aparte, no aportan peso propio.
export function loteKg(pb) {
  return Number(pb.packaging_count ?? 0) * Number(pb.packaging_kg ?? 0)
}

// Identificador visible de un lote pedido: el N° que ingresó el usuario,
// con el código interno como respaldo si todavía no lo cargó.
export function loteLabel(pb) {
  return pb.client_batch_number || pb.batch_code
}

// Descripción corta del empaque de un lote pedido, para mostrar en listas/PDF.
export function packagingLabel(pb) {
  const unit = PACKAGING_TYPE_LABELS[pb.packaging_type] ?? pb.packaging_type ?? '—'
  const parts = []
  if (pb.boxes_count != null) parts.push(`${pb.boxes_count} caja(s)`)
  if (pb.packaging_count != null && pb.packaging_kg != null) {
    parts.push(`${pb.packaging_count} ${unit.toLowerCase()}(s) × ${pb.packaging_kg} kg`)
  }
  return parts.join(' · ') || '—'
}

// Tolerancia de comparación QQ<->kg: solo cubre imprecisión de punto
// flotante, no es una tolerancia de negocio (coincidencia exacta requerida).
const FLOAT_EPSILON_KG = 0.01

// El envasado registrado de un lote es válido solo si coincide EXACTO con lo
// planificado (QQ, cajas y bolsas/sacos). Se recalcula siempre a partir del
// plan actual -- no basta con `envasado_registered_at` -- porque el plan del
// lote (Editar lote) se puede seguir editando después de registrar el
// envasado, e incluso después de cerrarlo (status 'procesado'), lo que puede
// dejar un envasado antes válido ahora desalineado.
export function isEnvasadoOk(pb, kgPerQuintal) {
  const plannedKg = loteKg(pb)
  const envasadoQqKg = Number(pb.envasado_qq ?? 0) * kgPerQuintal
  const envasadoQqOk = pb.envasado_qq != null && Math.abs(envasadoQqKg - plannedKg) <= FLOAT_EPSILON_KG
  const envasadoCajasOk = pb.boxes_count == null || Number(pb.envasado_cajas_envasadas) === pb.boxes_count
  const envasadoEmpaqueOk = pb.packaging_type === 'bolsa'
    ? (pb.packaging_count == null || Number(pb.envasado_bolsas_envasadas) === pb.packaging_count)
    : pb.packaging_type === 'saco'
      ? (pb.packaging_count == null || Number(pb.envasado_sacos_envasados) === pb.packaging_count)
      : true
  return !!pb.envasado_registered_at && envasadoQqOk && envasadoCajasOk && envasadoEmpaqueOk
}

// El control de calidad no tiene un valor planificado contra el cual
// coincidir (a diferencia del envasado) -- simplemente exige que los datos
// medidos estén cargados. calidad_registered_at solo no alcanza porque el
// registro es editable y en teoría podría quedar a medio llenar si algún
// día se relaja la validación del modal.
//
// CAES (COOPERATIVE.features.liberacionProductoTerminado) no exige
// Color/Sabor/Textura -- su papel real ("Control y Liberación de Producto
// Terminado", LPT-001) no los pide, el requisito ahí es solo % Humedad y
// % Impurezas. Decidido con el usuario 2026-09-13.
export function isCalidadOk(cooperative, pb) {
  const base = !!pb.calidad_registered_at &&
    pb.calidad_humedad_pct != null &&
    pb.calidad_impurezas_pct != null
  if (cooperative?.features?.liberacionProductoTerminado) return base
  return base && !!pb.calidad_color && !!pb.calidad_sabor && !!pb.calidad_textura
}

// Bunques asignados a un lote de envasado, a partir del embed
// `plant_bunque_batch_allocations ( kg, bunque:plant_batch_bunques(...) )`
// -- desde la Fase 2 de [[project_bunques_tamizado]] un bunque es un
// recurso independiente de planta que puede repartir su resultado entre
// varios lotes (incluso de órdenes distintas), en vez de pertenecer a uno
// solo. Reproceso/descarte/merma/insumos son un agregado único medido por
// bunque (no separable físicamente por lote de salida) -- acá se le
// atribuye a ESTE lote la porción proporcional según su parte de los kg
// tamizados totales del bunque (allocated_kg / bunque.tamizada_kg), tanto
// en los totales (allocated_reproceso_kg, etc.) como fila por fila en los
// insumos (allocated_inputs), para que sumar entre todos los lotes a los
// que se repartió un bunque dé exactamente sus totales reales, sin doble
// conteo. `share === 1` (reparto completo a un solo lote) es el caso más
// común y de ahí en más el comportamiento es idéntico al modelo anterior.
export function loteBunques(pb) {
  return (pb.plant_bunque_batch_allocations ?? [])
    .map(a => {
      const b = a.bunque
      if (!b) return null
      const tam = Number(b.tamizada_kg ?? 0)
      const share = tam > 0 ? Number(a.kg) / tam : 0
      const inputs = b.plant_homogenization_inputs ?? []
      return {
        ...b,
        allocated_kg: Number(a.kg),
        allocated_reproceso_kg: Number(b.reproceso_kg ?? 0) * share,
        allocated_descarte_kg: Number(b.descarte_kg ?? 0) * share,
        allocated_merma_kg: Number(b.merma_kg ?? 0) * share,
        allocated_inputs: inputs.map(h => ({ ...h, quantity_kg: Number(h.quantity_kg) * share })),
        allocated_insumo_kg: inputs.reduce((s, h) => s + Number(h.quantity_kg ?? 0), 0) * share,
        share,
      }
    })
    .filter(Boolean)
}

// Fragmento de select de Supabase/PostgREST para traer, junto a un lote de
// envasado, los bunques que le fueron asignados (ver loteBunques arriba).
// Centralizado para no repetir el mismo embed anidado en cada query
// (OrdenesPage, EmbarquePage, ReportesPage, quickDocs).
export const BUNQUE_ALLOCATIONS_SELECT = `
            plant_bunque_batch_allocations (
              kg,
              bunque:plant_batch_bunques (
                id, bunque_number, tamizada_kg, reproceso_kg, descarte_kg, merma_kg, processed_at,
                plant_homogenization_inputs ( id, source_exit_item_id, quantity_kg )
              )
            )`
