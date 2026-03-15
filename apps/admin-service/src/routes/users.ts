import { paginationSchema } from '@bytz/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { adminService } from '../services/admin.service'

const suspendSchema = z.object({
  adminId: z.string().min(1),
  reason: z.string().min(1).max(1000),
})

const unsuspendSchema = z.object({
  adminId: z.string().min(1),
})

export const usersRoute = new Hono()

// GET /admin/users?role=worker&search=john&page=1&pageSize=20
usersRoute.get('/', async (c) => {
  const role = c.req.query('role')
  const search = c.req.query('search')
  const pagination = paginationSchema.parse({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
  })

  const result = await adminService.getUsersList({
    role,
    search,
    page: pagination.page,
    pageSize: pagination.pageSize,
  })

  return c.json({ success: true, data: result })
})

// GET /admin/users/:id
usersRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const user = await adminService.getUserById(id)
  return c.json({ success: true, data: user })
})

// PATCH /admin/users/:id/suspend
usersRoute.patch('/:id/suspend', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = suspendSchema.safeParse(body)

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

  const user = await adminService.suspendUser(id, parsed.data.adminId, parsed.data.reason)
  return c.json({ success: true, data: user })
})

// PATCH /admin/users/:id/unsuspend
usersRoute.patch('/:id/unsuspend', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = unsuspendSchema.safeParse(body)

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

  const user = await adminService.unsuspendUser(id, parsed.data.adminId)
  return c.json({ success: true, data: user })
})
