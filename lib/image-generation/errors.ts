export class ImageGenerationProviderError extends Error {
  readonly requestMayHaveBeenAccepted: boolean
  readonly code: string

  constructor(
    message: string,
    options: { code: string; requestMayHaveBeenAccepted: boolean; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ImageGenerationProviderError'
    this.code = options.code
    this.requestMayHaveBeenAccepted = options.requestMayHaveBeenAccepted
  }
}

export class ImageGenerationReceiptConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageGenerationReceiptConflictError'
  }
}

export function boundedErrorMessage(error: unknown, maxLength = 2_000): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, 'data:image/[REDACTED]')
    .slice(0, maxLength)
}
