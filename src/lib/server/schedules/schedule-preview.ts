import { CronExpressionParser } from 'cron-parser'

import { normalizeSchedulePayload } from '@/lib/server/schedules/schedule-normalization'
import type { SchedulePreviewResponse, SchedulePreviewRun, ScheduleType } from '@/types'

type SchedulePayload = Record<string, unknown>

export interface PreviewScheduleOptions {
  cwd?: string | null
  now?: number
  count?: number
}

const DEFAULT_PREVIEW_RUNS = 5

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.trunc(value)
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes <= 1) return 'Every minute'
  if (minutes < 60) return `Every ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'Every hour' : `Every ${hours} hours`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Every day' : `Every ${days} days`
}

function formatRunLabel(timestamp: number, timezone: string | null): string {
  const date = new Date(timestamp)
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(timezone ? { timeZone: timezone, timeZoneName: 'short' as const } : {}),
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

function buildPreviewRun(timestamp: number, timezone: string | null): SchedulePreviewRun {
  return {
    at: timestamp,
    iso: new Date(timestamp).toISOString(),
    label: formatRunLabel(timestamp, timezone),
  }
}

function buildCronRuns(cron: string, timezone: string | null, now: number, count: number): SchedulePreviewRun[] {
  const interval = CronExpressionParser.parse(cron, {
    currentDate: new Date(now),
    ...(timezone ? { tz: timezone } : {}),
  })
  const runs: SchedulePreviewRun[] = []
  for (let index = 0; index < count; index += 1) {
    runs.push(buildPreviewRun(interval.next().getTime(), timezone))
  }
  return runs
}

function buildIntervalRuns(intervalMs: number, timezone: string | null, now: number, count: number): SchedulePreviewRun[] {
  const runs: SchedulePreviewRun[] = []
  for (let index = 1; index <= count; index += 1) {
    runs.push(buildPreviewRun(now + (intervalMs * index), timezone))
  }
  return runs
}

function cadenceLabel(scheduleType: ScheduleType, payload: SchedulePayload): string {
  if (scheduleType === 'cron') {
    const cron = trimString(payload.cron)
    return cron ? `Cron ${cron}` : 'Cron'
  }
  if (scheduleType === 'interval') {
    const intervalMs = positiveNumber(payload.intervalMs)
    return intervalMs ? formatDuration(intervalMs) : 'Interval'
  }
  return 'Run once'
}

export function previewSchedulePayload(
  payload: SchedulePayload,
  options: PreviewScheduleOptions = {},
): SchedulePreviewResponse {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const count = Math.max(1, Math.min(10, Math.trunc(options.count ?? DEFAULT_PREVIEW_RUNS)))
  const normalized = normalizeSchedulePayload({
    ...payload,
    nextRunAt: undefined,
  }, {
    cwd: options.cwd,
    now,
  })
  if (!normalized.ok) {
    return { ok: false, error: normalized.error }
  }

  const value = normalized.value
  const scheduleType = value.scheduleType === 'cron' || value.scheduleType === 'once'
    ? value.scheduleType
    : 'interval'
  const timezone = trimString(value.timezone) || null
  const warnings: string[] = []
  const staggerSec = positiveNumber(value.staggerSec)

  if (scheduleType === 'cron' && !timezone) {
    warnings.push('Timezone is not set, so cron runs use the host local timezone.')
  }
  if (staggerSec) {
    warnings.push(`Stagger may delay each run by up to ${staggerSec} seconds.`)
  }
  if (value.status === 'paused') {
    warnings.push('Paused schedules keep their forecast but will not run until reactivated.')
  }
  if (value.status === 'archived') {
    warnings.push('Archived schedules do not run until restored.')
  }

  let nextRuns: SchedulePreviewRun[] = []
  try {
    if (scheduleType === 'cron') {
      const cron = trimString(value.cron)
      if (!cron) {
        return { ok: false, error: 'Error: cron schedules require a cron expression.' }
      }
      nextRuns = buildCronRuns(cron, timezone, now, count)
    } else if (scheduleType === 'interval') {
      const intervalMs = positiveNumber(value.intervalMs)
      if (!intervalMs) {
        return { ok: false, error: 'Error: interval schedules require intervalMs.' }
      }
      nextRuns = buildIntervalRuns(intervalMs, timezone, now, count)
    } else {
      const runAt = positiveNumber(value.runAt)
      if (!runAt) {
        warnings.push('Run-once schedules need a runAt timestamp before they can be queued.')
      } else if (runAt <= now) {
        warnings.push('Run-once timestamp is in the past.')
      } else {
        nextRuns = [buildPreviewRun(runAt, timezone)]
      }
    }
  } catch {
    return { ok: false, error: 'Error: invalid schedule timing.' }
  }

  if (nextRuns.length === 0 && value.status !== 'archived') {
    warnings.push('No future runs could be calculated from this schedule.')
  }

  return {
    ok: true,
    scheduleType,
    cadence: cadenceLabel(scheduleType, value),
    timezone,
    nextRunAt: nextRuns[0]?.at ?? null,
    nextRuns,
    warnings,
    normalized: value,
  }
}
