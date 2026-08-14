const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/**
 * Exact Rupiah: "Rp 1.000.000".
 *
 * Intl separates the symbol with a non-breaking space, which is what keeps
 * "Rp" from wrapping away from its amount. Do not hand-roll `Rp ${n}` as a
 * substitute; that reintroduces the break.
 */
export function formatCurrency(amount: number): string {
  return rupiah.format(amount)
}

// Thousands grouping only, so "Rp 2.500 jt" reads as Indonesian.
const juta = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

/**
 * Rupiah folded to a fixed width for dense UI: "Rp 6 jt", "Rp 2.500 jt".
 *
 * For columns that cannot hold a full amount, meaning stat tiles, chart axes
 * and table cells. Prefer formatCurrency wherever the figure has to reconcile
 * against another one, because rounding to juta makes final_price,
 * talent_payout and platform_fee visibly fail to add up.
 *
 * Juta all the way up, with no miliar suffix. The admin panel used to fold a
 * miliar to "Rp 2.5M", and spreading that to the web app was rejected on the
 * grounds that "M" reads as either miliar or million depending on the reader,
 * and a 1000x misread lands on pages showing somebody their own cumulative
 * earnings. "jt" only ever means juta, so the wider column buys an amount that
 * cannot be misread. This is a product decision, not a formatting preference.
 */
export function formatCurrencyCompact(amount: number): string {
  if (amount >= 1_000_000) {
    return `Rp ${juta.format(Math.round(amount / 1_000_000))} jt`
  }
  return rupiah.format(amount)
}

/** "13 Agustus 2026" */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date))
}

/** "13 Agu 2026" */
export function formatDateShort(date: string | Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

/** "13 Agu 2026, 14.30" */
export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}
