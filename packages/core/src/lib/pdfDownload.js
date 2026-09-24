import domtoimage from 'dom-to-image-more'
import { jsPDF } from 'jspdf'

// Genera un PDF real a partir de un documento HTML completo (el mismo HTML
// que ya arma cada doc.buildPdfHtml para la ventana de impresión / la vista
// previa) -- se renderiza en un iframe oculto para que <style> y el layout
// se apliquen igual que en la vista previa (mismo mecanismo que el iframe
// srcDoc de "Ver" en QuickDocsModal.jsx).
//
// PRUEBA (2026-08-23): antes usaba html2canvas (vía html2pdf.js) para
// "capturar" el documento ya renderizado, pero esa librería reimplementa el
// layout de CSS a su manera y no soporta bien Grid (.formato-meta) ni
// bordes colapsados (.formato-table) -- ambos usados en los 12 documentos,
// por eso salían desordenados/sin tabla. dom-to-image-more captura distinto:
// serializa el DOM dentro de un <svg><foreignObject>, así que es el propio
// navegador el que lo dibuja (la misma fidelidad que "Ver"), no una
// reimplementación. Sigue siendo una imagen rasterizada adentro del PDF
// (no texto vectorial) -- la paginación (cortar la imagen en hojas A4) se
// arma acá a mano porque html2pdf.js no aplica a este camino.
//
// Existe aparte de openPrintWindow() (formatoUtils.js) -- esa sigue siendo
// el camino para descargar UN documento (abre el diálogo de impresión del
// navegador, "Guardar como PDF" manual). Esta se usa para "Descargar todos"
// en QuickDocsModal.jsx, que arma un .zip con todos los PDFs sin que el
// usuario tenga que confirmar un diálogo por cada uno.
const IFRAME_WIDTH_PX = 1000
const PIXEL_RATIO = 2 // nitidez de la captura, igual que el scale:2 anterior

export function generatePdfBlob(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.left = '-10000px'
    iframe.style.top = '0'
    iframe.style.width = `${IFRAME_WIDTH_PX}px`
    // Alto de arranque chico -- se recalcula después de cargar según el
    // contenido real (ver abajo). Un alto fijo cortaba documentos largos
    // (Trazabilidad, Homogenizado, Control de Envasado) antes de capturarlos.
    iframe.style.height = '100px'
    document.body.appendChild(iframe)

    const cleanup = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe) }

    iframe.onload = async () => {
      try {
        const body = iframe.contentDocument.body
        const fullHeight = body.scrollHeight
        iframe.style.height = `${fullHeight}px`

        const canvas = await domtoimage.toCanvas(body, {
          width: IFRAME_WIDTH_PX,
          height: fullHeight,
          bgcolor: '#ffffff',
          pixelRatio: PIXEL_RATIO,
        })

        const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
        const pageWidthPt = pdf.internal.pageSize.getWidth()
        const pageHeightPt = pdf.internal.pageSize.getHeight()

        // El canvas se escala para que su ancho ocupe el ancho de la hoja;
        // de esa escala sale cuántos px de canvas entran por página, y con
        // eso se corta la imagen completa en tantas hojas como haga falta
        // (en vez de una sola imagen gigante apachurrada en una página).
        const scale = pageWidthPt / canvas.width
        const pageHeightPx = pageHeightPt / scale
        const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightPx))

        for (let page = 0; page < totalPages; page++) {
          if (page > 0) pdf.addPage()
          const sliceHeightPx = Math.min(pageHeightPx, canvas.height - page * pageHeightPx)
          const pageCanvas = document.createElement('canvas')
          pageCanvas.width = canvas.width
          pageCanvas.height = sliceHeightPx
          pageCanvas.getContext('2d').drawImage(
            canvas,
            0, page * pageHeightPx, canvas.width, sliceHeightPx,
            0, 0, canvas.width, sliceHeightPx
          )
          pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidthPt, sliceHeightPx * scale)
        }

        cleanup()
        resolve(pdf.output('blob'))
      } catch (err) {
        cleanup()
        reject(err)
      }
    }
    iframe.srcdoc = html
  })
}

// Dispara la descarga de un Blob (ej. el .zip armado con JSZip) como si
// fuera un link normal -- la app corre en el navegador del usuario, no en
// el sandbox de un Artifact, así que un <a download> funciona sin problema.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// El nombre de archivo sale del propio <title> del HTML en vez de pedirlo
// como parámetro aparte: cada builder en lib/formatos/*.js ya arma un
// <title> con el nombre correcto (código de formato, o
// quickDocFileName(...) para los Documentos rápidos) porque lo necesita
// para imprimir -- reusarlo evita una segunda fuente de verdad que se
// pueda desincronizar del título real del documento.
function titleFromHtml(html) {
  return html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? 'documento'
}

// Descarga UN documento como PDF real y directo, sin pasar por la pestaña
// de impresión del navegador -- mismo pipeline que "Descargar todos" en
// QuickDocsModal.jsx (generatePdfBlob + downloadBlob), para no tener dos
// caminos distintos que generen el mismo PDF de formas distintas.
//
// No reemplaza a openPrintWindow() (shared.js): esa sigue siendo el camino
// para los botones "Imprimir" del historial, que sí necesitan el diálogo
// real del navegador (para elegir impresora, no solo para guardar).
export async function downloadPdfDocument(html) {
  const blob = await generatePdfBlob(html)
  downloadBlob(blob, `${titleFromHtml(html)}.pdf`)
}
