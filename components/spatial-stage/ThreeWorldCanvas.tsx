'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { SpatialCanvasHandle, SpatialQualityRenderState, StageCameraPose } from './three-stage-types'
import type { ThreeSceneInput, ThreeSceneRuntime } from './three-scene-runtime'
import styles from './SpatialStage.module.css'

export type { SpatialCanvasHandle, SpatialQualityRenderState, StageCameraPose } from './three-stage-types'

interface Props extends ThreeSceneInput {
  onQualityStateChange?: (state: SpatialQualityRenderState) => void
  onSelectInstance?: (instanceId: string | null) => void
  onCameraChange?: (pose: StageCameraPose) => void
}

export const ThreeWorldCanvas = forwardRef<SpatialCanvasHandle, Props>(function ThreeWorldCanvas(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<ThreeSceneRuntime | null>(null)
  const propsRef = useRef(props)
  const [state, setState] = useState({ loading: true, error: null as string | null })
  const [keyboardActive, setKeyboardActive] = useState(false)
  useEffect(() => { propsRef.current = props; runtimeRef.current?.sync(props) }, [props])

  useImperativeHandle(ref, () => ({
    isReady: () => runtimeRef.current?.isReady() ?? false,
    renderedRevisionId: () => runtimeRef.current?.renderedRevisionId() ?? null,
    capture: (viewpoint, revision) => runtimeRef.current?.capture(viewpoint, revision) ?? Promise.reject(new Error('空间舞台尚未就绪。')),
    querySurface: (id, horizontal, height, axis) => runtimeRef.current?.querySurface(id, horizontal, height, axis) ?? Promise.reject(new Error('空间舞台尚未就绪。')),
    currentViewpoint: () => runtimeRef.current?.currentViewpoint() ?? null,
    visibleInstanceIds: viewpoint => runtimeRef.current?.visibleInstanceIds(viewpoint) ?? [],
    resetUserView: () => runtimeRef.current?.resetUserView(),
    focusObject: key => runtimeRef.current?.focusObject(key),
  }), [])

  useEffect(() => {
    let cancelled = false
    // Browser-only loading also keeps WebGL/Spark out of server execution.
    void import('./three-scene-runtime').then(({ ThreeSceneRuntime }) => {
      if (cancelled || !containerRef.current) return
      const runtime = new ThreeSceneRuntime(containerRef.current, {
        onState: (loading, error) => setState({ loading, error }),
        onQualityStateChange: value => propsRef.current.onQualityStateChange?.(value),
        onSelectInstance: value => propsRef.current.onSelectInstance?.(value),
        onCameraChange: value => propsRef.current.onCameraChange?.(value),
        onKeyboardActive: setKeyboardActive,
      })
      runtimeRef.current = runtime
      runtime.sync(propsRef.current)
    }).catch(cause => { if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : '渲染器初始化失败。' }) })
    return () => { cancelled = true; runtimeRef.current?.dispose(); runtimeRef.current = null }
  }, [])

  return <div className={styles.viewerRoot}>
    <div ref={containerRef} className={styles.viewerContainer} aria-label="Three.js 空间查看器" tabIndex={0} title="点击画面激活；WASD 水平移动；Q/E 升降；Shift 加速；左键旋转，右键平移，滚轮缩放" />
    {state.loading && <div className={styles.viewerState} role="status"><strong>正在载入空间</strong><p>正在读取场景几何与环境。</p></div>}
    {state.error && <div className={styles.viewerWarning} role="alert"><strong>场景尚未完整载入</strong><span>{state.error}</span></div>}
    {!state.loading && props.cameraMode !== 'agent' && <div className={styles.viewerHint} data-active={keyboardActive}>
      <span className={styles.controlState}>{keyboardActive ? '自由相机已激活' : '点击画面激活自由相机'}</span>
      <span className={styles.keyGroup}><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><b>水平移动</b></span>
      <span className={styles.keyGroup}><kbd>Q</kbd><kbd>E</kbd><b>下降 / 上升</b></span>
      <span className={styles.mouseControl}>左键旋转 · 右键平移 · Shift 加速</span>
    </div>}
    {props.cameraMode === 'agent' && <div className={styles.viewerHint}><span className={styles.controlState}>Agent 视角只读 · 切回用户视角后可移动</span></div>}
  </div>
})
