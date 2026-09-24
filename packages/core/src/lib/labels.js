// Nombres del lote de envasado (plant_production_batches) y del bunque,
// configurables por cooperativa (ver features.loteLabel/bunqueLabel en
// config.js) -- CAES los llama "Lote de exportación"/"Lote de producción",
// el resto sigue con "Lote"/"Bunque". No aplica al "lote de campo" de
// Recepción/Calidad (materia prima del productor): ese es un concepto
// distinto y siempre se llama "Lote".
//
// El plural solo pluraliza la primera palabra ("Lote de exportación" ->
// "Lotes de exportación"), que es la regla correcta en español para estas
// frases. Las versiones en minúscula son para cuando el nombre va en medio
// de una oración en vez de como etiqueta/título.
function pluralize(label) {
  const [first, ...rest] = label.split(' ')
  return [`${first}s`, ...rest].join(' ')
}

export function getLoteLabel(cooperative) {
  return cooperative?.features?.loteLabel ?? 'Lote'
}
export function getLoteLabelLower(cooperative) {
  return getLoteLabel(cooperative).toLowerCase()
}
export function getLoteLabelPlural(cooperative) {
  return pluralize(getLoteLabel(cooperative))
}
export function getLoteLabelPluralLower(cooperative) {
  return getLoteLabelPlural(cooperative).toLowerCase()
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
