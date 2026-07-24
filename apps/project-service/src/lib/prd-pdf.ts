import type { PrdLanguage, PrdPdfData } from '../templates/PrdDocument'

type Raw = Record<string, unknown>

export function prdLanguage(raw: unknown): PrdLanguage {
  const value = typeof raw === 'object' && raw !== null ? (raw as Raw).language : undefined
  return value === 'en' ? 'en' : 'id'
}

export async function renderPrdPdf(data: PrdPdfData): Promise<Buffer> {
  const [{ renderToBuffer }, { PrdDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('../templates/PrdDocument'),
  ])
  return (await renderToBuffer(PrdDocument({ data }) as never)) as Buffer
}
