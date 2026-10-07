import { useCooperative } from '../lib/cooperativeContext'
import { getLoteLabelLower, getBunqueLabelLower } from '../lib/labels'

export default function TrazabilidadTable({ inputs, stockItems, processing, order }) {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE)
  const BUNQUE_LABEL_LOWER = getBunqueLabelLower(COOPERATIVE)
  const totalUsed = inputs.reduce((s, h) => s + Number(h.quantity_kg), 0)
  // `processing` viene de loteBunques(pb) -- ya trae la porción proporcional
  // atribuida a ESTE lote (allocated_*), distinta del total real del bunque
  // (tamizada_kg) si se repartió a más de un lote de envasado.
  const isSplit = processing != null && Math.abs(Number(processing.allocated_kg ?? 0) - Number(processing.tamizada_kg ?? 0)) > 0.01

  return (
    <div style={{ marginTop: 8, padding: '10px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8 }}>
      <div className="small" style={{ fontWeight: 600, marginBottom: 6, color: '#0369a1' }}>
        Trazabilidad completa — lotes de origen usados
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table small">
          <thead>
            <tr>
              <th>Lote origen</th>
              <th>Módulo</th>
              <th>Productor</th>
              <th>Kg usados</th>
              <th>% del total</th>
              <th>Humedad</th>
              <th>Color</th>
            </tr>
          </thead>
          <tbody>
            {inputs.map(h => {
              const src = stockItems.find(s => s.exit_item_id === h.source_exit_item_id)
              const pct = totalUsed > 0 ? (Number(h.quantity_kg) / totalUsed * 100).toFixed(1) : '—'
              return (
                <tr key={h.id ?? h.source_exit_item_id}>
                  <td><strong>{src?.comprobante_acopio ?? src?.guia_remision ?? h.source_exit_item_id.slice(0, 8)}</strong></td>
                  <td>{src?.module_name ?? '—'}</td>
                  <td>{src?.producer_name ?? '—'}</td>
                  <td>{Number(h.quantity_kg).toFixed(1)} kg</td>
                  <td>{pct}%</td>
                  <td>{src?.humidity_pct ?? '—'}%</td>
                  <td>{src?.color ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 600, background: '#e0f2fe' }}>
              <td colSpan={3}>Total homogenizado</td>
              <td>{totalUsed.toFixed(1)} kg</td>
              <td>100%</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {processing && (
        <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
          <span>Panela tamizada (asignada a este {getLoteLabelLower(COOPERATIVE, order)}): <strong style={{ color: 'var(--success)' }}>{Number(processing.allocated_kg ?? 0).toFixed(2)} kg</strong></span>
          <span>Reproceso: <strong>{Number(processing.allocated_reproceso_kg ?? 0).toFixed(2)} kg</strong></span>
          <span>Descarte: <strong>{Number(processing.allocated_descarte_kg ?? 0).toFixed(2)} kg</strong></span>
          <span>Merma: <strong style={{ color: Number(processing.allocated_merma_kg ?? 0) / totalUsed > 0.05 ? 'var(--warning)' : 'inherit' }}>
            {Number(processing.allocated_merma_kg ?? 0).toFixed(2)} kg ({totalUsed > 0 ? (Number(processing.allocated_merma_kg ?? 0) / totalUsed * 100).toFixed(1) : 0}%)
          </strong></span>
        </div>
      )}
      {isSplit && (
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          Este {BUNQUE_LABEL_LOWER} se repartió también a otro(s) {LOTE_LABEL_LOWER}(s) — total real del {BUNQUE_LABEL_LOWER}: {Number(processing.tamizada_kg).toFixed(2)} kg tamizada.
        </p>
      )}
    </div>
  )
}
