import { paginationSchema } from '@bytz/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { adminService } from '../services/admin.service'

const dateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

const updateSettingSchema = z.object({
  value: z.unknown(),
  adminId: z.string().min(1),
})

export const dashboardRoute = new Hono()

// GET /admin/dashboard?from=2024-01-01&to=2024-12-31
dashboardRoute.get('/dashboard', async (c) => {
  const params = dateRangeSchema.parse({
    from: c.req.query('from'),
    to: c.req.query('to'),
  })

  const dateRange = params.from && params.to ? { from: params.from, to: params.to } : undefined

  const overview = await adminService.getDashboardOverview(dateRange)
  return c.json({ success: true, data: overview })
})

// GET /admin/audit-logs?page=1&pageSize=20
dashboardRoute.get('/audit-logs', async (c) => {
  const pagination = paginationSchema.parse({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
  })

  const logs = await adminService.getAuditLogs(pagination.page, pagination.pageSize)
  return c.json({ success: true, data: logs })
})

// GET /admin/settings
dashboardRoute.get('/settings', async (c) => {
  const settings = await adminService.getSettings()
  return c.json({ success: true, data: settings })
})

// PATCH /admin/settings/:key
dashboardRoute.patch('/settings/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json()
  const parsed = updateSettingSchema.safeParse(body)

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

  const setting = await adminService.updateSetting(key, parsed.data.value, parsed.data.adminId)
  return c.json({ success: true, data: setting })
})
