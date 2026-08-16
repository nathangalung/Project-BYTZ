// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useToastStore } from '@/stores/toast'
import * as documentsRoute from './documents'

/**
 * Where the owner signs the NDA and the IP transfer agreement.
 *
 * Signing is the legal step that hands ownership of the deliverables over, and
 * nothing had ever executed this file - it reported zero statements, so it was
 * outside the coverage denominator rather than counted as uncovered. The page
 * also assembles four separate feeds into one list, and an invoice attributed
 * to the wrong milestone links the owner to someone else's PDF.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const PROJECT = { id: 'p-1', title: 'Toko Online Batik', status: 'in_progress' }
const BRD = {
  id: 'b-1',
  status: 'approved',
  version: 2,
  createdAt: '2026-01-05T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
}
const PRD = {
  id: 'd-1',
  status: 'draft',
  version: 1,
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: null,
}
const UNSIGNED_NDA = {
  id: 'c-1',
  type: 'standard_nda',
  signedByOwner: false,
  signedByTalent: false,
  signedAt: null,
  createdAt: '2026-02-11T00:00:00.000Z',
}

type Feeds = {
  project?: unknown
  brd?: unknown
  prd?: unknown
  contracts?: unknown[]
  transactions?: unknown[]
  invoices?: unknown[]
}

/**
 * Routes every read this page makes. Each feed is separate: a contract failure
 * must not blank the invoices, so they are stubbed independently.
 */
function stubApi(feeds: Feeds = {}) {
  const {
    project = PROJECT,
    brd = BRD,
    prd = PRD,
    contracts = [],
    transactions = [],
    invoices = [],
  } = feeds
  apiFetch.mockImplementation(async (url: string) => {
    const path = String(url)
    if (path.includes('/contracts/')) return { success: true, data: contracts }
    if (path.includes('/payments/project/')) return { success: true, data: transactions }
    if (path.includes('/invoices')) return { success: true, data: invoices }
    if (path.endsWith('/brd')) return { success: true, data: brd }
    if (path.endsWith('/prd')) return { success: true, data: prd }
    return { success: true, data: project }
  })
}

/** The upload path bypasses apiFetch entirely: presign, then PUT to storage. */
function stubUpload({ presignOk = true }: { presignOk?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('presigned-url')) {
      return new Response(
        JSON.stringify({ data: { url: 'https://storage.test/uploads/spec.pdf?sig=abc' } }),
        { status: presignOk ? 200 : 500 },
      )
    }
    return new Response('', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function render() {
  return renderRoute(documentsRoute, {
    path: '/projects/$projectId/documents',
    entry: '/projects/p-1/documents',
    destinations: [
      '/projects/$projectId',
      '/projects/$projectId/brd',
      '/projects/$projectId/prd',
      '/projects/$projectId/scoping',
    ],
  })
}

function toastMessages() {
  return useToastStore.getState().toasts.map((toast) => toast.message)
}

/** Sections are headed but unlabelled, so they are located by their heading. */
function section(name: string) {
  return within(screen.getByRole('heading', { name }).parentElement as HTMLElement)
}

beforeEach(() => {
  apiFetch.mockReset()
  stubApi()
  stubUpload()
  useToastStore.setState({ toasts: [] })
})

describe('loading the project', () => {
  it('shows a spinner rather than empty sections while the project arrives', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))

    const { container } = await render()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Documents' })).toBeNull()
  })

  it('names the project it belongs to', async () => {
    await render()

    expect(
      (await screen.findByRole('link', { name: 'Toko Online Batik' })).getAttribute('href'),
    ).toBe('/projects/p-1')
  })
})

describe('the requirement documents', () => {
  it('lists the BRD and the PRD with the version each is on', async () => {
    await render()

    expect(await screen.findByText('Business Requirement Document')).toBeDefined()
    expect(screen.getByText('Product Requirement Document')).toBeDefined()
    expect(screen.getByText(/Version\s*2/)).toBeDefined()
  })

  /** Without a BRD the owner needs the way to make one, not a blank panel. */
  it('sends the owner to scoping when there is no BRD yet', async () => {
    stubApi({ brd: null })

    await render()

    expect(await screen.findByText('BRD not available yet')).toBeDefined()
    expect(screen.getByRole('link', { name: /Go to BRD/ }).getAttribute('href')).toBe(
      '/projects/p-1/scoping',
    )
  })

  it('says the PRD is missing rather than showing an empty card', async () => {
    stubApi({ prd: null })

    await render()

    expect(await screen.findByText('PRD not available yet')).toBeDefined()
  })

  it('opens the BRD card at the BRD page', async () => {
    await render()

    const link = (await screen.findByText('Business Requirement Document')).closest('a')
    expect(link?.getAttribute('href')).toBe('/projects/p-1/brd')
  })
})

