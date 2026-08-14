// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentWatermark } from './document-watermark'

/** The inline SVG behind `url("data:image/svg+xml,...")`, decoded. */
function decodedSvg(element: HTMLElement): string {
  const match = /url\("data:image\/svg\+xml,(.*)"\)/.exec(element.style.backgroundImage)
  if (!match) throw new Error(`no svg background found in: ${element.style.backgroundImage}`)
  return decodeURIComponent(match[1])
}

describe('DocumentWatermark', () => {
  it('stays out of the accessibility tree and out of the way of clicks', () => {
    const { container } = render(<DocumentWatermark label="BELUM DIBAYAR" />)

    const overlay = container.firstElementChild as HTMLElement
    expect(overlay.getAttribute('aria-hidden')).toBe('true')
    expect(overlay.className).toContain('pointer-events-none')
  })

  it('paints the label into the tiled background', () => {
    const { container } = render(<DocumentWatermark label="BELUM DIBAYAR" />)

    const overlay = container.firstElementChild as HTMLElement
    expect(decodedSvg(overlay)).toContain('>BELUM DIBAYAR</text>')
    expect(overlay.style.backgroundRepeat).toBe('repeat')
  })

  /**
   * The label is interpolated into SVG markup, so an unescaped angle bracket
   * would close the text element early and drop the rest of the watermark.
   * Escaping is what keeps a label like "PREVIEW <BRD>" a label.
   */
  it('escapes markup characters in the label', () => {
    const { container } = render(<DocumentWatermark label="PREVIEW <BRD> & PRD" />)

    const svg = decodedSvg(container.firstElementChild as HTMLElement)
    expect(svg).toContain('&lt;BRD&gt; &amp; PRD')
    expect(svg).not.toContain('<BRD>')
  })

  /**
   * The ampersand has to be replaced first. Escaping the brackets first would
   * turn a literal "<" into "&lt;" and the following ampersand pass would then
   * escape its own output into "&amp;lt;". The label here is the four
   * characters & l t ; rather than a bracket, so a correct pass yields
   * "&amp;lt;" and a wrong order is visible as "&lt;".
   */
  it('escapes the ampersand before the brackets, not after', () => {
    const { container } = render(<DocumentWatermark label={'&lt;'} />)

    expect(decodedSvg(container.firstElementChild as HTMLElement)).toContain('>&amp;lt;</text>')
  })
})
