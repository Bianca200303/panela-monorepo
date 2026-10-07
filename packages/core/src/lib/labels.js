// Nombres del lote de envasado (plant_production_batches) y del bunque,
// configurables por cooperativa (ver features.loteLabel/bunqueLabel en
// config.js) -- CAES los llama "Lote de envasado"/"Lote de producción",
// el resto sigue con "Lote"/"Bunque". No aplica al "lote de campo" de
// Recepción/Calidad (materia prima del productor): ese es un concepto
// distinto y siempre se llama "Lote".
//
// Si la cooperativa vende nacional y exportación (features.loteLabelPorVenta),
// el nombre del lote depende de la orden: pasando la orden (o cualquier
// objeto con sale_type) se obtiene "Lote nacional"/"Lote de exportación";
// sin orden (listados generales, catálogos, reportes) o con una orden sin
// tipo de venta elegido todavía, queda el nombre neutro de features.loteLabel.
//
// El plural pluraliza las palabras hasta el primer "de" ("Lote de
// exportación" -> "Lotes de exportación", "Lote nacional" -> "Lotes
// nacionales"), que es la regla correcta en español para estas frases. Las
// versiones en minúscula son para cuando el nombre va en medio de una
// oración en vez de como etiqueta/título.
function pluralizeWord(word) {
  return /[aeiouáéó]$/i.test(word) ? `${word}s` : `${word}es`
}
function pluralize(label) {
  const words = label.split(' ')
  const deIdx = words.findIndex(w => w.toLowerCase() === 'de')
  const end = deIdx === -1 ? words.length : deIdx
  return words.map((w, i) => (i < end ? pluralizeWord(w) : w)).join(' ')
}

export function getLoteLabel(cooperative, order) {
  const porVenta = cooperative?.features?.loteLabelPorVenta
  if (porVenta && order?.sale_type === 'nacional') return porVenta.nacional
  if (porVenta && order?.sale_type === 'exportacion') return porVenta.exportacion
  return cooperative?.features?.loteLabel ?? 'Lote'
}
// Texto de la etiqueta de tipo de venta que acompaña a cada lote en
// listados que mezclan lotes de varias órdenes (ej. el reparto de un
// bunque). Vacío si la cooperativa no distingue nacional/exportación.
export function getVentaTag(cooperative, order) {
  if (!cooperative?.features?.loteLabelPorVenta) return ''
  if (order?.sale_type === 'nacional') return 'Nacional'
  if (order?.sale_type === 'exportacion') return 'Exportación'
  return ''
}
export function getLoteLabelLower(cooperative, order) {
  return getLoteLabel(cooperative, order).toLowerCase()
}
export function getLoteLabelPlural(cooperative, order) {
  return pluralize(getLoteLabel(cooperative, order))
}
export function getLoteLabelPluralLower(cooperative, order) {
  return getLoteLabelPlural(cooperative, order).toLowerCase()
}

export function getBunqueLabel(cooperative) {
  return cooperative?.features?.bunqueLabel ?? 'Bunque'
}
export function getBunqueLabelLower(cooperative) {
  return getBunqueLabel(cooperative).toLowerCase()
}
export function getBunqueLabelPlural(cooperative) {
  return pluralize(getBunqueLabel(cooperative))
}
export function getBunqueLabelPluralLower(cooperative) {
  return getBunqueLabelPlural(cooperative).toLowerCase()
}
