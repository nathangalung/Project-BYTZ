import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

function createClient(url: string) {
  const client = postgres(url, {
    max: 10,
    // DATABASE_URL points at pgbouncer running POOL_MODE=transaction, which
    // hands a server backend to a different client between statements.
    // postgres.js defaults to naming and reusing prepared statements, so it
    // PREPAREs on one backend and EXECUTEs on whatever backend the next
    // transaction lands on - "prepared statement \"...\" does not exist",
    // intermittently and under load only. The Go services already avoid this
    // with pgx's default_query_exec_mode=exec in their DSN (see
    // docker-compose.prod.yml); this is the same fix on the postgres.js side,
    // which cannot take a DSN parameter because postgres.js forwards unknown
    // ones to the server as startup options and fails to connect at all.
    //
    // Unconditional rather than pooled-only: there is one factory, and its one
    // direct-URL caller is the seed (src/seed.ts), which is a batch job that
    // can afford unnamed statements. Migrations do not come through here -
    // drizzle-kit builds its own connection from drizzle.config.ts.
    //
    // This disables *named* statements only. Queries still use the extended
    // protocol, so parameters stay out of the SQL text and Drizzle's
    // parameterisation is unaffected; the cost is re-planning per execution.
    prepare: false,
  })
  return drizzle(client, { schema })
}

export type Database = ReturnType<typeof createClient>

let db: Database | undefined

export function getDb(url?: string): Database {
  if (!db) {
    const connectionUrl = url ?? process.env.DATABASE_URL
    if (!connectionUrl) {
      throw new Error('DATABASE_URL is required')
    }
    db = createClient(connectionUrl)
  }
  return db
}
