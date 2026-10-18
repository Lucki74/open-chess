// Single source of truth for the renderer CSP. Used by electron/main.ts (response header)
// and vite.config.ts (meta tag in index.html, since webRequest may not see file:// loads).
export function buildCsp(dev: boolean): string {
  const connect = dev ? "'self' ws://localhost:*" : "'self'"
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
  ].join('; ')
}
