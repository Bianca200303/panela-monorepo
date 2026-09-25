import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { COOPERATIVE } from '../lib/config'
import HigienePersonalCaesPage from './HigienePersonalCaesPage'
import LimpiezaGeneralPage from './LimpiezaGeneralPage'
import VerificacionLimpiezaPage from '@panela/core/pages/VerificacionLimpiezaPage'
import CloroResidualCaesPage from './CloroResidualCaesPage'
import ControlPlagasCaesPage from './ControlPlagasCaesPage'
import CalibracionBalanzasCaesPage from './CalibracionBalanzasCaesPage'
import TempHumedadAmbientesCaesPage from './TempHumedadAmbientesCaesPage'
import LavadoManosCaesPage from './LavadoManosCaesPage'
import PreparacionSolucionesCaesPage from './PreparacionSolucionesCaesPage'
import ManejoResiduosCaesPage from './ManejoResiduosCaesPage'

// Hub de "Controles SIG" -- ver comentario largo original en el
// ControlesPage.jsx compartido (web-react/src/pages/, todavía existe ahí
// hasta que el resto de bucket 3 se termine de migrar). Esta es la copia
// SOLO CAES: se sacaron las ramas/imports de los controles de Norandino
// (HigienePage, LimpiezaAmbientes/Equipos, CloroResidualPage,
// ControlPlagasPage) porque ya no viven en esta app -- CAES siempre usa su
// propia variante, no hace falta el ternario por feature flag.
const TABS = [
  ['higiene', 'Higiene', HigienePersonalCaesPage, 'hys'],
  ['limpieza', 'Limpieza', LimpiezaGeneralPage, 'hys'],
  ['verificacion-limpieza', COOPERATIVE?.features?.verificacionLimpiezaTab ?? 'Verificación Limpieza', VerificacionLimpiezaPage, 'hys'],
  ['cloro-residual', 'Cloro Residual', CloroResidualCaesPage, 'hys'],
  ['plagas', 'Control de Plagas', ControlPlagasCaesPage, 'hys'],
  ['calibracion-balanzas', 'Calibración de Balanzas', CalibracionBalanzasCaesPage, 'bpm'],
  ['temp-humedad-ambientes', 'Temperatura y Humedad', TempHumedadAmbientesCaesPage, 'bpm'],
  ['lavado-manos', 'Lavado de Manos', LavadoManosCaesPage, 'hys'],
  ['preparacion-soluciones', 'Preparación de Soluciones', PreparacionSolucionesCaesPage, 'hys'],
  ['manejo-residuos', 'Manejo de Residuos', ManejoResiduosCaesPage, 'hys'],
]

const GROUP_LABELS = { bpm: 'BPM', hys: 'Higiene y Saneamiento' }

export default function ControlesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') ?? TABS[0][0])

  function selectTab(value) {
    setTab(value)
    setSearchParams({ tab: value })
  }

  const ActiveComponent = TABS.find(([v]) => v === tab)?.[2] ?? TABS[0][2]

  const tabButton = ([v, lbl]) => (
    <button key={v} className={`btn small ${tab === v ? 'primary' : 'outline'}`} onClick={() => selectTab(v)}>{lbl}</button>
  )

  return (
    <div>
      <div className="page-header">
        <h2>Controles de planta de envasado</h2>
      </div>

      {['bpm', 'hys'].map(group => {
        const groupTabs = TABS.filter(t => t[3] === group)
        if (groupTabs.length === 0) return null
        return (
          <div key={group} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
              {GROUP_LABELS[group]}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {groupTabs.map(tabButton)}
            </div>
          </div>
        )
      })}

      <ActiveComponent />
    </div>
  )
}
