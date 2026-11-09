import { fetchOrigenMateriaPrimaData, buildPrintHTMLOrigenMateriaPrima, origenMateriaPrimaExcel } from './origenMateriaPrima'
import { fetchFcmtphOrdenData, fcmtphOrdenPdf, fcmtphOrdenExcel } from './fcmtph'
import { fetchFcpoOrdenData, fcpoOrdenPdf, fcpoOrdenExcel } from './fcpo'
import { fetchEstibaOrdenData, estibaOrdenPdf, estibaOrdenExcel } from './estiba'
import { fetchFqdOrdenData, fqdOrdenPdf, fqdOrdenExcel } from './fqd'
import { fetchFmehOrdenData, fmehOrdenPdf, fmehOrdenExcel } from './fmeh'
import { fetchFcclrOrdenData, fcclrOrdenPdf, fcclrOrdenExcel } from './fcclr'
import { fetchFldhOrdenData, fldhOrdenPdf, fldhOrdenExcel } from './fldh'
import { fetchFiaeOrdenData, fiaeOrdenPdf, fiaeOrdenExcel } from './fiae'
import { fetchFcpOrdenData, fcpOrdenPdf, fcpOrdenExcel } from './fcp'
import { fetchFseaOrdenData, fseaOrdenPdf, fseaOrdenExcel } from './fsea'

// Documentos de CAMPO por orden -- misma forma que las entradas de
// QUICK_DOCS (planta) para que QuickDocsModal los trate igual (vista
// previa, PDF, Excel, .zip). A diferencia de QUICK_DOCS, la lista es la
// misma para CAES y Norandino (el campo funciona igual en las dos), por eso
// vive en core y cada app la arma con su COOPERATIVE. Ver
// [[project_documentos_campo_por_orden]]: reemplaza la emisión por período
// de Reportes -> Formatos de Campo y el capítulo CAMPO del informe.
//
// Categorías: las mismas que tenía Formatos de Campo (FormatosPage.jsx).
export function buildFieldDocs(cooperative) {
  const entry = (key, label, category, fetchData, pdf, excel) => ({
    key,
    label,
    category,
    needsFirmantes: true,
    fetchData: order => fetchData(cooperative, order),
    buildPdfHtml: (order, containerNumber, data, firmantes) => pdf(cooperative, order, containerNumber, data, firmantes),
    buildExcel: (order, containerNumber, data) => excel(cooperative, order, containerNumber, data),
  })
  return [
    entry('origen_materia_prima', 'Origen de la Materia Prima', 'trazabilidad', fetchOrigenMateriaPrimaData, buildPrintHTMLOrigenMateriaPrima, origenMateriaPrimaExcel),
    entry('fcmptph', 'Control de Materia Prima, Producción, pH y Temperatura', 'bpm', fetchFcmtphOrdenData, fcmtphOrdenPdf, fcmtphOrdenExcel),
    entry('fcpo', 'Control de Personal Operario', 'bpm', fetchFcpoOrdenData, fcpoOrdenPdf, fcpoOrdenExcel),
    entry('fet', 'Inspección de Estiba y Transporte', 'bpm', fetchEstibaOrdenData, estibaOrdenPdf, estibaOrdenExcel),
    entry('fmeh', 'Mantenimiento de Equipos y Hornillas', 'bpm', fetchFmehOrdenData, fmehOrdenPdf, fmehOrdenExcel),
    entry('fcclr', 'Control de Cloro Libre Residual', 'hys', fetchFcclrOrdenData, fcclrOrdenPdf, fcclrOrdenExcel),
    entry('fldh', 'Limpieza y Desinfección', 'hys', fetchFldhOrdenData, fldhOrdenPdf, fldhOrdenExcel),
    entry('fiae', 'Inspección de Ambientes, Equipo y Personal', 'hys', fetchFiaeOrdenData, fiaeOrdenPdf, fiaeOrdenExcel),
    entry('fcp', 'Control de Plagas', 'hys', fetchFcpOrdenData, fcpOrdenPdf, fcpOrdenExcel),
    entry('fsea', 'Seguimiento de Enfermedades y Accidentes', 'hys', fetchFseaOrdenData, fseaOrdenPdf, fseaOrdenExcel),
    entry('fqd', 'Quejas y Devoluciones', 'calidad', fetchFqdOrdenData, fqdOrdenPdf, fqdOrdenExcel),
  ]
}
