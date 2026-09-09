import type { ReactNode } from 'react'

/**
 * The safe subset of Markdown the scoping assistant actually emits.
 *
 * The model writes `**bold**`, dashed bullets and numbered steps, and the chat
 * bubble used to render `message.content` as a raw string, so owners read the
 * asterisks and the numbering ran together in one paragraph.
 *
 * This is a hand-written renderer to React nodes, NOT an HTML converter. There
 * is no `dangerouslySetInnerHTML` anywhere in apps/web and no DOMPurify in any
 * manifest, so a renderer that produced HTML would be the first thing in this
 * codebase that needed one. Model output is untrusted text; returning elements
 * keeps React's escaping in force for every leaf.
 *
 * Anything outside the subset stays literal rather than being guessed at. A
 * half-supported syntax that silently drops characters is worse than one that
 * shows them, because the owner cannot tell which happened.
 */

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'steps'; items: string[] }

const HEADING = /^#{1,6}\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const STEP = /^\s*(\d{1,2})[.)]\s+(.*)$/

/**
 * Numbered steps the model wrote inline instead of on their own lines.
 *
 * Split only on a run that starts at 1 and climbs by one. A budget line like
 * "Rp 50.000.000" carries digits and a dot too, and splitting that would tear a
 * number in half; requiring an ascending run from 1 is what tells a list apart
 * from a decimal that happens to sit next to a space.
 */
function splitInlineSteps(text: string): string[] | null {
  const marks: { index: number; length: number; n: number }[] = []
  const scan = /(^|\s)(\d{1,2})[.)]\s+/g
  let match = scan.exec(text)
  while (match !== null) {
    marks.push({
      index: match.index + match[1].length,
      length: match[0].length - match[1].length,
      n: Number(match[2]),
    })
    match = scan.exec(text)
  }
  if (marks.length < 2) return null
  if (!marks.every((mark, i) => mark.n === i + 1)) return null

  const items: string[] = []
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    items.push(text.slice(mark.index + mark.length, end).trim())
  })
  const lead = text.slice(0, marks[0].index).trim()
  // A line opening on "1." is caught by STEP before it reaches here.
  /* v8 ignore next */
  return lead ? [lead, ...items] : items
}

/** Group lines into blocks, keeping runs together. */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []

  function flushParagraph() {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ').trim()
    paragraph = []
    // Blank lines never reach the buffer, so this cannot be empty.
    /* v8 ignore next */
    if (!text) return
    const inlineSteps = splitInlineSteps(text)
    if (inlineSteps) {
      // A lead-in sentence before "1." is prose, not a step.
      const first = inlineSteps[0]
      if (!/^\d/.test(text) && inlineSteps.length > 2) {
        blocks.push({ kind: 'paragraph', text: first })
        blocks.push({ kind: 'steps', items: inlineSteps.slice(1) })
        return
      }
      blocks.push({ kind: 'steps', items: inlineSteps })
      return
    }
    blocks.push({ kind: 'paragraph', text })
  }

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushParagraph()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ kind: 'heading', text: heading[1].trim() })
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      flushParagraph()
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'bullets') last.items.push(bullet[1].trim())
      else blocks.push({ kind: 'bullets', items: [bullet[1].trim()] })
      continue
    }

    const step = STEP.exec(line)
    if (step) {
      flushParagraph()
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'steps') last.items.push(step[2].trim())
      else blocks.push({ kind: 'steps', items: [step[2].trim()] })
      continue
    }

    paragraph.push(line.trim())
  }
  flushParagraph()
  return blocks
}

/**
 * Inline spans, scanned in one pass so a marker cannot nest into another.
 *
 * Code comes first in the alternation: asterisks inside backticks are content,
 * not emphasis. The emphasis arms refuse a marker glued to a word character so
 * that snake_case identifiers and `2 * 3` survive as written.
 */
const INLINE =
  /`([^`]+)`|\*\*([\s\S]+?)\*\*|(?<![\w*])\*([^*\n]+?)\*(?![\w*])|(?<![\w_])_([^_\n]+?)_(?![\w_])/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let index = 0
  INLINE.lastIndex = 0

  let match = INLINE.exec(text)
  while (match !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const key = `${keyPrefix}-${index}`
    index += 1
    if (match[1] !== undefined) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-surface-container px-1 py-0.5 font-mono text-[0.85em]"
        >
          {match[1]}
        </code>,
      )
    } else if (match[2] !== undefined) {
      nodes.push(<strong key={key}>{match[2]}</strong>)
    } else {
      nodes.push(<em key={key}>{match[3] ?? match[4]}</em>)
    }
    cursor = match.index + match[0].length
    match = INLINE.exec(text)
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

/** Render the supported subset as React elements. */
export function MarkdownLite({ content }: { content: string }) {
  const blocks = parseBlocks(content)

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const key = `${block.kind}-${i}`
        if (block.kind === 'heading') {
          return (
            <p key={key} className="font-semibold">
              {renderInline(block.text, key)}
            </p>
          )
        }
        if (block.kind === 'bullets') {
          return (
            <ul key={key} className="ml-4 list-disc space-y-1 marker:text-current/50">
              {block.items.map((item, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: reparsed whole, position is the identity
                <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'steps') {
          return (
            <ol key={key} className="ml-4 list-decimal space-y-1 marker:text-current/50">
              {block.items.map((item, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: reparsed whole, position is the identity
                <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
              ))}
            </ol>
          )
        }
        return <p key={key}>{renderInline(block.text, key)}</p>
      })}
    </div>
  )
}
