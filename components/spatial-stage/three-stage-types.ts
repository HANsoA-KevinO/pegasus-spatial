import type { SceneViewpoint, Vec3 } from '@/lib/spatial/scene-types'

export interface StageCameraPose extends SceneViewpoint { distance: number }
export interface SpatialCanvasHandle {
  currentTime?(): number
  renderedBuildId?(): string | null
  focusObject?(key: string): void
  isReady(): boolean
  renderedRevisionId(): string | null
  capture(viewpoint?: SceneViewpoint, expectedRevisionId?: string): Promise<Blob>
  querySurface(terrainInstanceId: string, horizontal: [number, number], castHeight: number, upAxis: 'Y' | 'Z'): Promise<Vec3>
  currentViewpoint(): SceneViewpoint | null
  visibleInstanceIds(viewpoint?: SceneViewpoint): string[]
  resetUserView(): void
}
export interface SpatialQualityRenderState {
  status: 'glb' | 'loading' | 'ply' | 'error'
  instanceId: string | null
  error?: string
  loadedCount?: number
  totalCount?: number
}
export interface SpatialAgentMarker { id: string; label: string; color: string; viewpoint: SceneViewpoint }
