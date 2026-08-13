/**
 * URL resolution, with no imports of its own.
 *
 * This lived in lib/api.ts, which made two import cycles: stores/auth imports
 * apiUrl from there, and api.ts dynamically imports stores/auth inside its 401
 * branch to log the user out. lib/centrifugo closed a second loop the same way.
 *
 * The dynamic import is deliberate and stays, so no bundler ever saw a static
 * cycle, which is why a static analyser reports zero here. The coupling was
 * real all the same: stores/auth could not load without the whole fetch client
 * behind it. Splitting the three symbols both sides actually wanted into a leaf
 * removes the edge instead of hiding it.
 */

// Empty in dev where Vite proxies, absolute in production.
export const API_BASE_URL = (import.meta.env.VITE_API_URL as string) ?? ''

// Absolute URLs pass through unchanged.
export function resolveUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${API_BASE_URL}${url}`
}

export function apiUrl(path: string): string {
  return resolveUrl(path)
}
