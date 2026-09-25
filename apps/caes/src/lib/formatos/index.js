import { fetchOrdenProduccionData, ordenProduccionPdf, ordenProduccionExcel } from '@panela/core/lib/formatos/ordenProduccion'
import { fetchControlCalidadLoteData, controlCalidadLotePdf, controlCalidadLoteExcel } from '@panela/core/lib/formatos/controlCalidadLote'
import { fetchControlEnvasadoData, controlEnvasadoPdf, controlEnvasadoExcel } from '@panela/core/lib/formatos/controlEnvasado'
import { getLoteLabel } from '@panela/core/lib/labels'
import { COOPERATIVE } from '../config'
import { fetchRegistroTrazabilidad, registroTrazabilidadPdf, registroTrazabilidadExcel } from '@panela/core/lib/formatos/registroTrazabilidad'
import { fetchHomogenizadoTamizadoData, registroHomogenizadoTamizadoPdf, registroHomogenizadoTamizadoExcel } from '@panela/core/lib/formatos/homogenizadoTamizado'
import { fetchControlHigienePersonalCaesData, controlHigienePersonalCaesPdf, controlHigienePersonalCaesExcel } from './higienePersonalCaes'
import { fetchControlLimpiezaGeneralData, controlLimpiezaGeneralPdf, controlLimpiezaGeneralExcel } from './limpiezaGeneral'
import { fetchControlVerificacionLimpiezaData, controlVerificacionLimpiezaPdf, controlVerificacionLimpiezaExcel } from '@panela/core/lib/formatos/verificacionLimpieza'
import { fetchControlCloroResidualCaesData, controlCloroResidualCaesPdf, controlCloroResidualCaesExcel } from './cloroResidualCaes'
import { fetchControlPlagasCaesData, controlPlagasCaesPdf, controlPlagasCaesExcel } from './controlPlagasCaes'
import { fetchMonitoreoTamizadoCaesData, monitoreoTamizadoCaesPdf, monitoreoTamizadoCaesExcel } from './monitoreoTamizadoCaes'
import { fetchSelladoEnvasadoCaesData, selladoEnvasadoCaesPdf, selladoEnvasadoCaesExcel } from './selladoEnvasadoCaes'
import { fetchHermeticidadEnvasesCaesData, hermeticidadEnvasesCaesPdf, hermeticidadEnvasesCaesExcel } from './hermeticidadEnvasesCaes'
import { fetchCalibracionBalanzasCaesData, calibracionBalanzasCaesPdf, calibracionBalanzasCaesExcel } from './calibracionBalanzasCaes'
import { fetchTempHumedadAmbientesCaesData, tempHumedadAmbientesCaesPdf, tempHumedadAmbientesCaesExcel } from './tempHumedadAmbientesCaes'
import { fetchLavadoManosCaesData, lavadoManosCaesPdf, lavadoManosCaesExcel } from './lavadoManosCaes'
import { fetchPreparacionSolucionesCaesData, preparacionSolucionesCaesPdf, preparacionSolucionesCaesExcel } from './preparacionSolucionesCaes'
import { fetchManejoResiduosCaesData, manejoResiduosCaesPdf, manejoResiduosCaesExcel } from './manejoResiduosCaes'
import { fetchOrdenSalidaQuickDoc, ordenSalidaQuickDocPdf, ordenSalidaQuickDocExcel } from '@panela/core/lib/formatos/ordenSalida'
import { fetchPackingListQuickDoc, packingListQuickDocPdf, packingListQuickDocExcel } from '@panela/core/lib/formatos/packingList'
import { fetchPackingListNacionalCaesQuickDoc, packingListNacionalCaesQuickDocPdf, packingListNacionalCaesQuickDocExcel } from './packingListNacionalCaes'
import { fetchResumenTrazabilidadData, resumenTrazabilidadPdf, resumenTrazabilidadExcel } from './resumenTrazabilidad'

