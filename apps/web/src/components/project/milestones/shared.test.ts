import { MilestoneStatus } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { COLUMN_CONFIG, COLUMNS, formatFileSize } from './shared'

describe('formatFileSize', () => {
  it('reports bytes below a kilobyte', () => {
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('switches to kilobytes at exactly 1024', () => {
    expect(formatFileSize(1023)).toBe('1023 B')
    expect(formatFileSize(1024)).toBe('1.0 KB')
  })

  it('switches to megabytes at exactly a mebibyte', () => {
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB')
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('keeps one decimal so a 1.5 MB attachment does not read as 1 MB', () => {
    expect(formatFileSize(1_572_864)).toBe('1.5 MB')
  })

  /**
   * An empty upload is reachable - a milestone can carry a zero-byte
   * placeholder - and it has to render as a size rather than as nothing.
   */
  it('renders an empty file as zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
  })
})

describe('the milestone board columns', () => {
  /**
   * The board is the milestone status flow made visible: pending, in_progress,
   * submitted, approved on the happy path, with changes_requested as the one
   * exit. A column missing here is a status a talent can reach and nobody can
   * see, and a column left over is a status nothing can write.
   */
  it('covers every status a milestone can hold', () => {
    expect([...COLUMNS]).toEqual(Object.values(MilestoneStatus))
    expect([...COLUMNS]).toEqual([
      'pending',
      'in_progress',
      'submitted',
      'changes_requested',
      'approved',
    ])
  })

  it('gives every column a dot and a header colour', () => {
    for (const column of COLUMNS) {
      expect(COLUMN_CONFIG[column]?.dotColor, column).toBeTruthy()
      expect(COLUMN_CONFIG[column]?.headerColor, column).toBeTruthy()
    }
  })

  /**
   * Colour is a secondary cue here - the column heading carries the meaning -
   * so shared colours between columns are fine. What is not fine is the column
   * holding work that was sent back looking like the approved one.
   */
  it('separates the sent-back column from the approved one', () => {
    expect(COLUMN_CONFIG.changes_requested.dotColor).not.toBe(COLUMN_CONFIG.approved.dotColor)
  })
})
