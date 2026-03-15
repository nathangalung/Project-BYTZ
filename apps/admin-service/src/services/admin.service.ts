import { AppError } from '@bytz/shared'
import { adminRepository, type DateRange } from '../repositories/admin.repository'

export const adminService = {
  async getDashboardOverview(dateRange?: DateRange) {
    const [projectStats, revenueStats, workerStats] = await Promise.all([
      adminRepository.getProjectStats(),
      adminRepository.getRevenueStats(dateRange),
      adminRepository.getWorkerStats(),
    ])

    return {
      projects: projectStats,
      revenue: revenueStats,
      workers: workerStats,
    }
  },

  async getAuditLogs(page: number, pageSize: number) {
    const { items, total } = await adminRepository.getAuditLogs({
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

  async logAction(
    adminId: string,
    action: string,
    targetType: string,
    targetId: string,
    details?: Record<string, unknown>,
  ) {
    return adminRepository.createAuditLog({
      adminId,
      action,
      targetType,
      targetId,
      details,
    })
  },

  async getSettings() {
    return adminRepository.getPlatformSettings()
  },

  async updateSetting(key: string, value: unknown, adminId: string) {
    const setting = await adminRepository.updatePlatformSetting(key, value, adminId)

    // Audit log the setting change
    await adminRepository.createAuditLog({
      adminId,
      action: 'config.update',
      targetType: 'platform_setting',
      targetId: key,
      details: { key, newValue: value },
    })

    return setting
  },

  async getUsersList(filters: { role?: string; search?: string; page: number; pageSize: number }) {
    const { items, total } = await adminRepository.getUsersList(filters)

    return {
      items,
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    }
  },

  async getUserById(id: string) {
    const user = await adminRepository.getUserById(id)
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found')
    }
    return user
  },

  async suspendUser(userId: string, adminId: string, reason: string) {
    const user = await adminRepository.getUserById(userId)
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found')
    }

    const updated = await adminRepository.suspendUser(userId)

    await adminRepository.createAuditLog({
      adminId,
      action: 'user.suspend',
      targetType: 'user',
      targetId: userId,
      details: { reason, userEmail: user.email },
    })

    return updated
  },

  async unsuspendUser(userId: string, adminId: string) {
    const user = await adminRepository.getUserById(userId)
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found')
    }

    const updated = await adminRepository.unsuspendUser(userId)

    await adminRepository.createAuditLog({
      adminId,
      action: 'user.unsuspend',
      targetType: 'user',
      targetId: userId,
      details: { userEmail: user.email },
    })

    return updated
  },
}