// Copia SOLO CAES de este registro (originalmente compartido en
// web-react/src/lib/formatos/index.js, ver plan de migración a monorepo) --
// se sacaron los módulos/entradas exclusivos de Norandino (Higiene, Limpieza
// Ambientes/Equipos, Cloro Residual, Plagas "clásicos", Inspección de
// Cuerpos Extraños) porque esos archivos ya no existen en esta app, viven en
// apps/norandino/. El filtro por feature flag que antes decidía cuál de los
// dos mostrar ya no hace falta -- acá solo existe la variante CAES.
//
// Orden = numeración de los formatos físicos de referencia (01.-, 02.-,
// 05.-, 06.-, 08.-, 09.-, 11.- a 16.-); Orden de Salida y Packing List no
// tienen número en esa serie (son documentos de logística/embarque), van al
// final.
const ALL_QUICK_DOCS = [
  {
    key: 'orden_produccion',
    label: 'Orden de Producción',
    category: 'bpm',
    needsFirmantes: true,
    fetchData: fetchOrdenProduccionData,
    buildPdfHtml: (order, containerNumber, data, firmantes) => ordenProduccionPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => ordenProduccionExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'registro_trazabilidad',
    label: 'Registro de Trazabilidad',
    category: 'bpm',
    needsFirmantes: true,
    fetchData: fetchRegistroTrazabilidad,
    buildPdfHtml: (order, containerNumber, data, firmantes) => registroTrazabilidadPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => registroTrazabilidadExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'registro_homogenizado_tamizado',
    label: 'Registro de Homogenizado y Tamizado',
    category: 'bpm',
    needsFirmantes: true,
    fetchData: fetchHomogenizadoTamizadoData,
    buildPdfHtml: (order, containerNumber, data, firmantes) => registroHomogenizadoTamizadoPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => registroHomogenizadoTamizadoExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'control_envasado',
    label: 'Control del Envasado',
    category: 'bpm',
    needsFirmantes: true,
    fetchData: fetchControlEnvasadoData,
    buildPdfHtml: (order, containerNumber, data, firmantes) => controlEnvasadoPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => controlEnvasadoExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'control_calidad_lote',
    label: `Control de Calidad por ${getLoteLabel(COOPERATIVE)}`,
    category: 'bpm',
    needsFirmantes: true,
    fetchData: fetchControlCalidadLoteData,
    buildPdfHtml: (order, containerNumber, data, firmantes) => controlCalidadLotePdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => controlCalidadLoteExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'control_higiene_personal_caes',
    label: 'Control de Higiene del Personal',
    category: 'hys',
    needsFirmantes: true,
    fetchData: fetchControlHigienePersonalCaesData,
    buildPdfHtml: controlHigienePersonalCaesPdf,
    buildExcel: controlHigienePersonalCaesExcel,
  },
  {
    key: 'control_limpieza_general',
    label: 'Control de Limpieza',
    category: 'hys',
    needsFirmantes: true,
    fetchData: fetchControlLimpiezaGeneralData,
    buildPdfHtml: controlLimpiezaGeneralPdf,
    buildExcel: controlLimpiezaGeneralExcel,
  },
  {
    key: 'control_verificacion_limpieza',
    label: 'Verificación del Programa de Limpieza y Sanitización',
    category: 'hys',
    needsFirmantes: true,
    // fetchData/buildPdfHtml: verificacionLimpieza.js vive en packages/core
    // (compartido, ya no conoce la cooperativa) -- se envuelve para
    // pasarle COOPERATIVE local, preservando la misma forma de llamada que
    // usa QuickDocsModal.jsx/InformeOrden.jsx para cualquier doc de esta
    // lista (fetchData(order, kgPerQuintal, batch, tipo), buildPdfHtml(order,
    // containerNumber, data, firmantes)).
    fetchData: (order, kgPerQuintal, batch, tipo) => fetchControlVerificacionLimpiezaData(COOPERATIVE, order, kgPerQuintal),
    buildPdfHtml: (order, containerNumber, data, firmantes) => controlVerificacionLimpiezaPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: controlVerificacionLimpiezaExcel,
  },
  {
    key: 'control_cloro_residual_caes',
    label: 'Control de Consumo de Cloro y Verificación de Cloro Residual',
    category: 'hys',
    needsFirmantes: true,
    fetchData: fetchControlCloroResidualCaesData,
    buildPdfHtml: controlCloroResidualCaesPdf,
    buildExcel: controlCloroResidualCaesExcel,
  },
  {
    key: 'control_plagas_caes',
    label: 'Control de Roedores e Insectos',
    category: 'hys',
    needsFirmantes: true,
    fetchData: fetchControlPlagasCaesData,
    buildPdfHtml: controlPlagasCaesPdf,
    buildExcel: controlPlagasCaesExcel,
  },
  {
    key: 'monitoreo_tamizado_caes',
    label: 'Monitoreo y Verificación del Tamizado (PCC)',
    category: 'bpm',
    needsFirmantes: true,
    fetchData: fetchMonitoreoTamizadoCaesData,
    buildPdfHtml: monitoreoTamizadoCaesPdf,
    buildExcel: monitoreoTamizadoCaesExcel,
  },
  {
    key: 'sellado_envasado_caes',
    label: 'Control de Sellado, Envasado y Empaque de Producto Terminado',
    category: 'bpm',
    needsFirmantes: true,
    fetchData: fetchSelladoEnvasadoCaesData,
    buildPdfHtml: selladoEnvasadoCaesPdf,
    buildExcel: selladoEnvasadoCaesExcel,
  },
  {
    key: 'hermeticidad_envases_caes',
    label: 'Control de Hermeticidad de Envases',
    category: 'bpm',
    needsFirmantes: true,
    fetchData: fetchHermeticidadEnvasesCaesData,
    buildPdfHtml: hermeticidadEnvasesCaesPdf,
    buildExcel: hermeticidadEnvasesCaesExcel,
  },
  {
    key: 'calibracion_balanzas_caes',
    label: 'Verificación Interna de Calibración de Balanzas',
    category: 'bpm',
    needsFirmantes: true,
    fetchData: fetchCalibracionBalanzasCaesData,
    buildPdfHtml: calibracionBalanzasCaesPdf,
    buildExcel: calibracionBalanzasCaesExcel,
  },
  {
    key: 'temp_humedad_ambientes_caes',
    label: 'Control de Temperatura y Humedad de Ambientes',
    category: 'bpm',
    needsFirmantes: true,
    fetchData: fetchTempHumedadAmbientesCaesData,
    buildPdfHtml: tempHumedadAmbientesCaesPdf,
    buildExcel: tempHumedadAmbientesCaesExcel,
  },
  {
    key: 'lavado_manos_caes',
    label: 'Lavado de Manos en la Operación de Tamizado',
    category: 'hys',
    needsFirmantes: true,
    fetchData: fetchLavadoManosCaesData,
    buildPdfHtml: lavadoManosCaesPdf,
    buildExcel: lavadoManosCaesExcel,
  },
  {
    key: 'preparacion_soluciones_caes',
    label: 'Control de Preparación de Soluciones',
    category: 'hys',
    needsFirmantes: true,
    fetchData: fetchPreparacionSolucionesCaesData,
    buildPdfHtml: preparacionSolucionesCaesPdf,
    buildExcel: preparacionSolucionesCaesExcel,
  },
  {
    key: 'manejo_residuos_caes',
    label: 'Manejo de Residuos',
    category: 'hys',
    needsFirmantes: true,
    fetchData: fetchManejoResiduosCaesData,
    buildPdfHtml: manejoResiduosCaesPdf,
    buildExcel: manejoResiduosCaesExcel,
  },
  {
    key: 'orden_salida',
    label: 'Orden de Salida de Productos',
    category: 'logistica',
    needsFirmantes: false,
    fetchData: (order) => fetchOrdenSalidaQuickDoc(COOPERATIVE, order),
    buildPdfHtml: (order, containerNumber, data, firmantes) => ordenSalidaQuickDocPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => ordenSalidaQuickDocExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'packing_list',
    label: 'Packing List',
    category: 'logistica',
    needsFirmantes: false,
    fetchData: (order) => fetchPackingListQuickDoc(COOPERATIVE, order),
    buildPdfHtml: (order, containerNumber, data, firmantes) => packingListQuickDocPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => packingListQuickDocExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'packing_list_nacional_caes',
    label: 'Packing List-Nacional',
    category: 'logistica',
    needsFirmantes: false,
    fetchData: fetchPackingListNacionalCaesQuickDoc,
    buildPdfHtml: packingListNacionalCaesQuickDocPdf,
    buildExcel: packingListNacionalCaesQuickDocExcel,
  },
  {
    key: 'resumen_trazabilidad',
    label: 'Resumen de Trazabilidad',
    category: 'logistica',
    needsFirmantes: true,
    needsLoteSelector: true,
    needsTipoSelector: true,
    fetchData: fetchResumenTrazabilidadData,
    buildPdfHtml: resumenTrazabilidadPdf,
    buildExcel: resumenTrazabilidadExcel,
  },
]

export const QUICK_DOCS = ALL_QUICK_DOCS.filter(d => {
  // ventaNacionalExportacion es siempre true para CAES -- se deja el
  // chequeo (en vez de listar packing_list_nacional_caes directo) porque
  // es la misma condición documentada en el original, no un dato inventado.
  if (d.key === 'packing_list_nacional_caes') return !!COOPERATIVE?.features?.ventaNacionalExportacion
  return true
})
