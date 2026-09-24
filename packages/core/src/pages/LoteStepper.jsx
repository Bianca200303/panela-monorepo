import Icon from '../components/Icon'

export default function LoteStepper({ bunques, hasSalida, envasadoOk, calidadOk, status }) {
  const closed = status === 'procesado'
  const steps = [
    { key: 'homogenizado', label: 'Homogenizado', done: bunques.length > 0 },
    { key: 'tamizado', label: 'Tamizado', done: hasSalida },
    { key: 'envasado', label: 'Envasado', done: envasadoOk },
    { key: 'calidad', label: 'Calidad', done: calidadOk },
    { key: 'cerrado', label: 'Cerrado', done: closed },
  ]
  const currentIdx = steps.findIndex(s => !s.done)

  return (
    <div className="lote-stepper">
      {steps.map((s, i) => {
        const isClosedStep = s.key === 'cerrado' && closed
        const cls = isClosedStep ? 'closed' : s.done ? 'done' : i === currentIdx ? 'active' : ''
        return (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <Icon name="chevronRight" size={11} className="sep" />}
            <span className={`step ${cls}`}>
              {s.done ? <Icon name="check" size={11} /> : <span className="num">{i + 1}</span>}
              {s.label}
            </span>
          </span>
        )
      })}
    </div>
  )
}
