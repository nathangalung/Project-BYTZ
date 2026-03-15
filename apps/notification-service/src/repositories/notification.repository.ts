import { getDb, notifications } from '@bytz/db'
import type { NotificationType } from '@bytz/shared'
import { and, count, desc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

export type CreateNotificationInput = {
  userId: string
  type: NotificationType
  title: string
  message: string
  link?: string
}

function db() {
  return getDb()
}

export const notificationRepository = {
  async create(data: CreateNotificationInput) {
    const id = uuidv7()
    const [notification] = await db()
      .insert(notifications)
      .values({
        id,
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        link: data.link ?? null,
        isRead: false,
        createdAt: new Date(),
      })
      .returning()
    if (!notification) {
      throw new Error('Failed to create notification')
    }
    return notification
  },

  async findByUserId(userId: string, pagination: { page: number; pageSize: number }) {
    const { page, pageSize } = pagination
    const offset = (page - 1) * pageSize

    const [items, totalResult] = await Promise.all([
      db()
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(pageSize)
        .offset(offset),
      db().select({ count: count() }).from(notifications).where(eq(notifications.userId, userId)),
    ])

    const total = totalResult[0]?.count ?? 0
    return { items, total }
  },

  async markAsRead(id: string) {
    const [updated] = await db()
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id))
      .returning()
    return updated ?? null
  },

  async markAllAsRead(userId: string) {
    const result = await db()
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
      .returning()
    return result.length
  },

  async countUnread(userId: string) {
    const result = await db()
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    return result[0]?.count ?? 0
  },

  async findById(id: string) {
    const result = await db().select().from(notifications).where(eq(notifications.id, id)).limit(1)
    return result[0] ?? null
  },
}
