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
    isAdminCopy: false,
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
  it('renders the owner copy as a valid PDF', async () => {
    const buf = (await renderToBuffer(InvoiceTemplate({ data: sample() }) as never)) as Buffer
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(2000)
  })

  it('renders the admin copy as a valid PDF', async () => {
    const buf = (await renderToBuffer(
      InvoiceTemplate({ data: sample({ isAdminCopy: true }) }) as never,
    )) as Buffer
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(2000)
  })

  it('withholds the platform fee from the non-admin copy', () => {
    const text = textOf(InvoiceTemplate({ data: sample() })).join('\n')
    expect(text).not.toContain('Platform Service Fee')
    expect(text).not.toContain('2.850.000')
  })

  it('breaks the fee out on the admin copy', () => {
    const text = textOf(InvoiceTemplate({ data: sample({ isAdminCopy: true }) })).join('\n')
    expect(text).toContain('Platform Service Fee')
    expect(text).toContain('Rp 2.850.000')
    expect(text).toContain('Admin Copy')
  })

  it('anonymizes the talent on the non-admin copy and names them on the admin copy', () => {
    const owner = textOf(InvoiceTemplate({ data: sample() })).join('\n')
    expect(owner).toContain('Talent #7A8B9C0D')
    expect(owner).not.toContain('Rina Wijaya')
    expect(owner).not.toContain('rina@mail.id')

    const admin = textOf(InvoiceTemplate({ data: sample({ isAdminCopy: true }) })).join('\n')
    expect(admin).toContain('Rina Wijaya')
    expect(admin).toContain('rina@mail.id')
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
