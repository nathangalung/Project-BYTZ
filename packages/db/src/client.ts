import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

function createClient(url: string) {
  const client = postgres(url, { max: 10 })
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
