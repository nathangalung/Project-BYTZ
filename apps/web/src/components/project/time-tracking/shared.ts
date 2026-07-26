export type TimeLogEntry = {
  id: string
  taskTitle: string
  description: string
  date: string
  durationMinutes: number
  isRunning: boolean
}

export type ApiTimeLog = {
  id: string
  taskId: string
  talentId: string
  startedAt: string
  endedAt: string | null
  durationMinutes: number | null
  description: string | null
  createdAt: string
  taskTitle: string
}

export type TimeLogSummaryRow = {
  talentId: string
  talentName: string | null
  milestoneId: string | null
  milestoneTitle: string | null
  totalMinutes: number
  entryCount: number
}
