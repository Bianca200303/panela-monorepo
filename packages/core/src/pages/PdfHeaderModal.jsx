import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useCooperative } from '../lib/cooperativeContext'
import { loteKg, loteLabel, packagingLabel, loteBunques } from '../lib/loteHelpers'

export default function PdfHeaderModal({ order, container, data, loading, clients, onClose, onSaved }) {
  const COOPERATIVE = useCooperative()
  const [clientId, setClientId]     = useState('')
  const [saleNumber, setSaleNumber] = useState('')
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  useEffect(() => {
    setClientId(order.client_id ?? '')
    if (!data) return
    setSaleNumber(data.saleNumber)
  }, [data, order.client_id])

  const handleSaveAndPrint = async () => {
    setSaving(true)
    setError('')
    try {
      const { error: updErr } = await supabase
        .from('plant_orders')
        .update({ client_id: clientId || null, sale_number: saleNumber.trim() || null })
        .eq('id', order.id)
      if (updErr) throw updErr
      onSaved({ client_id: clientId || null, sale_number: saleNumber.trim() || null })
      window.print()
    } catch (e) {
      setError(e.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const customerName = clients?.find(c => c.id === clientId)?.name ?? ''
  const product = order.product ?? 'Panela'

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

  const tamizadoStr = !data?.tamizadoInicio ? '—'
    : fmtDate(data.tamizadoInicio) === fmtDate(data.tamizadoFin)
      ? fmtDate(data.tamizadoInicio)
      : `${fmtDate(data.tamizadoInicio)} — ${fmtDate(data.tamizadoFin)}`

  return (
    <div className="modal-overlay" style={{ alignItems: 'flex-start', overflowY: 'auto', padding: 0 }}>
      <div className="pdf-printable" style={{ width: '100%', maxWidth: 900, margin: '0 auto', background: '#fff', minHeight: '100vh', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 40px)' }}>

        {/* Acciones — se ocultan al imprimir */}
        <div className="no-print-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 4 }}>PDF Trazabilidad — Encabezado</div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{order.client_order_number ?? order.order_code}</h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn small outline" onClick={onClose}>Cerrar</button>
            <button className="btn small primary" onClick={handleSaveAndPrint} disabled={saving || loading}>
              {saving ? 'Guardando...' : 'Guardar e imprimir'}
            </button>
          </div>
        </div>

        {error && <div className="no-print-actions" style={{ color: '#dc2626', marginBottom: 12, fontSize: 13 }}>{error}</div>}

        {loading ? (
          <p className="muted">Cargando datos...</p>
        ) : (
          <>
            {/* Cliente y número de venta editables (por si no se llenaron al crear la orden) */}
            <div className="no-print-actions" style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Completar si falta</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span className="muted small">Cliente / importador</span>
                  <select className="input" value={clientId} onChange={e => setClientId(e.target.value)}>
                    <option value="">Sin cliente</option>
                    {(clients ?? []).filter(c => c.is_active || c.id === clientId).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span className="muted small">Número de venta</span>
                  <input className="input" value={saleNumber} onChange={e => setSaleNumber(e.target.value)} placeholder="Ej: VTA-2026-001" />
                </label>
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>Las certificaciones se asignan al crear cada lote de planta.</p>
            </div>

            {/* Encabezado imprimible */}
            <div style={{ border: '2px solid #1e3a5f', borderRadius: 8, overflow: 'hidden', fontSize: 13 }}>

              {/* Título */}
              <div style={{ background: '#1e3a5f', color: '#fff', padding: '10px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.75 }}>Informe de Trazabilidad</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{order.client_order_number ?? order.order_code} — {container?.container_number ?? 'Sin contenedor'}</div>
              </div>

              {/* Tabla etiqueta | valor */}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <colgroup>
                  <col style={{ width: '38%' }} />
                  <col style={{ width: '62%' }} />
                </colgroup>
                <tbody>
                  {[
                    { label: 'N° Contenedor',          value: container?.container_number ?? '—' },
                    { label: 'Cliente / Importador',    value: customerName || '—' },
                    { label: 'Producto',                value: product },
                    { label: 'N° Venta',                value: saleNumber || '—' },
                    { label: 'N° Orden de producción',  value: order.client_order_number ?? order.order_code },
                    { label: 'Tamizado (inicio — fin)', value: tamizadoStr },
                    { label: 'Certificaciones',         value: (data?.certNames ?? []).join(' · ') || '—' },
                  ].map(({ label, value }) => (
                    <tr key={label} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '7px 16px', fontWeight: 600, color: '#000', background: '#f8fafc', borderRight: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>
                        {label}
                      </td>
                      <td style={{ padding: '7px 16px', color: '#1e293b', fontWeight: 500 }}>
                        {value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ padding: '6px 16px', background: '#f8fafc', fontSize: 10, color: '#000', textAlign: 'right', borderTop: '1px solid #e2e8f0' }}>
                Generado el {new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })}
              </div>
            </div>

            {/* ── Lotes de envasado ── */}
            <div style={{ border: '2px solid #1e3a5f', borderRadius: 8, overflow: 'hidden', fontSize: 12, marginTop: 20 }}>
              <div style={{ background: '#1e3a5f', color: '#fff', padding: '8px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Lotes de Envasado</div>
              </div>
              {(order.plant_production_batches ?? []).length === 0 ? (
                <div style={{ padding: '16px', color: '#000', fontStyle: 'italic' }}>Sin lotes de envasado registrados.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9' }}>
                      {['N° Lote', 'Empaque', 'Cajas', 'Peso total (kg)', 'Pallets', 'Año vencimiento', 'Descripción'].map(h => (
                        <th key={h} style={{ padding: '7px 10px', fontWeight: 700, color: '#334155', fontSize: 11, borderBottom: '1px solid #cbd5e1', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(order.plant_production_batches ?? []).map((b, i) => {
                      const totalKg = loteKg(b) > 0
                        ? loteKg(b).toLocaleString('es-PE', { maximumFractionDigits: 1 })
                        : '—'
                      return (
                        <tr key={b.id} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                          <td style={{ padding: '7px 10px', fontWeight: 600, color: '#1e3a5f', whiteSpace: 'nowrap' }}>{loteLabel(b)}</td>
                          <td style={{ padding: '7px 10px', color: '#1e293b' }}>{[b.brand, packagingLabel(b)].filter(Boolean).join(' · ') || '—'}</td>
                          <td style={{ padding: '7px 10px', color: '#1e293b', whiteSpace: 'nowrap' }}>{b.boxes_count ?? '—'}</td>
                          <td style={{ padding: '7px 10px', color: '#1e293b', whiteSpace: 'nowrap' }}>{totalKg}</td>
                          <td style={{ padding: '7px 10px', color: '#1e293b', textAlign: 'center' }}>{b.pallet_count ?? '—'}</td>
                          <td style={{ padding: '7px 10px', color: '#1e293b', whiteSpace: 'nowrap' }}>{b.best_before_date ? b.best_before_date.slice(0, 4) : '—'}</td>
                          <td style={{ padding: '7px 10px', color: '#000' }}>{b.description || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }}>
                      <td colSpan={3} style={{ padding: '7px 10px', fontWeight: 700, color: '#334155', fontSize: 11 }}>TOTAL</td>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: '#1e3a5f', whiteSpace: 'nowrap' }}>
                        {(() => {
                          const tot = (order.plant_production_batches ?? []).reduce((acc, b) => acc + loteKg(b), 0)
                          return tot > 0 ? tot.toLocaleString('es-PE', { maximumFractionDigits: 1 }) : '—'
                        })()}
                      </td>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: '#1e3a5f', textAlign: 'center' }}>
                        {(() => {
                          const tot = (order.plant_production_batches ?? []).reduce((acc, b) => acc + (b.pallet_count ?? 0), 0)
                          return tot > 0 ? tot : '—'
                        })()}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* ── Trazabilidad de materia prima ── */}
            {(() => {
              const rows = data?.fieldRows ?? []
              const thS = { padding: '6px 8px', fontWeight: 700, color: '#334155', fontSize: 10, borderBottom: '1px solid #cbd5e1', textAlign: 'left', whiteSpace: 'nowrap', verticalAlign: 'bottom', borderRight: '1px solid #e2e8f0' }
              const tdS = { padding: '6px 8px', color: '#1e293b', fontSize: 11, verticalAlign: 'top', borderRight: '1px solid #e2e8f0' }
              const fmtKg = v => v > 0 ? v.toLocaleString('es-PE', { maximumFractionDigits: 1 }) : '—'
              const totalSacos  = rows.reduce((a, r) => a + r.sacos,    0)
              const totalSeca   = rows.reduce((a, r) => a + r.kg_seca,  0)
              const totalSuelta = rows.reduce((a, r) => a + r.kg_suelta, 0)
              const totalCerosa = rows.reduce((a, r) => a + r.kg_cerosa, 0)
              return (
                <div style={{ border: '2px solid #1e3a5f', borderRadius: 8, overflow: 'hidden', marginTop: 20 }}>
                  <div style={{ background: '#1e3a5f', color: '#fff', padding: '8px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Trazabilidad de Materia Prima — Producciones de Campo</div>
                  </div>
                  {rows.length === 0 ? (
                    <div style={{ padding: '16px', color: '#000', fontStyle: 'italic', fontSize: 12 }}>Sin datos de campo registrados.</div>
                  ) : (
                    <>
                      <div className="pdf-table-scroll" style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                        <thead>
                          <tr style={{ background: '#f1f5f9' }}>
                            <th rowSpan={2} style={thS}>N° Lote campo</th>
                            <th rowSpan={2} style={thS}>Productor</th>
                            <th rowSpan={2} style={thS}>DNI</th>
                            <th rowSpan={2} style={thS}>Módulo</th>
                            <th rowSpan={2} style={{ ...thS, textAlign: 'center' }}>Miembro</th>
                            <th rowSpan={2} style={thS}>Certif.</th>
                            {COOPERATIVE?.features?.certificacion && <th rowSpan={2} style={thS}>Status certif.</th>}
                            <th rowSpan={2} style={thS}>Comprobante acopio</th>
                            <th rowSpan={2} style={{ ...thS, textAlign: 'right' }}>Sacos</th>
                            <th colSpan={3} style={{ ...thS, textAlign: 'center', background: '#e8edf4' }}>Tipo de panela (kg)</th>
                          </tr>
                          <tr style={{ background: '#f1f5f9' }}>
                            <th style={{ ...thS, background: '#e8edf4' }}>Seca</th>
                            <th style={{ ...thS, background: '#e8edf4' }}>Suelta</th>
                            <th style={{ ...thS, background: '#e8edf4', borderRight: 'none' }}>Cerosa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, i) => (
                            <tr key={row.batch_code} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                              <td style={{ ...tdS, fontWeight: 600, color: '#1e3a5f', whiteSpace: 'nowrap' }}>{row.batch_code}</td>
                              <td style={tdS}>{row.producer_name || '—'}</td>
                              <td style={{ ...tdS, whiteSpace: 'nowrap' }}>{row.dni}</td>
                              <td style={{ ...tdS, whiteSpace: 'nowrap' }}>{row.modulo}</td>
                              <td style={{ ...tdS, textAlign: 'center' }}>
                                <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: row.is_member ? '#dcfce7' : '#fee2e2', color: row.is_member ? '#166534' : '#991b1b' }}>
                                  {row.is_member ? 'Sí' : 'No'}
                                </span>
                              </td>
                              <td style={tdS}>{row.certs}</td>
                              {COOPERATIVE?.features?.certificacion && <td style={tdS}>{row.cert_status}</td>}
                              <td style={{ ...tdS, whiteSpace: 'nowrap' }}>{row.guias.join(', ') || '—'}</td>
                              <td style={{ ...tdS, textAlign: 'right', whiteSpace: 'nowrap' }}>{row.sacos > 0 ? row.sacos : '—'}</td>
                              <td style={{ ...tdS, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtKg(row.kg_seca)}</td>
                              <td style={{ ...tdS, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtKg(row.kg_suelta)}</td>
                              <td style={{ ...tdS, textAlign: 'right', whiteSpace: 'nowrap', borderRight: 'none' }}>{fmtKg(row.kg_cerosa)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }}>
                            <td colSpan={8} style={{ padding: '7px 8px', fontWeight: 700, color: '#334155', fontSize: 11 }}>TOTAL GENERAL</td>
                            <td style={{ padding: '7px 8px', fontWeight: 700, color: '#1e3a5f', textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap' }}>{totalSacos > 0 ? totalSacos : '—'}</td>
                            <td style={{ padding: '7px 8px', fontWeight: 700, color: '#1e3a5f', textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtKg(totalSeca)}</td>
                            <td style={{ padding: '7px 8px', fontWeight: 700, color: '#1e3a5f', textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtKg(totalSuelta)}</td>
                            <td style={{ padding: '7px 8px', fontWeight: 700, color: '#1e3a5f', textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap', borderRight: 'none' }}>{fmtKg(totalCerosa)}</td>
                          </tr>
                        </tfoot>
                      </table>
                      </div>
                    </>
                  )}
                </div>
              )
            })()}

            {/* ── Control de Homogenizado y Tamizado ── */}
            {/* Grano de bunque, no de lote: por capacidad limitada, el tamizado de un
                lote se reparte en varios bunques, cada uno con su propio resultado.
                Desde la Fase 2 un bunque puede además repartirse entre varios lotes --
                cada fila es (lote, bunque) con la porción de kg asignada a ESE lote
                (b.allocated_*), no el total real del bunque si se compartió. */}
            {(() => {
              const batches = order.plant_production_batches ?? []
              const rows = batches.flatMap(pb => loteBunques(pb).map(b => ({ pb, b })))
              const fmtKg   = v => (v != null && v > 0) ? Number(v).toLocaleString('es-PE', { maximumFractionDigits: 1 }) : '—'
              const fmtPct  = (part, total) => total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '—'
              const fmtDate = d => d ? new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
              const thH = { padding: '6px 8px', fontWeight: 700, color: '#334155', fontSize: 10, borderBottom: '1px solid #cbd5e1', textAlign: 'left', whiteSpace: 'nowrap', borderRight: '1px solid #e2e8f0' }
              const tdH = { padding: '6px 8px', color: '#1e293b', fontSize: 11, borderRight: '1px solid #e2e8f0', whiteSpace: 'nowrap' }
              return (
                <div style={{ border: '2px solid #1e3a5f', borderRadius: 8, overflow: 'hidden', marginTop: 20 }}>
                  <div style={{ background: '#1e3a5f', color: '#fff', padding: '8px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Control de Homogenizado y Tamizado</div>
                  </div>
                  <div className="pdf-table-scroll" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9' }}>
                          <th style={thH}>N° Lote envasado</th>
                          <th style={thH}>N° Bunque</th>
                          <th style={thH}>Presentación</th>
                          <th style={{ ...thH, textAlign: 'right' }}>Kg MP entrada</th>
                          <th style={{ ...thH, textAlign: 'right', background: '#e8f5e9' }}>Kg tamizada</th>
                          <th style={{ ...thH, textAlign: 'right', background: 'rgba(15,76,92,0.10)' }}>Kg reproceso</th>
                          <th style={{ ...thH, textAlign: 'right', background: '#fff8e1' }}>Kg descarte</th>
                          <th style={{ ...thH, textAlign: 'right', background: '#fce4ec' }}>Kg merma</th>
                          <th style={{ ...thH, textAlign: 'right', background: '#fce4ec' }}>% merma</th>
                          <th style={{ ...thH, textAlign: 'center', borderRight: 'none' }}>Fecha tamizado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ pb, b }, i) => {
                          const entKg   = b.allocated_insumo_kg
                          const tamKg   = b.allocated_kg
                          const repKg   = b.allocated_reproceso_kg
                          const desKg   = b.allocated_descarte_kg
                          const merKg   = b.allocated_merma_kg
                          const esParcial = Math.abs(tamKg - Number(b.tamizada_kg ?? 0)) > 0.01
                          const presentacion = [pb.brand, packagingLabel(pb)].filter(Boolean).join(' · ') || '—'
                          return (
                            <tr key={`${pb.id}-${b.id}`} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                              <td style={{ ...tdH, fontWeight: 600, color: '#1e3a5f' }}>{loteLabel(pb)}</td>
                              <td style={tdH}>{b.bunque_number}{esParcial ? ' (parcial)' : ''}</td>
                              <td style={tdH}>{presentacion}</td>
                              <td style={{ ...tdH, textAlign: 'right' }}>{fmtKg(entKg)}</td>
                              <td style={{ ...tdH, textAlign: 'right', background: i % 2 === 0 ? '#f0fdf4' : '#dcfce7' }}>{fmtKg(tamKg)}</td>
                              <td style={{ ...tdH, textAlign: 'right', background: i % 2 === 0 ? 'rgba(15,76,92,0.10)' : 'rgba(15,76,92,0.18)' }}>{fmtKg(repKg)}</td>
                              <td style={{ ...tdH, textAlign: 'right', background: i % 2 === 0 ? '#fffde7' : '#fef9c3' }}>{fmtKg(desKg)}</td>
                              <td style={{ ...tdH, textAlign: 'right', background: i % 2 === 0 ? '#fdf2f8' : '#fce4ec' }}>{fmtKg(merKg)}</td>
                              <td style={{ ...tdH, textAlign: 'right', background: i % 2 === 0 ? '#fdf2f8' : '#fce4ec', color: entKg > 0 && merKg / entKg > 0.05 ? '#b91c1c' : '#374151' }}>
                                {fmtPct(merKg, entKg)}
                              </td>
                              <td style={{ ...tdH, textAlign: 'center', borderRight: 'none' }}>{fmtDate(b.processed_at)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        {(() => {
                          const totEnt = rows.reduce((s, { b }) => s + b.allocated_insumo_kg, 0)
                          const totTam = rows.reduce((s, { b }) => s + b.allocated_kg, 0)
                          const totRep = rows.reduce((s, { b }) => s + b.allocated_reproceso_kg, 0)
                          const totDes = rows.reduce((s, { b }) => s + b.allocated_descarte_kg, 0)
                          const totMer = rows.reduce((s, { b }) => s + b.allocated_merma_kg, 0)
                          return (
                            <tr style={{ background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }}>
                              <td colSpan={3} style={{ padding: '7px 8px', fontWeight: 700, color: '#334155', fontSize: 11 }}>TOTALES</td>
                              <td style={{ padding: '7px 8px', fontWeight: 700, color: '#1e3a5f', textAlign: 'right', fontSize: 11 }}>{fmtKg(totEnt)}</td>
                              <td style={{ padding: '7px 8px', fontWeight: 700, color: '#166534', textAlign: 'right', fontSize: 11 }}>{fmtKg(totTam)}</td>
                              <td style={{ padding: '7px 8px', fontWeight: 700, color: 'var(--primary-600)', textAlign: 'right', fontSize: 11 }}>{fmtKg(totRep)}</td>
                              <td style={{ padding: '7px 8px', fontWeight: 700, color: '#92400e', textAlign: 'right', fontSize: 11 }}>{fmtKg(totDes)}</td>
                              <td style={{ padding: '7px 8px', fontWeight: 700, color: '#b91c1c', textAlign: 'right', fontSize: 11 }}>{fmtKg(totMer)}</td>
                              <td style={{ padding: '7px 8px', fontWeight: 700, color: '#b91c1c', textAlign: 'right', fontSize: 11 }}>{fmtPct(totMer, totEnt)}</td>
                              <td style={{ padding: '7px 8px', borderRight: 'none' }} />
                            </tr>
                          )
                        })()}
                      </tfoot>
                    </table>
                  </div>
                </div>
              )
            })()}

            {/* ── Consolidado Total de Homogenizado y Tamizado ── */}
            {(() => {
              const batches    = order.plant_production_batches ?? []
              const allBunques = batches.flatMap(pb => loteBunques(pb))
              const allInputs  = allBunques.flatMap(b => b.allocated_inputs ?? [])
              const fmtKg      = v => (v != null && v > 0) ? Number(v).toLocaleString('es-PE', { maximumFractionDigits: 1 }) : '—'
              const totEnt     = allInputs.reduce((s, h) => s + Number(h.quantity_kg ?? 0), 0)
              const totTam     = allBunques.reduce((s, b) => s + b.allocated_kg, 0)
              const totRep     = allBunques.reduce((s, b) => s + b.allocated_reproceso_kg, 0)
              const totDes     = allBunques.reduce((s, b) => s + b.allocated_descarte_kg, 0)
              const totMer     = allBunques.reduce((s, b) => s + b.allocated_merma_kg, 0)
              const pctMer     = totEnt > 0 ? `${((totMer / totEnt) * 100).toFixed(1)}%` : '—'
              const nEnvasado  = batches.length
              const nCampo     = new Set(allInputs.map(h => h.source_exit_item_id).filter(Boolean)).size
              const items = [
                { label: 'Lotes de envasado',      value: nEnvasado,       color: '#1e3a5f' },
                { label: 'Lotes de campo usados',   value: nCampo,          color: '#1e3a5f' },
                { label: 'Total kg MP entrada',     value: fmtKg(totEnt),   color: '#1e3a5f' },
                { label: 'Total kg tamizada',        value: fmtKg(totTam),   color: '#166534' },
                { label: 'Total kg reproceso',       value: fmtKg(totRep),   color: 'var(--primary-600)' },
                { label: 'Total kg descarte',        value: fmtKg(totDes),   color: '#92400e' },
                { label: 'Total kg merma',           value: fmtKg(totMer),   color: '#b91c1c' },
                { label: '% merma general',          value: pctMer,          color: '#b91c1c' },
              ]
              return (
                <div style={{ border: '2px solid #1e3a5f', borderRadius: 8, overflow: 'hidden', marginTop: 20 }}>
                  <div style={{ background: '#1e3a5f', color: '#fff', padding: '8px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Consolidado Total de Homogenizado y Tamizado</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 0 }}>
                    {items.map(({ label, value, color }, i) => (
                      <div key={label} style={{ padding: '12px 16px', borderRight: i < items.length - 1 ? '1px solid #e2e8f0' : 'none', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
                        <div style={{ fontSize: 10, color: '#000', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </>
        )}
      </div>
    </div>
  )
}
