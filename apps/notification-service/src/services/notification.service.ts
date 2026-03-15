import type { NotificationType } from '@bytz/shared'
import { AppError } from '@bytz/shared'
import { notificationRepository } from '../repositories/notification.repository'

export const notificationService = {
  async createNotification(input: {
    userId: string
    type: NotificationType
    title: string
    message: string
    link?: string
  }) {
    const notification = await notificationRepository.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link,
    })

    return notification
  },

  async getUserNotifications(userId: string, page: number, pageSize: number) {
    const { items, total } = await notificationRepository.findByUserId(userId, {
      page,
      pageSize,
    })

    return {
      items,
      total,
      page,
      pageSize,
    }
  },

  async markRead(id: string) {
    const notification = await notificationRepository.findById(id)
    if (!notification) {
      throw new AppError('NOT_FOUND', 'Notification not found')
    }

    return notificationRepository.markAsRead(id)
  },

  async markAllRead(userId: string) {
    const count = await notificationRepository.markAllAsRead(userId)
    return { markedCount: count }
  },

  async getUnreadCount(userId: string) {
    const count = await notificationRepository.countUnread(userId)
    return { count }
  },
}
