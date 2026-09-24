import { supabase } from '@panela/core/lib/supabase'

export const FORMAT_TITLE_TRANSPORT_UNIT_CONTROLS_CAES = 'CONTROL DE LA UNIDAD DE TRANSPORTE'

// Control de la Unidad de Transporte (CAESP-PP-BPM-RE-CUT-001) -- SOLO
// CAES, ver COOPERATIVE.features.ventaNacionalExportacion en config.js.
// Aplica a Nacional Y Exportación (un solo control reusable para cualquier
// tramo de transporte real, ver migración 20260916130000). Es "registro
// plano" por (fecha, contenedor) -- N registros por contenedor, 0 a muchos,
// sin cabecera de "control" que agrupe varias filas -- mismo criterio que
// MonitoreoTamizadoCaesModal.jsx/SelladoEnvasadoCaesModal.jsx, pero a nivel
// contenedor/despacho en vez de a nivel lote.
export const VEHICULO_CHECK_ITEMS = [
  { code: 'cuenta_soat', label: 'Cuenta con SOAT', goodValue: true },
  { code: 'cuenta_revision_tecnica', label: 'Cuenta con Revisión Técnica', goodValue: true },
  { code: 'cuenta_botiquin', label: 'Cuenta con Botiquín', goodValue: true },
  { code: 'cuenta_extintor', label: 'Cuenta con Extintor', goodValue: true },
  { code: 'vehiculo_limpio', label: 'Vehículo limpio', goodValue: true },
  { code: 'libre_olores_extranos', label: 'Libre de olores extraños', goodValue: true },
  { code: 'carga_en_buen_estado', label: 'Carga en buen estado', goodValue: true },
]

export const CARGA_CHECK_ITEMS = [
  { code: 'limpieza_carga_limpio', label: 'Condiciones de limpieza de la carga: limpio', goodValue: true },
  { code: 'transporto_otros_productos', label: '¿Transportó otros productos que puedan contaminar?', goodValue: false },
  { code: 'evidencia_combustible', label: '¿Evidencia de haber transportado combustible?', goodValue: false },
  { code: 'libre_fisuras', label: 'Vehículo libre de fisuras', goodValue: true },
]

export const HERMETICIDAD_LABELS = { B: 'Bueno', R: 'Regular', M: 'Malo' }
export const DESINFECCION_LABELS = { cloro: 'Cloro', alcohol: 'Alcohol' }

export async function fetchTransportUnitControlsCaesData(container) {
  const { data: controls, error } = await supabase
    .from('plant_transport_unit_controls_caes')
    .select('*, estibadores:plant_transport_unit_control_estibadores_caes(*)')
    .eq('container_id', container.id)
    .order('control_date')
  if (error) throw new Error(error.message)
  return { container, controls: controls ?? [] }
}
