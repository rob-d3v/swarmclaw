import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { previewSchedulePayload } from './schedule-preview'

const NOW = Date.parse('2026-05-06T12:00:00.000Z')

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'agent-1',
    name: 'Preview schedule',
    taskPrompt: 'Review the queue',
    status: 'active',
    ...overrides,
  }
}

describe('previewSchedulePayload', () => {
  it('forecasts cron schedules with an explicit timezone', () => {
    const preview = previewSchedulePayload(basePayload({
      scheduleType: 'cron',
      cron: '0 9 * * *',
      timezone: 'UTC',
    }), { now: NOW })

    assert.equal(preview.ok, true)
    if (!preview.ok) return
    assert.equal(preview.scheduleType, 'cron')
    assert.equal(preview.timezone, 'UTC')
    assert.equal(preview.nextRuns.length, 5)
    assert.equal(preview.nextRunAt, Date.parse('2026-05-07T09:00:00.000Z'))
    assert.equal(preview.nextRuns[0].iso, '2026-05-07T09:00:00.000Z')
    assert.deepEqual(preview.warnings, [])
  })

  it('warns when cron schedules rely on host local time', () => {
    const preview = previewSchedulePayload(basePayload({
      scheduleType: 'cron',
      cron: '0 9 * * *',
    }), { now: NOW, count: 2 })

    assert.equal(preview.ok, true)
    if (!preview.ok) return
    assert.equal(preview.nextRuns.length, 2)
    assert.match(preview.warnings.join('\n'), /host local timezone/)
  })

  it('rejects invalid timezone values before saving', () => {
    const preview = previewSchedulePayload(basePayload({
      scheduleType: 'cron',
      cron: '0 9 * * *',
      timezone: 'Not/AZone',
    }), { now: NOW })

    assert.equal(preview.ok, false)
    if (preview.ok) return
    assert.match(preview.error, /invalid timezone/)
  })

  it('forecasts interval schedules from the preview time', () => {
    const preview = previewSchedulePayload(basePayload({
      scheduleType: 'interval',
      intervalMs: 30 * 60_000,
    }), { now: NOW, count: 3 })

    assert.equal(preview.ok, true)
    if (!preview.ok) return
    assert.equal(preview.scheduleType, 'interval')
    assert.equal(preview.nextRuns.length, 3)
    assert.deepEqual(preview.nextRuns.map((run) => run.at), [
      NOW + 30 * 60_000,
      NOW + 60 * 60_000,
      NOW + 90 * 60_000,
    ])
  })

  it('warns when a run-once schedule is already in the past', () => {
    const preview = previewSchedulePayload(basePayload({
      scheduleType: 'once',
      runAt: NOW - 60_000,
    }), { now: NOW })

    assert.equal(preview.ok, true)
    if (!preview.ok) return
    assert.equal(preview.nextRunAt, null)
    assert.equal(preview.nextRuns.length, 0)
    assert.match(preview.warnings.join('\n'), /past/)
  })
})
