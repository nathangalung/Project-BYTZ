/**
 * Formatting lives in @kerjacus/ui-kit so apps/web and apps/admin cannot drift
 * apart again. Re-exported here because the routes already import from
 * '@/lib/utils'; add admin-only helpers below, shared ones to the package.
 */
export { cn, formatCurrencyCompact, formatDateShort, formatDateTime } from '@kerjacus/ui-kit'

export function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase()
}
