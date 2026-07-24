import { MATCHING_SLA } from './constants'

/** Statuses the SLA clock runs in. */
export const MATCHING_SLA_STATUSES = ['matching', 'team_forming'] as const

export type MatchingSlaStatus = (typeof MATCHING_SLA_STATUSES)[number]

export type StatusLogEntry = {
  toStatus: string
  createdAt: string | Date
}

export type MatchingSla = {
  /** Epoch ms the platform promised to fill every position by. */
  deadline: number
  /** Signed, so it goes negative once the promise is late. */
  remainingMs: number
  breached: boolean
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function toMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

export function isMatchingSlaStatus(status: string): status is MatchingSlaStatus {
  return (MATCHING_SLA_STATUSES as readonly string[]).includes(status)
}

/**
 * How long the platform has to fill a project's positions.
 *
 * Team size decides it, not the status: a team project sits in `matching`
 * before it reaches `team_forming`, and it gets the 14 days from the start.
 */
export function matchingSlaWindowMs(teamSize: number): number {
  return teamSize > 1
    ? MATCHING_SLA.TEAM_PROJECT_DAYS * DAY_MS
    : MATCHING_SLA.SINGLE_TALENT_HOURS * HOUR_MS
}

/**
 * When the clock started: the most recent transition into matching.
 *
 * Only `project_status_logs` records it. A project's `createdAt` predates
 * scoping and its `updatedAt` moves on every edit, so neither can stand in.
 *
 * Most recent rather than first, because a project that dropped out of matching
 * and came back gets a fresh window. Unparseable rows are skipped instead of
 * winning the comparison as NaN.
 */
export function matchingStartedAt(logs: readonly StatusLogEntry[]): string | Date | null {
  let bestAt: string | Date | null = null
  let bestMs = Number.NEGATIVE_INFINITY

  for (const log of logs) {
    if (!isMatchingSlaStatus(log.toStatus)) continue
    const ms = toMs(log.createdAt)
    if (Number.isNaN(ms) || ms <= bestMs) continue
    bestAt = log.createdAt
    bestMs = ms
  }

  return bestAt
}

/**
 * Resolve the SLA against the moment matching started.
 *
 * Returns null for a timestamp that will not parse, so a caller renders nothing
 * rather than a NaN countdown.
 */
export function matchingSla(
  startedAt: string | Date,
  teamSize: number,
  now: number,
): MatchingSla | null {
  const start = toMs(startedAt)
  if (Number.isNaN(start)) return null

  const deadline = start + matchingSlaWindowMs(teamSize)
  const remainingMs = deadline - now

  return { deadline, remainingMs, breached: remainingMs <= 0 }
}

/** Resolve straight from status logs, or null when matching never started. */
export function matchingSlaFromLogs(
  logs: readonly StatusLogEntry[],
  teamSize: number,
  now: number,
): MatchingSla | null {
  const startedAt = matchingStartedAt(logs)
  return startedAt === null ? null : matchingSla(startedAt, teamSize, now)
}
