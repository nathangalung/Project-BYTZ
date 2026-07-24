import { describe, expect, it } from 'vitest'
import {
  isMatchingSlaStatus,
  matchingSla,
  matchingSlaFromLogs,
  matchingSlaWindowMs,
  matchingStartedAt,
} from './matching-sla'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const START = '2026-07-01T00:00:00.000Z'
const START_MS = Date.parse(START)

describe('isMatchingSlaStatus', () => {
  it('accepts the two matching states', () => {
    expect(isMatchingSlaStatus('matching')).toBe(true)
    expect(isMatchingSlaStatus('team_forming')).toBe(true)
  })

  it('rejects every other status', () => {
    for (const status of ['matched', 'in_progress', 'prd_approved', 'completed', '']) {
      expect(isMatchingSlaStatus(status)).toBe(false)
    }
  })
})

describe('matchingSlaWindowMs', () => {
  it('gives a single talent 72 hours', () => {
    expect(matchingSlaWindowMs(1)).toBe(72 * HOUR)
  })

  it('gives a team 14 days', () => {
    expect(matchingSlaWindowMs(2)).toBe(14 * DAY)
    expect(matchingSlaWindowMs(8)).toBe(14 * DAY)
  })

  it('treats a missing or zero team size as single talent', () => {
    expect(matchingSlaWindowMs(0)).toBe(72 * HOUR)
  })
})

describe('matchingStartedAt', () => {
  it('returns null when matching never started', () => {
    expect(
      matchingStartedAt([
        { toStatus: 'scoping', createdAt: START },
        { toStatus: 'prd_approved', createdAt: START },
      ]),
    ).toBeNull()
  })

  it('returns null for an empty log', () => {
    expect(matchingStartedAt([])).toBeNull()
  })

  it('picks the most recent entry into matching, not the first', () => {
    const logs = [
      { toStatus: 'matching', createdAt: '2026-07-01T00:00:00.000Z' },
      { toStatus: 'cancelled', createdAt: '2026-07-02T00:00:00.000Z' },
      { toStatus: 'matching', createdAt: '2026-07-05T00:00:00.000Z' },
    ]
    expect(matchingStartedAt(logs)).toBe('2026-07-05T00:00:00.000Z')
  })

  it('counts team_forming as a start', () => {
    const logs = [{ toStatus: 'team_forming', createdAt: START }]
    expect(matchingStartedAt(logs)).toBe(START)
  })

  it('ignores unparseable timestamps rather than ranking them', () => {
    const logs = [
      { toStatus: 'matching', createdAt: 'not a date' },
      { toStatus: 'matching', createdAt: START },
    ]
    expect(matchingStartedAt(logs)).toBe(START)
  })

  it('accepts Date values', () => {
    const at = new Date(START)
    expect(matchingStartedAt([{ toStatus: 'matching', createdAt: at }])).toBe(at)
  })
})

describe('matchingSla', () => {
  it('counts down to the deadline while inside the window', () => {
    const sla = matchingSla(START, 1, START_MS + 12 * HOUR)
    expect(sla).toEqual({
      deadline: START_MS + 72 * HOUR,
      remainingMs: 60 * HOUR,
      breached: false,
    })
  })

  it('reports a breach once the deadline passes', () => {
    const sla = matchingSla(START, 1, START_MS + 80 * HOUR)
    expect(sla?.breached).toBe(true)
    expect(sla?.remainingMs).toBe(-8 * HOUR)
  })

  it('breaches exactly on the deadline', () => {
    expect(matchingSla(START, 1, START_MS + 72 * HOUR)?.breached).toBe(true)
  })

  it('uses the 14 day window for a team', () => {
    const sla = matchingSla(START, 3, START_MS)
    expect(sla?.deadline).toBe(START_MS + 14 * DAY)
    expect(sla?.breached).toBe(false)
  })

  it('returns null for an unparseable start', () => {
    expect(matchingSla('never', 1, START_MS)).toBeNull()
  })
})

describe('matchingSlaFromLogs', () => {
  it('resolves the window from the newest matching entry', () => {
    const logs = [
      { toStatus: 'prd_approved', createdAt: '2026-06-01T00:00:00.000Z' },
      { toStatus: 'matching', createdAt: START },
    ]
    expect(matchingSlaFromLogs(logs, 1, START_MS)).toEqual({
      deadline: START_MS + 72 * HOUR,
      remainingMs: 72 * HOUR,
      breached: false,
    })
  })

  it('returns null when the project never reached matching', () => {
    expect(matchingSlaFromLogs([{ toStatus: 'draft', createdAt: START }], 1, START_MS)).toBeNull()
  })
})
