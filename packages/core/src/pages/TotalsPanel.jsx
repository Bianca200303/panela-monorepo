import { loteKg } from '../lib/loteHelpers'
import { useCooperative } from '../lib/cooperativeContext'
import Stat from '../components/Stat'
import Icon from '../components/Icon'

// Totales de los lotes pedidos de una orden: cajas, bolsas, sacos, pallets,
// toneladas, kg, quintales.
export default function TotalsPanel({ batches, kgPerQuintal, plannedKg, envasadoKg }) {
  const COOPERATIVE = useCooperative()
  const totalKg     = batches.reduce((s, b) => s + loteKg(b), 0)
  const totalBoxes  = batches.reduce((s, b) => s + Number(b.boxes_count ?? 0), 0)
  const totalBags   = batches.filter(b => b.packaging_type === 'bolsa').reduce((s, b) => s + Number(b.packaging_count ?? 0), 0)
  const totalSacks  = batches.filter(b => b.packaging_type === 'saco').reduce((s, b) => s + Number(b.packaging_count ?? 0), 0)
  const totalPallets = batches.reduce((s, b) => s + Number(b.pallet_count ?? 0), 0)
  const totalTon    = totalKg / 1000
  const totalQq     = kgPerQuintal > 0 ? totalKg / kgPerQuintal : 0

  const items = [
    { label: 'Cajas',     value: totalBoxes.toLocaleString('es-PE') },
    { label: 'Bolsas',    value: totalBags.toLocaleString('es-PE') },
    { label: 'Sacos',     value: totalSacks.toLocaleString('es-PE') },
    ...(COOPERATIVE?.features?.pallets ? [{ label: 'Pallets', value: totalPallets.toLocaleString('es-PE') }] : []),
    { label: 'Kg',        value: totalKg.toLocaleString('es-PE', { maximumFractionDigits: 1 }) },
    { label: 'Toneladas', value: totalTon.toLocaleString('es-PE', { maximumFractionDigits: 2 }) },
    { label: 'Quintales', value: totalQq.toLocaleString('es-PE', { maximumFractionDigits: 1 }) },
  ]

  const gapKg = plannedKg != null && envasadoKg != null ? plannedKg - envasadoKg : null
  const gapPct = gapKg != null && plannedKg > 0 ? (gapKg / plannedKg) * 100 : null

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
        <Icon name="clipboardCheck" size={13} />
        Totales agregados de la orden
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 6,
        padding: '8px 10px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8,
      }}>
        {items.map(it => (
          <Stat key={it.label} label={it.label} value={it.value} />
        ))}
      </div>
      {gapKg != null && Math.abs(gapKg) > 0.5 && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="alertTriangle" size={12} />
          Diferencia vs. planificado: {gapPct > 0 ? '-' : '+'}{Math.abs(gapPct).toFixed(1)}%
        </div>
      )}
    </div>
  )
}
