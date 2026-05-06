import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildRunHandoffPacket,
  formatRunHandoffMarkdown,
} from './run-handoff'
import type { EvidenceArtifact, RunBrief, SessionRunRecord } from '@/types'

function run(overrides: Partial<SessionRunRecord> = {}): SessionRunRecord {
  return {
    id: overrides.id || 'run_1',
    sessionId: overrides.sessionId || 'sess_1',
    source: overrides.source || 'task',
    internal: overrides.internal ?? false,
    mode: overrides.mode || 'direct',
    status: overrides.status || 'completed',
    messagePreview: overrides.messagePreview || 'Verify the release',
    queuedAt: overrides.queuedAt ?? 1000,
    startedAt: overrides.startedAt ?? 1500,
    endedAt: overrides.endedAt ?? 4500,
    resultPreview: overrides.resultPreview || 'Release verified with browser smoke evidence.',
    ownerType: overrides.ownerType ?? 'task',
    ownerId: overrides.ownerId ?? 'task_1',
    ...overrides,
  }
}

function brief(overrides: Partial<RunBrief> = {}): RunBrief {
  return {
    runId: overrides.runId || 'run_1',
    sessionId: overrides.sessionId || 'sess_1',
    title: overrides.title || 'Verify the release',
    objective: overrides.objective || 'Verify the release',
    status: overrides.status || 'completed',
    source: overrides.source || 'task',
    owner: overrides.owner ?? { type: 'task', id: 'task_1' },
    timeline: overrides.timeline || [
      { label: 'Queued', status: 'queued', at: 1000 },
      { label: 'Started', status: 'running', at: 1500 },
      { label: 'Ended', status: 'completed', at: 4500 },
    ],
    result: overrides.result ?? 'Release verified with browser smoke evidence.',
    error: overrides.error ?? null,
    warnings: overrides.warnings || [],
    usage: overrides.usage || {
      inputTokens: 10,
      outputTokens: 20,
      estimatedCost: 0.01,
      citationCount: 1,
      sourceIds: ['source_1'],
    },
    evidence: overrides.evidence || [{
      id: 'evidence_1',
      kind: 'event',
      title: 'Smoke test',
      summary: 'Browser smoke passed.',
      createdAt: 4300,
    }],
    generatedAt: overrides.generatedAt ?? 5000,
  }
}

function artifact(overrides: Partial<EvidenceArtifact> = {}): EvidenceArtifact {
  return {
    id: overrides.id || 'artifact_1',
    kind: overrides.kind || 'run_result',
    title: overrides.title || 'Run result',
    preview: overrides.preview || 'Release verified.',
    createdAt: overrides.createdAt ?? 4500,
    source: overrides.source || { type: 'run', id: 'run_1', label: 'Verify the release' },
    ...overrides,
  }
}

describe('run handoff packets', () => {
  it('summarizes a completed run with evidence, artifacts, and resume commands', () => {
    const packet = buildRunHandoffPacket(run(), brief(), [artifact()], 6000)

    assert.equal(packet.schemaVersion, 1)
    assert.equal(packet.runId, 'run_1')
    assert.equal(packet.readiness.status, 'ready')
    assert.equal(packet.timing.durationMs, 3000)
    assert.equal(packet.evidence.length, 1)
    assert.equal(packet.artifacts.length, 1)
    assert.ok(packet.resume.commands.some((command) => command.includes('swarmclaw runs handoff run_1')))
    assert.deepEqual(packet.readiness.recommendedActions, ['Handoff packet is ready to share.'])
  })

  it('marks failed and under-evidenced runs as needing attention', () => {
    const packet = buildRunHandoffPacket(
      run({ status: 'failed', error: 'Provider timed out.', resultPreview: undefined }),
      brief({ status: 'failed', result: null, error: 'Provider timed out.', warnings: ['Run failed and needs review before using the result.'], evidence: [] }),
      [],
      6000,
    )

    assert.equal(packet.readiness.status, 'blocked')
    assert.ok(packet.readiness.recommendedActions.some((action) => action.includes('Review the run error')))
    assert.ok(packet.outcome.warnings.length > 0)
  })

  it('formats concise markdown for handoff into another operator context', () => {
    const markdown = formatRunHandoffMarkdown(buildRunHandoffPacket(run(), brief(), [artifact({ url: '/api/files/serve?path=result.md' })], 6000))

    assert.match(markdown, /^# Run Handoff: Verify the release/)
    assert.match(markdown, /Run ID: run_1/)
    assert.match(markdown, /## Outcome/)
    assert.match(markdown, /Browser smoke passed/)
    assert.match(markdown, /swarmclaw chats context-pack sess_1/)
  })
})
