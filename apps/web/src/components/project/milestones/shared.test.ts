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
   * The board is the milestone status flow made visible, and the flow is
   * defined in CLAUDE.md: pending, in_progress, submitted, approved on the
   * happy path, with revision_requested and rejected as the two exits. A
   * column missing here is a status a talent can reach and nobody can see.
   */
  it('covers every status a milestone can hold', () => {
    expect([...COLUMNS]).toEqual([
      'pending',
      'in_progress',
      'submitted',
      'revision_requested',
      'approved',
      'rejected',
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
   * so shared colours between columns are fine. What is not fine is the two
   * failure columns looking like the two success ones.
   */
  it('separates the failure columns from the approved one', () => {
    expect(COLUMN_CONFIG.rejected.dotColor).not.toBe(COLUMN_CONFIG.approved.dotColor)
    expect(COLUMN_CONFIG.revision_requested.dotColor).not.toBe(COLUMN_CONFIG.approved.dotColor)
  })
})
