/**
 * The education and project rows a CV parse is worth.
 *
 * The AI service returns every degree with its qualification, grade and both
 * years, and every project with a title, a description and a tech stack. All
 * of it used to land in cv_parsed_data, which no external reader may open, so
 * the owner judging a candidate saw none of it and the talent's own profile
 * showed one university and one major.
 *
 * This turns that payload into rows for talent_education and talent_projects.
 * The payload is an LLM's output, so nothing here trusts a shape: a missing
 * key, a string where a list belongs, or an entry with no institution is
 * dropped rather than written as an empty row.
 */

/** A year as a CV writes it: "2017", "Sep 2017", "2017 - sekarang". */
function yearFrom(value: unknown): number | null {
  const match = typeof value === 'string' ? value.match(/(?:19|20)\d{2}/) : null
  return match ? Number(match[0]) : null
}

function trimmed(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  return text.length > max ? text.slice(0, max) : text
}

export type ParsedEducation = {
  university: string
  degree: string | null
  major: string | null
  gpa: string | null
  startYear: number | null
  endYear: number | null
  orderIndex: number
}

export type ParsedProject = {
  title: string
  description: string | null
  techStack: string[] | null
  url: string | null
  orderIndex: number
}

/**
 * The entries under one key of the parse, as objects.
 *
 * Deliberately not a zod shape: every field of an ExtractedCV entry is
 * optional and every value is read through a guard below anyway, so a schema
 * would only add a second place for an absent key to become a dropped CV. All
 * that has to hold here is "a list of objects".
 */
function entriesOf(parsed: unknown, key: 'education' | 'projects'): Record<string, unknown>[] {
  if (typeof parsed !== 'object' || parsed === null) return []
  const list = (parsed as Record<string, unknown>)[key]
  if (!Array.isArray(list)) return []
  return list.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
  )
}

/**
 * Education entries, in the order the parse emitted them.
 *
 * That order is most recent first, which is what the prompt asks for, so
 * order_index records it rather than re-deriving one from the years -- an
 * entry with no year would otherwise sort to an arbitrary place.
 *
 * An entry with no institution name is not an education; it is the model
 * filling a required field with an empty string, and storing it would put a
 * blank card on the profile.
 */
export function educationRowsFrom(parsed: unknown): ParsedEducation[] {
  const rows: ParsedEducation[] = []
  for (const entry of entriesOf(parsed, 'education')) {
    const university = trimmed(entry.university, 255)
    if (!university) continue
    rows.push({
      university,
      degree: trimmed(entry.degree, 100),
      major: trimmed(entry.major, 255),
      gpa: trimmed(entry.gpa, 20),
      startYear: yearFrom(entry.start),
      endYear: yearFrom(entry.end),
      orderIndex: rows.length,
    })
  }
  return rows
}

/**
 * Project entries, in the order the parse emitted them.
 *
 * A project with no title is dropped for the same reason an education with no
 * institution is: it renders as an empty card and tells an owner nothing.
 */
export function projectRowsFrom(parsed: unknown): ParsedProject[] {
  const rows: ParsedProject[] = []
  for (const entry of entriesOf(parsed, 'projects')) {
    const title = trimmed(entry.title, 255)
    if (!title) continue
    const stack = Array.isArray(entry.tech_stack)
      ? entry.tech_stack
          .map((item) => trimmed(item, 100))
          .filter((item): item is string => item !== null)
      : []
    rows.push({
      title,
      description: trimmed(entry.description, 4000),
      techStack: stack.length > 0 ? stack : null,
      url: trimmed(entry.url, 2000),
      orderIndex: rows.length,
    })
  }
  return rows
}
