import * as XLSX from 'xlsx'
import { supabase } from '@panela/core/lib/supabase'
import { COOPERATIVE } from '../config'
import { PRINT_STYLES, buildFirmasHTML, quickDocFileName, fmtDate, escapeHtml } from '@panela/core/lib/formatos/shared'

export const FORMAT_TITLE_SELLADO_ENVASADO_CAES = 'CONTROL DE SELLADO, ENVASADO Y EMPAQUE DE PRODUCTO TERMINADO'

// Control de Sellado, Envasado y Empaque de Producto Terminado
// (CAESP-PP-BPM-RE-CPR-003) -- SOLO CAES, ver
// COOPERATIVE.features.controlesPlantaCAES en lib/config.js. Registro
// plano por (fecha, hora, lote) -- ver SelladoEnvasadoCaesPage.jsx.
export const SEAL_CHECK_ITEMS = [
  { code: 'materias_extranas_ok', label: 'Materias extrañas' },
  { code: 'sellado_costura_ok', label: 'Sellado / Costura' },
  { code: 'peso_completo_ok', label: 'Peso completo' },
  { code: 'fecha_vencimiento_ok', label: 'Fecha de vencimiento completa y legible' },
  { code: 'lote_legible_ok', label: 'N° Lote completo y legible' },
  { code: 'limpieza_envase_ok', label: 'Limpieza e integridad de envase' },
]

export const DESTINO_LABELS = { nacional: 'Nacional', exportacion: 'Exportación' }

// Filtra por los lotes (plant_batch_id) de la propia orden -- antes filtraba
// por rango de fechas de tamizado/envasado de la orden, lo que podía traer
// filas de OTRAS órdenes con fechas superpuestas (mismo destino/rango en
// planta). plant_batch_id existe desde la migración 20260913280000
// (cuando el registro pasó a ser por lote) pero el fetch nunca se había
// actualizado para usarlo.
export async function fetchSelladoEnvasadoCaesData(order) {
  const batchIds = (order?.plant_production_batches ?? []).map(b => b.id)
  if (batchIds.length === 0) return { rows: [] }

  const { data, error } = await supabase
    .from('plant_packaging_seal_control_caes')
    .select('control_date, control_time, presentacion, lote_code, destino, cliente, materias_extranas_ok, sellado_costura_ok, peso_completo_ok, fecha_vencimiento_ok, lote_legible_ok, limpieza_envase_ok, observaciones, acciones_correctivas, formato_codigo')
    .in('plant_batch_id', batchIds)
    .order('control_date')
  if (error) throw new Error(error.message)

  return { rows: data ?? [] }
}

export function buildPrintHTMLSelladoEnvasadoCaes(order, containerNumber, data, firmantes) {
  const { rows } = data
  const clientName = order?.plant_clients?.name ?? '—'
  const firmasHTML = buildFirmasHTML(firmantes)

  const bodyRows = rows.map(r => `<tr>
      <td style="text-align:center;font-size:9px">${fmtDate(r.control_date)}</td>
      <td style="text-align:center;font-size:9px">${r.control_time ?? '—'}</td>
      <td style="font-size:9px;font-family:monospace">${escapeHtml(r.formato_codigo) ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(r.presentacion) ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(r.lote_code) ?? '—'}</td>
      <td style="text-align:center;font-size:9px">${DESTINO_LABELS[r.destino] ?? '—'}</td>
      <td style="font-size:9px">${escapeHtml(r.cliente) ?? '—'}</td>
      ${SEAL_CHECK_ITEMS.map(item => `<td style="text-align:center;font-size:9px">${r[item.code] ? 'C' : 'NC'}</td>`).join('')}
      <td style="font-size:9px">${escapeHtml(r.observaciones) ?? ''}</td>
      <td style="font-size:9px">${escapeHtml(r.acciones_correctivas) ?? ''}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('sellado_envasado_caes', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
    .formato-table th { font-size: 8px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${COOPERATIVE?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_SELLADO_ENVASADO_CAES}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">Planta:</span> Panela</div>
      <div><span class="meta-label">Ref:</span> ${order?.client_order_number ?? order?.order_code ?? '—'} / ${containerNumber ?? '—'}</div>
      <div><span class="meta-label">Cliente:</span> ${clientName}</div>
    </div>
  </div>

  ${rows.length === 0
    ? '<p style="font-size:12px;margin-top:10px">No se encontraron registros de sellado/envasado/empaque en el rango de fechas de trabajo de esta orden.</p>'
    : `<div style="overflow-x:auto"><table class="formato-table" style="min-width:100%">
        <thead><tr>
          <th>Fecha</th><th>Hora</th><th>Código</th><th>Presentación</th><th>N° Lote</th><th>Destino</th><th>Cliente</th>
          ${SEAL_CHECK_ITEMS.map(item => `<th>${item.label}</th>`).join('')}
          <th style="text-align:left">Observaciones</th><th style="text-align:left">Acción Correctiva</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table></div>
      <p style="font-size:9px;margin:4px 0 0;color:#555">C: Conforme &nbsp;&nbsp; NC: No conforme</p>`}

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function selladoEnvasadoCaesPdf(order, containerNumber, data, firmantes) {
  return buildPrintHTMLSelladoEnvasadoCaes(order, containerNumber, data, firmantes)
}

export function selladoEnvasadoCaesExcel(order, containerNumber, { rows }) {
  const aoa = [
    [FORMAT_TITLE_SELLADO_ENVASADO_CAES],
    ['Planta:', 'Panela'],
    ['Ref:', `${order?.client_order_number ?? order?.order_code ?? ''} / ${containerNumber ?? ''}`],
    ['Cliente:', order?.plant_clients?.name ?? ''],
    [],
    ['Fecha', 'Hora', 'Código', 'Presentación', 'N° Lote', 'Destino', 'Cliente', ...SEAL_CHECK_ITEMS.map(i => i.label), 'Observaciones', 'Acción Correctiva'],
  ]
  for (const r of rows) {
    aoa.push([
      r.control_date, r.control_time ?? '', r.formato_codigo ?? '', r.presentacion ?? '', r.lote_code ?? '', DESTINO_LABELS[r.destino] ?? '', r.cliente ?? '',
      ...SEAL_CHECK_ITEMS.map(item => r[item.code] ? 'C' : 'NC'),
      r.observaciones ?? '', r.acciones_correctivas ?? '',
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sellado Envasado')
  XLSX.writeFile(wb, `${quickDocFileName('sellado_envasado_caes', order, containerNumber)}.xlsx`)
}
