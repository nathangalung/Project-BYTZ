import { COMPLETENESS_KEYS } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import {
  buildScopingSystemPrompt,
  computeScopingCompleteness,
  type ProjectFormFields,
} from './scoping-context'

/**
 * The intake form already answers most of what a BRD needs, but the scoping
 * page opened on an empty chat with no idea what was still outstanding. The
 * score alone cannot drive that: naming the gaps is what lets the assistant
 * open with a question instead of silence.
 */

function project(over: Partial<ProjectFormFields> = {}): ProjectFormFields {
  return {
    title: 'Marketplace UMKM',
    description: 'Toko online sederhana.',
    category: 'web_app',
    budgetMin: 0,
    budgetMax: 0,
    estimatedTimelineDays: 0,
    preferences: null,
    ...over,
  } as ProjectFormFields
}

const FULL = project({
  description: [
    'Masalah: penjual UMKM kesulitan mencatat pesanan manual sehingga sering salah kirim.',
    'Tujuan bisnis: menaikkan repeat order dan memangkas waktu pencatatan.',
    'Fitur utama: katalog produk, keranjang, checkout, dan riwayat pesanan.',
    'Target pengguna: pemilik toko dan pembeli akhir di kota besar.',
    'Kebutuhan detail: butuh dashboard admin, role staff, dan ekspor laporan bulanan',
    'yang bisa dipakai tim gudang setiap akhir minggu tanpa bantuan developer.',
    'Risiko: adopsi lambat jika penjual belum terbiasa, asumsi stok sudah rapi.',
    'Metrik sukses: target 30 persen kenaikan repeat order dalam enam bulan.',
    'Integrasi: pembayaran Midtrans dan notifikasi WhatsApp.',
  ].join(' '),
  budgetMin: 10_000_000,
  budgetMax: 20_000_000,
  estimatedTimelineDays: 90,
})

describe('computeScopingCompleteness', () => {
  it('names every gap a bare form leaves behind', () => {
    const { floor, missing } = computeScopingCompleteness(project(), [])
    expect(floor).toBeLessThan(50)
    expect(missing).toContain('problem')
    expect(missing).toContain('budget')
    expect(missing).toContain('timeline')
    expect(missing).toContain('metrics')
  })

  it('reports no gaps once the form covers everything', () => {
    const { floor, missing } = computeScopingCompleteness(FULL, [])
    expect(floor).toBe(100)
    expect(missing).toEqual([])
  })

  /**
   * The reason this takes a transcript at all.
   *
   * The bar used to be the form floor on reload, because nothing persisted what
   * the conversation was worth. An owner who answered in chat came back to the
   * form's score, which reads as a progress bar that does not move.
   */
  it('counts what the owner answered in chat, not just the form', () => {
    const formOnly = computeScopingCompleteness(project(), [])
    const withChat = computeScopingCompleteness(project(), [
      'Masalahnya proses pemesanan masih manual dan sering salah catat',
      'Anggaran sekitar Rp 30 juta',
    ])

    expect(formOnly.missing).toContain('problem')
    expect(withChat.missing).not.toContain('problem')
    expect(withChat.missing).not.toContain('budget')
    expect(withChat.floor).toBeGreaterThan(formOnly.floor)
  })

  /** Only the owner's turns are scored, so the assistant cannot inflate it. */
  it('never scores below the form alone, whatever the chat adds', () => {
    const formOnly = computeScopingCompleteness(FULL, [])
    const withChat = computeScopingCompleteness(FULL, ['ok', 'lanjut'])

    expect(withChat.floor).toBeGreaterThanOrEqual(formOnly.floor)
  })

  it('drops a key from missing as soon as the form answers it', () => {
    const before = computeScopingCompleteness(project(), [])
    const after = computeScopingCompleteness(project({ budgetMin: 5_000_000 }), [])
    expect(before.missing).toContain('budget')
    expect(after.missing).not.toContain('budget')
    expect(after.floor).toBeGreaterThan(before.floor)
  })

  /**
   * A figure in the form answers its section on its own. The words are the
   * other route in, for an owner who wrote the number into the free text, so
   * a filled field has to count even when the text names none of them.
   */
  it.each([
    ['budget', { budgetMin: 5_000_000 }],
    ['budget', { budgetMax: 20_000_000 }],
    ['timeline', { estimatedTimelineDays: 90 }],
  ])('counts %s from the form field alone', (key, field) => {
    const bare = project()
    expect(bare.description).not.toMatch(/anggaran|budget|rp|juta|bulan|minggu|deadline/i)

    expect(computeScopingCompleteness(project(field), []).missing).not.toContain(key)
  })

  /**
   * The Python scorer keys the same eleven checks; a drifting vocabulary
   * would leave the chips and the assistant's opening naming different gaps.
   */
  it('uses the vocabulary the AI scorer and the i18n labels share', () => {
    // Read from the shared table rather than restated here: a third copy of
    // the key list is the thing the generated Python copy exists to prevent.
    expect(computeScopingCompleteness(project(), []).missing).toEqual([...COMPLETENESS_KEYS])
  })

  it('scores the floor as the share of checks that passed', () => {
    const { floor, missing } = computeScopingCompleteness(project(), [])
    const total = COMPLETENESS_KEYS.length
    expect(floor).toBe(Math.round(((total - missing.length) / total) * 100))
  })
})

/**
 * The preamble exists so the assistant does not re-ask for what the intake
 * form already collected. Talent preferences are part of that: an owner who
 * asked for React and five years of experience has answered the staffing
 * question, and an assistant that asks it again looks like it did not read the
 * form.
 *
 * Both fields are optional, so both lines were only ever exercised absent.
 */
describe('buildScopingSystemPrompt talent preferences', () => {
  it('carries required skills and minimum experience into the preamble', () => {
    const prompt = buildScopingSystemPrompt(
      project({
        preferences: { requiredSkills: ['React', 'Go'], minExperience: 5 },
      }),
    )

    expect(prompt).toContain('Required skills: React, Go')
    expect(prompt).toContain('Minimum talent experience: 5 years')
  })

  /**
   * Zero is a real answer - "no minimum" - and the guard tests the type rather
   * than truthiness so that it survives rather than reading as absent.
   */
  it('keeps a zero minimum rather than dropping it as falsy', () => {
    const prompt = buildScopingSystemPrompt(project({ preferences: { minExperience: 0 } }))

    expect(prompt).toContain('Minimum talent experience: 0 years')
  })

  it('omits both lines when the owner expressed no preference', () => {
    const prompt = buildScopingSystemPrompt(
      project({ preferences: { requiredSkills: [], industry: 'fintech' } }),
    )

    expect(prompt).not.toContain('Required skills:')
    expect(prompt).not.toContain('Minimum talent experience:')
    expect(prompt).toContain('Industry: fintech')
  })
})
