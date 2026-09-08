import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const MILESTONES = readSource('./_authenticated/projects/$projectId/milestones.tsx')
const TIME_TRACKING = readSource('./_authenticated/projects/$projectId/time-tracking.tsx')

/**
 * Both routes pulled a large charting library into their route chunk while
 * rendering it only conditionally: recharts behind `summary.length > 0`, and
 * the SVAR Gantt behind a tab that is not the default. Importing them lazily
 * lets the page paint without them.
 *
 * A bare `<Suspense>` was not enough. It has no error path, so a chunk that
 * never arrives leaves the fallback on screen with nothing to end it, which is
 * how the Gantt tab could sit on "Loading..." for good. `LazyPanel` pairs the
 * two, and `lazyWithRetry` retries the fetch before giving up, because
 * `React.lazy` caches a rejection and would otherwise never ask again.
 */

describe('heavy route chunks', () => {
  it('pairs every lazy chunk with something that can report a failed load', () => {
    for (const source of [MILESTONES, TIME_TRACKING]) {
      expect(source).toContain('lazyWithRetry')
      expect(source).toContain('<LazyPanel')
      expect(source).not.toContain('lazy(() =>')
    }
  })

  it('defers recharts until the time summary has rows to plot', () => {
    expect(TIME_TRACKING).not.toContain("from 'recharts'")
    expect(TIME_TRACKING).toContain(
      "import('@/components/project/time-tracking/talent-hours-chart')",
    )
    expect(TIME_TRACKING).toContain('<LazyPanel')
  })

  it('defers the Gantt bundle until the Gantt tab is opened', () => {
    expect(MILESTONES).not.toContain('import { GanttView } from')
    expect(MILESTONES).toContain("import('@/components/project/gantt-view')")
    expect(MILESTONES).toContain('<LazyPanel')
  })
})

/**
 * The timer ticked a `setTimerSeconds` that lived at the top of a 600-line
 * component, so the whole page - including every derived list below - was
 * rebuilt once a second while a talent logged time.
 */
describe('time tracking render cost', () => {
  it('keeps the per-second tick in a leaf component', () => {
    expect(TIME_TRACKING).not.toContain('setTimerSeconds')
    expect(TIME_TRACKING).not.toContain('setInterval')
    expect(TIME_TRACKING).toContain('<TimerDisplay running={isTimerRunning} />')
  })

  it('derives its totals and groupings once per fetch', () => {
    expect(TIME_TRACKING).toContain('} = useMemo(() => {')
    expect(TIME_TRACKING).toContain('}, [timeLogs])')
  })
})

describe('milestone board render cost', () => {
  /** useCallback(...)() memoises nothing: it rebuilds the groups every render. */
  it('memoises the milestone list and its grouping', () => {
    expect(MILESTONES).not.toMatch(/useCallback\([\s\S]*?\}, \[milestones\]\)\(\)/)
    expect(MILESTONES).toContain('const milestones: MilestoneItem[] = useMemo(')
    expect(MILESTONES).toContain('const groupedMilestones = useMemo(')
  })
})
