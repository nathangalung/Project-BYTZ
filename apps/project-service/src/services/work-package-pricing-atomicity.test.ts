import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Menambah work package menulis tiga hal: paket baru, payout paket lama yang
 * ikut bergeser, dan total harga proyek. Ketiganya berjalan terpisah tanpa
 * transaksi.
 *
 * Bracket platform fee dipilih dari total harga proyek, jadi menambah satu
 * paket bisa memindahkan seluruh proyek ke bracket lain dan mengubah payout
 * paket yang sudah ada. Kalau proses berhenti di tengah, paket lama tetap
 * memakai payout bracket lama sementara total proyek sudah berubah, atau
 * sebaliknya. Invariant final_price = talent_payout + platform_fee putus dan
 * tidak ada CHECK constraint yang menangkapnya.
 *
 * Efeknya menyebar: computeMilestoneFee membaca rasio payout terhadap nominal
 * work package, jadi setiap pencairan milestone sesudahnya salah hitung fee.
 */

const service = readFileSync(path.resolve(__dirname, './work-package.service.ts'), 'utf8')
const repo = readFileSync(
  path.resolve(__dirname, '../repositories/work-package.repository.ts'),
  'utf8',
)

function method(source: string, name: string): string {
  const start = source.indexOf(`async ${name}(`)
  expect(start, `${name} tidak ditemukan`).toBeGreaterThan(-1)
  const next = source.indexOf('\n  async ', start + 10)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('createWorkPackages', () => {
  const body = method(service, 'createWorkPackages')

  it('menulis ketiganya dalam satu transaksi', () => {
    expect(body).toContain('transaction')
  })

  it('memperbarui payout paket lama di dalam transaksi yang sama', () => {
    const tx = body.slice(body.indexOf('transaction'))
    expect(tx).toContain('updatePayout')
  })

  it('memperbarui total harga proyek di dalam transaksi yang sama', () => {
    const tx = body.slice(body.indexOf('transaction'))
    expect(tx).toMatch(/finalPrice/)
    expect(tx).toMatch(/platformFee/)
    expect(tx).toMatch(/talentPayout/)
  })
})

describe('repository work package', () => {
  /**
   * Repo harus bisa dipakai di dalam transaksi milik pemanggil. Tanpa itu,
   * service terpaksa menulis lewat koneksi pool dan transaksi kehilangan
   * artinya.
   */
  it('menerima transaksi dari pemanggil', () => {
    expect(repo).toMatch(/tx\?:|tx:/)
  })
})
