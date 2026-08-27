'use client'

import { TopNavBar } from '@/components/shell/TopNavBar'
import { NavigationProgress } from '@/components/loading/NavigationProgress'

export default function SpatialStageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen overflow-hidden bg-[#080b0f]">
      <NavigationProgress />
      <TopNavBar />
      <div className="h-screen pt-16">{children}</div>
    </div>
  )
}
