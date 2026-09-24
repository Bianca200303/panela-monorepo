import * as XLSX from 'xlsx'
import { loteLabel, loteKg } from '../loteHelpers'
import { PRINT_STYLES, fmtNum, buildFirmasHTML, buildOrdenHeaderHTML, quickDocFileName } from './shared'
import { getLoteLabel } from '../labels'
import { fetchOrderCertNames } from './registroTrazabilidad'

export const FORMAT_TITLE_ORDEN_PRODUCCION = 'ORDEN DE PRODUCCIÓN'

// A diferencia de los otros documentos "por orden", aquí no hace falta ir a
// buscar datos de tamizado/envasado -- es un resumen de lo que ya está
// cargado en la orden y sus lotes pedidos. order.plant_production_batches ya
// viene embebido en la query principal de OrdenesPage.jsx, así que ni
// siquiera hace falta una consulta nueva para los lotes -- solo se pide la
// certificación (por lote, se agrega para toda la orden igual que en
// Trazabilidad/Homogenizado).
export async function fetchOrdenProduccionData(order, kgPerQuintal) {
  const certNames = await fetchOrderCertNames(order.id)
  const rows = (order.plant_production_batches ?? []).map(b => ({
    lote: loteLabel(b),
    vencimientoYear: b.best_before_date ? b.best_before_date.slice(0, 4) : null,
    description: b.description || null,
    cajas: b.boxes_count,
    bolsas: b.packaging_type === 'bolsa' ? b.packaging_count : null,
    sacos: b.packaging_type === 'saco' ? b.packaging_count : null,
    pallet: b.pallet_count,
    packagingType: b.packaging_type,
    packagingKg: b.packaging_kg,
    kg: loteKg(b),
  }))
  return { rows, certNames, kgPerQuintal }
}

