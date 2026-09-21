import { describe, expect, it } from 'vitest'
import { educationRowsFrom, projectRowsFrom } from './cv-structured'

/**
 * The input is an LLM's output reaching a table with NOT NULL columns, so the
 * cases that matter are the malformed ones: a missing key, a string where a
 * list belongs, an entry the model filled with empty strings because the field
 * was required.
 */
describe('educationRowsFrom', () => {
  it('keeps every entry, in the order the parse emitted', () => {
    const rows = educationRowsFrom({
      education: [
        { university: 'Institut Teknologi Bandung', degree: 'S2', major: 'Informatika' },
        { university: 'Universitas Indonesia', degree: 'S1', major: 'Ilmu Komputer' },
      ],
    })

    expect(rows.map((r) => r.university)).toEqual([
      'Institut Teknologi Bandung',
      'Universitas Indonesia',
    ])
    expect(rows.map((r) => r.orderIndex)).toEqual([0, 1])
  })

  it('reads a year out of a date written as prose', () => {
    const [row] = educationRowsFrom({
      education: [{ university: 'UGM', start: 'Agustus 2019', end: 'Juli 2023' }],
    })

    expect(row.startYear).toBe(2019)
    expect(row.endYear).toBe(2023)
  })

  it('leaves a year null rather than guessing when the CV gave none', () => {
    const [row] = educationRowsFrom({
      education: [{ university: 'UGM', start: '', end: 'sekarang' }],
    })

    expect(row.startYear).toBeNull()
    expect(row.endYear).toBeNull()
  })

  it('keeps a GPA as written, because a CV does not always write a number', () => {
    const [row] = educationRowsFrom({
      education: [{ university: 'UGM', gpa: '3,72 / 4,00' }],
    })

    expect(row.gpa).toBe('3,72 / 4,00')
  })

  /** university is NOT NULL, and a blank card tells a reader nothing. */
  it('drops an entry with no institution', () => {
    const rows = educationRowsFrom({
      education: [{ university: '   ', degree: 'S1' }, { university: 'UGM' }],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ university: 'UGM', orderIndex: 0 })
  })

  it('truncates a value longer than its column', () => {
    const [row] = educationRowsFrom({ education: [{ university: 'U'.repeat(400) }] })

    expect(row.university).toHaveLength(255)
  })

  it.each([
    ['no payload at all', undefined],
    ['a payload that is not an object', 'nonsense'],
    ['education that is not a list', { education: 'ITB' }],
    ['a parse with no education key', { name: 'Jane' }],
  ])('returns nothing for %s', (_label, payload) => {
    expect(educationRowsFrom(payload)).toEqual([])
  })
})

describe('projectRowsFrom', () => {
  it('keeps the title, the description and the stack', () => {
    const [row] = projectRowsFrom({
      projects: [
        {
          title: 'Nusantara Pay',
          description: 'Agregator payment gateway',
          tech_stack: ['Go', 'PostgreSQL'],
          url: 'https://github.com/x/nusantara-pay',
        },
      ],
    })

    expect(row).toEqual({
      title: 'Nusantara Pay',
      description: 'Agregator payment gateway',
      techStack: ['Go', 'PostgreSQL'],
      url: 'https://github.com/x/nusantara-pay',
      orderIndex: 0,
    })
  })

  it('stores no stack rather than an empty one', () => {
    const [row] = projectRowsFrom({ projects: [{ title: 'Kasir UMKM', tech_stack: [] }] })

    expect(row.techStack).toBeNull()
  })

  it('drops the entries of a stack that are not strings', () => {
    const [row] = projectRowsFrom({
      projects: [{ title: 'Kasir UMKM', tech_stack: ['Flutter', 42, null, '  '] }],
    })

    expect(row.techStack).toEqual(['Flutter'])
  })

  it('survives a tech stack the model wrote as one string', () => {
    const [row] = projectRowsFrom({
      projects: [{ title: 'Kasir UMKM', tech_stack: 'Flutter, Dart' }],
    })

    expect(row.techStack).toBeNull()
  })

  it('drops a project with no title', () => {
    expect(projectRowsFrom({ projects: [{ title: '', description: 'ada' }] })).toEqual([])
  })

  it('numbers the projects in the order the CV listed them', () => {
    const rows = projectRowsFrom({
      projects: [{ title: 'Satu' }, { title: '' }, { title: 'Dua' }],
    })

    expect(rows.map((r) => [r.title, r.orderIndex])).toEqual([
      ['Satu', 0],
      ['Dua', 1],
    ])
  })

  it.each([
    ['no payload at all', undefined],
    ['projects that are not a list', { projects: 7 }],
    ['a parse with no projects key', { education: [] }],
  ])('returns nothing for %s', (_label, payload) => {
    expect(projectRowsFrom(payload)).toEqual([])
  })
})
