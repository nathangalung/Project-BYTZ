import { describe, expect, it } from 'vitest'
import {
  buildScopingSystemPrompt,
  computeFormCompleteness,
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

describe('computeFormCompleteness', () => {
  it('names every gap a bare form leaves behind', () => {
    const { floor, missing } = computeFormCompleteness(project())
    expect(floor).toBeLessThan(50)
    expect(missing).toContain('problem')
    expect(missing).toContain('budget')
    expect(missing).toContain('timeline')
    expect(missing).toContain('metrics')
  })

  it('reports no gaps once the form covers everything', () => {
    const { floor, missing } = computeFormCompleteness(FULL)
    expect(floor).toBe(100)
    expect(missing).toEqual([])
  })

  it('drops a key from missing as soon as the form answers it', () => {
    const before = computeFormCompleteness(project())
    const after = computeFormCompleteness(project({ budgetMin: 5_000_000 }))
    expect(before.missing).toContain('budget')
    expect(after.missing).not.toContain('budget')
    expect(after.floor).toBeGreaterThan(before.floor)
  })

  /**
   * The Python scorer keys the same eleven checks; a drifting vocabulary
   * would leave the chips and the assistant's opening naming different gaps.
   */
  it('uses the vocabulary the AI scorer and the i18n labels share', () => {
    const { missing } = computeFormCompleteness(project())
    const known = [
      'description',
      'problem',
      'objectives',
      'features',
      'users',
      'requirements',
      'risks',
      'metrics',
      'budget',
      'timeline',
      'integrations',
    ]
    for (const key of missing) expect(known).toContain(key)
  })

  it('scores the floor as the share of checks that passed', () => {
    const { floor, missing } = computeFormCompleteness(project())
    expect(floor).toBe(Math.round(((11 - missing.length) / 11) * 100))
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
