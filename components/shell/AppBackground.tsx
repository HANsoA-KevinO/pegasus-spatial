'use client'

import type { JSX } from 'react'
import { BreathingAirMass } from './BreathingAirMass'

export type AppBackgroundState = 'landing' | 'idle' | 'running'

/** Lightweight application atmosphere, intentionally independent of Canvas. */
export function AppBackground({
  state,
  sidebarWidth = 0,
  conversationPaneWidth = null,
}: {
  state: AppBackgroundState
  sidebarWidth?: number
  conversationPaneWidth?: string | null
}): JSX.Element {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 isolate overflow-hidden bg-surface"
    >
      {sidebarWidth > 0 && (
        <div
          data-layer="sidebar-background"
          className="pmo-resizable-panel absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--glass-panel-bg)_55%,transparent)]"
          style={{ width: sidebarWidth }}
        />
      )}
      {conversationPaneWidth && (
        <div
          data-layer="conversation-background"
          className="absolute bottom-0 right-0 top-16 bg-[color-mix(in_srgb,var(--glass-panel-bg)_38%,transparent)]"
          style={{ width: conversationPaneWidth }}
        />
      )}
      <div
        data-layer="breathing-air-region"
        className="pmo-resizable-offset absolute bottom-0 right-0 top-16 overflow-hidden"
        style={{ left: sidebarWidth }}
      >
        <BreathingAirMass state={state} />
      </div>
      <div
        className="absolute inset-0 transition-all duration-700"
        style={{
          backdropFilter: state === 'idle' ? 'blur(7px) saturate(1.16)' : 'blur(2px)',
          WebkitBackdropFilter: state === 'idle' ? 'blur(7px) saturate(1.16)' : 'blur(2px)',
        }}
      />
    </div>
  )
}
