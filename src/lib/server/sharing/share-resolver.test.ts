import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import type { Mission, MissionReport } from '@/types'

const originalEnv = {
  DATA_DIR: process.env.DATA_DIR,
  WORKSPACE_DIR: process.env.WORKSPACE_DIR,
  SWARMCLAW_BUILD_MODE: process.env.SWARMCLAW_BUILD_MODE,
}

let tempDir = ''
let repo: typeof import('@/lib/server/missions/mission-repository')
let resolver: typeof import('./share-resolver')

function makeMission(overrides: Partial<Mission> = {}): Mission {
  const now = Date.now()
  return {
    id: overrides.id ?? 'mi_share_1',
    title: 'Shared mission',
    goal: 'Produce a launch report',
    successCriteria: ['Report exists', 'Evidence is cited'],
    rootSessionId: 'share_session_1',
    agentIds: ['agent_1'],
    status: 'running',
    budget: {
      maxUsd: 2,
      maxTokens: 100_000,
      maxToolCalls: null,
      maxWallclockSec: 86_400,
      maxTurns: 120,
      warnAtFractions: [0.5, 0.8, 0.95],
    },
    usage: {
      usdSpent: 0.42,
      tokensUsed: 12_345,
      toolCallsUsed: 9,
      turnsRun: 12,
      wallclockMsElapsed: 900_000,
      startedAt: now - 900_000,
      lastUpdatedAt: now,
      warnFractionsHit: [],
    },
    milestones: [
      {
        id: 'ms_1',
        at: now - 1000,
        kind: 'subgoal_done',
        summary: 'Release evidence collected',
        evidence: ['run_1'],
        sessionId: 'share_session_1',
        runId: 'run_1',
      },
    ],
    reportSchedule: null,
    reportConnectorIds: [],
    createdAt: now - 1_000_000,
    updatedAt: now,
    ...overrides,
  }
}

function makeReport(missionId: string, overrides: Partial<MissionReport> = {}): MissionReport {
  const now = Date.now()
  return {
    id: overrides.id ?? 'mrep_share_1',
    missionId,
    generatedAt: overrides.generatedAt ?? now,
    format: 'markdown',
    fromAt: now - 10_000,
    toAt: now,
    title: overrides.title ?? 'Shared mission: progress update',
    body: overrides.body ?? '# Shared mission\n\nEvidence is ready.',
    deliveredTo: [],
    highlights: [],
    ...overrides,
  }
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-share-resolver-'))
  process.env.DATA_DIR = path.join(tempDir, 'data')
  process.env.WORKSPACE_DIR = path.join(tempDir, 'workspace')
  process.env.SWARMCLAW_BUILD_MODE = '1'
  repo = await import('@/lib/server/missions/mission-repository')
  resolver = await import('./share-resolver')
})

after(() => {
  if (originalEnv.DATA_DIR === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = originalEnv.DATA_DIR
  if (originalEnv.WORKSPACE_DIR === undefined) delete process.env.WORKSPACE_DIR
  else process.env.WORKSPACE_DIR = originalEnv.WORKSPACE_DIR
  if (originalEnv.SWARMCLAW_BUILD_MODE === undefined) delete process.env.SWARMCLAW_BUILD_MODE
  else process.env.SWARMCLAW_BUILD_MODE = originalEnv.SWARMCLAW_BUILD_MODE
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('share-resolver', () => {
  it('resolves a public mission payload with summary milestones and safe report metadata', () => {
    const mission = makeMission({ id: 'mi_public_share' })
    repo.upsertMission(mission)
    repo.saveMissionReport(makeReport(mission.id, { id: 'mrep_old', generatedAt: mission.createdAt + 1000, title: 'Old report' }))
    repo.saveMissionReport(makeReport(mission.id, { id: 'mrep_new', generatedAt: mission.createdAt + 2000, title: 'Latest report' }))

    const payload = resolver.resolveSharedEntity({
      id: 'share_1',
      token: 'tok',
      entityType: 'mission',
      entityId: mission.id,
      label: null,
      createdAt: Date.now(),
      expiresAt: null,
      revokedAt: null,
    })

    assert.equal(payload?.kind, 'mission')
    if (payload?.kind !== 'mission') return
    assert.equal(payload.milestones[0]?.summary, 'Release evidence collected')
    assert.equal(Object.hasOwn(payload.milestones[0] ?? {}, 'note'), false)
    assert.equal(payload.usage.turnsRun, 12)
    assert.equal(payload.budget.maxUsd, 2)
    assert.equal(payload.latestReport?.title, 'Latest report')
    assert.deepEqual(payload.reports.map((r) => r.title), ['Latest report', 'Old report'])
  })
})
