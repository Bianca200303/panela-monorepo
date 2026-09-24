import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, fmtDate, escapeHtml, yesNo } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_MONITOREO_TAMIZADO_CAES = 'MONITOREO Y VERIFICACIÓN DEL TAMIZADO (PCC)'

// Monitoreo y Verificación del Tamizado / PCC (CAESP-PP-BPM-RE-CPR-002) --
// SOLO CAES, ver COOPERATIVE.features.controlesPlantaCAES en
// lib/config.js. Registro plano por (fecha, lote) -- sin cabecera de
// control que agrupe varias filas, ver MonitoreoTamizadoCaesModal.jsx.
// El N° de lote del papel real es el LOTE DE ENVASADO (se decodificó el
// código DDD+YY+NNN -- día juliano+año+correlativo anual -- contra las
// fechas manuscritas del papel, y CPR-007 Hermeticidad de Envases,
// inequívocamente producto envasado, comparte los mismos códigos en las
// mismas fechas) -- mismo criterio que Sellado/Envasado (CPR-003) y
// Hermeticidad de Envases (CPR-007). Ver migración 20260916100000.
export const SIEVE_CHECK_ITEMS = [
  { code: 'sin_abolladuras', label: 'Sin abolladuras' },
  { code: 'sin_fisuras', label: 'Sin fisuras' },
  { code: 'sin_desgaste', label: 'Sin desgaste' },
  { code: 'sin_deformaciones', label: 'Sin deformaciones' },
  { code: 'sin_obstrucciones', label: 'Sin obstrucciones' },
]

// Filtra por los lotes (plant_batch_id) de la propia orden -- mismo
// criterio que selladoEnvasadoCaes.js.
export async function fetchMonitoreoTamizadoCaesData(order) {
  const batchIds = (order?.plant_production_batches ?? []).map(b => b.id)
  if (batchIds.length === 0) return { rows: [] }

  const { data, error } = await supabase
    .from('plant_sieve_monitoring_caes')
    .select('monitoring_date, lote_code, sin_abolladuras, sin_fisuras, sin_desgaste, sin_deformaciones, sin_obstrucciones, hubo_desviacion, causa_raiz, acciones_correctivas')
    .in('plant_batch_id', batchIds)
    .order('monitoring_date')
  if (error) throw new Error(error.message)

  return { rows: data ?? [] }
}

export function buildPrintHTMLMonitoreoTamizadoCaes(order, containerNumber, data, firmantes) {
  const { rows } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  const bodyRows = rows.map(r => `<tr>
      <td style="text-align:center;font-size:10px">${fmtDate(r.monitoring_date)}</td>
      <td style="font-size:10px">${escapeHtml(r.lote_code) ?? '—'}</td>
      ${SIEVE_CHECK_ITEMS.map(item => `<td style="text-align:center;font-size:10px">${r[item.code] ? '✓' : '✗'}</td>`).join('')}
      <td style="text-align:center;font-size:10px">${yesNo(r.hubo_desviacion)}</td>
      <td style="font-size:10px">${escapeHtml(r.causa_raiz) ?? ''}</td>
      <td style="font-size:10px">${escapeHtml(r.acciones_correctivas) ?? ''}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('monitoreo_tamizado_caes', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
    .formato-table th { font-size: 9px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${COOPERATIVE?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_MONITOREO_TAMIZADO_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${rows.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron registros de monitoreo del tamizado para los lotes de esta orden.</p>'
    : `<table class="formato-table" style="width:100%">
        <thead><tr>
          <th>Fecha</th><th>N° Lote</th>
          ${SIEVE_CHECK_ITEMS.map(item => `<th>${item.label}</th>`).join('')}
          <th>¿Desviación?</th><th style="text-align:left">Causa Raíz</th><th style="text-align:left">Acciones Correctivas</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>`}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function monitoreoTamizadoCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLMonitoreoTamizadoCaes(order, containerNumber, data, firmantes)
}

export function monitoreoTamizadoCaesExcel(order, containerNumber, { rows }) {
  const aoa = [
    [FORMAT_TITLE_MONITOREO_TAMIZADO_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
    ['Fecha', 'N° Lote', ...SIEVE_CHECK_ITEMS.map(i => i.label), '¿Desviación?', 'Causa Raíz', 'Acciones Correctivas'],
  ]
  for (const r of rows) {
    aoa.push([
      r.monitoring_date, r.lote_code ?? '',
      ...SIEVE_CHECK_ITEMS.map(item => r[item.code] ? 'OK' : 'X'),
      r.hubo_desviacion ? 'Sí' : 'No', r.causa_raiz ?? '', r.acciones_correctivas ?? '',
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Monitoreo Tamizado')
  XLSX.writeFile(wb, `${quickDocFileName('monitoreo_tamizado_caes', order, containerNumber)}.xlsx`)
}
