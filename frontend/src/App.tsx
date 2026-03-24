import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/auth/LoginPage'
import RegisterPage from './pages/auth/RegisterPage'
import LandingPage from './pages/auth/LandingPage'
import PrivacyPolicyPage from './pages/auth/PrivacyPolicyPage'
import PersonalDataConsentPage from './pages/auth/PersonalDataConsentPage'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage'
import ResetPasswordPage from './pages/auth/ResetPasswordPage'
import AcceptInvitePage from './pages/auth/AcceptInvitePage'
import PublicContentPage from './pages/public/PublicContentPage'
import DashboardPage from './pages/org/DashboardPage'
import MembersPage from './pages/org/MembersPage'
import SettingsPage from './pages/org/SettingsPage'
import AuditLogPage from './pages/admin/AuditLogPage'
import AdminPage from './pages/admin/AdminPage'
import SuperAdminPage from './pages/superadmin/SuperAdminPage'
import BillingPage from './pages/billing/BillingPage'
import BillingSuccessPage from './pages/billing/BillingSuccessPage'
import PlansPage from './pages/billing/PlansPage'
import TablesPage from './pages/tables/TablesPage'
import TableDetailPage from './pages/tables/TableDetailPage'
import DocsPage from './pages/docs/DocsPage'
import KnowledgePage from './pages/knowledge/KnowledgePage'
import SchedulePage from './pages/schedule/SchedulePage'
import ReportsPage from './pages/reports/ReportsPage'
import AIPage from './pages/ai/AIPage'
import AppLayout from './components/layout/AppLayout'
import { useAuth } from './contexts/AuthContext'
import { ErrorBoundary } from './components/common/ErrorBoundary'

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
      <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/invite/accept" element={<AcceptInvitePage />} />
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route path="/personal-data-consent" element={<PersonalDataConsentPage />} />
      <Route path="/product/:slug" element={<PublicContentPage />} />
      <Route path="/company/:slug" element={<PublicContentPage />} />
      <Route path="/legal/:slug" element={<PublicContentPage />} />
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/audit" element={<AuditLogPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tables" element={<TablesPage />} />
        <Route path="/tables/:tableId" element={<TableDetailPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/ai" element={<AIPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/billing/success" element={<BillingSuccessPage />} />
        <Route path="/plans" element={<PlansPage />} />
      </Route>
      <Route
        path="/superadmin"
        element={
          <ErrorBoundary title="Суперадмин">
            <SuperAdminPage />
          </ErrorBoundary>
        }
      />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  )
}