/**
 * Signing transfers ownership of the deliverables, so a contract that is not
 * yet countersigned must offer the control and one that is must not.
 */
describe('signing a contract', () => {
  it('offers the sign control while the contract is unsigned', async () => {
    stubApi({ contracts: [UNSIGNED_NDA] })

    await render()

    expect(await screen.findByText('NDA - Toko Online Batik')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Sign' })).toBeDefined()
  })

  it('withdraws the sign control once both parties have signed', async () => {
    stubApi({
      contracts: [
        {
          ...UNSIGNED_NDA,
          signedByOwner: true,
          signedByTalent: true,
          signedAt: '2026-02-12T00:00:00.000Z',
        },
      ],
    })

    await render()

    expect(await screen.findByText('NDA - Toko Online Batik')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull()
  })

  /** One signature is not agreement; the control stays until both are in. */
  it('keeps the sign control when only the talent has signed', async () => {
    stubApi({ contracts: [{ ...UNSIGNED_NDA, signedByTalent: true }] })

    await render()

    expect(await screen.findByRole('button', { name: 'Sign' })).toBeDefined()
  })

  it('sends the signature and confirms it', async () => {
    stubApi({ contracts: [UNSIGNED_NDA] })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: 'Sign' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/api/v1/contracts/c-1/sign', { method: 'PATCH' }),
    )
    expect(toastMessages()).toContain('Contract signed')
  })

  it('reports a refused signature rather than looking signed', async () => {
    stubApi({ contracts: [UNSIGNED_NDA] })
    apiFetch.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path.includes('/sign')) throw new Error('not a party to this contract')
      if (path.includes('/contracts/')) return { success: true, data: [UNSIGNED_NDA] }
      if (path.includes('/payments/project/')) return { success: true, data: [] }
      if (path.includes('/invoices')) return { success: true, data: [] }
      if (path.endsWith('/brd')) return { success: true, data: BRD }
      if (path.endsWith('/prd')) return { success: true, data: PRD }
      return { success: true, data: PROJECT }
    })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: 'Sign' }))

    await waitFor(() => expect(toastMessages()).toContain('Upload failed'))
  })

  it('names the IP transfer agreement distinctly from the NDA', async () => {
    stubApi({ contracts: [{ ...UNSIGNED_NDA, id: 'c-2', type: 'ip_transfer' }] })

    await render()

    expect(await screen.findByText('IP Transfer Agreement - Toko Online Batik')).toBeDefined()
  })

  it('says there are no contracts rather than showing an empty grid', async () => {
    await render()

    expect(await screen.findByText('No contracts yet')).toBeDefined()
  })
})

/**
 * Invoices are built from transactions, and only the money-moving types count.
 * An escrow deposit is not an invoice and must not be listed as one.
 */
