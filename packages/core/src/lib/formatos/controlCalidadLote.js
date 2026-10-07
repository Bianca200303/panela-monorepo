import * as XLSX from 'xlsx'
import { loteLabel } from '../loteHelpers'
import { PRINT_STYLES, fmtNum, buildFirmasHTML, buildOrdenHeaderHTML, quickDocFileName, escapeHtml } from './shared'
import { getLoteLabel } from '../labels'
import { fetchOrderCertNames } from './registroTrazabilidad'

// Ahora vive en packages/core -- ya no puede importar un COOPERATIVE fijo
// (ver plan de migración a monorepo), así que isLiberacion/el título pasan
// a depender de un parámetro `cooperative` explícito en vez de un módulo
// con un solo valor fijo.
//
// CAES (cooperative.features.liberacionProductoTerminado): este documento
// pasa a ser "Control y Liberación de Producto Terminado" (papel real
// CAESP-PP-BPM-RE-LPT-001) -- Color/Sabor/Textura se reemplazan por
// Unidades por lote, Formato/Presentación, Muestreado por y Resultado
// (C/NC). Decidido con el usuario 2026-09-13.
function isLiberacion(cooperative) {
  return !!cooperative?.features?.liberacionProductoTerminado
}

export function getFormatTitleControlCalidadLote(cooperative) {
  return isLiberacion(cooperative)
    ? 'CONTROL Y LIBERACIÓN DE PRODUCTO TERMINADO'
    : `CONTROL DE CALIDAD POR ${getLoteLabel(cooperative).toUpperCase()}`
}

// Mismo encabezado que Orden de Producción (misma orden, mismos datos de
// contenedor/venta/fechas) -- order.plant_production_batches ya viene
// embebido en la query principal de OrdenesPage.jsx (con las columnas
// calidad_*/liberacion_* incluidas), así que tampoco hace falta consulta
// nueva de lotes aquí. Solo entran los lotes que ya tienen control de
// calidad registrado (calidad_registered_at no nulo). "Destino" = cliente
// de la orden (no hay un destino distinto por lote hoy).
export async function fetchControlCalidadLoteData(order) {
  const certNames = await fetchOrderCertNames(order.id)
  const destino = order?.plant_clients?.name ?? null
  const rows = (order.plant_production_batches ?? [])
    .filter(b => b.calidad_registered_at != null)
    .map(b => ({
      lote: loteLabel(b),
      humedadPct: b.calidad_humedad_pct,
      impurezasPct: b.calidad_impurezas_pct,
      color: b.calidad_color,
      sabor: b.calidad_sabor,
      textura: b.calidad_textura,
      unidadesPorLote: b.liberacion_unidades_por_lote,
      formatoPresentacion: b.liberacion_formato_presentacion,
      muestreadoPor: b.liberacion_muestreado_por,
      resultado: b.liberacion_resultado,
      formatoCodigo: b.liberacion_formato_codigo,
      destino,
      observaciones: b.calidad_observaciones,
    }))
  return { rows, certNames }
}

function resultadoLabel(r) {
  if (r === 'conforme') return 'Conforme'
  if (r === 'no_conforme') return 'No conforme'
  return '—'
}

