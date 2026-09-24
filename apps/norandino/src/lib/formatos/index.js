import { COOPERATIVE } from '../config'
import { fetchOrdenProduccionData, ordenProduccionPdf, ordenProduccionExcel } from '@panela/core/lib/formatos/ordenProduccion'
import { fetchControlCalidadLoteData, controlCalidadLotePdf, controlCalidadLoteExcel } from '@panela/core/lib/formatos/controlCalidadLote'
import { fetchControlEnvasadoData, controlEnvasadoPdf, controlEnvasadoExcel } from '@panela/core/lib/formatos/controlEnvasado'
import { getLoteLabel } from '@panela/core/lib/labels'
import { fetchRegistroTrazabilidad, registroTrazabilidadPdf, registroTrazabilidadExcel } from '@panela/core/lib/formatos/registroTrazabilidad'
import { fetchHomogenizadoTamizadoData, registroHomogenizadoTamizadoPdf, registroHomogenizadoTamizadoExcel } from '@panela/core/lib/formatos/homogenizadoTamizado'
import { fetchControlCuerposExtranosData, controlCuerposExtranosPdf, controlCuerposExtranosExcel } from './cuerposExtranos'
import { fetchControlSaludHigienePersonalData, controlSaludHigienePersonalPdf, controlSaludHigienePersonalExcel } from './saludHigienePersonal'
import { fetchControlLimpiezaAmbientesData, controlLimpiezaAmbientesPdf, controlLimpiezaAmbientesExcel } from './limpiezaAmbientes'
import { fetchControlLimpiezaEquiposData, controlLimpiezaEquiposPdf, controlLimpiezaEquiposExcel } from './limpiezaEquipos'
import { fetchControlVerificacionLimpiezaData, controlVerificacionLimpiezaPdf, controlVerificacionLimpiezaExcel } from '@panela/core/lib/formatos/verificacionLimpieza'
import { fetchControlCloroResidualData, controlCloroResidualPdf, controlCloroResidualExcel } from './cloroResidual'
import { fetchControlPlagasData, controlPlagasPdf, controlPlagasExcel } from './controlPlagas'
import { fetchOrdenSalidaQuickDoc, ordenSalidaQuickDocPdf, ordenSalidaQuickDocExcel } from '@panela/core/lib/formatos/ordenSalida'
import { fetchPackingListQuickDoc, packingListQuickDocPdf, packingListQuickDocExcel } from '@panela/core/lib/formatos/packingList'
import { fetchResumenTrazabilidadData, resumenTrazabilidadPdf, resumenTrazabilidadExcel } from './resumenTrazabilidad'

