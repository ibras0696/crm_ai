import { useState } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'
import { useTranslation } from 'react-i18next'

export default function AppLayout() {
  const { isAuthenticated, isLoading } = useAuth()
  const { t } = useTranslation('common')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">{t('layout.loading')}</span>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex h-[100dvh] md:h-screen overflow-hidden">
      <Sidebar
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />
      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden transition-[margin] duration-300',
          sidebarCollapsed ? 'md:ml-[68px]' : 'md:ml-[260px]'
        )}
        id="main-content"
      >
        <Header onMenuToggle={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-background p-4 md:p-6 scrollbar-thin pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
          <Outlet />
        </main>
        <BottomNav onMorePress={() => setMobileMenuOpen(true)} />
      </div>
    </div>
  )
}
