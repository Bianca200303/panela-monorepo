import Icon from './Icon'

// Aviso al crear/editar un lote (nacional o de exportación): cuántos kg de
// materia prima hay en stock en ese momento (v_plant_available_stock,
// kg_available), y si los kg planificados del lote lo superan. Es solo un
// aviso: no bloquea el guardado.
export default function LoteStockNotice({ stockItems, plannedKg }) {
  const stockKg = (stockItems ?? []).reduce((s, x) => s + Math.max(0, Number(x.kg_available ?? 0)), 0)
  const exceeds = plannedKg > 0 && plannedKg > stockKg + 0.01
  const tone = exceeds
    ? { background: 'var(--danger-bg-soft)', border: '1px solid var(--danger)', color: 'var(--danger)' }
    : { background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', color: 'var(--warning-text)' }

  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 12px', padding: '8px 10px', borderRadius: 8, fontSize: 13, ...tone }}>
      <Icon name="alertTriangle" size={15} />
      <span>
        Stock de materia prima disponible: <strong>{stockKg.toFixed(1)} kg</strong>
        {plannedKg > 0 && <> · Este lote: <strong>{plannedKg.toFixed(1)} kg</strong></>}
        {exceeds && <> — supera el stock disponible</>}
      </span>
    </div>
  )
}
