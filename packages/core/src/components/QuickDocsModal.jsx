import { useState, useEffect } from 'react'
import JSZip from 'jszip'
import { quickDocFileName, docFileId } from '../lib/formatos/shared'
import { generatePdfBlob, downloadBlob, downloadPdfDocument } from '../lib/pdfDownload'
import { useCooperative } from '../lib/cooperativeContext'
import { loteLabel, isOrderNacional } from '../lib/loteHelpers'
import { getLoteLabel, getLoteLabelPluralLower } from '../lib/labels'

// Agrupación visual de la lista por categoría (category en cada entrada de
// QUICK_DOCS, ver lib/formatos/index.js de cada app) -- mismo criterio y
// mismos nombres completos que usa ControlesPage.jsx para sus tabs BPM/HYS,
// más "logistica" para los documentos que no son ni control de proceso ni
// de higiene (Orden de Salida, Packing List, Resumen de Trazabilidad).
const CATEGORY_LABELS = {
  bpm:       'Buenas Prácticas de Manufactura',
  hys:       'Higiene y Saneamiento',
  logistica: 'Logística y Trazabilidad',
}
const CATEGORY_ORDER = ['bpm', 'hys', 'logistica']

// Documentos rápidos por orden -- no son "formatos" oficiales (esos viven en
// la sección Formatos, con código correlativo propio). Se arman al vuelo con
// datos que ya existen en el sistema, para bajar directo desde la card de la
// orden sin tener que ir a buscarlos a otro lado. Hoy hay 1 (Registro de
// Trazabilidad); la lista crece agregando entradas a QUICK_DOCS, sin tocar
// este modal.
//
// initialDocKey/initialBatch: entrada directa a un documento puntual sin
// pasar por la lista (ej. el botón "Resumen de trazabilidad" de cada lote en
// Órdenes) -- salta también el selector de lote porque ya se sabe cuál es.
// quickDocs: lista QUICK_DOCS de la app que llama (ya no un import fijo --
// cada cooperativa tiene su propia lista, ver lib/formatos/index.js de
// apps/caes y apps/norandino).
export default function QuickDocsModal({ order, containerNumber, kgPerQuintal, initialDocKey, initialBatch, onClose, quickDocs }) {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL = getLoteLabel(COOPERATIVE)
  const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE)
  const QUICK_DOCS = quickDocs
  const [docKey, setDocKey] = useState(null)
  const [docData, setDocData] = useState(null)
  const [firmantes, setFirmantes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null) // { current, total, label }
  const [bulkResult, setBulkResult] = useState('')
  const [pdfGenerating, setPdfGenerating] = useState(false)

  // Selector de lote: solo lo usan los documentos con needsLoteSelector
  // (hoy, Resumen de Trazabilidad) -- ver quickDocs.js. Con
  // un solo lote en la orden se autoselecciona sin mostrar nada.
  const [pendingLoteDoc, setPendingLoteDoc] = useState(null) // key del doc esperando que se elija el lote

  // Selector de tipo (needsTipoSelector, hoy solo Resumen de Trazabilidad):
  // CAES tiene formatos distintos para venta Nacional y para Exportación.
  // Si la orden ya tiene order.sale_type guardado (elegido al crearla, ver
  // OrdenesPage.jsx) se usa directo sin preguntar -- esto solo queda como
  // fallback para órdenes viejas creadas antes de que existiera ese campo.
  const [pendingTipoDoc, setPendingTipoDoc] = useState(null) // { key, batch } esperando que se elija el tipo

  const doc = QUICK_DOCS.find(d => d.key === docKey)
  const batches = order?.plant_production_batches ?? []

  // QUICK_DOCS es una lista fija por cooperativa (no sabe de qué orden se
  // trata) -- Packing List (exportación) y Packing List-Nacional conviven
  // ahí para toda venta CAES, pero solo uno de los dos aplica según
  // order.sale_type. Antes el que no aplicaba tiraba error recién al
  // abrirlo (fetchData lo rechazaba); ahora se saca directo de la lista.
  const applicableDocs = QUICK_DOCS.filter(d => {
    if (d.key === 'packing_list') return !isOrderNacional(COOPERATIVE, order)
    if (d.key === 'packing_list_nacional_caes') return isOrderNacional(COOPERATIVE, order)
    return true
  })

  const loadDoc = async (key, batch, tipo) => {
    setError('')
    setDocKey(key)
    setDocData(null)
    setFirmantes([])
    setShowPreview(false)
    setPendingLoteDoc(null)
    setPendingTipoDoc(null)
    setLoading(true)
    try {
      const d = QUICK_DOCS.find(x => x.key === key)
      const data = await d.fetchData(order, kgPerQuintal, batch, tipo)
      setDocData(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Punto intermedio entre "ya sé el lote" y "cargar el documento": si el
  // doc necesita tipo (Nacional/Exportación) lo pregunta antes de cargar.
  const chooseLote = (key, batch) => {
    const d = QUICK_DOCS.find(x => x.key === key)
    if (d.needsTipoSelector) {
      if (order?.sale_type) {
        loadDoc(key, batch, order.sale_type)
        return
      }
      setError('')
      setDocKey(key)
      setPendingLoteDoc(null)
      setPendingTipoDoc({ key, batch })
      return
    }
    loadDoc(key, batch)
  }

  const openDoc = async (key) => {
    const d = QUICK_DOCS.find(x => x.key === key)
    if (d.needsLoteSelector && batches.length > 1) {
      setError('')
      setDocKey(key)
      setPendingLoteDoc(key)
      return
    }
    chooseLote(key, batches[0])
  }

  useEffect(() => {
    if (initialDocKey) chooseLote(initialDocKey, initialBatch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDocKey, initialBatch])

  const addFirmante    = () => setFirmantes(prev => [...prev, { nombre: '', cargo: '' }])
  const updateFirmante = (i, field, value) => setFirmantes(prev => prev.map((f, idx) => idx === i ? { ...f, [field]: value } : f))
  const removeFirmante = (i) => setFirmantes(prev => prev.filter((_, idx) => idx !== i))

  const handlePdf = async () => {
    setPdfGenerating(true)
    try {
      const html = doc.buildPdfHtml(order, containerNumber, docData, firmantes)
      await downloadPdfDocument(html)
    } catch (err) {
      setError(err.message)
    } finally {
      setPdfGenerating(false)
    }
  }

  const handleExcel = () => {
    doc.buildExcel(order, containerNumber, docData)
  }

  // Arma un .zip con los 12 documentos como PDFs reales, cada uno como su
  // propio archivo adentro (nunca un PDF combinado) -- una sola descarga en
  // vez de 12 ventanas/archivos sueltos. Mismo HTML que usa "Ver" para la
  // vista previa (vía generatePdfBlob, ver pdfDownload.js), así el diseño
  // de cada PDF sale igual al de la vista previa individual. No usa
  // firmantes (el modo manual por documento no aplica acá, sale con la
  // línea en blanco) ni openPrintWindow (ese depende de que el usuario
  // confirme el diálogo de impresión documento por documento). Si un
  // documento falla (ej. sin datos para esta orden), se salta y sigue con
  // el resto -- no corta el armado del zip.
  const handleDownloadAll = async () => {
    setBulkDownloading(true)
    setBulkResult('')
    const zip = new JSZip()
    const failed = []
    for (let i = 0; i < applicableDocs.length; i++) {
      const d = applicableDocs[i]
      setBulkProgress({ current: i + 1, total: applicableDocs.length, label: d.label })
      try {
        const data = await d.fetchData(order, kgPerQuintal)
        const html = d.buildPdfHtml(order, containerNumber, data, [])
        const blob = await generatePdfBlob(html)
        zip.file(`${quickDocFileName(d.key, order, containerNumber)}.pdf`, blob)
      } catch (err) {
        failed.push(`${d.label} (${err.message})`)
      }
    }
    if (Object.keys(zip.files).length > 0) {
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipBlob, `Documentos - ${docFileId(order, containerNumber)}.zip`)
    }
    setBulkDownloading(false)
    setBulkProgress(null)
    setBulkResult(
      failed.length === 0
        ? `Se descargaron los ${applicableDocs.length} documentos en un .zip.`
        : `Se armó el .zip con ${applicableDocs.length - failed.length} de ${applicableDocs.length}. No se pudieron generar: ${failed.join(', ')}.`
    )
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-body">
          <h3 style={{ margin: '0 0 4px' }}>Documentos de planta de envasado</h3>
          <p className="muted small" style={{ margin: '0 0 16px' }}>
            Orden {order?.client_order_number ?? order?.order_code}
          </p>

          {!doc && (
            <>
              <button
                className="btn primary"
                style={{ width: '100%', marginBottom: 10 }}
                onClick={handleDownloadAll}
                disabled={bulkDownloading}
              >
                {bulkDownloading
                  ? `Generando ${bulkProgress?.current}/${bulkProgress?.total} — ${bulkProgress?.label}...`
                  : 'Descargar todos (.zip)'}
              </button>
              {bulkResult && <p className="muted small" style={{ margin: '0 0 10px' }}>{bulkResult}</p>}
              {CATEGORY_ORDER.map(cat => {
                const docsInCat = applicableDocs.filter(d => d.category === cat)
                if (docsInCat.length === 0) return null
                return (
                  <div key={cat} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
                      {CATEGORY_LABELS[cat]}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {docsInCat.map(d => (
                        <button
                          key={d.key}
                          className="btn outline"
                          style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                          onClick={() => openDoc(d.key)}
                          disabled={bulkDownloading}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {doc && pendingLoteDoc && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 12px' }}>
                <strong style={{ fontSize: 14 }}>{doc.label}</strong>
                <button className="btn small outline" onClick={() => { setDocKey(null); setPendingLoteDoc(null) }}>‹ Volver</button>
              </div>
              <p className="muted small" style={{ margin: '0 0 10px' }}>Esta orden tiene {batches.length} {LOTE_LABEL_PLURAL_LOWER}. Seleccione cuál se está trazando.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {batches.map(b => (
                  <button
                    key={b.id}
                    className="btn outline"
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                    onClick={() => chooseLote(pendingLoteDoc, b)}
                  >
                    {LOTE_LABEL} {loteLabel(b)}{b.brand ? ` — ${b.brand}` : ''}
                  </button>
                ))}
              </div>
            </>
          )}

          {doc && pendingTipoDoc && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 12px' }}>
                <strong style={{ fontSize: 14 }}>{doc.label}</strong>
                <button className="btn small outline" onClick={() => { setDocKey(null); setPendingTipoDoc(null) }}>‹ Volver</button>
              </div>

              <p className="muted small" style={{ margin: '0 0 10px' }}>¿Esta venta es nacional o de exportación?</p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn outline" style={{ flex: 1 }} onClick={() => loadDoc(pendingTipoDoc.key, pendingTipoDoc.batch, 'nacional')}>Nacional</button>
                <button className="btn outline" style={{ flex: 1 }} onClick={() => loadDoc(pendingTipoDoc.key, pendingTipoDoc.batch, 'exportacion')}>Exportación</button>
              </div>
            </>
          )}

          {doc && !pendingLoteDoc && !pendingTipoDoc && loading && <p className="muted small">Cargando datos...</p>}
          {error && <p style={{ color: '#dc2626', fontSize: 14, margin: '4px 0' }}>{error}</p>}

          {doc && !pendingLoteDoc && !pendingTipoDoc && !loading && docData && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 12px' }}>
                <strong style={{ fontSize: 14 }}>{doc.label}</strong>
                <button className="btn small outline" onClick={() => { setDocKey(null); setDocData(null) }}>‹ Volver</button>
              </div>

              {doc.needsFirmantes && (
                <div className="card" style={{ marginBottom: 14, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Firmantes</div>
                    <button className="btn small outline" onClick={addFirmante}>+ Agregar</button>
                  </div>
                  {firmantes.length === 0 && <p className="muted small" style={{ margin: 0 }}>Sin firmantes agregados — el documento sale con la línea en blanco.</p>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {firmantes.map((f, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="text" placeholder="Nombre completo" value={f.nombre}
                          style={{ flex: 2, fontSize: 12, padding: '4px 8px' }}
                          onChange={e => updateFirmante(idx, 'nombre', e.target.value)}
                        />
                        <input
                          type="text" placeholder="Cargo" value={f.cargo}
                          style={{ flex: 2, fontSize: 12, padding: '4px 8px' }}
                          onChange={e => updateFirmante(idx, 'cargo', e.target.value)}
                        />
                        <button
                          onClick={() => removeFirmante(idx)}
                          style={{ padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#fee2e2', color: '#dc2626', fontWeight: 700 }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn outline" onClick={() => setShowPreview(v => !v)}>{showPreview ? 'Ocultar vista previa' : 'Ver'}</button>
                <button className="btn primary" onClick={handlePdf} disabled={pdfGenerating}>{pdfGenerating ? 'Generando...' : 'Descargar PDF'}</button>
                <button className="btn outline" onClick={handleExcel}>Descargar Excel</button>
              </div>

              {showPreview && (
                <iframe
                  title={doc.label}
                  srcDoc={doc.buildPdfHtml(order, containerNumber, docData, firmantes)}
                  style={{ width: '100%', height: 500, marginTop: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}
                />
              )}
            </>
          )}
        </div>
        <div className="modal-actions">
          <button
            className="btn small"
            onClick={() => { if (doc) { setDocKey(null); setDocData(null); setPendingLoteDoc(null); setPendingTipoDoc(null) } else { onClose() } }}
            disabled={bulkDownloading}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
