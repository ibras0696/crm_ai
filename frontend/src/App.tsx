import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import MembersPage from './pages/MembersPage'
import SettingsPage from './pages/SettingsPage'
import AuditLogPage from './pages/AuditLogPage'
import LandingPage from './pages/LandingPage'
import TablesPage from './pages/TablesPage'
import TableDetailPage from './pages/TableDetailPage'
import KnowledgePage from './pages/KnowledgePage'
import SchedulePage from './pages/SchedulePage'
import ReportsPage from './pages/ReportsPage'
import AIPage from './pages/AIPage'
import AdminPage from './pages/AdminPage'
import BillingPage from './pages/BillingPage'
import PlansPage from './pages/PlansPage'
import SuperAdminPage from './pages/SuperAdminPage'
import AppLayout from './components/layout/AppLayout'
import { useAuth } from './contexts/AuthContext'

function RootRedirect() {
  const { isAuthenticated } = useAuth()
  return <Navigate to={isAuthenticated ? '/dashboard' : '/landing'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/landing" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/audit" element={<AuditLogPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tables" element={<TablesPage />} />
        <Route path="/tables/:tableId" element={<TableDetailPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/ai" element={<AIPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/plans" element={<PlansPage />} />
      </Route>
      <Route path="/superadmin" element={<SuperAdminPage />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  )
}
