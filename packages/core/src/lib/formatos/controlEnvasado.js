import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { loteLabel } from '../loteHelpers'
import { PRINT_STYLES, fmtNum, quickDocFileName } from './shared'
import { getLoteLabel, getBunqueLabel } from '../labels'

export const FORMAT_TITLE_CONTROL_ENVASADO = 'CONTROL DEL ENVASADO'

// Formato físico COA-PPA-OIM-RG-002: una página por fecha de envasado, con un
// renglón por lote envasado ese día. El envasado es 1 registro por lote (no
// por bunque, ver EnvasadoModal.jsx), así que cada bloque agrupa los lotes
// de la orden cuyo envasado_registered_at cae en esa fecha. La certificación
// es del LOTE (batch_certs vive a nivel de lote, no de orden), por eso va
// como columna por renglón y no como un casillero único para todo el
// documento como en el papel físico.

export async function fetchControlEnvasadoData(order) {
  const { data: allBatches, error: batchesErr } = await supabase
    .from('plant_production_batches')
    .select(`
      id, batch_code, client_batch_number, packaging_type,
      envasado_turno, envasado_qq, envasado_descarte_barrido_kg,
      envasado_cajas_envasadas, envasado_cajas_descarte,
      envasado_bolsas_envasadas, envasado_sacos_envasados,
      envasado_bolsas_rechazo_metal, envasado_bolsas_descarte_fabrica,
      envasado_bolsas_descarte_sellado, envasado_bolsas_descarte_codificado,
      envasado_registered_at,
      plant_bunque_batch_allocations ( bunque:plant_batch_bunques ( bunque_number ) ),
      plant_product_catalog ( description ),
      plant_batch_certs ( batch_certs ( name ) )
    `)
    .eq('order_id', order.id)
  if (batchesErr) throw new Error(batchesErr.message)

  const batches = (allBatches ?? []).filter(b => b.envasado_registered_at != null)
  if (batches.length === 0) return { blocks: [] }

  const blocksByDate = {}
  for (const b of batches) {
    const dateKey = b.envasado_registered_at.slice(0, 10)
    ;(blocksByDate[dateKey] ??= []).push(b)
  }

  const blocks = Object.keys(blocksByDate).sort().map(dateKey => {
    const rows = blocksByDate[dateKey].map(b => {
      const isSaco = b.packaging_type === 'saco'
      const certNames = (b.plant_batch_certs ?? []).map(pc => pc.batch_certs?.name).filter(Boolean)
      return {
        turno: b.envasado_turno === 'tarde' ? 'Tarde' : 'Mañana',
        bunqueCode: (b.plant_bunque_batch_allocations ?? []).map(a => a.bunque?.bunque_number).filter(Boolean).join(', ') || '—',
        descripcionBolsa: b.plant_product_catalog?.description ?? '—',
        lote: loteLabel(b),
        certText: certNames.length > 0 ? certNames.join(' - ').toUpperCase() : '—',
        envasada_qq: b.envasado_qq,
        descarte_barrido_kg: b.envasado_descarte_barrido_kg,
        cajas_envasadas: b.envasado_cajas_envasadas,
        cajas_descarte: b.envasado_cajas_descarte,
        isSaco,
        empaque_envasadas: isSaco ? b.envasado_sacos_envasados : b.envasado_bolsas_envasadas,
        rechazo_metal: b.envasado_bolsas_rechazo_metal,
        descarte_fabrica: b.envasado_bolsas_descarte_fabrica,
        descarte_sellado: b.envasado_bolsas_descarte_sellado,
        descarte_codificado: b.envasado_bolsas_descarte_codificado,
      }
    })
    return {
      fecha: new Date(dateKey + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      rows,
    }
  })

  return { blocks }
}

function buildControlEnvasadoBlockHTML(cooperative, block) {
  const LOTE_LABEL = getLoteLabel(cooperative)
  const BUNQUE_LABEL = getBunqueLabel(cooperative)
  const hasDetector = cooperative?.features?.detectorMetales
  const bodyRows = block.rows.map(r => `
    <tr>
      <td style="text-align:center">${r.turno}</td>
      <td style="text-align:center;white-space:nowrap">${r.bunqueCode}</td>
      <td>${r.descripcionBolsa}</td>
      <td style="white-space:nowrap">${r.lote}</td>
      <td style="white-space:nowrap;font-size:9px">${r.certText}</td>
      <td style="text-align:right">${fmtNum(r.envasada_qq)}</td>
      <td style="text-align:right">${fmtNum(r.descarte_barrido_kg)}</td>
      <td style="text-align:right">${r.cajas_envasadas ?? '—'}</td>
      <td style="text-align:right">${r.cajas_descarte ?? '—'}</td>
      <td style="text-align:right">${r.empaque_envasadas ?? '—'}</td>
      ${hasDetector ? `<td style="text-align:right">${r.isSaco ? '—' : (r.rechazo_metal ?? '—')}</td>` : ''}
      <td style="text-align:right">${r.isSaco ? '—' : (r.descarte_fabrica ?? '—')}</td>
      <td style="text-align:right">${r.isSaco ? '—' : (r.descarte_sellado ?? '—')}</td>
      <td style="text-align:right">${r.isSaco ? '—' : (r.descarte_codificado ?? '—')}</td>
    </tr>`).join('')

  return `<div class="lote-block">
      <div class="lote-separator"><strong>Fecha: ${block.fecha}</strong></div>
      <table class="formato-table">
        <thead>
          <tr>
            <th rowspan="2">Turno</th>
            <th rowspan="2">${BUNQUE_LABEL}</th>
            <th rowspan="2" style="text-align:left">Descripción bolsa</th>
            <th rowspan="2">N° ${LOTE_LABEL}</th>
            <th rowspan="2">Certificación</th>
            <th colspan="2">Panela</th>
            <th colspan="2">Cajas</th>
            <th colspan="${hasDetector ? 5 : 4}">Bolsas / Sacos</th>
          </tr>
          <tr>
            <th>Envasada (QQ)</th>
            <th>Descarte por barrido (kg)</th>
            <th>Envasadas</th>
            <th>Descarte</th>
            <th>Envasadas</th>
            ${hasDetector ? '<th>Rechazo detector metales</th>' : ''}
            <th>Descarte fábrica</th>
            <th>Descarte sellado</th>
            <th>Descarte codificado</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`
}

export function buildPrintHTMLControlEnvasado(cooperative, order, containerNumber, data, firmantes) {
  const { blocks } = data

  const llenadoPor  = firmantes?.[0]?.nombre || '_______________________'
  const revisadoPor = firmantes?.[1]?.nombre || '_______________________'

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('control_envasado', order, containerNumber)}</title>
  <style>
    ${PRINT_STYLES}
    @page { size: landscape; }
    .formato-table th { font-size: 9px; }
    .formato-table td { font-size: 10px; }
  </style>
</head>
<body>
  <div class="formato-header">
    <div style="text-align:center;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${cooperative?.name ?? ''}</div>
      <div style="font-size:15px;font-weight:800;margin-top:4px;text-transform:uppercase">${FORMAT_TITLE_CONTROL_ENVASADO}</div>
    </div>
    <div class="formato-meta">
      <div><span class="meta-label">OP:</span> ${order?.client_order_number ?? order?.order_code ?? '—'}</div>
      <div><span class="meta-label">Contenedor N°:</span> ${order?.internal_container_number ?? '—'}</div>
      <div><span class="meta-label">Nº de venta:</span> ${order?.sale_number ?? '—'}</div>
    </div>
  </div>

  ${blocks.map(b => buildControlEnvasadoBlockHTML(cooperative, b)).join('')}

  <div style="margin-top:24px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;font-size:11px">
    <div><span class="meta-label">Llenado por:</span> ${llenadoPor}</div>
    <div><span class="meta-label">Revisado por:</span> ${revisadoPor}</div>
  </div>
</body>
</html>`
}

export function controlEnvasadoPdf(cooperative, order, containerNumber, data, firmantes) {
  return buildPrintHTMLControlEnvasado(cooperative, order, containerNumber, data, firmantes)
}

export function controlEnvasadoExcel(cooperative, order, containerNumber, { blocks }) {
  const LOTE_LABEL = getLoteLabel(cooperative)
  const BUNQUE_LABEL = getBunqueLabel(cooperative)
  const aoa = [
    ['CONTROL DEL ENVASADO'],
    ['OP:', order?.client_order_number ?? order?.order_code ?? ''],
    ['Contenedor N°:', order?.internal_container_number ?? ''],
    ['Nº de venta:', order?.sale_number ?? ''],
    [],
  ]
  const hasDetector = cooperative?.features?.detectorMetales
  const cols = [
    'Turno', BUNQUE_LABEL, 'Descripción bolsa', `N° ${LOTE_LABEL}`, 'Certificación',
    'Panela envasada (QQ)', 'Descarte por barrido (kg)',
    'Cajas envasadas', 'Cajas descarte',
    'Bolsas/Sacos envasadas', ...(hasDetector ? ['Rechazo detector metales'] : []), 'Descarte fábrica', 'Descarte sellado', 'Descarte codificado',
  ]

  for (const block of blocks) {
    aoa.push([`Fecha: ${block.fecha}`])
    aoa.push(cols)
    for (const r of block.rows) {
      aoa.push([
        r.turno, r.bunqueCode, r.descripcionBolsa, r.lote, r.certText,
        r.envasada_qq ?? '', r.descarte_barrido_kg ?? '',
        r.cajas_envasadas ?? '', r.cajas_descarte ?? '',
        r.empaque_envasadas ?? '',
        ...(hasDetector ? [r.isSaco ? '' : (r.rechazo_metal ?? '')] : []),
        r.isSaco ? '' : (r.descarte_fabrica ?? ''),
        r.isSaco ? '' : (r.descarte_sellado ?? ''),
        r.isSaco ? '' : (r.descarte_codificado ?? ''),
      ])
    }
    aoa.push([])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Control Envasado')
  XLSX.writeFile(wb, `${quickDocFileName('control_envasado', order, containerNumber)}.xlsx`)
}
