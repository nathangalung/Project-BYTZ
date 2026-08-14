// @vitest-environment jsdom
import { ProjectVisibility } from '@kerjacus/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import type { FormData } from './shared'
import { Step1BasicInfo } from './step-basic-info'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const t = i18n.getFixedT('id', 'project')

function form(overrides: Partial<FormData> = {}): FormData {
  return {
    title: '',
    description: '',
    category: 'web_app',
    budgetMin: '',
    budgetMax: '',
    estimatedTimelineDays: '',
    deadline: '',
    almamater: '',
    minExperience: '',
    requiredSkills: [],
    visibility: ProjectVisibility.PUBLIC_SUMMARY,
    documentFileKey: '',
    documentType: '',
    ...overrides,
  }
}

/** Presign then PUT: the browser uploads straight to storage. */
function stubUpload({ presignFails = false } = {}) {
  const puts: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(String(url))
        return Promise.resolve(new Response('', { status: 200 }))
      }
      if (presignFails) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'X' } }), { status: 500 }),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: { url: 'https://storage.example/signed', key: 'document/brief.pdf' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }),
  )
  return puts
}

function renderStep(props: Partial<Parameters<typeof Step1BasicInfo>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Step1BasicInfo
        form={form()}
        errors={{}}
        updateField={vi.fn()}
        t={t}
        projectType="individual"
        setProjectType={vi.fn()}
        companyName=""
        setCompanyName={vi.fn()}
        companyRole=""
        setCompanyRole={vi.fn()}
        onDocumentUploaded={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('Step1BasicInfo', () => {
  it('labels the text fields so they are reachable by name', () => {
    renderStep()

    expect(screen.getByLabelText(/Judul Proyek/)).toBeDefined()
    expect(screen.getByLabelText(/Kategori/)).toBeDefined()
    expect(screen.getByLabelText(/Deskripsi/)).toBeDefined()
  })

  it.each([
    ['title', /Judul Proyek/],
    ['description', /Deskripsi/],
  ] as const)('reports what was typed into %s', async (field, label) => {
    const user = userEvent.setup()
    const updateField = vi.fn()
    renderStep({ updateField })

    await user.type(screen.getByLabelText(label), 'A')

    expect(updateField).toHaveBeenCalledExactlyOnceWith(field, 'A')
  })

  describe('the category select', () => {
    it('offers the five categories the platform serves', () => {
      renderStep()

      const options = Array.from((screen.getByLabelText(/Kategori/) as HTMLSelectElement).options)
      expect(options.filter((o) => o.value !== '')).toHaveLength(5)
    })

    it('reports the category that was chosen', async () => {
      const user = userEvent.setup()
      const updateField = vi.fn()
      renderStep({ updateField })

      await user.selectOptions(screen.getByLabelText(/Kategori/), 'mobile_app')

      expect(updateField).toHaveBeenCalledExactlyOnceWith('category', 'mobile_app')
    })

    /**
     * The placeholder option is disabled, so it can be shown as the initial
     * state without being selectable as an answer.
     */
    it('keeps its placeholder option unselectable', () => {
      renderStep()

      const placeholder = (screen.getByLabelText(/Kategori/) as HTMLSelectElement).options[0]
      expect(placeholder.value).toBe('')
      expect(placeholder.disabled).toBe(true)
    })
  })

  describe('the document type', () => {
    it.each([
      ['brd', 'BRD'],
      ['prd', 'PRD'],
      ['both', 'both'],
    ])('reports %s when its card is pressed', async (value, _label) => {
      const user = userEvent.setup()
      const updateField = vi.fn()
      renderStep({ updateField })

      const cards = screen.getAllByRole('button')
      const index = ['brd', 'prd', 'both'].indexOf(value)
      await user.click(cards[index])

      expect(updateField).toHaveBeenCalledExactlyOnceWith('documentType', value)
    })

    it('marks the chosen one', () => {
      renderStep({ form: form({ documentType: 'prd' }) })

      const cards = screen.getAllByRole('button')
      expect(cards[1].className).toContain('border-primary-500')
      expect(cards[0].className).toContain('border-outline-dim/20')
    })
  })

  describe('the company fields', () => {
    /**
     * They only apply to a company project, so they stay out of the form for
     * an individual one rather than sitting there as two fields to ignore.
     */
    it('stay hidden for an individual project', () => {
      renderStep({ projectType: 'individual' })

      expect(screen.queryByLabelText(/Nama Perusahaan/)).toBeNull()
    })

    it('appear for a company project', () => {
      renderStep({ projectType: 'company' })

      expect(screen.getByLabelText(/Nama Perusahaan/)).toBeDefined()
      expect(screen.getByLabelText(/Posisi Anda di Perusahaan/)).toBeDefined()
    })

    it('report what was typed', async () => {
      const user = userEvent.setup()
      const setCompanyName = vi.fn()
      renderStep({ projectType: 'company', setCompanyName })

      await user.type(screen.getByLabelText(/Nama Perusahaan/), 'P')

      expect(setCompanyName).toHaveBeenCalledExactlyOnceWith('P')
    })

    it('switch the project type when the other card is pressed', async () => {
      const user = userEvent.setup()
      const setProjectType = vi.fn()
      renderStep({ setProjectType })

      await user.click(screen.getByRole('button', { name: /Perusahaan|Company/ }))

      expect(setProjectType).toHaveBeenCalledExactlyOnceWith('company')
    })
  })

  describe('the brief upload', () => {
    /**
     * The browser uploads straight to storage through a signed URL, so the
     * backend only ever sees the key. Posting the file through the API would
     * be a different, and worse, architecture.
     */
    it('presigns then puts the file, and reports the key back', async () => {
      const user = userEvent.setup()
      const onDocumentUploaded = vi.fn()
      const puts = stubUpload()
      renderStep({ onDocumentUploaded })

      const input = document.getElementById('doc-upload') as HTMLInputElement
      await user.upload(input, new File(['x'], 'brief.pdf', { type: 'application/pdf' }))

      await waitFor(() => {
        expect(onDocumentUploaded).toHaveBeenCalledExactlyOnceWith('document/brief.pdf')
      })
      expect(puts).toEqual(['https://storage.example/signed'])
    })

    it.each(['brief.exe', 'brief.png'])('refuses %s without uploading it', async (name) => {
      // applyAccept off so the handler's own check is what refuses it, not
      // user-event filtering the file out before it ever reaches the input.
      const user = userEvent.setup({ applyAccept: false })
      const onDocumentUploaded = vi.fn()
      const puts = stubUpload()
      renderStep({ onDocumentUploaded })

      const input = document.getElementById('doc-upload') as HTMLInputElement
      await user.upload(input, new File(['x'], name, { type: 'application/octet-stream' }))

      expect(await screen.findByText(/Gunakan PDF atau DOCX/)).toBeDefined()
      expect(puts).toHaveLength(0)
      expect(onDocumentUploaded).not.toHaveBeenCalled()
    })

    it('refuses a file over ten megabytes', async () => {
      const user = userEvent.setup()
      const puts = stubUpload()
      renderStep()

      const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'brief.pdf', {
        type: 'application/pdf',
      })
      const input = document.getElementById('doc-upload') as HTMLInputElement
      await user.upload(input, big)

      expect(await screen.findByText('Ukuran file melebihi batas maksimum')).toBeDefined()
      expect(puts).toHaveLength(0)
    })

    it('reports a failed upload rather than pretending it worked', async () => {
      const user = userEvent.setup()
      const onDocumentUploaded = vi.fn()
      stubUpload({ presignFails: true })
      renderStep({ onDocumentUploaded })

      const input = document.getElementById('doc-upload') as HTMLInputElement
      await user.upload(input, new File(['x'], 'brief.pdf', { type: 'application/pdf' }))

      expect(await screen.findByText('Gagal mengunggah berkas')).toBeDefined()
      expect(onDocumentUploaded).not.toHaveBeenCalled()
    })

    it('accepts only the two document formats at the field level', () => {
      renderStep()

      const input = document.getElementById('doc-upload') as HTMLInputElement
      expect(input.accept).toContain('.pdf')
      expect(input.accept).toContain('.docx')
    })
  })

  describe('the validation messages', () => {
    it.each([
      ['title', 'Judul wajib diisi'],
      ['description', 'Deskripsi terlalu pendek'],
      ['category', 'Pilih kategori'],
      ['documentType', 'Pilih tipe dokumen'],
      ['documentFileKey', 'Unggah dokumen dulu'],
    ])('surfaces the %s message', (field, message) => {
      renderStep({ errors: { [field]: message } })

      expect(screen.getByText(message)).toBeDefined()
    })

    it('marks the field the message belongs to', () => {
      renderStep({ errors: { title: 'Judul wajib diisi' } })

      expect(screen.getByLabelText(/Judul Proyek/).className).toContain('border-error-500')
      expect(screen.getByLabelText(/Deskripsi/).className).not.toContain('border-error-500')
    })
  })
})
