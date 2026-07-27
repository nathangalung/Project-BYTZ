import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One scoping thread per project. Five routes reached for it and three wrote
 * their own find-or-create, each a check-then-act that two concurrent sends
 * both pass - so a project could end up with two threads holding half the
 * history each, and the readers pick one with `.limit(1)` and no ORDER BY.
 */

const source = readFileSync(path.resolve(__dirname, './projects.ts'), 'utf8')

describe('projects.ts scoping thread access', () => {
  it('creates the thread through the shared helper only', () => {
    expect(source).toContain('ensureScopingConversation')
  })

  /**
   * The inserts are the race. None may remain inline, whatever local shape
   * they used - the two spellings here were a `.values({...})` chain and a
   * bare `.values({` block.
   */
  it('has no inline scoping insert left', () => {
    expect(source).not.toMatch(/type:\s*'ai_scoping'/)
  })

  /**
   * The two read-only sites shared the same predicate written out again.
   * Different copies drift; one place cannot.
   */
  it('reads the thread through the shared helper only', () => {
    expect(source).not.toMatch(/eq\(chatConversations\.type,\s*'ai_scoping'\)/)
  })
})

describe('chat_conversations migration', () => {
  /**
   * Asserted against the migration rather than the Drizzle model: the model is
   * the intent, the migration is what reaches the database. A schema edit that
   * never got generated would pass the first and still leave the race open.
   */
  const migrationsDir = path.resolve(__dirname, '../../../../packages/db/migrations')
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'))
    .join('\n')

  /**
   * The application guard is advisory - it loses the race it is meant to
   * settle. This index is what makes a second scoping thread impossible.
   */
  it('admits one scoping thread per project', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "chat_conversations_scoping_unique" ON "chat_conversations"[^;]*\("project_id"\)[^;]*WHERE type = 'ai_scoping'/,
    )
  })

  /**
   * Partial on purpose. owner_talent and talent_talent threads are legitimately
   * many per project, so a plain unique index on project_id would break them.
   */
  it('leaves the other conversation types repeatable', () => {
    expect(sql).not.toMatch(
      /CREATE UNIQUE INDEX "chat_conversations_scoping_unique"[^;]*\("project_id"\);/,
    )
  })
})

describe('contracts migration', () => {
  const migrationsDir = path.resolve(__dirname, '../../../../packages/db/migrations')
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'))
    .join('\n')

  it('admits one contract per assignment per type', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "contracts_assignment_type_unique" ON "contracts"[^;]*\("assignment_id","type"\)/,
    )
  })
})
