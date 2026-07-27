import { describe, expect, it } from 'vitest'
import MILESTONES from './_authenticated/projects/$projectId/milestones.tsx?raw'
import TIME_TRACKING from './_authenticated/projects/$projectId/time-tracking.tsx?raw'

/**
 * Both routes pulled a large charting library into their route chunk while
 * rendering it only conditionally: recharts behind `summary.length > 0`, and
 * the SVAR Gantt behind a tab that is not the default. Importing them lazily
 * lets the page paint without them.
 */

describe('heavy route chunks', () => {
  it('defers recharts until the time summary has rows to plot', () => {
    expect(TIME_TRACKING).not.toContain("from 'recharts'")
    expect(TIME_TRACKING).toContain(
      "import('@/components/project/time-tracking/talent-hours-chart')",
    )
    expect(TIME_TRACKING).toContain('<Suspense')
  })

  it('defers the Gantt bundle until the Gantt tab is opened', () => {
    expect(MILESTONES).not.toContain('import { GanttView } from')
    expect(MILESTONES).toContain("import('@/components/project/gantt-view')")
    expect(MILESTONES).toContain('<Suspense')
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
    expect(MILESTONES).not.toContain('useCallback')
    expect(MILESTONES).toContain('const milestones: MilestoneItem[] = useMemo(')
    expect(MILESTONES).toContain('const groupedMilestones = useMemo(')
  })
})