export function buildPrintHTMLControlCalidadLote(cooperative, order, containerNumber, data, firmantes) {
  const LOTE_LABEL = getLoteLabel(cooperative, order)
  const { rows, certNames } = data
  const certText = certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : '—'
  const formatTitle = getFormatTitleControlCalidadLote(cooperative)

  const bodyRows = rows.map(r => isLiberacion(cooperative) ? `
    <tr>
      <td style="white-space:nowrap">${r.lote}</td>
      <td style="font-size:10px;font-family:monospace">${escapeHtml(r.formatoCodigo) ?? '—'}</td>
      <td style="text-align:right">${fmtNum(r.humedadPct)}</td>
      <td style="text-align:right">${fmtNum(r.impurezasPct, 4)}</td>
      <td style="text-align:right">${r.unidadesPorLote ?? '—'}</td>
      <td>${escapeHtml(r.formatoPresentacion) ?? '—'}</td>
      <td>${escapeHtml(r.muestreadoPor) ?? '—'}</td>
      <td>${resultadoLabel(r.resultado)}</td>
      <td style="font-size:10px">${escapeHtml(r.observaciones) ?? ''}</td>
    </tr>` : `
    <tr>
      <td style="white-space:nowrap">${r.lote}</td>
      <td style="text-align:right">${fmtNum(r.humedadPct)}</td>
      <td style="text-align:right">${fmtNum(r.impurezasPct, 4)}</td>
      <td>${r.color ?? '—'}</td>
      <td>${r.sabor ?? '—'}</td>
      <td>${r.textura ?? '—'}</td>
      <td>${r.destino ?? '—'}</td>
      <td style="font-size:10px">${escapeHtml(r.observaciones) ?? ''}</td>
    </tr>`).join('')

  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_calidad_lote', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
  </style>
</head>
<body>
  ${buildOrdenHeaderHTML(cooperative, order, certText, formatTitle)}

  <table class="formato-table">
    <thead>
      ${isLiberacion(cooperative) ? `<tr>
        <th>Nro ${LOTE_LABEL}</th>
        <th>Código</th>
        <th>% Humedad</th>
        <th>% Impurezas</th>
        <th>Unidades por lote</th>
        <th>Formato / Presentación</th>
        <th>Muestreado por</th>
        <th>Resultado</th>
        <th style="text-align:left">Observación</th>
      </tr>` : `<tr>
        <th>Nro ${LOTE_LABEL}</th>
        <th>% Humedad</th>
        <th>% Impurezas</th>
        <th>Color</th>
        <th>Sabor</th>
        <th>Textura</th>
        <th>Destino</th>
        <th style="text-align:left">Observación</th>
      </tr>`}
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function controlCalidadLotePdf(cooperative, order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlCalidadLote(cooperative, order, containerNumber, data, firmantes)
}

export function controlCalidadLoteExcel(cooperative, order, containerNumber, { rows, certNames }) {
  const LOTE_LABEL = getLoteLabel(cooperative, order)
  const certText = certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : ''
  const aoa = [
    [getFormatTitleControlCalidadLote(cooperative)],
    ['Contenedor N°:', order?.internal_container_number ?? ''],
    ['Producto:', order?.product ?? ''],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    ['Nº de venta:', order?.sale_number ?? ''],
    ['Nº orden producción:', order?.client_order_number ?? order?.order_code ?? ''],
    ['Certificación:', certText],
    ['Fecha inicio tamizado:', order?.tamizado_fecha_inicio ?? '', 'Fecha final tamizado:', order?.tamizado_fecha_fin ?? ''],
    ['Fecha inicio envasado:', order?.envasado_fecha_inicio ?? '', 'Fecha final envasado:', order?.envasado_fecha_fin ?? ''],
    ['Fecha de envío:', order?.fecha_envio ?? ''],
    [],
    isLiberacion(cooperative)
      ? [`Nro ${LOTE_LABEL}`, 'Código', '% Humedad', '% Impurezas', 'Unidades por lote', 'Formato / Presentación', 'Muestreado por', 'Resultado', 'Observación']
      : [`Nro ${LOTE_LABEL}`, '% Humedad', '% Impurezas', 'Color', 'Sabor', 'Textura', 'Destino', 'Observación'],
  ]
  for (const r of rows) {
    aoa.push(isLiberacion(cooperative)
      ? [r.lote, r.formatoCodigo ?? '', r.humedadPct, r.impurezasPct, r.unidadesPorLote ?? '', r.formatoPresentacion ?? '', r.muestreadoPor ?? '', resultadoLabel(r.resultado), r.observaciones ?? '']
      : [r.lote, r.humedadPct, r.impurezasPct, r.color ?? '', r.sabor ?? '', r.textura ?? '', r.destino ?? '', r.observaciones ?? ''])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `Control Calidad ${LOTE_LABEL}`.slice(0, 31))
  XLSX.writeFile(wb, `${quickDocFileName('control_calidad_lote', order, containerNumber)}.xlsx`)
}
