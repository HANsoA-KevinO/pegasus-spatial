export const DEFAULT_SCENE_FRAME_OCCUPANCY = 0.62

const MIN_HALF_FOV_RADIANS = Math.PI / 180

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

/**
 * Returns a camera distance that keeps a bounding sphere inside the viewport
 * while making it occupy a stable share of the shorter screen dimension.
 *
 * Using the limiting horizontal/vertical field of view makes the result work
 * for both the narrow embedded Stage and the standalone full-screen Stage.
 */
export function cameraDistanceForBoundingSphere({
  radius,
  verticalFovDeg,
  aspect,
  occupancy = DEFAULT_SCENE_FRAME_OCCUPANCY,
  minimumDistance = 0.2,
  maximumDistance = 5_000,
}: {
  radius: number
  verticalFovDeg: number
  aspect: number
  occupancy?: number
  minimumDistance?: number
  maximumDistance?: number
}): number {
  const safeRadius = Math.max(Math.abs(radius), 0.001)
  const verticalHalfFov = clamp(verticalFovDeg, 20, 100) * Math.PI / 360
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(aspect, 0.1))
  const limitingHalfFov = Math.max(Math.min(verticalHalfFov, horizontalHalfFov), MIN_HALF_FOV_RADIANS)
  const targetHalfAngle = limitingHalfFov * clamp(occupancy, 0.35, 0.85)
  const fittedDistance = safeRadius / Math.sin(targetHalfAngle)

  return clamp(
    fittedDistance,
    Math.max(minimumDistance, safeRadius * 1.05),
    Math.max(maximumDistance, minimumDistance),
  )
}
