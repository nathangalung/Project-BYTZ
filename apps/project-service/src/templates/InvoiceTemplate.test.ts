import { readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { type InvoiceData, InvoiceTemplate } from './InvoiceTemplate'

const SRC_ROOT = join(import.meta.dirname, '..')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

function sample(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    invoiceNumber: 'INV-2026-0042',
    issuedAt: new Date('2026-07-25T03:00:00.000Z'),
    audience: 'owner',
    owner: { name: 'Budi Santoso', email: 'budi@tokobagus.id' },
    talent: {
      id: '0198c4de-7f31-7a2b-9c4d-5e6f7a8b9c0d',
      name: 'Rina Wijaya',
      email: 'rina@mail.id',
    },
    project: { id: 'p-1', title: 'Marketplace UMKM' },
    milestone: { id: 'm-1', title: 'Backend API', description: 'REST endpoints and auth.' },
    amounts: { subtotal: 7_150_000, platformFee: 2_850_000, total: 10_000_000, currency: 'IDR' },
    ...overrides,
  }
}

function textOf(node: unknown): string[] {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string') return [node]
  if (typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textOf)
  const props = (node as { props?: { children?: unknown } }).props
  return props ? textOf(props.children) : []
}

/**
 * Bun resolves an extensionless import to `.tsx` before `.ts`; Vite resolves
 * `.ts` first. A shadowing pair therefore runs one module in production and
 * tests the other. tsconfig `include` is `src/**\/*.ts`, so `tsc` never sees
 * the `.tsx` half either. This test is the only thing standing between us and
 * a repeat.
 */
describe('module resolution', () => {
  it('has no .ts file shadowed by a .tsx sibling', () => {
    const byStem = new Map<string, string[]>()
    for (const file of walk(SRC_ROOT)) {
      const ext = extname(file)
      if (ext !== '.ts' && ext !== '.tsx') continue
      const stem = file.slice(0, -ext.length)
      byStem.set(stem, [...(byStem.get(stem) ?? []), ext])
    }
    const collisions = [...byStem.entries()]
      .filter(([, exts]) => exts.length > 1)
      .map(([stem]) => relative(SRC_ROOT, stem))
    expect(collisions).toEqual([])
  })
})

describe('InvoiceTemplate', () => {
  it.each(['owner', 'talent', 'admin'] as const)(
    'renders the %s copy as a valid PDF',
    async (a) => {
      const buf = (await renderToBuffer(
        InvoiceTemplate({ data: sample({ audience: a }) }) as never,
      )) as Buffer
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
      expect(buf.length).toBeGreaterThan(2000)
    },
  )

  /**
   * The fee is the gross minus the net, so a copy carrying both figures
   * discloses it by subtraction. Each non-admin copy gets one side only.
   */
  it('shows the owner the gross it funded and never the talent net', () => {
    const text = textOf(InvoiceTemplate({ data: sample() })).join('\n')
    expect(text).toContain('Owner Copy')
    expect(text).toContain('Rp 10.000.000')
    expect(text).not.toContain('7.150.000')
    expect(text).not.toContain('2.850.000')
    expect(text).not.toContain('Platform Service Fee')
  })

  it('shows the talent its payout and never the gross', () => {
    const text = textOf(InvoiceTemplate({ data: sample({ audience: 'talent' }) })).join('\n')
    expect(text).toContain('Talent Copy')
    expect(text).toContain('Rp 7.150.000')
    expect(text).not.toContain('10.000.000')
    expect(text).not.toContain('2.850.000')
    expect(text).not.toContain('Platform Service Fee')
  })

  it('breaks the fee out on the admin copy alone', () => {
    const text = textOf(InvoiceTemplate({ data: sample({ audience: 'admin' }) })).join('\n')
    expect(text).toContain('Admin Copy')
    expect(text).toContain('Platform Service Fee')
    expect(text).toContain('Rp 2.850.000')
    expect(text).toContain('Rp 7.150.000')
    expect(text).toContain('Rp 10.000.000')
  })

  /**
   * Anonymity is a pre-deal rule. An invoice exists only after a milestone
   * settles, and a receipt that hides its payee is not an accounting record.
   */
  it.each(['owner', 'talent', 'admin'] as const)('names both parties on the %s copy', (a) => {
    const text = textOf(InvoiceTemplate({ data: sample({ audience: a }) })).join('\n')
    expect(text).toContain('Rina Wijaya')
    expect(text).toContain('rina@mail.id')
    expect(text).toContain('Budi Santoso')
    expect(text).toContain('budi@tokobagus.id')
  })

  it('truncates a long milestone description instead of overflowing the page', () => {
    const long = 'x'.repeat(900)
    const text = textOf(
      InvoiceTemplate({ data: sample({ milestone: { id: 'm', title: 't', description: long } }) }),
    ).join('\n')
    expect(text).toContain(`${'x'.repeat(397)}...`)
    expect(text).not.toContain(long)
  })
})
