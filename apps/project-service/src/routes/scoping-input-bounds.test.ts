import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Both scoping turns loaded every message in the conversation and shipped all
 * of them upstream on every request, and neither capped the message the owner
 * typed beyond "not empty".
 *
 * Cost and latency then grow with the square of the session: turn fifty
 * re-sends the previous forty-nine. max_output_tokens is set on the AI side,
 * so input was the only unbounded dimension left, and one owner could drive a
 * single request at the whole context window. The sibling upload-spec route
 * already caps its notes at 2000.
 */

const source = readFileSync(path.resolve(__dirname, './projects.ts'), 'utf8')

describe('scoping chat input', () => {
  it('caps the message the owner sends', () => {
    expect(source).toContain('MAX_SCOPING_MESSAGE_LENGTH')
  })

  /**
   * Both the JSON turn and the SSE turn. Bounding one leaves the other as the
   * cheaper way in.
   */
  it('bounds the history window on both turns', () => {
    const windowed = source.match(/SCOPING_HISTORY_WINDOW/g) ?? []
    expect(windowed.length, 'both turns must bound the history').toBeGreaterThanOrEqual(3)
  })

  /**
   * Newest wins: the tail is what the answer depends on. Trimming the tail
   * would drop the question being answered.
   */
  it('keeps the most recent turns', () => {
    expect(source).toMatch(/desc\(chatMessages\.createdAt\)/)
    expect(source).toContain('.reverse()')
  })
})
