import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@panela/core/store/authStore'
import { CooperativeProvider } from '@panela/core/lib/cooperativeContext'
import { COOPERATIVE } from './lib/config'
import LoginPage from '@panela/core/pages/LoginPage'
import Layout from '@panela/core/components/Layout'
import DashboardPage from '@panela/core/pages/DashboardPage'
import UsersPage from '@panela/core/pages/UsersPage'
import CalidadPage from '@panela/core/pages/CalidadPage'
import BunquesPage from '@panela/core/pages/BunquesPage'
import ReportesPage from '@panela/core/pages/ReportesPage'
import CuposProduccionPage from '@panela/core/pages/CuposProduccionPage'
import EmptyState from '@panela/core/components/EmptyState'
import HigienePersonalCaesPage from './pages/HigienePersonalCaesPage'
import LimpiezaGeneralPage from './pages/LimpiezaGeneralPage'
import CloroResidualCaesPage from './pages/CloroResidualCaesPage'
import ControlPlagasCaesPage from './pages/ControlPlagasCaesPage'
import CalibracionBalanzasCaesPage from './pages/CalibracionBalanzasCaesPage'
import TempHumedadAmbientesCaesPage from './pages/TempHumedadAmbientesCaesPage'
import LavadoManosCaesPage from './pages/LavadoManosCaesPage'
import PreparacionSolucionesCaesPage from './pages/PreparacionSolucionesCaesPage'
import ManejoResiduosCaesPage from './pages/ManejoResiduosCaesPage'
import ControlesPage from './pages/ControlesPage'
import RecepcionPage from '@panela/core/pages/RecepcionPage'
import OrdenesPage from './pages/OrdenesPage'
import EmbarquePage from './pages/EmbarquePage'
import CatalogosPage from '@panela/core/pages/CatalogosPage'
import VerificacionLimpiezaPage from '@panela/core/pages/VerificacionLimpiezaPage'

function ProtectedRoute({ children }) {
  const { session, webUser, loading } = useAuthStore()
  if (loading || (session && !webUser)) return <div className="container" style={{ marginTop: 40 }}>Cargando...</div>
  if (!session) return <Navigate to="/login" replace />
  return children
}

// Segunda capa además de ocultar el link en el nav (Layout.jsx) -- sin esto,
// cualquier usuario autenticado podía entrar escribiendo la URL directo.
function AdminRoute({ children }) {
  const webUser = useAuthStore((s) => s.webUser)
  if (webUser?.role !== 'admin_web') {
    return (
      <div className="container" style={{ marginTop: 40 }}>
        <EmptyState icon="alertTriangle" message="Esta sección es solo para administradores." />
      </div>
    )
  }
  return children
}

export default function App() {
  const init = useAuthStore((s) => s.init)

  useEffect(() => {
    init()
  }, [])

  return (
    <CooperativeProvider cooperative={COOPERATIVE}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="usuarios" element={<AdminRoute><UsersPage /></AdminRoute>} />
            <Route path="cupos-produccion" element={<AdminRoute><CuposProduccionPage /></AdminRoute>} />
            <Route path="recepcion" element={<RecepcionPage />} />
            <Route path="calidad" element={<CalidadPage />} />
            <Route path="ordenes" element={<OrdenesPage />} />
            <Route path="bunques" element={<BunquesPage />} />
            <Route path="embarque" element={<EmbarquePage />} />
            <Route path="catalogos" element={<CatalogosPage />} />
            <Route path="reportes" element={<ReportesPage />} />
            <Route path="higiene-caes" element={<HigienePersonalCaesPage />} />
            <Route path="limpieza-general" element={<LimpiezaGeneralPage />} />
            <Route path="verificacion-limpieza" element={<VerificacionLimpiezaPage />} />
            <Route path="cloro-residual-caes" element={<CloroResidualCaesPage />} />
            <Route path="controles" element={<ControlesPage />} />
            <Route path="control-plagas-caes" element={<ControlPlagasCaesPage />} />
            <Route path="calibracion-balanzas-caes" element={<CalibracionBalanzasCaesPage />} />
            <Route path="temp-humedad-ambientes-caes" element={<TempHumedadAmbientesCaesPage />} />
            <Route path="lavado-manos-caes" element={<LavadoManosCaesPage />} />
            <Route path="preparacion-soluciones-caes" element={<PreparacionSolucionesCaesPage />} />
            <Route path="manejo-residuos-caes" element={<ManejoResiduosCaesPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </CooperativeProvider>
  )
}
