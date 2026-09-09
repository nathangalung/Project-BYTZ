import type { Page } from '@playwright/test'

export type ContrastFinding = {
  selector: string
  sample: string
  color: string
  background: string
  fontSize: number
  fontWeight: number
  ratio: number
  required: number
}

export type ContrastReport = {
  checked: number
  skipped: number
  failures: ContrastFinding[]
}

/**
 * Measures text against its painted background.
 *
 * styles.contrast.test.ts does this arithmetic on the token files, so it can
 * only see pairs that are written as tokens. A class and the background behind
 * it usually sit on different elements, which is why the sidebar wordmark
 * failure was invisible to grep. This composites the background up the
 * ancestor chain instead, the way the browser paints it.
 */
export async function collectContrastFailures(page: Page): Promise<ContrastReport> {
  return page.evaluate(() => {
    type Rgba = { r: number; g: number; b: number; a: number }

    function parseColor(value: string): Rgba | null {
      const match = value.match(/rgba?\(([^)]+)\)/)
      if (!match) return null
      const parts = match[1]
        .split(/[,\s/]+/)
        .filter(Boolean)
        .map(Number)
      if (parts.length < 3 || parts.some(Number.isNaN)) return null
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
    }

    // Source over, opaque backdrop
    function blend(top: Rgba, bottom: Rgba): Rgba {
      const a = top.a
      return {
        r: top.r * a + bottom.r * (1 - a),
        g: top.g * a + bottom.g * (1 - a),
        b: top.b * a + bottom.b * (1 - a),
        a: 1,
      }
    }

    function channel(value: number): number {
      const c = value / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }

    function luminance(color: Rgba): number {
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
    }

    function contrast(a: Rgba, b: Rgba): number {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }

    /** Null when a gradient blocks the read. */
    function paintedBackground(start: Element): Rgba | null {
      const layers: Rgba[] = []
      let node: Element | null = start
      while (node) {
        const style = getComputedStyle(node)
        if (style.backgroundImage !== 'none') return null
        const parsed = parseColor(style.backgroundColor)
        if (parsed && parsed.a > 0) {
          if (parsed.a >= 1) {
            return layers.reduceRight((below, above) => blend(above, below), parsed)
          }
          layers.push(parsed)
        }
        node = node.parentElement
      }
      const base: Rgba = { r: 255, g: 255, b: 255, a: 1 }
      return layers.reduceRight((below, above) => blend(above, below), base)
    }

    function describe(el: Element): string {
      const parts: string[] = []
      let node: Element | null = el
      for (let depth = 0; node && depth < 3; depth++) {
        const id = node.id ? `#${node.id}` : ''
        const cls =
          node.className && typeof node.className === 'string'
            ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}`
            : ''
        parts.unshift(`${node.tagName.toLowerCase()}${id}${cls}`)
        node = node.parentElement
      }
      return parts.join(' > ')
    }

    function ownText(el: Element): string {
      let text = ''
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
      }
      return text.trim()
    }

    const failures: ContrastFinding[] = []
    let checked = 0
    let skipped = 0

    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const sample = ownText(el)
      if (!sample) continue
      if (el.closest('[aria-hidden="true"]')) continue
      // WCAG 1.4.3 exempts disabled
      if (el.closest(':disabled')) continue

      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      if (Number(style.opacity) === 0) continue
      if (el.getClientRects().length === 0) continue

      const color = parseColor(style.color)
      const background = paintedBackground(el)
      if (!color || !background) {
        skipped++
        continue
      }

      const painted = color.a < 1 ? blend(color, background) : color
      const fontSize = Number.parseFloat(style.fontSize)
      const fontWeight = Number(style.fontWeight) || 400
      const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700)
      const required = large ? 3 : 4.5
      const ratio = contrast(painted, background)
      checked++

      if (ratio + 0.005 < required) {
        failures.push({
          selector: describe(el),
          sample: sample.slice(0, 60),
          color: style.color,
          background: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
          fontSize,
          fontWeight,
          ratio: Math.round(ratio * 100) / 100,
          required,
        })
      }
    }

    return { checked, skipped, failures }
  })
}

/** One line per failing pair. */
export function formatFindings(findings: ContrastFinding[]): string {
  return findings
    .map(
      (f) =>
        `${f.ratio}:1 (needs ${f.required}) ${f.color} on ${f.background} ` +
        `${f.fontSize}px/${f.fontWeight} "${f.sample}" at ${f.selector}`,
    )
    .join('\n')
}
