import { describe, expect, it } from 'vitest'
import DATA_TABLE from '../components/ui/data-table.tsx?raw'
import PROJECTS from './_authenticated/projects.tsx?raw'
import USERS from './_authenticated/users.tsx?raw'

/**
 * DataTable memoises its sort on `[rows, columns, sort]`. Both routes built
 * `columns` as a fresh array literal in the render body, so the identity
 * changed on every keystroke in the search box and up to a hundred rows were
 * re-sorted and re-rendered per character typed.
 */

describe('admin table columns', () => {
  it('is the columns identity that drives the sort memo', () => {
    expect(DATA_TABLE).toContain('}, [rows, columns, sort])')
  })

  it('holds the users columns stable across renders', () => {
    expect(USERS).toContain('const columns = useMemo<Column<AdminUserRow>[]>(')
    expect(USERS).not.toContain('const columns: Column<AdminUserRow>[] = [')
  })

  it('holds the projects columns stable across renders', () => {
    expect(PROJECTS).toContain('const columns = useMemo<Column<ProjectListItem>[]>(')
    expect(PROJECTS).not.toContain('const columns: Column<ProjectListItem>[] = [')
    // statusLabel is read by the detail panel too, so it needs its own identity.
    expect(PROJECTS).toContain('const statusLabel = useCallback(')
  })
})
