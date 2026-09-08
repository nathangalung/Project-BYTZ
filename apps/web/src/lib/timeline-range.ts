/**
 * The timeline brackets the intake wizard offers, and the way back.
 *
 * The wizard asks for a range and stores the integer the team-size formula
 * needs, so an owner who picked "2-4 bulan" was shown "90 hari" everywhere
 * afterwards - a number they never chose, narrower than the answer they gave.
 *
 * The map is inverted here rather than read back from `preferences.deadlineRange`
 * because two of the five places this is displayed are public routes. Reaching
 * the stored key would mean putting the whole preferences blob, including the
 * free-text brief and the talent criteria, into an anonymous response.
 */

export type TimelineBracket = { key: string; days: number }

/**
 * Days are the midpoint the wizard commits to, not the edge of the range.
 * Keep this list and the wizard's own map as one thing: they are the same
 * table read in opposite directions.
 */
export const TIMELINE_BRACKETS: readonly TimelineBracket[] = [
  { key: 'deadline_1_2_months', days: 45 },
  { key: 'deadline_2_4_months', days: 90 },
  { key: 'deadline_4_6_months', days: 150 },
  { key: 'deadline_over_6_months', days: 210 },
]

/**
 * The bracket an owner picked, or null when the number came from somewhere
 * else. Nothing is guessed: a project created before the wizard, or one whose
 * timeline the AI has since revised, keeps showing its own integer rather than
 * being rounded into a range it was never given.
 */
export function timelineBracketKey(days: number | null | undefined): string | null {
  if (typeof days !== 'number') return null
  return TIMELINE_BRACKETS.find((bracket) => bracket.days === days)?.key ?? null
}