// Copia SOLO Norandino de este registro (originalmente compartido en
// web-react/src/lib/formatos/index.js, ver plan de migración a monorepo) --
// se sacaron los módulos/entradas exclusivos de CAES (Higiene, Cloro y
// Plagas "grilla mensual", Limpieza fusionada, Packing List-Nacional, y los
// 8 controles de Fase 2 sin equivalente acá) porque esos archivos ya no
// existen en esta app, viven en apps/caes/. El filtro por feature flag que
// antes decidía cuál de los dos mostrar ya no hace falta -- acá solo existe
// la variante Norandino.
//
// Orden = numeración de los formatos físicos de referencia (01.-, 02.-,
// 05.-, 06.-, 08.-, 09.-, 11.- a 16.-); Orden de Salida y Packing List no
// tienen número en esa serie (son documentos de logística/embarque), van al
// final.
export const QUICK_DOCS = [
  {
    key: 'orden_produccion',
    label: 'Orden de Producción',
    needsFirmantes: true,
    fetchData: fetchOrdenProduccionData,
    buildPdfHtml: (order, containerNumber, data, firmantes) => ordenProduccionPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => ordenProduccionExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'registro_trazabilidad',
    label: 'Registro de Trazabilidad',
    needsFirmantes: true,
    fetchData: fetchRegistroTrazabilidad,
    buildPdfHtml: (order, containerNumber, data, firmantes) => registroTrazabilidadPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => registroTrazabilidadExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'registro_homogenizado_tamizado',
    label: 'Registro de Homogenizado y Tamizado',
    needsFirmantes: true,
    fetchData: fetchHomogenizadoTamizadoData,
    buildPdfHtml: (order, containerNumber, data, firmantes) => registroHomogenizadoTamizadoPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => registroHomogenizadoTamizadoExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'control_envasado',
    label: 'Control del Envasado',
    needsFirmantes: true,
    fetchData: fetchControlEnvasadoData,
    buildPdfHtml: (order, containerNumber, data, firmantes) => controlEnvasadoPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => controlEnvasadoExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'control_calidad_lote',
    label: `Control de Calidad por ${getLoteLabel(COOPERATIVE)}`,
    needsFirmantes: true,
    fetchData: fetchControlCalidadLoteData,
    buildPdfHtml: (order, containerNumber, data, firmantes) => controlCalidadLotePdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => controlCalidadLoteExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'inspeccion_cuerpos_extranos',
    label: 'Inspección de Cuerpos Extraños',
    needsFirmantes: true,
    fetchData: fetchControlCuerposExtranosData,
    buildPdfHtml: controlCuerposExtranosPdf,
    buildExcel: controlCuerposExtranosExcel,
  },
  {
    key: 'control_salud_higiene_personal',
    label: 'Control de Salud e Higiene del Personal',
    needsFirmantes: true,
    fetchData: fetchControlSaludHigienePersonalData,
    buildPdfHtml: controlSaludHigienePersonalPdf,
    buildExcel: controlSaludHigienePersonalExcel,
  },
  {
    key: 'control_limpieza_ambientes',
    label: 'Control de Limpieza y Sanitización de Ambientes',
    needsFirmantes: true,
    fetchData: fetchControlLimpiezaAmbientesData,
    buildPdfHtml: controlLimpiezaAmbientesPdf,
    buildExcel: controlLimpiezaAmbientesExcel,
  },
  {
    key: 'control_limpieza_equipos',
    label: 'Control de Limpieza y Sanitización de Equipos - Utensilios',
    needsFirmantes: true,
    fetchData: fetchControlLimpiezaEquiposData,
    buildPdfHtml: controlLimpiezaEquiposPdf,
    buildExcel: controlLimpiezaEquiposExcel,
  },
  {
    key: 'control_verificacion_limpieza',
    label: 'Verificación del Programa de Limpieza y Sanitización',
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
    key: 'control_cloro_residual',
    label: 'Control de Cloro Residual',
    needsFirmantes: true,
    fetchData: fetchControlCloroResidualData,
    buildPdfHtml: controlCloroResidualPdf,
    buildExcel: controlCloroResidualExcel,
  },
  {
    key: 'control_plagas',
    label: 'Control de Plagas',
    needsFirmantes: true,
    fetchData: fetchControlPlagasData,
    buildPdfHtml: controlPlagasPdf,
    buildExcel: controlPlagasExcel,
  },
  {
    key: 'orden_salida',
    label: 'Orden de Salida de Productos',
    needsFirmantes: false,
    fetchData: (order) => fetchOrdenSalidaQuickDoc(COOPERATIVE, order),
    buildPdfHtml: (order, containerNumber, data, firmantes) => ordenSalidaQuickDocPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => ordenSalidaQuickDocExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'packing_list',
    label: 'Packing List',
    needsFirmantes: false,
    fetchData: (order) => fetchPackingListQuickDoc(COOPERATIVE, order),
    buildPdfHtml: (order, containerNumber, data, firmantes) => packingListQuickDocPdf(COOPERATIVE, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => packingListQuickDocExcel(COOPERATIVE, order, containerNumber, data),
  },
  {
    key: 'resumen_trazabilidad',
    label: 'Resumen de Trazabilidad',
    needsFirmantes: true,
    needsLoteSelector: true,
    needsTipoSelector: false,
    fetchData: fetchResumenTrazabilidadData,
    buildPdfHtml: resumenTrazabilidadPdf,
    buildExcel: resumenTrazabilidadExcel,
  },
]
