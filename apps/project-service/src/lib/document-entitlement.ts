import { brdDocuments, getDb, prdDocuments, projects, transactions } from '@kerjacus/db'
import { and, eq, gte, sql } from 'drizzle-orm'

type DocKind = 'brd' | 'prd'

// New documents of one type the user created since midnight UTC today.
export async function dailyDocsCreated(userId: string, kind: DocKind): Promise<number> {
  const db = getDb()
  const table = kind === 'brd' ? brdDocuments : prdDocuments
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .innerJoin(projects, eq(table.projectId, projects.id))
    .where(and(eq(projects.ownerId, userId), gte(table.createdAt, startOfDay)))
  return row?.count ?? 0
}

// Paid unlock, backfilling paidAt if the payment callback was dropped.
export async function isDocumentPaid(
  projectId: string,
  kind: DocKind,
  currentPaidAt: Date | null,
): Promise<boolean> {
  if (currentPaidAt) return true

  const db = getDb()
  const txType = kind === 'brd' ? 'brd_payment' : 'prd_payment'
  const [paid] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.projectId, projectId),
        eq(transactions.type, txType),
        eq(transactions.status, 'completed'),
      ),
    )
    .limit(1)
  if (!paid) return false

  // Backfill so downloads, the watermark and the revision cap agree.
  const table = kind === 'brd' ? brdDocuments : prdDocuments
  await db
    .update(table)
    .set({ paidAt: new Date(), updatedAt: new Date() })
    .where(eq(table.projectId, projectId))
  return true
}
