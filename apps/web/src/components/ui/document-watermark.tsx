type DocumentWatermarkProps = { label: string }

// XML-safe text for the inline SVG.
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Tiled diagonal watermark over an unpaid BRD/PRD preview.
 *
 * The whole document is visible before payment; this marks every screenful so a
 * screenshot carries the label. The clean, watermark-free PDF is the paid
 * unlock. Rendered as a repeating inline-SVG background so it covers the full
 * scroll height, not just one centred word.
 */
export function DocumentWatermark({ label }: DocumentWatermarkProps) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">` +
      `<text x="160" y="110" fill="#152e34" fill-opacity="0.07" font-size="26" font-weight="700" ` +
      `font-family="Inter, sans-serif" text-anchor="middle" transform="rotate(-30 160 110)">` +
      `${escapeXml(label)}</text></svg>`,
  )
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20"
      style={{ backgroundImage: `url("data:image/svg+xml,${svg}")`, backgroundRepeat: 'repeat' }}
    />
  )
}
