import { useState } from 'react'
import { useConfirm } from '../hooks/useConfirm'
import { useCooperative } from '../lib/cooperativeContext'
import { loteKg, loteLabel, packagingLabel, isEnvasadoOk, isCalidadOk, loteBunques, formatDate } from '../lib/loteHelpers'
import { getLoteLabel, getLoteLabelLower, getLoteLabelPluralLower, getBunqueLabelLower, getBunqueLabelPlural, getBunqueLabelPluralLower } from '../lib/labels'
import OrderNumberField from '../components/OrderNumberField'
import Icon from '../components/Icon'
import Stat from '../components/Stat'
import LoteStepper from './LoteStepper'
import TotalsPanel from './TotalsPanel'
import TrazabilidadTable from './TrazabilidadTable'

const BATCH_STATUS = {
  pendiente_homogenizado: { label: 'Sin homogenizado', cls: 'warn' },
  homogenizado:           { label: 'Homogenizado',     cls: 'info' },
  procesado:              { label: 'Procesado',         cls: 'ok'   },
}

export default function OrderCard({ order, stockItems, processingLimits, kgPerQuintal, webUsersMap, onAddLote, onEditLote, onGestionarBunques, onGestionarEnvasado, onGestionarObjetosExtranos, onGestionarPesosSellado, onGestionarSelladoEnvasadoCaes, onGestionarHermeticidadCaes, onGestionarMonitoreoTamizadoCaes, onGestionarCalidad, onCloseLote, onComplete, onEditOrder, onDocumentos, onResumenTrazabilidad, onReload }) {
  const COOPERATIVE = useCooperative()
  const LOTE_LABEL = getLoteLabel(COOPERATIVE, order)
  const LOTE_LABEL_LOWER = getLoteLabelLower(COOPERATIVE, order)
  const LOTE_LABEL_PLURAL_LOWER = getLoteLabelPluralLower(COOPERATIVE, order)
  const BUNQUE_LABEL_LOWER = getBunqueLabelLower(COOPERATIVE)
  const BUNQUE_LABEL_PLURAL = getBunqueLabelPlural(COOPERATIVE)
  const BUNQUE_LABEL_PLURAL_LOWER = getBunqueLabelPluralLower(COOPERATIVE)
  // Colapsada por defecto -- con muchas órdenes en proceso a la vez, mostrar
  // todo expandido de entrada hace la lista imposible de escanear.
  const [open, setOpen] = useState(false)
  const [openTraza, setOpenTraza] = useState(null) // bunque_id con trazabilidad abierta
  const [collapsedLotes, setCollapsedLotes] = useState({}) // overrides manuales { [pb.id]: bool }
  const { confirm, dialog: confirmDialog } = useConfirm()

  const batches = order.plant_production_batches ?? []
  const readOnly = order.status === 'completado'
  const allProcessed = batches.length > 0 && batches.every(b => b.status === 'procesado')
  const pendingEnvasado = batches.filter(b => !isEnvasadoOk(b, kgPerQuintal))
  const totalPlannedKg = batches.reduce((s, b) => s + loteKg(b), 0)
  const canComplete = allProcessed && pendingEnvasado.length === 0

  // El tamizado siempre puede superar lo planificado (no hay merma negativa
  // que "importe") — la comparación relevante antes de completar es contra
  // el envasado, que si difiere de lo planificado es una señal real.
  const totalEnvasadoKg = batches.reduce((s, b) => s + Number(b.envasado_qq ?? 0) * kgPerQuintal, 0)
  const envasadoGapKg = totalPlannedKg - totalEnvasadoKg
  const envasadoGapPct = totalPlannedKg > 0 ? (envasadoGapKg / totalPlannedKg) * 100 : 0

  const [completeError, setCompleteError] = useState('')

  const handleCompleteClick = async () => {
    setCompleteError('')
    if (Math.abs(envasadoGapKg) > 0.5) {
      const ok = await confirm({
        title: 'Diferencia entre lo planificado y lo envasado',
        message:
          `Se planificaron ${totalPlannedKg.toFixed(1)} kg y se envasó realmente ${totalEnvasadoKg.toFixed(1)} kg ` +
          `(${envasadoGapKg > 0 ? 'faltan' : 'sobran'} ${Math.abs(envasadoGapKg).toFixed(1)} kg, ${Math.abs(envasadoGapPct).toFixed(1)}%).\n\n` +
          `¿Confirmás completar la orden de todas formas?`,
        confirmText: 'Completar de todas formas',
        danger: Math.abs(envasadoGapPct) > processingLimits.mermaThresholdPct,
      })
      if (!ok) return
    }
    try {
      await onComplete()
    } catch (err) {
      setCompleteError(err.message)
    }
  }

  return (
    <div className="item">
      <header style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <OrderNumberField order={order} onSaved={onReload} />
          <span className="muted small">
            {order.market}
            {totalPlannedKg > 0 && ` · ${totalPlannedKg.toFixed(1)} kg`}
            {` · ${batches.length} ${LOTE_LABEL_LOWER}(s)`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`tag dot ${order.status === 'completado' ? 'ok' : 'warn'}`}>
            {order.status === 'completado' ? 'Completado' : 'En proceso'}
          </span>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--muted)' }} />
        </div>
      </header>

      {open && (<>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <button className="btn small outline" onClick={() => onEditOrder(order)}>
          Editar orden
        </button>
        <button className="btn small outline" onClick={onDocumentos}>
          Documentos
        </button>
      </div>

      <div className="order-meta-grid">
        <Stat className="left" label="Mercado" value={order.market || '—'} />
        {(order.tamizado_fecha_inicio || order.tamizado_fecha_fin) && (
          <Stat label="Tamizado" value={`${formatDate(order.tamizado_fecha_inicio)} — ${formatDate(order.tamizado_fecha_fin)}`} />
        )}
        {(order.envasado_fecha_inicio || order.envasado_fecha_fin) && (
          <Stat label="Envasado" value={`${formatDate(order.envasado_fecha_inicio)} — ${formatDate(order.envasado_fecha_fin)}`} />
        )}
        {order.fecha_envio && <Stat label="Fecha de envío" value={formatDate(order.fecha_envio)} />}
        {order.internal_container_number && <Stat label="Contenedor interno" value={order.internal_container_number} />}
        {totalPlannedKg > 0 && <Stat label="Carga total" value={`${totalPlannedKg.toFixed(1)} kg`} />}
      </div>

      {batches.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {batches.map(pb => {
            const bunques = loteBunques(pb)
            const totalInputKg = bunques.reduce((s, b) => s + b.allocated_insumo_kg, 0)
            const totalReproceso = bunques.reduce((s, b) => s + b.allocated_reproceso_kg, 0)
            const totalDescarte = bunques.reduce((s, b) => s + b.allocated_descarte_kg, 0)
            const totalMerma = bunques.reduce((s, b) => s + b.allocated_merma_kg, 0)
            const mermaPct = totalInputKg > 0 ? (totalMerma / totalInputKg * 100) : 0
            const hasSalida = bunques.some(b => b.tamizada_kg != null)
            const plannedKg = loteKg(pb)
            // pb.status solo distingue "procesado" de forma confiable (se
            // actualiza al cerrar el lote); el paso a 'homogenizado' quedó
            // huérfano desde que el reparto de bunques pasó a ser independiente
            // del lote, así que ese estado se deriva de los bunques repartidos.
            const effectiveStatus = pb.status === 'procesado'
              ? 'procesado'
              : bunques.length > 0 ? 'homogenizado' : 'pendiente_homogenizado'
            const status = BATCH_STATUS[effectiveStatus] ?? { label: effectiveStatus, cls: 'info' }
            const envasadoOk = isEnvasadoOk(pb, kgPerQuintal)
            const calidadOk = isCalidadOk(COOPERATIVE, pb)
            const isLiberacion = COOPERATIVE?.features?.liberacionProductoTerminado
            // Colapsado por defecto solo cuando ya no queda nada pendiente
            // (cerrado y con envasado correcto) -- si algo necesita atención
            // se muestra expandido de entrada.
            const defaultCollapsed = pb.status === 'procesado' && envasadoOk
            const isCollapsed = collapsedLotes[pb.id] ?? defaultCollapsed
            const toggleCollapsed = () => setCollapsedLotes(prev => ({ ...prev, [pb.id]: !isCollapsed }))

            return (
              <div key={pb.id} className="lote-card">
                <div className="lote-card-header">
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{LOTE_LABEL}: {loteLabel(pb)}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className={`tag dot ${status.cls}`} style={{ fontSize: 11 }}>{status.label}</span>
                    <button
                      className="btn small outline"
                      style={{ fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={toggleCollapsed}
                    >
                      <Icon name={isCollapsed ? 'chevronDown' : 'chevronUp'} size={12} />
                      {isCollapsed ? 'Detalle' : 'Ocultar'}
                    </button>
                  </div>
                </div>
                <div className="lote-card-sub">
                  Marca <strong>{pb.brand}</strong> · Empaque <strong>{packagingLabel(pb)}</strong> · Planificado <strong>{plannedKg.toFixed(2)} kg</strong>
                </div>
                <LoteStepper bunques={bunques} hasSalida={hasSalida} envasadoOk={envasadoOk} calidadOk={calidadOk} status={effectiveStatus} />

                {!isCollapsed && <>

                {bunques.length > 0 && totalInputKg > 0 && (
                  <div className="stage-card">
                    <div className="stage-card-title">Homogenizado</div>
                    <div className="stage-grid">
                      <Stat className="left" label="Kg repartidos" value={`${totalInputKg.toFixed(2)} kg`} />
                      <Stat className="left" label={`N° de ${BUNQUE_LABEL_LOWER}(s)`} value={bunques.length} />
                    </div>
                  </div>
                )}

                {hasSalida && (
                  <div className="stage-card">
                    <div className="stage-card-title">Tamizado</div>
                    <div className="stage-grid">
                      <Stat className="left" label="Panela tamizada" value={`${Number(pb.tamizada_kg).toFixed(2)} kg`} />
                      <Stat className="left" label="Reproceso" value={`${totalReproceso.toFixed(2)} kg`} />
                      <Stat className="left" label="Descarte" value={`${totalDescarte.toFixed(2)} kg`} />
                      <Stat className="left" label="Merma" value={`${totalMerma.toFixed(2)} kg (${mermaPct.toFixed(2)}%)`} />
                    </div>
                    {mermaPct > 5 && (
                      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}>
                        {mermaPct.toFixed(2)}% de merma — sobre el umbral habitual (5%)
                      </div>
                    )}
                  </div>
                )}

                {pb.envasado_registered_at ? (
                  <div className="stage-card">
                    <div className="stage-card-title">
                      Envasado
                      {webUsersMap[pb.envasado_registered_by] && (
                        <span className="registrado-por">Registró: {webUsersMap[pb.envasado_registered_by]}</span>
                      )}
                    </div>
                    <div className="stage-grid">
                      <Stat className="left" label="Turno" value={pb.envasado_turno === 'manana' ? 'Mañana' : 'Tarde'} />
                      <Stat className="left" label="Quintales" value={Number(pb.envasado_qq).toFixed(2)} />
                      <Stat className="left" label="Kg envasados" value={`${(Number(pb.envasado_qq) * kgPerQuintal).toFixed(2)} kg`} />
                      <Stat className="left" label="Cajas" value={pb.envasado_cajas_envasadas} />
                      {pb.packaging_type === 'bolsa' && pb.envasado_bolsas_envasadas != null && (
                        <Stat className="left" label="Bolsas" value={pb.envasado_bolsas_envasadas} />
                      )}
                      {pb.packaging_type === 'saco' && pb.envasado_sacos_envasados != null && (
                        <Stat className="left" label="Sacos" value={pb.envasado_sacos_envasados} />
                      )}
                      {Number(pb.tamizada_kg ?? 0) > 0 && (
                        <Stat className="left" label="% de lo tamizado" value={`${((Number(pb.envasado_qq) * kgPerQuintal) / Number(pb.tamizada_kg) * 100).toFixed(0)}%`} />
                      )}
                      {bunques.length > 0 && (
                        <Stat className="left" label={BUNQUE_LABEL_PLURAL} value={bunques.map(b => b.bunque_number).join(', ')} />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="meta" style={{ fontSize: 12, marginTop: 6 }}>Envasado: sin registrar</div>
                )}

                {pb.calidad_registered_at ? (
                  <div className="stage-card">
                    <div className="stage-card-title">
                      {isLiberacion ? 'Liberación' : 'Calidad'}
                      {webUsersMap[pb.calidad_registered_by] && (
                        <span className="registrado-por">Registró: {webUsersMap[pb.calidad_registered_by]}</span>
                      )}
                    </div>
                    <div className="stage-grid">
                      <Stat className="left" label="Humedad" value={`${Number(pb.calidad_humedad_pct).toFixed(2)}%`} />
                      <Stat className="left" label="Impurezas" value={`${Number(pb.calidad_impurezas_pct).toFixed(2)}%`} />
                      {isLiberacion ? (<>
                        {pb.liberacion_resultado && (
                          <Stat className="left" label="Resultado" value={pb.liberacion_resultado === 'conforme' ? 'Conforme' : 'No conforme'} />
                        )}
                        {pb.liberacion_formato_presentacion && (
                          <Stat className="left" label="Presentación" value={pb.liberacion_formato_presentacion} />
                        )}
                      </>) : (<>
                        <Stat className="left" label="Color" value={pb.calidad_color} />
                        <Stat className="left" label="Sabor" value={pb.calidad_sabor} />
                        <Stat className="left" label="Textura" value={pb.calidad_textura} />
                      </>)}
                    </div>
                  </div>
                ) : (
                  <div className="meta" style={{ fontSize: 12, marginTop: 6 }}>
                    {isLiberacion ? 'Liberación' : 'Calidad'}: sin registrar
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <button
                    className="btn outline"
                    style={{ fontSize: 13, fontWeight: 600, padding: '6px 14px', color: '#166534', borderColor: 'var(--success)', background: '#f0fdf4' }}
                    onClick={() => onResumenTrazabilidad(pb)}
                  >
                    Resumen de trazabilidad
                  </button>
                  {bunques.filter(b => b.tamizada_kg != null).map(b => (
                    <button
                      key={b.id}
                      className="btn outline"
                      style={{ fontSize: 13, fontWeight: 600, padding: '6px 14px', color: '#166534', borderColor: 'var(--success)', background: '#f0fdf4' }}
                      onClick={() => setOpenTraza(openTraza === b.id ? null : b.id)}
                    >
                      {openTraza === b.id ? `Ocultar trazabilidad ${BUNQUE_LABEL_LOWER} ${b.bunque_number}` : `Ver trazabilidad · ${BUNQUE_LABEL_LOWER} ${b.bunque_number}`}
                    </button>
                  ))}
                </div>
                {bunques.filter(b => b.tamizada_kg != null).map(b => openTraza === b.id && (
                  <TrazabilidadTable
                    key={b.id}
                    inputs={b.allocated_inputs ?? []}
                    stockItems={stockItems ?? []}
                    processing={b}
                    order={order}
                  />
                ))}

                {!readOnly && (<>
                <div className="controles-box">
                  <span className="controles-label">Controles de planta</span>
                  <div className="controles-actions">
                    <button className="btn small outline" onClick={() => onEditLote(pb)}>
                      Editar {LOTE_LABEL_LOWER}
                    </button>
                    {/* Primary se mueve solo al paso activo del stepper de arriba
                        (homogenizado/tamizado -> envasado -> calidad), para que
                        quede claro cuál tocar sin tener que leer el stepper. */}
                    <button className={`btn small ${!hasSalida ? 'primary' : 'outline'}`} onClick={() => onGestionarBunques(pb)}>
                      Repartir {BUNQUE_LABEL_PLURAL_LOWER}{bunques.length > 0 ? ` (${bunques.length} asignado${bunques.length === 1 ? '' : 's'})` : ''}
                    </button>
                    {COOPERATIVE?.features?.detectorMetales && (
                      <button className="btn small outline" onClick={() => onGestionarObjetosExtranos(pb)}>
                        Objetos extraños
                      </button>
                    )}
                    {!COOPERATIVE?.features?.controlesPlantaCAES && (
                      <button className="btn small outline" onClick={() => onGestionarPesosSellado(pb)}>
                        Pesos y sellado
                      </button>
                    )}
                    {/* Sellado/Envasado, Hermeticidad de Envases y
                        Monitoreo del Tamizado (CAES, Fase 2) son el
                        equivalente de CAES a "Pesos y Sellado" --
                        inspecciones del producto ya envasado de ESTE lote,
                        ver SelladoEnvasadoCaesModal.jsx /
                        HermeticidadEnvasesCaesModal.jsx /
                        MonitoreoTamizadoCaesModal.jsx. */}
                    {COOPERATIVE?.features?.controlesPlantaCAES && (<>
                      <button className="btn small outline" onClick={() => onGestionarMonitoreoTamizadoCaes(pb)}>
                        Monitoreo del Tamizado
                      </button>
                      <button className="btn small outline" onClick={() => onGestionarSelladoEnvasadoCaes(pb)}>
                        Sellado, Envasado y Empaque
                      </button>
                      <button className="btn small outline" onClick={() => onGestionarHermeticidadCaes(pb)}>
                        Hermeticidad de Envases
                      </button>
                    </>)}
                    <button className={`btn small ${hasSalida && !envasadoOk ? 'primary' : 'outline'}`} onClick={() => onGestionarEnvasado(pb)}>
                      {pb.envasado_registered_at ? 'Editar envasado' : 'Registrar envasado'}
                    </button>
                    <button className={`btn small ${envasadoOk && !calidadOk ? 'primary' : 'outline'}`} onClick={() => onGestionarCalidad(pb)}>
                      {isLiberacion
                        ? (pb.calidad_registered_at ? 'Editar liberación' : 'Registrar liberación')
                        : (pb.calidad_registered_at ? 'Editar control de calidad' : 'Registrar control de calidad')}
                    </button>
                    {bunques.length > 0 && (
                      <button
                        className="btn small primary"
                        onClick={() => onCloseLote(pb)}
                        disabled={!envasadoOk || !calidadOk}
                        title={envasadoOk && calidadOk ? undefined : `Faltan requisitos para cerrar el ${LOTE_LABEL_LOWER} (ver aviso abajo)`}
                      >
                        Cerrar {LOTE_LABEL_LOWER}
                      </button>
                    )}
                  </div>
                  {bunques.length > 0 && !envasadoOk && (
                    <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, marginTop: 8 }}>
                      Para cerrar el {LOTE_LABEL_LOWER}, el envasado debe coincidir exacto con lo planificado (QQ, cajas y {pb.packaging_type === 'bolsa' ? 'bolsas' : 'sacos'}).
                    </div>
                  )}
                  {bunques.length > 0 && !calidadOk && (
                    <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, marginTop: 8 }}>
                      Para cerrar el {LOTE_LABEL_LOWER}, hace falta registrar {isLiberacion ? 'la liberación de producto terminado' : 'el control de calidad del envasado'} (% Humedad y % Impurezas).
                    </div>
                  )}
                </div>
                </>)}
                </>}
              </div>
            )
          })}
        </div>
      )}

      {batches.length > 0 && (
        <TotalsPanel batches={batches} kgPerQuintal={kgPerQuintal} plannedKg={totalPlannedKg} envasadoKg={totalEnvasadoKg} />
      )}

      {/* Fase 2: cierre */}
      <div className={`order-completion-banner ${canComplete ? 'ready' : 'pending'}`}>
        {canComplete ? (
          <>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Todos los {LOTE_LABEL_PLURAL_LOWER} procesados</span>
            <button className="btn small primary" onClick={handleCompleteClick}>Completar orden</button>
          </>
        ) : (
          <span style={{ fontSize: 12 }}>
            {batches.length === 0
              ? `Agrega al menos un ${LOTE_LABEL_LOWER} para poder completar la orden.`
              : batches.filter(b => b.status !== 'procesado').length > 0
                ? `${batches.filter(b => b.status !== 'procesado').length} ${LOTE_LABEL_LOWER}(s) aún sin procesar.`
                : `${pendingEnvasado.length} ${LOTE_LABEL_LOWER}(s) con envasado sin completar correctamente (debe coincidir exacto con lo planificado).`
            }
          </span>
        )}
      </div>
      {completeError && (
        <p style={{ color: '#dc2626', fontSize: 12, margin: '6px 0 0', fontWeight: 600 }}>{completeError}</p>
      )}

      <footer style={{ marginTop: 8 }}>
        <button className="btn small outline" onClick={onAddLote}>+ Agregar {LOTE_LABEL_LOWER}</button>
      </footer>
      </>)}

      {confirmDialog}
    </div>
  )
}
