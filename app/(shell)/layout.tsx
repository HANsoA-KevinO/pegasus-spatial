'use client'

import { usePathname } from 'next/navigation'
import { TopNavBar } from '@/components/shell/TopNavBar'
import { AppSidebar } from '@/components/shell/AppSidebar'
import { AppBackground, type AppBackgroundState } from '@/components/shell/AppBackground'
import { NavigationProgress } from '@/components/loading/NavigationProgress'
import { useChatContext } from '@/contexts/ChatContext'
import { useWorkspaceLayout } from '@/contexts/WorkspaceLayoutContext'

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { sidebarCollapsed, messages, isLoading, showWorkspace } = useChatContext()
  const { leftSidebarWidth, rightPanelWidth } = useWorkspaceLayout()
  const backgroundState: AppBackgroundState = isLoading ? 'running' : messages.length ? 'idle' : 'landing'
  const showSidebar = !pathname.startsWith('/library') && !pathname.startsWith('/store')
  const sidebarWidth = showSidebar ? (sidebarCollapsed ? 64 : leftSidebarWidth) : 0
  const conversationPaneWidth = showSidebar && backgroundState !== 'landing'
    ? (showWorkspace ? `${rightPanelWidth}px` : `calc(100% - ${sidebarWidth}px)`)
    : null
  return (
    <div className="relative isolate h-screen">
      <AppBackground
        state={backgroundState}
        sidebarWidth={sidebarWidth}
        conversationPaneWidth={conversationPaneWidth}
      />
      <NavigationProgress />
      <TopNavBar />
      {showSidebar && <AppSidebar />}
      <div
        data-resizable-offset="left-sidebar"
        className="pmo-resizable-offset relative z-10 flex h-screen min-w-0 pt-16"
        style={{ marginLeft: sidebarWidth }}
      >
        {children}
      </div>
    </div>
  )
}
