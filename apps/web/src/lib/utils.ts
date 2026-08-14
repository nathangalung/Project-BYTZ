/**
 * Formatting lives in @kerjacus/ui-kit so apps/web and apps/admin cannot drift
 * apart again. Re-exported here because ~50 call sites already import from
 * '@/lib/utils'; add web-only helpers below, shared ones to the package.
 */
export {
  cn,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatDateShort,
} from '@kerjacus/ui-kit'
