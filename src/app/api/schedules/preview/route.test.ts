import assert from 'node:assert/strict'
import test from 'node:test'

import { POST as previewSchedule } from './route'

test('POST /api/schedules/preview returns a timing forecast without persisting', async () => {
  const agentId = `missing-preview-agent-${Date.now()}`
  const response = await previewSchedule(new Request('http://local/api/schedules/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId,
      name: 'Preview smoke',
      taskPrompt: 'Review the queue',
      scheduleType: 'cron',
      cron: '0 9 * * *',
      timezone: 'UTC',
      status: 'active',
    }),
  }))

  assert.equal(response.status, 200)
  const payload = await response.json() as Record<string, unknown>
  assert.equal(payload.ok, true)
  assert.equal(payload.scheduleType, 'cron')
  assert.equal(payload.timezone, 'UTC')
  assert.equal(Array.isArray(payload.nextRuns), true)
  assert.equal((payload.nextRuns as unknown[]).length, 5)
  assert.match(String((payload.warnings as string[]).join('\n')), /Agent not found/)
})

test('POST /api/schedules/preview rejects invalid draft timing', async () => {
  const response = await previewSchedule(new Request('http://local/api/schedules/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId: 'schedule-preview-agent-invalid',
      taskPrompt: 'Review the queue',
      scheduleType: 'cron',
      cron: '0 9 * * *',
      timezone: 'Not/AZone',
    }),
  }))

  assert.equal(response.status, 400)
  const payload = await response.json() as Record<string, unknown>
  assert.match(String(payload.error || ''), /invalid timezone/)
})
