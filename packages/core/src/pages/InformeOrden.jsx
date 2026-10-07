import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCooperative } from '../lib/cooperativeContext'
import { loteKg, loteLabel, packagingLabel, formatDate, loteBunques } from '../lib/loteHelpers'
import { buildPrintHTMLFcmtph, FORMAT_TITLE_FCMPTPH } from '../lib/formatos/fcmtph'
import { buildPrintHTMLEstiba } from '../lib/formatos/estiba'
import { buildPrintHTMLFcpo } from '../lib/formatos/fcpo'
import { buildPrintHTMLFcclr } from '../lib/formatos/fcclr'
import { buildPrintHTMLFqd } from '../lib/formatos/fqd'
import Secc from './Secc'
import { quickDocLabel } from '../lib/formatos/shared'

const FLDH_ALL_AREAS = [
  'reception_milling', 'thermal_treatment', 'homogenization_packaging',
  'warehouses', 'changing_rooms', 'restrooms', 'cleaning_equipment', 'reservoir',
]
const FLDH_AREA_LABELS = {
  reception_milling: 'Recepción/Molienda',
  thermal_treatment: 'Tratamiento térmico',
  homogenization_packaging: 'Homogenización/Empaque',
  warehouses: 'Bodegas',
  changing_rooms: 'Vestieros',
  restrooms: 'Baños',
  cleaning_equipment: 'Equipos limpieza',
  reservoir: 'Reservorio',
}

// Los 14 documentos de QUICK_DOCS no comparten forma de datos (rows, blocks
// o pallets según el documento) -- esto cubre los 3 casos sin tener que
// mapear key por key.
function quickDocItemCount(docData) {
  return docData?.rows?.length ?? docData?.blocks?.length ?? docData?.pallets?.length ?? 0
}

