import { useMemo, useRef, useState } from 'react'
import { toast } from '../lib/toast'
import { exportTableToExcel } from '../lib/excelExport'
import { readSpreadsheetRows } from '../lib/excelImport'
import { quotaSheetColumns, quotaSheetRows, validateQuotaRows, importQuotas } from '../lib/quotaImport'

const kg = (n) => Number(n).toLocaleString('es-PE', { maximumFractionDigits: 2 })
const itemKey = (r) => `${r.rowNum}-${r.cert.id}`

// Importar cupos por parcela × certificación desde Excel/CSV: plantilla
// (una fila por parcela, una columna por certificación) → subir archivo →
// vista previa (nuevos / cambian / con error) → confirmar. Nada se guarda
// antes de confirmar, y se guarda todo junto (RPC import_plot_quotas).
//   plots: parcelas activas de la cooperativa (fetchActivePlots), las mismas
//   que ya cargó la página; null mientras cargan.
//   campaign: { id, year } de la campaña elegida en la página.
export default function ImportarCuposModal({ plots, campaign, quotas, certs, onClose, onImported }) {
  const [file, setFile] = useState(null) // { name, rows } | { name, error }
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  const result = useMemo(() => {
    if (!file) return null
    if (file.error) return { error: file.error }
    return validateQuotaRows(file.rows, { plots, certs, quotas })
  }, [file, plots, certs, quotas])

  const downloadTemplate = () => {
    exportTableToExcel({
      fileName: `Plantilla cupos campaña ${campaign.year}`,
      sheetName: `Campaña ${campaign.year}`,
      columns: quotaSheetColumns(certs),
      rows: quotaSheetRows(plots, quotas),
    })
  }

  const handleFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = '' // permite volver a subir el mismo archivo corregido
    if (!f) return
    try {
      setFile({ name: f.name, rows: await readSpreadsheetRows(f) })
    } catch {
      setFile({ name: f.name, error: 'No se pudo leer el archivo. Use un Excel (.xlsx) o CSV.' })
    }
  }

  const ready = result?.ready ?? []
  const updates = ready.filter(r => r.previousKg != null).length
  const created = ready.length - updates
  const toReview = ready.filter(r => r.warnings.length > 0)

  const handleImport = async () => {
    setSaving(true)
    try {
      const n = await importQuotas(campaign.id, ready)
      toast.success(`${n} cupos importados`)
      onImported()
    } catch (err) {
      toast.error('No se importó ningún cupo', err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 820, width: '100%' }}>
        <div className="modal-body">
          <h3 style={{ margin: '0 0 16px' }}>Importar cupos · Campaña {campaign.year}</h3>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn small outline" onClick={downloadTemplate} disabled={!plots?.length || !certs.length}>
              {plots ? `Descargar plantilla (${plots.length} parcelas)` : 'Cargando parcelas...'}
            </button>
            <button className="btn small primary" onClick={() => fileRef.current?.click()} disabled={!plots || saving}>
              Subir archivo
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={handleFile} />
            {file && <span className="small">{file.name}</span>}
          </div>

          {result?.error && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{result.error}</p>}

          {result && !result.error && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {created > 0 && <span className="tag ok">{created} nuevos</span>}
                {updates > 0 && <span className="tag ok">{updates} cambian</span>}
                {result.unchanged > 0 && <span className="tag info">{result.unchanged} sin cambios</span>}
                {toReview.length > 0 && <span className="tag warn">{toReview.length} para revisar</span>}
                {result.errors.length > 0 && <span className="tag error-tag">{result.errors.length} filas con error</span>}
                {result.skipped > 0 && <span className="tag info">{result.skipped} parcelas sin cupo</span>}
              </div>

              {result.ignoredColumns.length > 0 && (
                <p className="small" style={{ color: 'var(--warning)', margin: 0 }}>
                  No son certificaciones de la cooperativa y se ignoran: {result.ignoredColumns.join(', ')}.
                  Válidas: {certs.map(c => c.name).join(', ')}.
                </p>
              )}

              {result.errors.length > 0 && (
                <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--danger)', borderRadius: 8, padding: '6px 10px' }}>
                  {result.errors.map(e => (
                    <div key={e.rowNum} className="small" style={{ color: 'var(--danger)' }}>Fila {e.rowNum}: {e.message}</div>
                  ))}
                </div>
              )}

              {toReview.length > 0 && (
                <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--warning)', borderRadius: 8, padding: '6px 10px' }}>
                  {toReview.map(r => (
                    <div key={itemKey(r)} className="small" style={{ color: 'var(--warning)' }}>
                      Fila {r.rowNum} ({r.plot.name}, {r.cert.name} {kg(r.cupoKg)} kg): {r.warnings.join('; ')}
                    </div>
                  ))}
                </div>
              )}

              {ready.length > 0 && (
                <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <table className="table small">
                    <thead>
                      <tr>
                        {['Fila', 'Productor', 'Parcela', 'Certificación', 'Cupo kg', 'Cupo actual kg'].map(h => (
                          <th key={h} style={{ position: 'sticky', top: 0 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ready.map(r => (
                        <tr key={itemKey(r)}>
                          <td>{r.rowNum}</td>
                          <td>{r.plot.producerName}</td>
                          <td>{r.plot.name}{r.plot.code ? ` · ${r.plot.code}` : ''}</td>
                          <td>{r.cert.name}</td>
                          <td style={r.warnings.length ? { color: 'var(--warning)', fontWeight: 600 } : undefined}>{kg(r.cupoKg)}</td>
                          <td>{r.previousKg == null ? '—' : kg(r.previousKg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn small" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn small primary" onClick={handleImport} disabled={saving || ready.length === 0}>
            {saving ? 'Importando...' : `Importar ${ready.length} cupos a la campaña ${campaign.year}`}
          </button>
        </div>
      </div>
    </div>
  )
}
