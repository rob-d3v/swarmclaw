import { NextResponse } from 'next/server'
import { buildTaskHandoffPacket } from '@/lib/server/tasks/task-handoff'
import { loadTasks } from '@/lib/server/tasks/task-repository'
import type { TaskHandoffReadinessStatus } from '@/types'

export const dynamic = 'force-dynamic'

const READINESS_STATUSES: TaskHandoffReadinessStatus[] = ['ready', 'needs_attention', 'blocked']

function normalizeLimit(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : 50
  if (!Number.isFinite(parsed)) return 50
  return Math.max(1, Math.min(200, Math.trunc(parsed)))
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') as TaskHandoffReadinessStatus | null
  const includeArchived = searchParams.get('includeArchived') === 'true'
  const limit = normalizeLimit(searchParams.get('limit'))
  const now = Date.now()
  const tasks = loadTasks()
  const packets = Object.values(tasks)
    .filter((task) => includeArchived || task.status !== 'archived')
    .map((task) => buildTaskHandoffPacket(task, tasks, { now, runBrief: null }))
    .sort((left, right) => {
      const statusRank: Record<TaskHandoffReadinessStatus, number> = {
        blocked: 0,
        needs_attention: 1,
        ready: 2,
      }
      return statusRank[left.readiness.status] - statusRank[right.readiness.status] || right.updatedAt - left.updatedAt
    })

  const filtered = status && READINESS_STATUSES.includes(status)
    ? packets.filter((packet) => packet.readiness.status === status)
    : packets
  const counts: Record<TaskHandoffReadinessStatus, number> = {
    ready: 0,
    needs_attention: 0,
    blocked: 0,
  }
  for (const packet of packets) counts[packet.readiness.status] += 1

  return NextResponse.json({
    generatedAt: now,
    counts,
    items: filtered.slice(0, limit),
  })
}
