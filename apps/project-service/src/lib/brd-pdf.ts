import type { BrdPdfData } from '../templates/BrdDocument'

// The normaliser lives in packages/shared alongside prd-content: it was
// duplicated here and in the web preview, and the copies drifted in both
// directions - the preview claimed a team of one, this one dropped legacy
// risk objects and requirement bodies from the document owners pay for.
export { brdLanguage, normalizeBrdContent } from '@kerjacus/shared'

/** Render a BRD to a PDF buffer. Lazy-imports the renderer. */
export async function renderBrdPdf(data: BrdPdfData): Promise<Buffer> {
  const [{ renderToBuffer }, { BrdDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('../templates/BrdDocument'),
  ])
  return (await renderToBuffer(BrdDocument({ data }) as never)) as Buffer
}
