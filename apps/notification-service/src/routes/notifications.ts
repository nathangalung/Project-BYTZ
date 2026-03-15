import { paginationSchema } from '@bytz/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { notificationService } from '../services/notification.service'

const createNotificationSchema = z.object({
  userId: z.string().min(1),
  type: z.enum([
    'project_match',
    'application_update',
    'milestone_update',
    'payment',
    'dispute',
    'team_formation',
    'assignment_offer',
    'system',
  ]),
  title: z.string().min(1).max(255),
  message: z.string().min(1),
  link: z.string().optional(),
})

export const notificationsRoute = new Hono()

// GET /notifications?userId=xxx&page=1&pageSize=20
notificationsRoute.get('/', async (c) => {
  const userId = c.req.query('userId')
  if (!userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'userId query parameter is required',
        },
      },
      400,
    )
  }

  const pagination = paginationSchema.parse({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
  })

  const result = await notificationService.getUserNotifications(
    userId,
    pagination.page,
    pagination.pageSize,
  )

  return c.json({ success: true, data: result })
})

// POST /notifications (internal: create notification from other services)
notificationsRoute.post('/', async (c) => {
  const body = await c.req.json()
  const parsed = createNotificationSchema.safeParse(body)

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      400,
    )
  }

  const notification = await notificationService.createNotification(parsed.data)
  return c.json({ success: true, data: notification }, 201)
})

// PATCH /notifications/:id/read
notificationsRoute.patch('/:id/read', async (c) => {
  const id = c.req.param('id')
  const notification = await notificationService.markRead(id)
  return c.json({ success: true, data: notification })
})

// PATCH /notifications/read-all?userId=xxx
notificationsRoute.patch('/read-all', async (c) => {
  const userId = c.req.query('userId')
  if (!userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'userId query parameter is required',
        },
      },
      400,
    )
  }

  const result = await notificationService.markAllRead(userId)
  return c.json({ success: true, data: result })
})

// GET /notifications/unread-count?userId=xxx
notificationsRoute.get('/unread-count', async (c) => {
  const userId = c.req.query('userId')
  if (!userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'userId query parameter is required',
        },
      },
      400,
    )
  }

  const result = await notificationService.getUnreadCount(userId)
  return c.json({ success: true, data: result })
})
