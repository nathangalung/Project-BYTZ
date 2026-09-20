// @vitest-environment jsdom
import { ProjectVisibility } from '@kerjacus/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import type { FormData } from './shared'
import { Step1BasicInfoLite } from './step-basic-info-lite'

/**
 * The three fields both intakes ask for. The owner wizard's own suite covers
 * them through Step1BasicInfo; this one covers the contract that makes the
 * sharing work - the slot the owner hangs its account-only fields in, and the
 * empty slot the public route leaves.
 */

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

const t = i18n.getFixedT('id', 'project')

function form(overrides: Partial<FormData> = {}): FormData {
  return {
    title: '',
    description: '',
    category: '',
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

function renderLite(props: Partial<Parameters<typeof Step1BasicInfoLite>[0]> = {}) {
  return render(
    <Step1BasicInfoLite form={form()} errors={{}} updateField={vi.fn()} t={t} {...props} />,
  )
}

describe('Step1BasicInfoLite', () => {
  it('asks only what a visitor can answer before signing in', () => {
    renderLite()

    expect(screen.getByRole('heading', { level: 2, name: 'Informasi Dasar' })).toBeDefined()
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
    renderLite({ updateField })

    await user.type(screen.getByLabelText(label), 'A')

    expect(updateField).toHaveBeenCalledExactlyOnceWith(field, 'A')
  })

  it('reports the category that was chosen', async () => {
    const user = userEvent.setup()
    const updateField = vi.fn()
    renderLite({ updateField })

    await user.selectOptions(screen.getByLabelText(/Kategori/), 'mobile_app')

    expect(updateField).toHaveBeenCalledExactlyOnceWith('category', 'mobile_app')
  })

  it('dims the category field until one is picked', () => {
    const { rerender } = renderLite()
    expect(screen.getByLabelText(/Kategori/).className).toContain('text-on-surface-muted')

    rerender(
      <Step1BasicInfoLite
        form={form({ category: 'web_app' })}
        errors={{}}
        updateField={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByLabelText(/Kategori/).className).not.toContain('text-on-surface-muted')
  })

  it('marks only the field its message belongs to', () => {
    renderLite({ errors: { title: 'Judul wajib diisi' } })

    expect(screen.getByText('Judul wajib diisi')).toBeDefined()
    expect(screen.getByLabelText(/Judul Proyek/).className).toContain('border-error-500')
    expect(screen.getByLabelText(/Deskripsi/).className).not.toContain('border-error-500')
  })

  /**
   * The owner wizard adds the fields that need an account. They belong under
   * the heading and above the title, which is the order this slot fixes - the
   * public route renders the same component with the slot left empty.
   */
  it('hangs the account-only fields between the heading and the title', () => {
    const { container } = renderLite({ children: <p>Unggah dokumen</p> })

    const blocks = Array.from(container.firstElementChild?.children ?? [])
    expect(blocks[0].tagName).toBe('H2')
    expect(blocks[1].textContent).toBe('Unggah dokumen')
    expect(blocks[2].querySelector('input')?.id).toBe('title')
  })

  it('renders nothing extra when no fields are passed', () => {
    const { container } = renderLite()

    expect(container.firstElementChild?.children).toHaveLength(4)
  })
})
