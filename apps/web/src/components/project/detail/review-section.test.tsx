// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { type User, useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { ReviewSection } from './review-section'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
})

const OWNER: User = {
  id: 'u-owner',
  email: 'owner@kerjacus.id',
  name: 'Pemilik',
  role: 'owner',
  locale: 'id',
}

const TALENT: User = { ...OWNER, id: 'u-talent', role: 'talent', name: 'Talenta' }

type Review = {
  id: string
  projectId: string
  reviewerId: string
  revieweeId: string
  rating: number
  comment: string | null
  type: 'owner_to_talent' | 'talent_to_owner'
  createdAt: string
}

function signIn(user: User) {
  useAuthStore.setState({ user, isAuthenticated: true, isLoading: false })
}

const PROJECT = {
  status: 'completed',
  ownerId: 'u-owner',
  assignments: [{ talentUserId: 'u-talent' }],
}

type PostBehaviour = {
  /** Leave the POST unsettled so the in-flight state stays on screen. */
  hangs?: boolean
  /** Reject with something that has no `.message`, e.g. a dropped socket. */
  throwsNonError?: boolean
}

/** Routes GET reviews and POST review separately so each can be asserted. */
function stubApi(reviews: Review[], postStatus = 200, post_: PostBehaviour = {}) {
  const post = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (post_.hangs) return new Promise<Response>(() => {})
        if (post_.throwsNonError) return Promise.reject('socket hang up')
        post(JSON.parse(String(init.body)))
        return Promise.resolve(
          new Response(JSON.stringify(postStatus === 200 ? { success: true, data: {} } : {}), {
            status: postStatus,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: reviews }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
  return post
}

function renderSection(project: Record<string, unknown> = PROJECT) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ReviewSection projectId="p-1" project={project as { status: string }} />
    </QueryClientProvider>,
  )
}

