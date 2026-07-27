export type TechStackItem = {
  name: string
  category: string
  description: string
  recommended?: boolean
}
export type ApiEndpoint = { method: string; path: string; description: string }
export type DbTable = { name: string; description: string; columns: number }
export type TeamMember = { role: string; skills: string[]; estimatedHours: number }
export type Deliverable = { title: string; type: string; expected: string }
export type WorkPackageItem = {
  name: string
  requiredSkills: string[]
  estimatedHours: number
  amount: number
  dependencies: string[]
  deliverables: Deliverable[]
  acceptanceCriteria: string[]
}
export type SprintItem = { name: string; duration: string; milestones: string[] }
export type DependencyItem = { from: string; to: string; type: string }

export type PrdContent = {
  techStack: TechStackItem[]
  architecture: string
  apiDesign: ApiEndpoint[]
  databaseSchema: DbTable[]
  teamComposition: TeamMember[]
  workPackages: WorkPackageItem[]
  sprintPlan: SprintItem[]
  dependencyGraph: DependencyItem[]
  assumptions: string[]
  risks: string[]
  totalCost: number
  teamSize: number
  totalEstimatedHours: number
}

type Raw = Record<string, unknown>

function pick(raw: Raw, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = raw[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function list(value: unknown): Raw[] {
  return Array.isArray(value)
    ? (value.filter((v) => typeof v === 'object' && v !== null) as Raw[])
    : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

/**
 * Rupiah, and the model writes it.
 *
 * work_packages.amount is an integer column. A fractional amount reached the
 * insert unchanged, Postgres rejected the row, the error was swallowed to a
 * console line, and the project reached prd_generated with no work packages at
 * all - a successful-looking PRD and a dead end at matching. The amount also
 * picks the fee bracket, so it is the last field to be relaxed about.
 */
function money(value: unknown): number {
  return Math.round(num(value))
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function deliverable(raw: Raw): Deliverable {
  return {
    title: str(pick(raw, 'title', 'name')),
    type: str(raw.type) || 'document',
    expected: str(raw.expected),
  }
}

function workPackage(raw: Raw): WorkPackageItem {
  return {
    name: str(pick(raw, 'name', 'title')),
    requiredSkills: strings(pick(raw, 'requiredSkills', 'required_skills')),
    estimatedHours: num(pick(raw, 'estimatedHours', 'estimated_hours')),
    amount: money(raw.amount),
    dependencies: strings(raw.dependencies),
    deliverables: list(raw.deliverables).map(deliverable),
    acceptanceCriteria: strings(pick(raw, 'acceptanceCriteria', 'acceptance_criteria')),
  }
}

function sprint(raw: Raw, index: number): SprintItem {
  const days = num(pick(raw, 'durationDays', 'duration_days'))
  return {
    name:
      str(pick(raw, 'name', 'title')) ||
      `Sprint ${num(pick(raw, 'sprintNumber', 'sprint_number')) || index + 1}`,
    duration: str(raw.duration) || (days ? `${days} days` : ''),
    milestones: strings(pick(raw, 'milestones', 'tasks')),
  }
}

/** Strings or objects, both arrive. */
function techItem(value: unknown): TechStackItem {
  if (typeof value === 'string') {
    return { name: value, category: 'other', description: '' }
  }
  const raw = (value ?? {}) as Raw
  return {
    name: str(pick(raw, 'name', 'choice', 'title')),
    category: str(raw.category) || 'other',
    description: str(pick(raw, 'description', 'rationale')),
    recommended: raw.recommended === true,
  }
}

/** A prose paragraph counts as one entry. */
function prose(value: unknown, build: (text: string) => Raw): Raw[] {
  if (typeof value === 'string' && value.trim()) return [build(value.trim())]
  return list(value)
}

function endpoint(raw: Raw): ApiEndpoint {
  return {
    method: str(raw.method) || 'ANY',
    path: str(pick(raw, 'path', 'endpoint')),
    description: str(raw.description),
  }
}

function table(raw: Raw): DbTable {
  const columns = raw.columns
  return {
    name: str(pick(raw, 'name', 'table')),
    description: str(raw.description),
    columns: Array.isArray(columns) ? columns.length : num(columns),
  }
}

function teamMember(raw: Raw): TeamMember {
  return {
    role: str(pick(raw, 'role', 'title', 'name')),
    skills: strings(pick(raw, 'skills', 'requiredSkills', 'required_skills')),
    estimatedHours: num(pick(raw, 'estimatedHours', 'estimated_hours')),
  }
}

function dependency(raw: Raw): DependencyItem {
  return {
    from: str(pick(raw, 'from', 'from_package', 'fromPackage')),
    to: str(pick(raw, 'to', 'to_package', 'toPackage')),
    type: str(raw.type) || 'finish_to_start',
  }
}

/**
 * Read a stored PRD whatever shape it was written in.
 *
 * The AI service builds the document in Python and emits snake_case, and
 * project-service stores that body verbatim. The viewer only ever read
 * camelCase, and its `?? []` and `?? 0` defaults turned every miss into an
 * empty section rather than an error, so a paid-for PRD rendered as Rp 0, team
 * size 0 and blank tech stack, architecture, API design, schema, work packages
 * and sprints. Several fields differ by name too: work packages arrive as
 * `title`, sprints carry `tasks` rather than `milestones`, and the dependency
 * list is `dependencies`, not `dependencyGraph`.
 *
 * totalCost and totalEstimatedHours are never emitted under either casing, so
 * they are summed from the work packages. That also settles the two
 * contradictory totals the page used to show, since the header and the table
 * footer now come from the same numbers.
 */
export function normalizePrdContent(input: unknown): PrdContent {
  const raw: Raw = typeof input === 'object' && input !== null ? (input as Raw) : {}

  // team_composition arrives as { team_size, work_packages }, not a list.
  const teamBlock = pick(raw, 'teamComposition', 'team_composition')
  const nestedTeam = (
    typeof teamBlock === 'object' && !Array.isArray(teamBlock) ? teamBlock : {}
  ) as Raw

  const rawPackages =
    pick(raw, 'workPackages', 'work_packages') ?? pick(nestedTeam, 'workPackages', 'work_packages')
  const workPackages = list(rawPackages).map(workPackage)
  const sprintPlan = list(pick(raw, 'sprintPlan', 'sprint_plan')).map(sprint)

  const declaredCost = num(pick(raw, 'totalCost', 'total_cost'))
  const declaredHours = num(pick(raw, 'totalEstimatedHours', 'total_estimated_hours'))

  return {
    techStack: (Array.isArray(pick(raw, 'techStack', 'tech_stack'))
      ? (pick(raw, 'techStack', 'tech_stack') as unknown[])
      : []
    ).map(techItem),
    architecture: str(raw.architecture),
    apiDesign: prose(pick(raw, 'apiDesign', 'api_design'), (text) => ({
      method: 'REST',
      path: '',
      description: text,
    })).map(endpoint),
    databaseSchema: prose(pick(raw, 'databaseSchema', 'database_schema'), (text) => ({
      name: 'Schema',
      description: text,
      columns: 0,
    })).map(table),
    teamComposition: Array.isArray(teamBlock)
      ? list(teamBlock).map(teamMember)
      : workPackages.map((wp) => ({
          role: wp.name,
          skills: wp.requiredSkills,
          estimatedHours: wp.estimatedHours,
        })),
    workPackages,
    sprintPlan,
    dependencyGraph: list(pick(raw, 'dependencyGraph', 'dependencies')).map(dependency),
    assumptions: strings(pick(raw, 'assumptions')),
    risks: strings(pick(raw, 'risks')),
    totalCost: declaredCost || workPackages.reduce((sum, wp) => sum + wp.amount, 0),
    teamSize:
      num(pick(raw, 'teamSize', 'team_size')) ||
      num(pick(nestedTeam, 'teamSize', 'team_size')) ||
      workPackages.length,
    totalEstimatedHours:
      declaredHours || workPackages.reduce((sum, wp) => sum + wp.estimatedHours, 0),
  }
}
