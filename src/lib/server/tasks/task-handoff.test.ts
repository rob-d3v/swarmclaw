import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildTaskHandoffPacket, formatTaskHandoffMarkdown } from '@/lib/server/tasks/task-handoff'
import type { BoardTask } from '@/types'

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'task-main',
    title: 'Prepare release handoff',
    description: 'Summarize the release state for the next operator.',
    status: 'backlog',
    agentId: 'agent-1',
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  } as BoardTask
}

describe('task handoff packets', () => {
  it('marks unresolved blockers as blocked and recommends a concrete action', () => {
    const tasks: Record<string, BoardTask> = {
      'task-main': task({
        blockedBy: ['dep-1'],
        executionWorkspace: {
          path: '/tmp/workspace',
          mode: 'task',
          preparedAt: 150,
          previewLinks: [],
          runtimeServices: [],
        },
      }),
      'dep-1': task({
        id: 'dep-1',
        title: 'Finish prerequisite',
        status: 'running',
        agentId: 'agent-2',
      }),
    }

    const packet = buildTaskHandoffPacket(tasks['task-main'], tasks, { now: 300, runBrief: null })

    assert.equal(packet.readiness.status, 'blocked')
    assert.deepEqual(packet.dependencies.blockedBy.map((ref) => ref.id), ['dep-1'])
    assert.equal(packet.readiness.checks.find((item) => item.id === 'dependencies')?.status, 'blocked')
    assert.ok(packet.readiness.recommendedActions.some((action) => action.includes('unresolved blockers')))
  })

  it('summarizes workspace, evidence, and quality gate state in markdown', () => {
    const mainTask = task({
      status: 'completed',
      result: 'Release completed with tests and browser smoke.',
      completionReportPath: '/tmp/workspace/report.md',
      outputFiles: ['/tmp/workspace/report.md'],
      artifacts: [{ filename: 'smoke.txt', type: 'file', url: '/uploads/smoke.txt' }],
      verificationSummary: 'npm run test passed',
      qualityGate: {
        enabled: true,
        minResultChars: 10,
        minEvidenceItems: 2,
        requireVerification: true,
        requireArtifact: true,
        requireReport: true,
      },
      executionWorkspace: {
        path: '/tmp/workspace',
        mode: 'task',
        contextPath: '/tmp/workspace/context.json',
        envPath: '/tmp/workspace/.env.swarmclaw',
        preparedAt: 150,
        previewLinks: [{ id: 'preview', label: 'Preview', kind: 'web', url: 'http://127.0.0.1:3456', addedAt: 160 }],
        runtimeServices: [{ id: 'dev', name: 'Dev server', status: 'running', updatedAt: 160 }],
      },
    })

    const packet = buildTaskHandoffPacket(mainTask, { 'task-main': mainTask }, { now: 300, runBrief: null })
    const markdown = formatTaskHandoffMarkdown(packet)

    assert.equal(packet.readiness.status, 'ready')
    assert.match(markdown, /# Task Handoff: Prepare release handoff/)
    assert.match(markdown, /Readiness: ready/)
    assert.match(markdown, /Workspace: \/tmp\/workspace/)
    assert.match(markdown, /Preview: Preview http:\/\/127\.0\.0\.1:3456/)
    assert.match(markdown, /Task report: \/tmp\/workspace\/report\.md/)
  })
})
