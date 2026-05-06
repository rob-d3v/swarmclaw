import assert from 'node:assert/strict'
import test from 'node:test'

import { runWithTempDataDir } from '@/lib/server/test-utils/run-with-temp-data-dir'

test('GET /api/runs/[id]/handoff returns structured and markdown handoff context', () => {
  const output = runWithTempDataDir<{
    status: number
    markdownStatus: number
    missingStatus: number
    schemaVersion: number
    readiness: string
    artifactCount: number
    markdownContentType: string
    markdownIncludesTitle: boolean
    markdownIncludesCommand: boolean
  }>(`
    const storageMod = await import('./src/lib/server/storage')
    const ledgerMod = await import('./src/lib/server/runtime/run-ledger')
    const routeMod = await import('./src/app/api/runs/[id]/handoff/route')
    const storage = storageMod.default || storageMod
    const ledger = ledgerMod.default || ledgerMod
    const route = routeMod.default || routeMod

    const now = Date.now()
    storage.saveSessions({
      sess_run_handoff: {
        id: 'sess_run_handoff',
        name: 'Run handoff session',
        cwd: process.env.WORKSPACE_DIR,
        user: 'tester',
        provider: 'openai',
        model: 'gpt-4o-mini',
        messages: [],
        createdAt: now,
        lastActiveAt: now,
      },
    })

    ledger.persistRun({
      id: 'run_handoff_1',
      sessionId: 'sess_run_handoff',
      source: 'task',
      internal: false,
      mode: 'direct',
      status: 'completed',
      messagePreview: 'Ship the next fix',
      queuedAt: now - 5000,
      startedAt: now - 4000,
      endedAt: now - 1000,
      resultPreview: 'Fix shipped and verified.',
      totalInputTokens: 11,
      totalOutputTokens: 22,
      retrievalSummary: { citationCount: 1, sourceIds: ['source_1'] },
    })
    ledger.appendPersistedRunEvent({
      runId: 'run_handoff_1',
      sessionId: 'sess_run_handoff',
      phase: 'status',
      status: 'completed',
      timestamp: now - 1000,
      event: { t: 'md', text: 'Fix shipped and verified.' },
      citations: [{
        sourceId: 'source_1',
        sourceTitle: 'Release evidence',
        sourceKind: 'manual',
        sourceUrl: 'https://example.test/release',
        sourceLabel: null,
        chunkId: 'chunk_1',
        chunkIndex: 0,
        chunkCount: 1,
        charStart: 0,
        charEnd: 20,
        sectionLabel: null,
        snippet: 'Release checks passed.',
        whyMatched: null,
        score: 0.9,
      }],
    })

    const response = await route.GET(
      new Request('http://local/api/runs/run_handoff_1/handoff'),
      { params: Promise.resolve({ id: 'run_handoff_1' }) },
    )
    const payload = await response.json()

    const markdownResponse = await route.GET(
      new Request('http://local/api/runs/run_handoff_1/handoff?format=markdown'),
      { params: Promise.resolve({ id: 'run_handoff_1' }) },
    )
    const markdown = await markdownResponse.text()

    const missingResponse = await route.GET(
      new Request('http://local/api/runs/missing/handoff'),
      { params: Promise.resolve({ id: 'missing' }) },
    )

    console.log(JSON.stringify({
      status: response.status,
      markdownStatus: markdownResponse.status,
      missingStatus: missingResponse.status,
      schemaVersion: payload.schemaVersion,
      readiness: payload.readiness.status,
      artifactCount: payload.artifacts.length,
      markdownContentType: markdownResponse.headers.get('content-type') || '',
      markdownIncludesTitle: markdown.includes('# Run Handoff: Ship the next fix'),
      markdownIncludesCommand: markdown.includes('swarmclaw runs handoff run_handoff_1'),
    }))
  `, { prefix: 'swarmclaw-run-handoff-route-' })

  assert.equal(output.status, 200)
  assert.equal(output.markdownStatus, 200)
  assert.equal(output.missingStatus, 404)
  assert.equal(output.schemaVersion, 1)
  assert.equal(output.readiness, 'ready')
  assert.equal(output.artifactCount >= 1, true)
  assert.match(output.markdownContentType, /text\/markdown/)
  assert.equal(output.markdownIncludesTitle, true)
  assert.equal(output.markdownIncludesCommand, true)
})
