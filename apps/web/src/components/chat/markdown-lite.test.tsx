// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownLite, parseBlocks } from './markdown-lite'

/**
 * What the owner reads in the scoping thread.
 *
 * The bubble used to render the model's reply as a raw string, so `**bold**`
 * arrived with its asterisks and numbered steps ran together in one line. These
 * assert the rendered output, not the parse tree, because the parse tree was
 * never the thing that was wrong.
 */

describe('markdown the scoping assistant emits', () => {
  it('renders bold instead of printing asterisks', () => {
    const { container } = render(<MarkdownLite content="Fitur **out-of-scope** untuk fase ini." />)

    expect(container.querySelector('strong')?.textContent).toBe('out-of-scope')
    expect(container.textContent).not.toContain('**')
  })

  it('keeps emphasis inside backticks literal', () => {
    const { container } = render(<MarkdownLite content="Gunakan `a ** b` di sini." />)

    expect(container.querySelector('code')?.textContent).toBe('a ** b')
    expect(container.querySelector('strong')).toBeNull()
  })

  /** snake_case identifiers must survive as written. */
  it('leaves underscores inside a word alone', () => {
    const { container } = render(<MarkdownLite content="Kolom estimated_timeline_days dipakai." />)

    expect(container.querySelector('em')).toBeNull()
    expect(container.textContent).toContain('estimated_timeline_days')
  })

  it('renders dashed lines as a list', () => {
    render(<MarkdownLite content={'Kebutuhan:\n- Login\n- Pembayaran'} />)

    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['Login', 'Pembayaran'])
  })

  it('renders numbered lines as an ordered list', () => {
    const { container } = render(<MarkdownLite content={'1. Analisis\n2. Desain\n3. Bangun'} />)

    expect(container.querySelector('ol')).not.toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  /**
   * The complaint in the screenshot: the model wrote the steps inline, so they
   * arrived as one unbroken paragraph.
   */
  it('breaks steps the model wrote inline onto their own lines', () => {
    render(<MarkdownLite content="Tahapannya 1. riset pasar 2. prototipe 3. rilis" />)

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'riset pasar',
      'prototipe',
      'rilis',
    ])
    expect(screen.getByText('Tahapannya').tagName).toBe('P')
  })

  /**
   * Rupiah figures carry digits next to a dot and a space. Splitting one would
   * tear the number in half, which is worse than leaving the text as prose.
   */
  it('does not mistake a money figure for a numbered list', () => {
    const content = 'Anggaran Rp 50.000.000 sampai Rp 150.000.000 sudah termasuk 2. tahap uji'
    const blocks = parseBlocks(content)

    expect(blocks.every((block) => block.kind === 'paragraph')).toBe(true)
  })

  it('needs the run to start at one and climb by one', () => {
    expect(parseBlocks('lihat 2. dan 5. saja')).toEqual([
      { kind: 'paragraph', text: 'lihat 2. dan 5. saja' },
    ])
  })

  it('renders a heading as its own emphasised line', () => {
    render(<MarkdownLite content={'## Ringkasan\nIsi ringkasan.'} />)

    expect(screen.getByText('Ringkasan').textContent).not.toContain('#')
  })

  it('separates paragraphs split by a blank line', () => {
    const { container } = render(<MarkdownLite content={'Baris satu.\n\nBaris dua.'} />)

    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  it('renders plain text unchanged', () => {
    render(<MarkdownLite content="Tidak ada markup di sini." />)

    expect(screen.getByText('Tidak ada markup di sini.').tagName).toBe('P')
  })

  it('renders nothing for an empty reply', () => {
    const { container } = render(<MarkdownLite content="" />)

    expect(container.querySelectorAll('p')).toHaveLength(0)
  })
})
