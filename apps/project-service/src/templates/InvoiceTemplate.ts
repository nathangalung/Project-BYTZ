/**
 * Invoice PDF template using @react-pdf/renderer.
 *
 * Uses React.createElement directly (no JSX) to avoid widening the
 * project's tsconfig include glob to `*.tsx`.
 *
 * Brand palette:
 *   #152e34 — primary dark teal (headings, accents)
 *   #3b526a — body text slate
 *   #5e677d — muted/footer
 *   #f6f3ab — cream highlight (totals row)
 */

// Lazy require pattern would be cleaner but @react-pdf/renderer exposes
// all components at the package root; we import statically so types resolve.
// The library itself is pure JS once installed; only rendering hits PDFKit.
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { createElement as h } from 'react'

export type InvoiceData = {
  invoiceNumber: string
  issuedAt: Date
  isAdminCopy: boolean
  owner: { name: string; email: string }
  talent: { id: string; name: string; email: string }
  project: { id: string; title: string }
  milestone: { id: string; title: string; description: string }
  amounts: {
    subtotal: number
    platformFee: number
    total: number
    currency: 'IDR'
  }
}

const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  year: 'numeric',
  month: 'long',
  day: '2-digit',
})

function formatRupiah(amount: number): string {
  return `Rp ${rupiahFormatter.format(amount)}`
}

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: 'Helvetica',
    fontSize: 11,
    color: '#3b526a',
    backgroundColor: '#ffffff',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: '#152e34',
    paddingBottom: 16,
    marginBottom: 24,
  },
  brand: {
    fontSize: 22,
    fontWeight: 700,
    color: '#152e34',
  },
  brandSub: {
    fontSize: 9,
    color: '#5e677d',
    marginTop: 4,
  },
  metaBlock: {
    textAlign: 'right',
  },
  invoiceNumber: {
    fontSize: 13,
    fontWeight: 700,
    color: '#152e34',
  },
  metaLabel: {
    fontSize: 9,
    color: '#5e677d',
    marginTop: 2,
  },
  partiesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  partyBlock: {
    width: '48%',
  },
  partyLabel: {
    fontSize: 9,
    color: '#5e677d',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  partyName: {
    fontSize: 12,
    fontWeight: 700,
    color: '#152e34',
  },
  partyDetail: {
    fontSize: 10,
    color: '#3b526a',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#152e34',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 8,
  },
  projectBlock: {
    backgroundColor: '#f4f5f7',
    padding: 12,
    marginBottom: 24,
    borderLeftWidth: 3,
    borderLeftColor: '#152e34',
  },
  projectTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: '#152e34',
    marginBottom: 4,
  },
  milestoneTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#3b526a',
    marginTop: 4,
  },
  milestoneDesc: {
    fontSize: 10,
    color: '#5e677d',
    marginTop: 4,
    lineHeight: 1.4,
  },
  amountsTable: {
    marginTop: 8,
    marginBottom: 24,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e8eaed',
  },
  amountLabel: {
    fontSize: 10,
    color: '#3b526a',
  },
  amountValue: {
    fontSize: 10,
    color: '#3b526a',
    fontFamily: 'Helvetica',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: '#152e34',
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: '#ffffff',
  },
  totalValue: {
    fontSize: 12,
    fontWeight: 700,
    color: '#ffffff',
  },
  adminBadge: {
    backgroundColor: '#e59a91',
    color: '#152e34',
    padding: 4,
    fontSize: 8,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 36,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: '#e8eaed',
    paddingTop: 8,
    fontSize: 8,
    color: '#5e677d',
    textAlign: 'center',
  },
})

function anonymizeTalent(talent: InvoiceData['talent']): {
  displayName: string
  displayEmail: string
} {
  const shortId = talent.id.slice(-8).toUpperCase()
  return {
    displayName: `Talent #${shortId}`,
    displayEmail: '(hidden until contract complete)',
  }
}

export function InvoiceTemplate(props: { data: InvoiceData }) {
  const { data } = props
  const anon = data.isAdminCopy
    ? { displayName: data.talent.name, displayEmail: data.talent.email }
    : anonymizeTalent(data.talent)

  return h(
    Document,
    {
      title: `Invoice ${data.invoiceNumber}`,
      author: 'KerjaCUS!',
      subject: `Invoice for ${data.milestone.title}`,
    },
    h(
      Page,
      { size: 'A4', style: styles.page },
      data.isAdminCopy
        ? h(Text, { style: styles.adminBadge }, 'Admin Copy — Includes Platform Fee Breakdown')
        : null,
      // Header
      h(
        View,
        { style: styles.headerRow },
        h(
          View,
          {},
          h(Text, { style: styles.brand }, 'KerjaCUS! Invoice'),
          h(Text, { style: styles.brandSub }, 'Managed Marketplace for Digital Projects'),
        ),
        h(
          View,
          { style: styles.metaBlock },
          h(Text, { style: styles.invoiceNumber }, data.invoiceNumber),
          h(Text, { style: styles.metaLabel }, `Issued ${dateFormatter.format(data.issuedAt)}`),
        ),
      ),
      // Parties
      h(
        View,
        { style: styles.partiesRow },
        h(
          View,
          { style: styles.partyBlock },
          h(Text, { style: styles.partyLabel }, 'Project Owner'),
          h(Text, { style: styles.partyName }, data.owner.name),
          h(Text, { style: styles.partyDetail }, data.owner.email),
        ),
        h(
          View,
          { style: styles.partyBlock },
          h(Text, { style: styles.partyLabel }, 'Talent'),
          h(Text, { style: styles.partyName }, anon.displayName),
          h(Text, { style: styles.partyDetail }, anon.displayEmail),
        ),
      ),
      // Project + milestone
      h(Text, { style: styles.sectionTitle }, 'Project Details'),
      h(
        View,
        { style: styles.projectBlock },
        h(Text, { style: styles.projectTitle }, data.project.title),
        h(Text, { style: styles.milestoneTitle }, `Milestone: ${data.milestone.title}`),
        h(
          Text,
          { style: styles.milestoneDesc },
          data.milestone.description.length > 400
            ? `${data.milestone.description.slice(0, 397)}...`
            : data.milestone.description,
        ),
      ),
      // Amounts
      h(Text, { style: styles.sectionTitle }, 'Amount'),
      h(
        View,
        { style: styles.amountsTable },
        h(
          View,
          { style: styles.amountRow },
          h(Text, { style: styles.amountLabel }, 'Subtotal (talent payout)'),
          h(Text, { style: styles.amountValue }, formatRupiah(data.amounts.subtotal)),
        ),
        data.isAdminCopy
          ? h(
              View,
              { style: styles.amountRow },
              h(Text, { style: styles.amountLabel }, 'Platform Service Fee'),
              h(Text, { style: styles.amountValue }, formatRupiah(data.amounts.platformFee)),
            )
          : null,
        h(
          View,
          { style: styles.totalRow },
          h(Text, { style: styles.totalLabel }, 'TOTAL'),
          h(Text, { style: styles.totalValue }, formatRupiah(data.amounts.total)),
        ),
      ),
      // Footer
      h(
        Text,
        { style: styles.footer, fixed: true },
        `Generated by KerjaCUS! Platform on ${dateFormatter.format(data.issuedAt)} — ${data.invoiceNumber}`,
      ),
    ),
  )
}
