import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..')

function runWithTempDataDir<T extends Record<string, unknown>>(script: string): T {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-queue-retry-policy-'))
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATA_DIR: path.join(tempDir, 'data'),
        WORKSPACE_DIR: path.join(tempDir, 'workspace'),
        SWARMCLAW_BUILD_MODE: '1',
      },
      encoding: 'utf-8',
      timeout: 15000,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout || 'subprocess failed')
    const lines = (result.stdout || '')
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const jsonLine = [...lines].reverse().find((line) => line.startsWith('{'))
    return JSON.parse(jsonLine || '{}') as T
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

test('recoverStalledRunningTasks dead-letters repeated retry failures instead of repeating identical work', () => {
  const output = runWithTempDataDir<{
    result: { recovered: number; deadLettered: number }
    status: string | null
    attempts: number | null
    queued: string[]
    retryScheduledAt: number | null
    deadLetteredAt: number | null
    error: string | null
  }>(`
    const storageMod = await import('@/lib/server/storage')
    const queueMod = await import('@/lib/server/runtime/queue')
    const storage = storageMod.default || storageMod
    const queue = queueMod.default || queueMod

    const now = Date.now()
    const reason = 'Detected stalled run after 5m without progress'
    storage.saveSettings({
      ...storage.loadSettings(),
      taskStallTimeoutMin: 5,
      taskRetryBackoffSec: 30,
    })
    storage.saveTasks({
      repeat: {
        id: 'repeat',
        title: 'Repeated structural failure',
        description: 'A task that already retried the same failure reason',
        status: 'running',
        agentId: 'agent-a',
        startedAt: now - 600_000,
        updatedAt: now - 600_000,
        createdAt: now - 700_000,
        maxAttempts: 3,
        attempts: 1,
        checkoutRunId: 'repeat-run-id',
        error: 'Retry scheduled after failure: ' + reason,
      },
    })
    storage.saveQueue([])

    const result = queue.recoverStalledRunningTasks()
    const task = storage.loadTasks().repeat
    console.log(JSON.stringify({
      result,
      status: task?.status ?? null,
      attempts: task?.attempts ?? null,
      queued: storage.loadQueue(),
      retryScheduledAt: task?.retryScheduledAt ?? null,
      deadLetteredAt: task?.deadLetteredAt ?? null,
      error: task?.error ?? null,
    }))
  `)

  assert.equal(output.result.recovered, 0)
  assert.equal(output.result.deadLettered, 1)
  assert.equal(output.status, 'failed')
  assert.equal(output.attempts, 2)
  assert.deepEqual(output.queued, [])
  assert.equal(output.retryScheduledAt, null)
  assert.equal(typeof output.deadLetteredAt, 'number')
  assert.match(output.error || '', /Dead-lettered after 2\/3 attempts/)
})
