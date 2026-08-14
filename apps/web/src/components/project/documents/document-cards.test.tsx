// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileText } from 'lucide-react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { DocumentCard, EmptyDocCard } from './document-cards'
import type { DocumentItem } from './shared'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

function doc(overrides: Partial<DocumentItem> = {}): DocumentItem {
  return {
    id: 'doc-1',
    title: 'BRD Marketplace UMKM',
    type: 'brd',
    status: 'approved',
    date: '2026-08-13T00:00:00.000Z',
    version: 2,
    fileUrl: null,
    linkTo: null,
    ...overrides,
  }
}

function renderInRouter(node: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/projects/new',
        component: () => null,
      }),
      createRoute({ getParentRoute: () => rootRoute, path: '/brd', component: () => null }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(<RouterProvider router={router} />)
}

describe('DocumentCard', () => {
  it('shows the title, the translated status and the version', () => {
    render(<DocumentCard doc={doc()} />)

    expect(screen.getByRole('heading', { name: 'BRD Marketplace UMKM' })).toBeDefined()
    expect(screen.getByText('Disetujui')).toBeDefined()
    expect(screen.getByText('Versi 2')).toBeDefined()
  })

  it('omits the version line for a document that has none', () => {
    render(<DocumentCard doc={doc({ version: null })} />)

    expect(screen.queryByText(/Versi/)).toBeNull()
  })

  it('dates the document', () => {
    render(<DocumentCard doc={doc()} />)

    expect(screen.getByText('Tanggal: 13 Agustus 2026')).toBeDefined()
  })

  describe('the download control', () => {
    /**
     * An icon-only link needs its own accessible name, and it has to open in a
     * new tab without handing the opener over - the target is a signed storage
     * URL, so rel is not cosmetic here.
     */
    it('is a named link that does not leak the opener', () => {
      render(<DocumentCard doc={doc({ fileUrl: 'https://files.example/brd.pdf' })} />)

      const link = screen.getByRole('link', { name: 'Unduh' })
      expect(link.getAttribute('href')).toBe('https://files.example/brd.pdf')
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    })

    /**
     * With no file the control becomes a dimmed span rather than a dead link.
     * That is honest about there being nothing to fetch, but it also means the
     * disabled state is unreachable by keyboard and unnamed to a screen
     * reader, which reads as the control simply not existing.
     */
    it('degrades to an unreachable placeholder when there is no file', () => {
      render(<DocumentCard doc={doc({ fileUrl: null })} />)

      expect(screen.queryByRole('link', { name: 'Unduh' })).toBeNull()
    })
  })

  describe('signing', () => {
    it('offers no sign action unless the caller passes a handler', () => {
      render(<DocumentCard doc={doc({ type: 'contract', status: 'pending' })} />)

      expect(screen.queryByRole('button', { name: /Tandatangani/ })).toBeNull()
    })

    it('signs when the control is pressed', async () => {
      const user = userEvent.setup()
      const onSign = vi.fn()
      render(<DocumentCard doc={doc({ type: 'contract', status: 'pending' })} onSign={onSign} />)

      await user.click(screen.getByRole('button', { name: /Tandatangani/ }))

      expect(onSign).toHaveBeenCalledTimes(1)
    })

    /**
     * Signing is not idempotent on the server side, so a second press while
     * the first is in flight has to be refused rather than merely discouraged.
     */
    it('refuses a second press while signing is in flight', async () => {
      const user = userEvent.setup()
      const onSign = vi.fn()
      render(<DocumentCard doc={doc({ type: 'contract' })} onSign={onSign} isSigning />)

      const button = screen.getByRole('button', { name: /Tandatangani/ })
      expect((button as HTMLButtonElement).disabled).toBe(true)
      await user.click(button)

      expect(onSign).not.toHaveBeenCalled()
    })

    it('shows a spinner in place of the pen while signing', () => {
      const { container } = render(
        <DocumentCard doc={doc({ type: 'contract' })} onSign={vi.fn()} isSigning />,
      )

      expect(container.querySelector('.animate-spin')).not.toBeNull()
    })
  })

  it('wraps the whole card in a link when there is somewhere to go', async () => {
    renderInRouter(<DocumentCard doc={doc({ linkTo: '/brd' })} />)

    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('/brd')
    expect(link.textContent).toContain('BRD Marketplace UMKM')
  })

  it('renders no link when there is nowhere to go', () => {
    render(<DocumentCard doc={doc({ linkTo: null })} />)

    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it.each(['brd', 'prd', 'contract', 'invoice', 'other'] as const)(
    'gives the %s type its own badge',
    (type) => {
      render(<DocumentCard doc={doc({ type })} />)

      expect(screen.getByText(type)).toBeDefined()
    },
  )

  /**
   * The type and status maps are keyed by strings the API supplies. Falling
   * back rather than indexing undefined is what keeps an unrecognised value
   * from throwing on `typeConfig.icon`.
   */
  it('falls back for a type and a status it does not know', () => {
    render(
      <DocumentCard
        doc={doc({ type: 'nda' as DocumentItem['type'], status: 'void' as DocumentItem['status'] })}
      />,
    )

    expect(screen.getByRole('heading', { name: 'BRD Marketplace UMKM' })).toBeDefined()
  })
})

describe('EmptyDocCard', () => {
  it('explains what is missing', () => {
    render(<EmptyDocCard icon={<FileText />} message="Belum ada BRD" />)

    expect(screen.getByText('Belum ada BRD')).toBeDefined()
  })

  it('offers no action when there is nowhere to send the user', () => {
    render(<EmptyDocCard icon={<FileText />} message="Belum ada BRD" />)

    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('offers the way forward when there is one', async () => {
    renderInRouter(
      <EmptyDocCard
        icon={<FileText />}
        message="Belum ada BRD"
        linkTo="/projects/new"
        linkLabel="Buat Proyek"
      />,
    )

    const link = await screen.findByRole('link', { name: /Buat Proyek/ })
    expect(link.getAttribute('href')).toBe('/projects/new')
  })

  /**
   * Both halves of the action are needed. A label with no destination, or a
   * destination with no label, renders an anchor nobody can read or follow.
   */
  it.each([
    ['destination', { linkTo: '/projects/new' }],
    ['label', { linkLabel: 'Buat Proyek' }],
  ])('renders no action given only a %s', (_name, props) => {
    renderInRouter(<EmptyDocCard icon={<FileText />} message="Belum ada BRD" {...props} />)

    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})