describe('ReviewSection', () => {
  /**
   * Reviews are attributed to the signed-in user, so with no session there is
   * nobody to attribute one to. Rendering nothing is what keeps a signed-out
   * visitor from filling in a form that cannot be submitted.
   */
  it('renders nothing to a signed-out visitor', () => {
    stubApi([])
    const { container } = renderSection()

    expect(container.firstChild).toBeNull()
  })

  it('shows a busy indicator while the reviews load', () => {
    signIn(OWNER)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    const { container } = renderSection()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  describe('the rating control', () => {
    /**
     * Five icon-only buttons need names that say how many stars each awards,
     * or a screen reader hears the same control five times over.
     */
    it('names each star by the score it awards', async () => {
      signIn(OWNER)
      stubApi([])
      renderSection()

      expect(await screen.findByRole('button', { name: '1 bintang' })).toBeDefined()
      expect(screen.getByRole('button', { name: '5 bintang' })).toBeDefined()
    })

    it('shows the chosen score once a star is picked', async () => {
      const user = userEvent.setup()
      signIn(OWNER)
      stubApi([])
      renderSection()

      await user.click(await screen.findByRole('button', { name: '4 bintang' }))

      expect(screen.getByText('4/5')).toBeDefined()
    })

    it('shows no score before one is picked', async () => {
      signIn(OWNER)
      stubApi([])
      renderSection()

      await screen.findByRole('button', { name: '1 bintang' })
      expect(screen.queryByText('0/5')).toBeNull()
    })
  })

  describe('submitting', () => {
    it('refuses to submit without a rating', async () => {
      signIn(OWNER)
      stubApi([])
      renderSection()

      const submit = await screen.findByRole('button', { name: /Kirim ulasan/ })
      expect((submit as HTMLButtonElement).disabled).toBe(true)
    })

    it('sends the rating, the comment and the direction of the review', async () => {
      const user = userEvent.setup()
      signIn(OWNER)
      const post = stubApi([])
      renderSection()

      await user.click(await screen.findByRole('button', { name: '5 bintang' }))
      await user.type(screen.getByLabelText('Komentar'), 'Kerja bagus')
      await user.click(screen.getByRole('button', { name: /Kirim ulasan/ }))

      await waitFor(() => {
        expect(post).toHaveBeenCalledWith({
          projectId: 'p-1',
          revieweeId: 'u-talent',
          rating: 5,
          comment: 'Kerja bagus',
          type: 'owner_to_talent',
        })
      })
    })

    /**
     * The owner reviews the assigned talent and the talent reviews the owner.
     * Getting the direction wrong files the rating against the wrong party,
     * and ratings feed the matching algorithm.
     */
    it('points a talent review back at the project owner', async () => {
      const user = userEvent.setup()
      signIn(TALENT)
      const post = stubApi([])
      renderSection()

      await user.click(await screen.findByRole('button', { name: '4 bintang' }))
      await user.click(screen.getByRole('button', { name: /Kirim ulasan/ }))

      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          expect.objectContaining({ revieweeId: 'u-owner', type: 'talent_to_owner' }),
        )
      })
    })

    it('omits an empty comment rather than sending whitespace', async () => {
      const user = userEvent.setup()
      signIn(OWNER)
      const post = stubApi([])
      renderSection()

      await user.click(await screen.findByRole('button', { name: '3 bintang' }))
      await user.type(screen.getByLabelText('Komentar'), '   ')
      await user.click(screen.getByRole('button', { name: /Kirim ulasan/ }))

      // JSON.stringify drops an undefined value, so the key never leaves.
      await waitFor(() => {
        expect(post).toHaveBeenCalledTimes(1)
      })
      expect(Object.hasOwn(post.mock.calls[0][0] as object, 'comment')).toBe(false)
    })

    it('confirms the submission and clears the form', async () => {
      const user = userEvent.setup()
      signIn(OWNER)
      stubApi([])
      renderSection()

      await user.click(await screen.findByRole('button', { name: '5 bintang' }))
      await user.type(screen.getByLabelText('Komentar'), 'Kerja bagus')
      await user.click(screen.getByRole('button', { name: /Kirim ulasan/ }))

      await waitFor(() => {
        expect(useToastStore.getState().toasts[0]?.message).toBe('Ulasan terkirim')
      })
      expect((screen.getByLabelText('Komentar') as HTMLTextAreaElement).value).toBe('')
    })

    it('reports a failed submission rather than pretending it worked', async () => {
      const user = userEvent.setup()
      signIn(OWNER)
      stubApi([], 500)
      renderSection()

      await user.click(await screen.findByRole('button', { name: '5 bintang' }))
      await user.click(screen.getByRole('button', { name: /Kirim ulasan/ }))

      await waitFor(() => {
        expect(useToastStore.getState().toasts[0]?.type).toBe('error')
      })
    })

    /**
     * The toast reads `err.message`, which a rejection that is not an Error
     * does not have. Without the fallback the owner is shown a toast reading
     * "undefined" and no way to tell whether the rating was recorded.
     */
    it('names the failure when the rejection carries no message', async () => {
      const user = userEvent.setup()
      signIn(OWNER)
      stubApi([], 200, { throwsNonError: true })
      renderSection()

      await user.click(await screen.findByRole('button', { name: '5 bintang' }))
      await user.click(screen.getByRole('button', { name: /Kirim ulasan/ }))

      await waitFor(() => {
        expect(useToastStore.getState().toasts[0]?.message).toBe('Ulasan gagal terkirim, coba lagi')
      })
    })

    /** A rating is posted once; the in-flight state is what stops a double send. */
    it('shows the submission in flight rather than an idle button', async () => {
      const user = userEvent.setup()
      signIn(OWNER)
      stubApi([], 200, { hangs: true })
      const { container } = renderSection()

      await user.click(await screen.findByRole('button', { name: '5 bintang' }))
      await user.click(screen.getByRole('button', { name: /Kirim ulasan/ }))

      const submit = await screen.findByRole<HTMLButtonElement>('button', { name: /Kirim ulasan/ })
      await waitFor(() => expect(submit.disabled).toBe(true))
      expect(container.querySelector('.animate-spin')).not.toBeNull()
    })

    /**
     * With nobody assigned there is no reviewee, and posting would file the
     * rating against an empty id. Refusing with a message is what keeps the
     * request from being made at all.
     */
    it('refuses when the project has nobody to review', async () => {
      const user = userEvent.setup()
      signIn(OWNER)
      const post = stubApi([])
      renderSection({ status: 'completed', assignments: [] })

      await user.click(await screen.findByRole('button', { name: '5 bintang' }))
      await user.click(screen.getByRole('button', { name: /Kirim ulasan/ }))

      await waitFor(() => {
        expect(useToastStore.getState().toasts[0]?.type).toBe('error')
      })
      expect(post).not.toHaveBeenCalled()
    })
  })

  describe('once a review has been left', () => {
    const myReview: Review = {
      id: 'r-1',
      projectId: 'p-1',
      reviewerId: 'u-owner',
      revieweeId: 'u-talent',
      rating: 4,
      comment: 'Tepat waktu',
      type: 'owner_to_talent',
      createdAt: '2026-08-13T00:00:00.000Z',
    }

    it('replaces the form with what was submitted', async () => {
      signIn(OWNER)
      stubApi([myReview])
      renderSection()

      expect(await screen.findByText('Kamu sudah memberi ulasan untuk proyek ini')).toBeDefined()
      expect(screen.getByText('Tepat waktu')).toBeDefined()
      expect(screen.queryByRole('button', { name: /Kirim ulasan/ })).toBeNull()
    })

    /**
     * Four filled stars out of five. Filling all of them, or none, is the
     * failure that would show the reviewer a score they did not give.
     */
    it('shows the score that was given', async () => {
      signIn(OWNER)
      stubApi([myReview])
      const { container } = renderSection()

      await screen.findByText('Kamu sudah memberi ulasan untuk proyek ini')
      expect(container.querySelectorAll('.fill-accent-cream-600')).toHaveLength(4)
    })

    it('renders the confirmation without a comment', async () => {
      signIn(OWNER)
      stubApi([{ ...myReview, comment: null }])
      renderSection()

      expect(await screen.findByText('Kamu sudah memberi ulasan untuk proyek ini')).toBeDefined()
    })

    /**
     * Both parties review the same project, so the check has to match on the
     * reviewer and the direction. Matching on the project alone would hide the
     * owner's form as soon as the talent had left theirs.
     */
    it('still offers the form when only the other party has reviewed', async () => {
      signIn(OWNER)
      stubApi([
        {
          ...myReview,
          id: 'r-2',
          reviewerId: 'u-talent',
          revieweeId: 'u-owner',
          type: 'talent_to_owner',
        },
      ])
      renderSection()

      expect(await screen.findByRole('button', { name: /Kirim ulasan/ })).toBeDefined()
      expect(screen.queryByText('Kamu sudah memberi ulasan untuk proyek ini')).toBeNull()
    })
  })

  it('counts the comment against its limit', async () => {
    const user = userEvent.setup()
    signIn(OWNER)
    stubApi([])
    renderSection()

    const comment = await screen.findByLabelText('Komentar')
    expect(screen.getByText('0/2000')).toBeDefined()
    expect((comment as HTMLTextAreaElement).maxLength).toBe(2000)

    await user.type(comment, 'Halo')
    expect(screen.getByText('4/2000')).toBeDefined()
  })
})
