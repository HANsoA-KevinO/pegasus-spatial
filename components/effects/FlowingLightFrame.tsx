'use client'

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

interface FlowingLightFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

const MIN_DURATION_SECONDS = 9
const MAX_DURATION_SECONDS = 14
const FLOW_WAVE_SEGMENTS = 57

/**
 * 流光：以光带轴心为最亮点，沿运动方向向两侧线性衰减。
 * 光带长度与动画周期都由边框周长计算，容器尺寸变化后会自动适配。
 */
export function FlowingLightFrame({
  children,
  className = '',
  onFocusCapture,
  ...props
}: FlowingLightFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const axisRef = useRef<SVGRectElement>(null)
  const [metrics, setMetrics] = useState({ width: 1, height: 1, pathLength: 1, waveLength: 1 })

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const updateFlowMetrics = () => {
      const { width, height } = frame.getBoundingClientRect()
      const rectWidth = Math.max(1, width - 6)
      const rectHeight = Math.max(1, height - 6)
      const radius = Math.min(14, rectWidth / 2, rectHeight / 2)
      const perimeter = Math.max(1, 2 * (rectWidth + rectHeight - 4 * radius) + 2 * Math.PI * radius)
      const duration = Math.min(
        MAX_DURATION_SECONDS,
        Math.max(MIN_DURATION_SECONDS, perimeter / 230),
      )
      const desiredWaveLength = Math.min(1080, Math.max(520, perimeter * 0.42))
      const waveLength = Math.max(1, Math.min(desiredWaveLength, perimeter * 0.72))
      const fillDuration = Math.min(2.5, Math.max(1.6, perimeter / 1200))

      frame.style.setProperty('--pmo-flow-duration', `${duration.toFixed(2)}s`)
      frame.style.setProperty('--pmo-flow-fill-duration', `${fillDuration.toFixed(2)}s`)
      frame.style.setProperty('--pmo-flow-path-length', `${perimeter.toFixed(2)}px`)
      frame.dataset.flowPerimeter = perimeter.toFixed(0)
      frame.dataset.flowDuration = duration.toFixed(2)
      frame.dataset.flowFillDuration = fillDuration.toFixed(2)
      setMetrics(current => {
        const next = {
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
          pathLength: perimeter,
          waveLength,
        }
        return current.width === next.width
          && current.height === next.height
          && Math.abs(current.pathLength - next.pathLength) < 0.5
          && Math.abs(current.waveLength - next.waveLength) < 0.5
          ? current
          : next
      })
    }

    updateFlowMetrics()
    const observer = new ResizeObserver(updateFlowMetrics)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  const inset = 3
  const rectWidth = Math.max(0, metrics.width - inset * 2)
  const rectHeight = Math.max(0, metrics.height - inset * 2)
  const radius = Math.min(14, rectWidth / 2, rectHeight / 2)

  const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    onFocusCapture?.(event)
    if (!(event.target instanceof HTMLTextAreaElement)) return

    const frame = frameRef.current
    const axis = axisRef.current
    if (!frame || !axis) return

    const axisStyle = getComputedStyle(axis)
    const dashOffset = Number.parseFloat(axisStyle.strokeDashoffset)
    const segmentLength = Number.parseFloat(
      axisStyle.getPropertyValue('--pmo-flow-segment-length'),
    )
    if (!Number.isFinite(dashOffset) || !Number.isFinite(segmentLength)) return

    const fillStart = ((-dashOffset + segmentLength) % metrics.pathLength + metrics.pathLength)
      % metrics.pathLength
    const flowDuration = Number.parseFloat(frame.dataset.flowDuration ?? '')
    const fillDuration = Number.parseFloat(frame.dataset.flowFillDuration ?? '')
    const idleAdvance = Number.isFinite(flowDuration)
      && flowDuration > 0
      && Number.isFinite(fillDuration)
      ? metrics.pathLength * (fillDuration / flowDuration)
      : 0
    const fillEnd = fillStart + idleAdvance

    frame.style.setProperty('--pmo-flow-fill-start', `${fillStart.toFixed(2)}px`)
    frame.style.setProperty('--pmo-flow-fill-end', `${fillEnd.toFixed(2)}px`)
    frame.dataset.flowFillStart = fillStart.toFixed(0)
    frame.dataset.flowFillEnd = fillEnd.toFixed(0)
  }

  return (
    <div
      ref={frameRef}
      data-effect-name="流光"
      className={`pmo-flowing-light ${className}`}
      onFocusCapture={handleFocusCapture}
      {...props}
    >
      <svg
        className="pmo-flowing-light__path"
        data-flow-direction="axis-forward"
        viewBox={`0 0 ${metrics.width} ${metrics.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g className="pmo-flowing-light__wave-group">
          {Array.from({ length: FLOW_WAVE_SEGMENTS }, (_, index) => {
            // 使用奇数个微段让正中间恰好落在光带轴心。轴心亮度为 1，
            // 两侧按与轴心的归一化距离线性降至 0，形成对称的三角衰减。
            const axisIndex = Math.floor(FLOW_WAVE_SEGMENTS / 2)
            const axisDistance = Math.abs(index - axisIndex) / axisIndex
            const linearFalloff = Math.max(0, 1 - axisDistance)
            const stride = metrics.waveLength / (FLOW_WAVE_SEGMENTS - 1)
            const overlapCount = 3
            const segmentLength = Math.min(metrics.pathLength, Math.max(2, stride * overlapCount))
            const startOffset = -(index * stride)
            const endOffset = startOffset - metrics.pathLength
            const targetOpacity = 0.96 * linearFalloff
            const compensatedOpacity = 1 - Math.pow(1 - targetOpacity, 1 / overlapCount)
            const opacity = compensatedOpacity
            const strokeWidth = 2.1 + 1.5 * linearFalloff
            const primaryPercent = 96 - 50 * linearFalloff
            const segmentStyle = {
              '--pmo-flow-segment-start': `${startOffset.toFixed(2)}px`,
              '--pmo-flow-segment-end': `${endOffset.toFixed(2)}px`,
              '--pmo-flow-segment-stroke': `color-mix(in srgb, var(--primary) ${primaryPercent.toFixed(2)}%, white ${(100 - primaryPercent).toFixed(2)}%)`,
              '--pmo-flow-segment-length': `${segmentLength.toFixed(2)}px`,
              '--pmo-flow-segment-gap': `${Math.max(1, metrics.pathLength - segmentLength).toFixed(2)}px`,
              '--pmo-flow-segment-cap': index === axisIndex ? 'round' : 'butt',
              '--pmo-flow-segment-width': `${strokeWidth.toFixed(3)}px`,
              '--pmo-flow-segment-opacity': opacity.toFixed(6),
            } as CSSProperties

            return (
              <rect
                key={index}
                ref={index === axisIndex ? axisRef : undefined}
                className="pmo-flowing-light__wave"
                data-flow-part={index === axisIndex ? 'axis' : undefined}
                x={inset}
                y={inset}
                width={rectWidth}
                height={rectHeight}
                rx={radius}
                pathLength={metrics.pathLength}
                style={segmentStyle}
              />
            )
          })}
        </g>
        <rect
          className="pmo-flowing-light__focus-fill"
          x={inset}
          y={inset}
          width={rectWidth}
          height={rectHeight}
          rx={radius}
          pathLength={metrics.pathLength}
        />
      </svg>
      {children}
    </div>
  )
}
