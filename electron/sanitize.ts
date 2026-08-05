const CREDENTIAL_ASSIGNMENT =
  /\b(authorization|bearer|cookie|password|secret|token)\s*[:=]\s*[^\s;|]+/gi

export function sanitizeSensitiveText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s|]+/g, (url) => {
      try {
        const parsed = new URL(url)
        return `${parsed.origin}${parsed.pathname}`
      } catch {
        return '[url]'
      }
    })
    .replace(/\/Users\/[^\s|]+/g, '[local-path]')
    .replace(/[A-Za-z]:\\Users\\[^\s|]+/g, '[local-path]')
    .replace(CREDENTIAL_ASSIGNMENT, '$1=[redacted]')
}