describe('the invoice list', () => {
  const RELEASE = {
    id: 'tx-1',
    type: 'escrow_release',
    amount: 4_000_000,
    status: 'completed',
    milestoneId: 'm-1',
    createdAt: '2026-03-01T00:00:00.000Z',
  }

  it('lists a milestone release, a BRD payment and a PRD payment', async () => {
    stubApi({
      transactions: [
        RELEASE,
        { ...RELEASE, id: 'tx-2', type: 'brd_payment', milestoneId: null },
        { ...RELEASE, id: 'tx-3', type: 'prd_payment', milestoneId: null },
      ],
    })

    await render()

    expect(await screen.findByText('Invoice - Milestone')).toBeDefined()
    expect(screen.getByText('Invoice - BRD')).toBeDefined()
    expect(screen.getByText('Invoice - PRD')).toBeDefined()
  })

  it('leaves an escrow deposit out of the invoice list', async () => {
    stubApi({ transactions: [{ ...RELEASE, id: 'tx-9', type: 'escrow_in' }] })

    await render()

    expect(await screen.findByText('No invoices yet')).toBeDefined()
  })

  it('attaches the PDF belonging to that milestone', async () => {
    stubApi({
      transactions: [RELEASE],
      invoices: [
        {
          invoiceNumber: 'INV-1',
          milestoneId: 'm-1',
          downloadUrl: '/api/v1/projects/p-1/invoices/m-1.pdf',
          audience: 'owner',
          generatedAt: '2026-03-01T00:00:00.000Z',
        },
      ],
    })

    await render()

    const card =
      ((await screen.findByText('Invoice - Milestone')).closest('div')
        ?.parentElement as HTMLElement) ?? document.body
    expect(within(card).getByRole('link', { name: 'Download' }).getAttribute('href')).toContain(
      '/api/v1/projects/p-1/invoices/m-1.pdf',
    )
  })

  /** No matching invoice row means no link, not a link to nothing. */
  it('offers no download when the invoice PDF has not been generated', async () => {
    stubApi({ transactions: [RELEASE] })

    await render()

    expect(await screen.findByText('Invoice - Milestone')).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull()
  })

  it('marks an incomplete transaction as pending rather than paid', async () => {
    stubApi({ transactions: [{ ...RELEASE, status: 'processing' }] })

    await render()

    expect(await screen.findByText('Invoice - Milestone')).toBeDefined()
    expect(section('Invoice').getByText('Pending')).toBeDefined()
  })
})

describe('uploading a supporting file', () => {
  const FILE = new File(['halo'], 'spesifikasi.pdf', { type: 'application/pdf' })

  /** The file input carries a real label, so it is reached the way a user is. */
  async function chooser() {
    return (await screen.findByLabelText('Upload Document')) as HTMLInputElement
  }

  /**
   * The drop zone is an unlabelled div with no role, so it is located by the
   * instruction printed inside it. Three other cards on this page carry the
   * same dashed-border classes, which is why a class selector finds the wrong
   * element.
   */
  async function dropZone() {
    const prompt = await screen.findByText('Drag & drop files or click to upload')
    return prompt.parentElement as HTMLElement
  }

  it('stores the file and lists it once the upload lands', async () => {
    const fetchMock = stubUpload()
    const user = userEvent.setup()
    await render()

    await user.upload(await chooser(), FILE)

    expect(await screen.findByText('spesifikasi.pdf')).toBeDefined()
    // Presign first, then a PUT straight to storage - the backend never sees bytes.
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/upload/presigned-url')
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://storage.test/uploads/spec.pdf?sig=abc')
  })

  it('reports a failed presign instead of listing a file that was never stored', async () => {
    stubUpload({ presignOk: false })
    const user = userEvent.setup()
    await render()

    await user.upload(await chooser(), FILE)

    await waitFor(() => expect(toastMessages()).toContain('Upload failed'))
    expect(screen.queryByText('spesifikasi.pdf')).toBeNull()
  })

  it('lets the owner take an uploaded file back off the list', async () => {
    const user = userEvent.setup()
    await render()
    await user.upload(await chooser(), FILE)
    expect(await screen.findByText('spesifikasi.pdf')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(screen.queryByText('spesifikasi.pdf')).toBeNull())
  })

  /** Drag events have no user-event equivalent, so fireEvent is right here. */
  it('highlights the drop zone while a file is held over it', async () => {
    await render()
    const zone = await dropZone()

    fireEvent.dragOver(zone)
    expect(zone.className).toContain('border-brand-accent/40')

    fireEvent.dragLeave(zone)
    expect(zone.className).not.toContain('border-brand-accent/40')
  })

  it('uploads a dropped file the same way as a chosen one', async () => {
    const fetchMock = stubUpload()
    await render()
    const zone = await dropZone()

    fireEvent.drop(zone, { dataTransfer: { files: [FILE] } })

    expect(await screen.findByText('spesifikasi.pdf')).toBeDefined()
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/upload/presigned-url')
  })

  it('reports a failed drop rather than silently dropping the file', async () => {
    stubUpload({ presignOk: false })
    await render()
    const zone = await dropZone()

    fireEvent.drop(zone, { dataTransfer: { files: [FILE] } })

    await waitFor(() => expect(toastMessages()).toContain('Upload failed'))
  })

  it('does nothing when the file chooser is dismissed with no file', async () => {
    const fetchMock = stubUpload()
    await render()

    fireEvent.change(await chooser(), { target: { files: [] } })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