// quickDocs: lista QUICK_DOCS de la app que llama (ya no un import fijo --
// cada cooperativa tiene su propia lista, ver lib/formatos/index.js de
// apps/caes y apps/norandino).
export default function InformeOrden({ order, containerNumber, data, loading, onClose, quickDocs }) {
  const QUICK_DOCS = quickDocs
  const COOPERATIVE = useCooperative()
  const navigate = useNavigate()
  // Cada Secc guarda su "open" en estado propio -- no hay un estado central
  // que controlar. Forzar un remount de todo el contenido (cambiando su key)
  // es la forma más simple de volver todas las Secc a su default (cerrado).
  const [collapseTick, setCollapseTick] = useState(0)

  if (loading) return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 500, textAlign: 'center', padding: 40 }}>
        <p className="muted">Cargando informe completo...</p>
      </div>
    </div>
  )

  const { exitItemsMap, evalMap, recMap, tempsMap, phMap, certsMap, workersMap, stowageMap, fieldDocsMap, fcpoMap, chlorineByModuleDate, fcclrByModule, cleaningByModuleDate, fldhByModule, returnsByBatch, fqdMap, plantDocsMap } = data ?? {}
  const batches = order.plant_production_batches ?? []
  const totalTamizada = batches.reduce((s, pb) => s + Number(pb.tamizada_kg ?? 0), 0)

  return (
    <div className="modal-overlay" style={{ alignItems: 'flex-start', overflowY: 'auto', padding: 0 }}>
      <div style={{ width: '100%', maxWidth: 960, margin: '0 auto', background: '#fff', minHeight: '100vh', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 40px)' }}>

        {/* Cabecera */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 24 }} className="no-print-actions">
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 4 }}>Informe de trazabilidad completa</div>
            <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>{order.client_order_number ?? order.order_code}</h2>
            <div className="muted small">Generado el {formatDate(new Date().toISOString())}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn small outline" onClick={() => setCollapseTick(t => t + 1)}>Contraer todo</button>
            <button className="btn small" onClick={onClose}>Cerrar</button>
          </div>
        </div>

        {/* key={collapseTick}: al tocar "Contraer todo" se remonta este bloque
            entero, así cada Secc vuelve a su default (cerrado) sin necesidad
            de un estado central compartido entre todas. */}
        <div key={collapseTick}>
        {/* Resumen de orden */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 28, padding: '16px 20px', background: '#f8fafc', borderRadius: 10, border: '1px solid var(--border)' }}>
          <div><div className="muted small">Mercado destino</div><strong>{order.market}</strong></div>
          <div><div className="muted small">Carga total contenedor</div><strong>{order.total_kg ?? 0} kg</strong></div>
          <div><div className="muted small">Panela tamizada</div><strong style={{ color: 'var(--success)' }}>{totalTamizada.toFixed(1)} kg</strong></div>
          {(order.tamizado_fecha_inicio || order.tamizado_fecha_fin) && (
            <div><div className="muted small">Tamizado</div><strong>{formatDate(order.tamizado_fecha_inicio)} — {formatDate(order.tamizado_fecha_fin)}</strong></div>
          )}
          {(order.envasado_fecha_inicio || order.envasado_fecha_fin) && (
            <div><div className="muted small">Envasado</div><strong>{formatDate(order.envasado_fecha_inicio)} — {formatDate(order.envasado_fecha_fin)}</strong></div>
          )}
          {order.fecha_envio && (
            <div><div className="muted small">Fecha de envío</div><strong>{formatDate(order.fecha_envio)}</strong></div>
          )}
          {order.notes && <div style={{ gridColumn: '1 / -1' }}><span className="muted small">Notas: </span>{order.notes}</div>}
        </div>

        {/* CAPÍTULO 1 — Documentos de planta de envasado (nivel orden) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: '2px 8px', borderRadius: 20, background: '#7c3aed', color: '#fff' }}>PLANTA</span>
          <h3 style={{ margin: 0, fontSize: 15 }}>Documentos de planta de envasado</h3>
        </div>
        <div style={{ borderLeft: '4px solid #7c3aed', marginBottom: 32 }}>
          {QUICK_DOCS.map(d => {
            const entry = plantDocsMap?.[d.key]
            const count = quickDocItemCount(entry?.data)

            if (entry?.error) {
              return (
                <Secc key={d.key} titulo={quickDocLabel(d, order)} colorTitulo="#7c3aed" bgBody="#faf5ff" badge={<span style={{ color: '#dc2626', fontSize: 11 }}>No disponible</span>}>
                  <p className="muted small" style={{ margin: 0 }}>{entry.error}</p>
                </Secc>
              )
            }
            if (count === 0) {
              return (
                <Secc key={d.key} titulo={quickDocLabel(d, order)} colorTitulo="#7c3aed" bgBody="#faf5ff" badge="Sin datos">
                  <p className="muted small" style={{ margin: 0 }}>Todavía no hay datos registrados para este documento.</p>
                </Secc>
              )
            }
            const html = d.buildPdfHtml(order, containerNumber, entry.data, [])
            return (
              <Secc key={d.key} titulo={quickDocLabel(d, order)} colorTitulo="#7c3aed" bgBody="#faf5ff" badge={`${count}`}>
                <iframe
                  srcDoc={html}
                  style={{ width: '100%', minHeight: 400, border: 'none', display: 'block' }}
                  title={d.key}
                  onLoad={e => {
                    try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ }
                  }}
                />
              </Secc>
            )
          })}
        </div>

        {/* CAPÍTULO 2 — Trazabilidad de campo (materia prima) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: '2px 8px', borderRadius: 20, background: '#15803d', color: '#fff' }}>CAMPO</span>
          <h3 style={{ margin: 0, fontSize: 15 }}>Trazabilidad de campo (materia prima)</h3>
        </div>
        {batches.map((pb, idx) => {
          // homoInputs ya viene con la porción proporcional atribuida a ESTE
          // lote (allocated_inputs) -- si un bunque se repartió a más de un
          // lote, cada uno ve solo su parte, sin doble conteo entre lotes.
          const bunques      = loteBunques(pb)
          const homoInputs   = bunques.flatMap(b => b.allocated_inputs ?? [])
          const totalInputKg = homoInputs.reduce((s, h) => s + Number(h.quantity_kg), 0)
          const proc = bunques.some(b => b.tamizada_kg != null) ? {
            tamizada_kg:  pb.tamizada_kg,
            reproceso_kg: bunques.reduce((s, b) => s + b.allocated_reproceso_kg, 0),
            descarte_kg:  bunques.reduce((s, b) => s + b.allocated_descarte_kg, 0),
            merma_kg:     bunques.reduce((s, b) => s + b.allocated_merma_kg, 0),
            processed_at: bunques.map(b => b.processed_at).filter(Boolean).sort().slice(-1)[0] ?? null,
          } : null
          const plannedKg    = loteKg(pb)

          // Documentos FCMPTPH que cubren los lotes de campo de este lote de envasado
          const fieldBatchIds = homoInputs
            .map(h => exitItemsMap?.[h.source_exit_item_id]?.production_batches?.id)
            .filter(Boolean)
          const allPlantFormats = Object.values(fieldDocsMap ?? {})
            .filter(d => fieldBatchIds.some(id => d.coveredBatchIds.includes(id)))

          return (
            <Secc
              key={pb.id}
              titulo={`${loteLabel(pb)} — ${pb.brand} · ${packagingLabel(pb)}`}
              badge={proc ? `${proc.tamizada_kg} kg tamizados` : null}
              colorTitulo="#0f4c5c"
              bgBody="#fff"
            >

              {/* Resultado procesado */}
              {proc && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, padding: '12px 16px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', fontSize: 13 }}>
                  <div><div className="muted small">Total homogenizado</div><strong>{totalInputKg.toFixed(1)} kg</strong></div>
                  <div><div className="muted small">Panela tamizada</div><strong style={{ color: 'var(--success)' }}>{proc.tamizada_kg} kg</strong></div>
                  <div><div className="muted small">Reproceso</div><strong>{proc.reproceso_kg ?? 0} kg</strong></div>
                  <div><div className="muted small">Descarte</div><strong>{proc.descarte_kg} kg</strong></div>
                  <div>
                    <div className="muted small">Merma</div>
                    <strong style={{ color: (Number(proc.merma_kg) / totalInputKg * 100) > 5 ? 'var(--warning)' : 'inherit' }}>
                      {proc.merma_kg} kg ({totalInputKg > 0 ? (Number(proc.merma_kg) / totalInputKg * 100).toFixed(1) : 0}%)
                    </strong>
                  </div>
                  {proc.processed_at && <div style={{ gridColumn: '1 / -1' }}><span className="muted small">Fecha procesado: </span>{formatDate(proc.processed_at)}</div>}
                </div>
              )}

              {/* Trazabilidad: lotes de origen */}
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: '#000' }}>
                  Lotes de campo de origen
                  <span className="tag info" style={{ marginLeft: 8, fontSize: 11 }}>{homoInputs.length} fuente(s) · {totalInputKg.toFixed(1)} kg total</span>
                </div>
                {homoInputs.map((h, hi) => {
                  const exitItem  = exitItemsMap?.[h.source_exit_item_id]
                  const ev        = evalMap?.[h.source_exit_item_id]
                  const rec       = recMap?.[h.source_exit_item_id]
                  const prodBatch = exitItem?.production_batches
                  const producer  = prodBatch?.producers
                  const exitReg   = exitItem?.exit_registrations
                  const reception = rec?.exit_receptions
                  const pct       = totalInputKg > 0 ? (Number(h.quantity_kg) / totalInputKg * 100).toFixed(1) : '—'
                  const pbId      = prodBatch?.id
                  const erId      = exitReg?.id
                  const temps     = pbId ? (tempsMap?.[pbId] ?? []) : []
                  const phControls = pbId ? (phMap?.[pbId] ?? []) : []
                  const certs     = pbId ? (certsMap?.[pbId] ?? []) : []
                  const stowage   = erId ? stowageMap?.[erId] : null
                  const formats   = pbId ? (fieldDocsMap ? Object.values(fieldDocsMap).filter(d => d.coveredBatchIds.includes(pbId)) : []) : []

                  return (
                    <div key={hi} style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>

                      {/* Encabezado fuente */}
                      <div style={{ background: '#f1f5f9', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Lote de campo</span>
                          <strong>{exitItem?.item_document_number ?? prodBatch?.batch_code ?? '—'}</strong>
                          <span className="muted small">{producer?.coop_modules?.name ?? '—'}</span>
                          {certs.length > 0 && certs.map(c => (
                            <span key={c} style={{ fontSize: 11, padding: '2px 8px', background: '#dcfce7', color: '#15803d', borderRadius: 20, border: '1px solid #86efac' }}>{c}</span>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8, fontSize: 13, flexShrink: 0 }}>
                          <span><strong>{Number(h.quantity_kg).toFixed(1)} kg</strong> usados</span>
                          <span className="muted">({pct}%)</span>
                        </div>
                      </div>

                      {/* Datos clave del lote de campo */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '7px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: '#000', background: '#fafafa' }}>
                        <span><span style={{ color: 'var(--muted)' }}>Panela: </span>{prodBatch?.panela_kg != null ? <strong>{prodBatch.panela_kg} kg</strong> : <span className="muted">—</span>}{prodBatch?.confitillo_kg != null && <span> · Confitillo: <strong>{prodBatch.confitillo_kg} kg</strong></span>}</span>
                        <span><span style={{ color: 'var(--muted)' }}>DNI: </span>{producer?.dni ?? '—'}</span>
                        <span><span style={{ color: 'var(--muted)' }}>Módulo: </span>{producer?.coop_modules?.name ?? '—'}</span>
                      </div>

                      {/* Evaluación de calidad (recepción) */}
                      {ev && (
                        <Secc titulo="Evaluación de calidad" badge="recepción" colorTitulo="#1d4ed8" bgBody="#eff6ff">
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13 }}>
                            <span>Humedad: <strong>{ev.humidity_pct}%</strong></span>
                            <span>Impurezas: <strong>{ev.impurities_pct}%</strong></span>
                            <span>Color: <strong>{ev.color}</strong></span>
                            <span>Aspecto: <strong>{ev.appearance}</strong></span>
                            <span>Condición saco: <strong>{ev.sack_condition}</strong></span>
                            {ev.notes && <span className="muted">Obs: {ev.notes}</span>}
                          </div>
                        </Secc>
                      )}

                      {/* FCMPTPH — Formato de control de materia prima, producción, pH y temperatura */}
                      {(() => {
                        const allCertsForBatch = certs.map(name => ({ id: name, name }))
                        const batchObj = {
                          batch_code: prodBatch?.batch_code,
                          harvest_date: prodBatch?.harvest_date,
                          process_date: prodBatch?.process_date,
                          cane_kg: prodBatch?.cane_kg,
                          juice_liters: prodBatch?.juice_liters,
                          panela_kg: prodBatch?.panela_kg,
                          confitillo_kg: prodBatch?.confitillo_kg,
                          efficiency_percentage: prodBatch?.efficiency_percentage,
                          porcentaje_extraccion: prodBatch?.porcentaje_extraccion,
                          cane_density: prodBatch?.cane_density,
                          cachaza_percentage: prodBatch?.cachaza_percentage,
                          observations: prodBatch?.observations,
                          producers: producer,
                          plots: prodBatch?.plots,
                          ph_controls: phControls,
                          temperatures: temps,
                          production_batch_certs: certs.map(name => ({ batch_certs: { id: name, name } })),
                        }
                        const docCode = formats.length > 0 ? formats.map(f => f.document_code).join(', ') : '—'
                        const fullHTML = buildPrintHTMLFcmtph(
                          COOPERATIVE,
                          docCode,
                          producer?.coop_modules?.name ?? '—',
                          prodBatch?.process_date,
                          prodBatch?.process_date,
                          formats[0]?.emitted_at ?? null,
                          [batchObj],
                          allCertsForBatch,
                          formats[0]?.firmantes ?? []
                        )
                        return (
                          <Secc
                            titulo={FORMAT_TITLE_FCMPTPH}
                            badge={formats.length > 0
                              ? <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  {formats.map(f => (
                                    <button key={f.id} onClick={() => { onClose(); navigate(`/reportes?tab=formatos&doc=${encodeURIComponent(f.document_code)}`) }} style={{ fontFamily: 'monospace', color: '#15803d', fontWeight: 700, background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 'inherit' }}>{f.document_code} ↗</button>
                                  ))}
                                </span>
                              : null
                            }
                            colorTitulo="#15803d"
                            bgBody="#f0fdf4"
                          >
                            <iframe
                              srcDoc={fullHTML}
                              style={{ width: '100%', minHeight: 400, border: 'none', display: 'block' }}
                              title={`FCMPTPH-${prodBatch?.batch_code}`}
                              onLoad={e => {
                                try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ }
                              }}
                            />
                          </Secc>
                        )
                      })()}

                      {/* FCPO — Control de personal operario */}
                      {(() => {
                        const workerControls = pbId ? (workersMap?.[pbId] ?? []) : []
                        if (!workerControls.length) return null
                        const areas = workerControls.map(wc => ({ work_area: wc.work_area, observations: wc.observations, items: wc.worker_control_items ?? [] }))
                        const totalWorkers = areas.reduce((s, a) => s + (a.items?.length ?? 0), 0)
                        const fcpo = pbId ? fcpoMap?.[pbId] : null
                        const fcpoHTML = buildPrintHTMLFcpo(COOPERATIVE, fcpo?.formato_codigo ?? null, fcpo?.emitted_at, prodBatch, producer, areas, fcpo?.firmantes ?? [])
                        return (
                          <Secc
                            titulo="FORMATO DE CONTROL DE PERSONAL OPERARIO"
                            badge={fcpo?.formato_codigo
                              ? <button onClick={() => { onClose(); navigate(`/reportes?tab=formatos&subtab=fcpo&doc=${encodeURIComponent(fcpo.formato_codigo)}`) }}
                                  style={{ fontFamily: 'monospace', color: '#7c3aed', fontWeight: 700, background: '#f5f3ff', border: '1px solid #7c3aed', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 'inherit' }}>
                                  {fcpo.formato_codigo} ↗
                                </button>
                              : null
                            }
                            colorTitulo="#7c3aed"
                            bgBody="#f5f3ff"
                          >
                            <div className="muted small" style={{ marginBottom: 6 }}>{totalWorkers} trabajador(es) evaluado(s)</div>
                            <iframe
                              srcDoc={fcpoHTML}
                              style={{ width: '100%', minHeight: 400, border: 'none', display: 'block' }}
                              title={`FCPO-${prodBatch?.batch_code}`}
                              onLoad={e => {
                                try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ }
                              }}
                            />
                          </Secc>
                        )
                      })()}

                      {/* FQD — Quejas y devoluciones */}
                      {(() => {
                        const batchReturns = pbId ? (returnsByBatch?.[pbId] ?? []) : []
                        if (!batchReturns.length) return null
                        return batchReturns.map((ret, ri) => {
                          const fqd     = fqdMap?.[ret.id] ?? null
                          const fqdHTML = buildPrintHTMLFqd(COOPERATIVE, fqd?.formato_codigo ?? null, fqd?.emitted_at, ret, prodBatch, producer, fqd?.firmantes ?? [])
                          const qtxt    = ret.quantity_sacks > 0 ? `${ret.quantity_sacks} sacos` : `${Number(ret.quantity_kg).toFixed(2)} kg`
                          return (
                            <Secc
                              key={ret.id}
                              titulo={`QUEJAS Y DEVOLUCIONES${batchReturns.length > 1 ? ` #${ri + 1}` : ''}`}
                              badge={fqd?.formato_codigo
                                ? <button onClick={() => { onClose(); navigate(`/reportes?tab=formatos&subtab=fqd&doc=${encodeURIComponent(fqd.formato_codigo)}`) }}
                                    style={{ fontFamily: 'monospace', color: '#be185d', fontWeight: 700, background: '#fdf2f8', border: '1px solid #be185d', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 'inherit' }}>
                                    {fqd.formato_codigo} ↗
                                  </button>
                                : null
                              }
                              colorTitulo="#be185d"
                              bgBody="#fdf2f8"
                            >
                              <div className="muted small" style={{ marginBottom: 6 }}>Cliente: {ret.client_name} · {qtxt} · {ret.return_date}</div>
                              <iframe
                                srcDoc={fqdHTML}
                                style={{ width: '100%', minHeight: 300, border: 'none', display: 'block' }}
                                title={`FQD-${prodBatch?.batch_code}-${ri}`}
                                onLoad={e => {
                                  try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ }
                                }}
                              />
                            </Secc>
                          )
                        })
                      })()}

                      {/* FCCLR — Control de cloro libre residual */}
                      {(() => {
                        const moduleId  = prodBatch?.producers?.coop_modules?.id
                        const procDate  = prodBatch?.process_date
                        const chlorineRecords = moduleId && procDate ? (chlorineByModuleDate?.[`${moduleId}_${procDate}`] ?? []) : []
                        if (!chlorineRecords.length) return null
                        const fcclrDoc = moduleId && procDate
                          ? (fcclrByModule?.[moduleId] ?? []).find(d => d.date_from <= procDate && d.date_to >= procDate) ?? null
                          : null
                        const fcclrHTML = buildPrintHTMLFcclr(
                          COOPERATIVE,
                          fcclrDoc?.formato_codigo ?? null,
                          producer?.coop_modules?.name ?? '—',
                          procDate, procDate,
                          fcclrDoc?.emitted_at ?? null,
                          chlorineRecords,
                          fcclrDoc?.firmantes ?? []
                        )
                        return (
                          <Secc
                            titulo="FORMATO DE CONTROL DE CLORO LIBRE RESIDUAL"
                            badge={fcclrDoc?.formato_codigo
                              ? <button onClick={() => { onClose(); navigate(`/reportes?tab=formatos&subtab=fcclr&doc=${encodeURIComponent(fcclrDoc.formato_codigo)}`) }}
                                  style={{ fontFamily: 'monospace', color: '#0e7490', fontWeight: 700, background: '#ecfeff', border: '1px solid #0e7490', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 'inherit' }}>
                                  {fcclrDoc.formato_codigo} ↗
                                </button>
                              : null
                            }
                            colorTitulo="#0e7490"
                            bgBody="#ecfeff"
                          >
                            <div className="muted small" style={{ marginBottom: 6 }}>{chlorineRecords.length} medición(es) registrada(s)</div>
                            <iframe
                              srcDoc={fcclrHTML}
                              style={{ width: '100%', minHeight: 300, border: 'none', display: 'block' }}
                              title={`FCCLR-${prodBatch?.batch_code}`}
                              onLoad={e => {
                                try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ }
                              }}
                            />
                          </Secc>
                        )
                      })()}

                      {/* Limpieza y Desinfección */}
                      {(() => {
                        const moduleId = prodBatch?.producers?.coop_modules?.id
                        const procDate = prodBatch?.process_date
                        const sessions = moduleId && procDate ? (cleaningByModuleDate?.[`${moduleId}_${procDate}`] ?? []) : []
                        if (!sessions.length) return null
                        const fldhDoc = moduleId && procDate
                          ? (fldhByModule?.[moduleId] ?? []).find(d => d.date_from <= procDate && d.date_to >= procDate) ?? null
                          : null
                        const TYPE_NAMES = { daily: 'Diaria', general: 'General', deep: 'Profunda' }
                        return (
                          <Secc
                            titulo="LIMPIEZA Y DESINFECCIÓN"
                            badge={fldhDoc?.formato_codigo
                              ? <button onClick={() => { onClose(); navigate(`/reportes?tab=formatos&subtab=fldh&doc=${encodeURIComponent(fldhDoc.formato_codigo)}`) }}
                                  style={{ fontFamily: 'monospace', color: 'var(--success)', fontWeight: 700, background: '#f0fdf4', border: '1px solid var(--success)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 'inherit' }}>
                                  {fldhDoc.formato_codigo} ↗
                                </button>
                              : null
                            }
                            colorTitulo="var(--success)"
                            bgBody="#f0fdf4"
                          >
                            <div className="muted small" style={{ marginBottom: 8 }}>
                              {sessions.length} sesión{sessions.length !== 1 ? 'es' : ''} de limpieza registrada{sessions.length !== 1 ? 's' : ''} este día
                            </div>
                            {sessions.map((s, i) => {
                              const tipos = (s.cleaning_types ?? []).map(t => TYPE_NAMES[t] ?? t).join(' + ') || '—'
                              const covered = s.areas ?? []
                              const missing = FLDH_ALL_AREAS.filter(a => !covered.includes(a))
                              return (
                                <div key={i} style={{ marginBottom: 8, padding: '8px 10px', background: '#fff', borderRadius: 6, border: '1px solid #bbf7d0', fontSize: 12 }}>
                                  <div style={{ marginBottom: 4 }}>
                                    <strong style={{ color: 'var(--success)' }}>{tipos}</strong>
                                    {s.general_observations && (
                                      <span className="muted" style={{ marginLeft: 8 }}>{s.general_observations}</span>
                                    )}
                                  </div>
                                  {covered.length > 0 && (
                                    <div style={{ marginBottom: 3 }}>
                                      <span style={{ color: 'var(--success)', fontWeight: 600 }}>Áreas limpias ({covered.length}/{FLDH_ALL_AREAS.length}): </span>
                                      <span style={{ color: '#166534' }}>{covered.map(a => FLDH_AREA_LABELS[a] ?? a).join(', ')}</span>
                                    </div>
                                  )}
                                  {missing.length > 0 && (
                                    <div>
                                      <span style={{ color: '#b91c1c', fontWeight: 600 }}>Sin limpiar ({missing.length}): </span>
                                      <span style={{ color: '#991b1b' }}>{missing.map(a => FLDH_AREA_LABELS[a] ?? a).join(', ')}</span>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </Secc>
                        )
                      })()}

                      {/* Inspección de transporte — FET */}
                      {stowage && (() => {
                        const stowageItems = homoInputs
                          .filter(hi => exitItemsMap?.[hi.source_exit_item_id]?.exit_registrations?.id === erId)
                          .map(hi => {
                            const ei = exitItemsMap?.[hi.source_exit_item_id]
                            return { id: hi.source_exit_item_id, quantity_kg: ei?.quantity_kg, production_batches: ei?.production_batches }
                          })
                        const fetHTML = buildPrintHTMLEstiba(
                          COOPERATIVE,
                          stowage.formato_codigo ?? '(borrador)',
                          stowage.emitted_at,
                          exitReg,
                          stowage,
                          stowageItems,
                          stowage.firmantes ?? []
                        )
                        return (
                          <Secc
                            titulo="FORMATO DE INSPECCIÓN DE ESTIBA Y TRANSPORTE"
                            badge={stowage.formato_codigo
                              ? <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  <button onClick={() => { onClose(); navigate(`/reportes?tab=formatos&subtab=fet&doc=${encodeURIComponent(stowage.formato_codigo)}`) }} style={{ fontFamily: 'monospace', color: '#b45309', fontWeight: 700, background: '#fffbeb', border: '1px solid #b45309', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 'inherit' }}>{stowage.formato_codigo} ↗</button>
                                </span>
                              : null
                            }
                            colorTitulo="#b45309"
                            bgBody="#fffbeb"
                          >
                            <iframe
                              srcDoc={fetHTML}
                              style={{ width: '100%', minHeight: 400, border: 'none', display: 'block' }}
                              title={`FET-${exitReg?.exit_code}`}
                              onLoad={e => {
                                try { e.target.style.height = e.target.contentDocument.body.scrollHeight + 32 + 'px' } catch { /* iframe cross-origin/timing, seguro ignorar */ }
                              }}
                            />
                          </Secc>
                        )
                      })()}

                    </div>
                  )
                })}
              </div>
            </Secc>
          )
        })}
        </div>
      </div>
    </div>
  )
}