export function buildPrintHTMLOrdenProduccion(cooperative, order, containerNumber, data, firmantes) {
  const LOTE_LABEL = getLoteLabel(cooperative)
  const { rows, certNames, kgPerQuintal } = data
  const certText = certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : '—'
  const hasPallets = cooperative?.features?.pallets

  const bodyRows = rows.map(r => `
    <tr>
      <td style="white-space:nowrap">${r.lote}</td>
      <td style="text-align:center">${r.vencimientoYear ?? '—'}</td>
      <td>${r.description ?? '—'}</td>
      <td style="text-align:right">${r.cajas ?? '—'}</td>
      <td style="text-align:right">${r.bolsas ?? '—'}</td>
      <td style="text-align:right">${r.sacos ?? '—'}</td>
      ${hasPallets ? `<td style="text-align:right">${r.pallet ?? '—'}</td>` : ''}
    </tr>`).join('')

  const totalCajas  = rows.reduce((s, r) => s + Number(r.cajas ?? 0), 0)
  const totalBolsas = rows.reduce((s, r) => s + Number(r.bolsas ?? 0), 0)
  const totalSacos  = rows.reduce((s, r) => s + Number(r.sacos ?? 0), 0)
  const totalPallet = rows.reduce((s, r) => s + Number(r.pallet ?? 0), 0)
  const totalKg     = rows.reduce((s, r) => s + r.kg, 0)

  // Desglose de bolsas/sacos por peso de empaque, y por descripción del
  // lote -- en la mayoría de los casos coinciden (1 sola combinación por
  // orden), pero se calcula por grupo real para cubrir órdenes que mezclan
  // presentaciones o descripciones distintas.
  const bolsaKgGroups = {}
  const sacoKgGroups = {}
  const descGroups = {}
  for (const r of rows) {
    if (r.packagingType === 'bolsa' && r.bolsas != null) {
      const kg = r.packagingKg ?? 0
      bolsaKgGroups[kg] = (bolsaKgGroups[kg] ?? 0) + Number(r.bolsas)
    }
    if (r.packagingType === 'saco' && r.sacos != null) {
      const kg = r.packagingKg ?? 0
      sacoKgGroups[kg] = (sacoKgGroups[kg] ?? 0) + Number(r.sacos)
    }
    if (r.description) {
      const g = (descGroups[r.description] ??= { bolsa: 0, saco: 0, kgBolsa: null, kgSaco: null })
      if (r.packagingType === 'bolsa' && r.bolsas != null) { g.bolsa += Number(r.bolsas); g.kgBolsa = r.packagingKg }
      if (r.packagingType === 'saco' && r.sacos != null) { g.saco += Number(r.sacos); g.kgSaco = r.packagingKg }
    }
  }
  const breakdownLines = [
    ...Object.entries(bolsaKgGroups).map(([kg, total]) => `<div><span class="meta-label">Bolsas (${kg} Kg):</span> ${total}</div>`),
    ...Object.entries(sacoKgGroups).map(([kg, total]) => `<div><span class="meta-label">Sacos (${kg} Kg):</span> ${total}</div>`),
    ...Object.entries(descGroups).flatMap(([desc, g]) => [
      g.bolsa > 0 ? `<div><span class="meta-label">Bolsas ${desc} (${g.kgBolsa ?? 0} Kg):</span> ${g.bolsa}</div>` : '',
      g.saco > 0  ? `<div><span class="meta-label">Sacos ${desc} (${g.kgSaco ?? 0} Kg):</span> ${g.saco}</div>`  : '',
    ]),
  ].filter(Boolean).join('')

  const firmasHTML = buildFirmasHTML(firmantes)

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${quickDocFileName('orden_produccion', order, containerNumber)}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  ${buildOrdenHeaderHTML(cooperative, order, certText, FORMAT_TITLE_ORDEN_PRODUCCION)}

  <table class="formato-table">
    <thead>
      <tr>
        <th>Nro ${LOTE_LABEL}</th>
        <th>Fecha Vencimiento</th>
        <th style="text-align:left">Descripción</th>
        <th>Cajas</th>
        <th>Bolsas</th>
        <th>Sacos</th>
        ${hasPallets ? '<th>Pallet</th>' : ''}
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right">Totales:</td>
        <td style="text-align:right">${totalCajas}</td>
        <td style="text-align:right">${totalBolsas}</td>
        <td style="text-align:right">${totalSacos}</td>
        ${hasPallets ? `<td style="text-align:right">${totalPallet}</td>` : ''}
      </tr>
    </tfoot>
  </table>

  <div style="display:flex;gap:24px;margin-top:14px;flex-wrap:wrap">
    <table class="formato-table" style="max-width:280px">
      <tbody>
        <tr><td>Toneladas</td><td style="text-align:right">${fmtNum(totalKg / 1000)}</td></tr>
        <tr><td>Kilogramos</td><td style="text-align:right">${fmtNum(totalKg)}</td></tr>
        <tr><td>Cajas</td><td style="text-align:right">${totalCajas}</td></tr>
        <tr><td>Quintales</td><td style="text-align:right">${fmtNum(kgPerQuintal > 0 ? totalKg / kgPerQuintal : 0)}</td></tr>
      </tbody>
    </table>
    ${breakdownLines ? `<div style="font-size:12px">${breakdownLines}</div>` : ''}
  </div>

  ${firmasHTML ? `<div class="formato-firmas">${firmasHTML}</div>` : ''}
</body>
</html>`
}

export function ordenProduccionPdf(cooperative, order, containerNumber, data, firmantes) {
  return buildPrintHTMLOrdenProduccion(cooperative, order, containerNumber, data, firmantes)
}

export function ordenProduccionExcel(cooperative, order, containerNumber, { rows, certNames, kgPerQuintal }) {
  const LOTE_LABEL = getLoteLabel(cooperative)
  const certText = certNames?.length > 0 ? certNames.join(' - ').toUpperCase() : ''
  const totalKg = rows.reduce((s, r) => s + r.kg, 0)
  const hasPallets = cooperative?.features?.pallets

  const aoa = [
    ['ORDEN DE PRODUCCIÓN'],
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
    [`Nro ${LOTE_LABEL}`, 'Fecha Vencimiento', 'Descripción', 'Cajas', 'Bolsas', 'Sacos', ...(hasPallets ? ['Pallet'] : [])],
  ]
  for (const r of rows) {
    aoa.push([r.lote, r.vencimientoYear ?? '', r.description ?? '', r.cajas ?? '', r.bolsas ?? '', r.sacos ?? '', ...(hasPallets ? [r.pallet ?? ''] : [])])
  }
  aoa.push([
    'Totales:', '', '',
    rows.reduce((s, r) => s + Number(r.cajas ?? 0), 0),
    rows.reduce((s, r) => s + Number(r.bolsas ?? 0), 0),
    rows.reduce((s, r) => s + Number(r.sacos ?? 0), 0),
    ...(hasPallets ? [rows.reduce((s, r) => s + Number(r.pallet ?? 0), 0)] : []),
  ])
  aoa.push([])
  aoa.push(['Toneladas', totalKg / 1000])
  aoa.push(['Kilogramos', totalKg])
  aoa.push(['Cajas', rows.reduce((s, r) => s + Number(r.cajas ?? 0), 0)])
  aoa.push(['Quintales', kgPerQuintal > 0 ? totalKg / kgPerQuintal : 0])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Orden de Producción')
  XLSX.writeFile(wb, `${quickDocFileName('orden_produccion', order, containerNumber)}.xlsx`)
}
