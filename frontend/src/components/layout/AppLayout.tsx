import { useState } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import Sidebar from './Sidebar'
import Header from './Header'

export default function AppLayout() {
  const { isAuthenticated, isLoading } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">Загрузка...</span>
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
          'flex flex-1 flex-col overflow-hidden transition-all duration-300',
          sidebarCollapsed ? 'md:ml-[68px]' : 'md:ml-[260px]'
        )}
        id="main-content"
      >
        <Header onMenuToggle={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
