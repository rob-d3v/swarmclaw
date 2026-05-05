import { buildRunBrief } from '@/lib/server/runs/run-brief'
import { getUnifiedRunById, listUnifiedRunEvents, listUnifiedRuns } from '@/lib/server/runs/unified-run-queries'
import { computeTaskLiveness } from '@/lib/server/tasks/task-execution-workspace'
import type {
  BoardTask,
  RunBrief,
  TaskHandoffCheck,
  TaskHandoffPacket,
  TaskHandoffReadinessStatus,
  TaskHandoffTaskRef,
} from '@/types'

const MAX_MARKDOWN_TEXT = 900

function compactText(value: unknown, maxChars = MAX_MARKDOWN_TEXT): string | null {
  if (typeof value !== 'string') return null
  const text = value.split(/\s+/).filter(Boolean).join(' ').trim()
  if (!text) return null
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text
}

function toIso(value: number | null | undefined): string {
  return value && Number.isFinite(value) ? new Date(value).toISOString() : 'n/a'
}

function taskRef(id: string, tasks: Record<string, BoardTask>, now: number): TaskHandoffTaskRef {
  const task = tasks[id]
  if (!task) {
    return {
      id,
      title: id,
      status: 'backlog',
      agentId: null,
      completedAt: null,
      liveness: {
        state: 'blocked',
        reason: 'Referenced task is missing.',
        checkedAt: now,
      },
    }
  }
  return {
    id: task.id,
    title: task.title || task.id,
    status: task.status,
    agentId: task.agentId || null,
    completedAt: task.completedAt ?? null,
    liveness: computeTaskLiveness(task, tasks, { now }),
  }
}

function resolveLatestRunBrief(task: BoardTask): RunBrief | null {
  const candidateIds = [
    task.checkpoint?.lastRunId,
    task.protocolRunId,
  ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)

  for (const runId of candidateIds) {
    const run = getUnifiedRunById(runId)
    if (run) return buildRunBrief(run, listUnifiedRunEvents(runId, 300))
  }

  if (!task.sessionId) return null
  const latestOwnedRun = listUnifiedRuns({ sessionId: task.sessionId, limit: 50 })
    .find((run) => run.ownerType === 'task' && run.ownerId === task.id)
  if (!latestOwnedRun) return null
  return buildRunBrief(latestOwnedRun, listUnifiedRunEvents(latestOwnedRun.id, 300))
}

function check(id: string, label: string, status: TaskHandoffCheck['status'], detail?: string | null, taskIds?: string[]): TaskHandoffCheck {
  return { id, label, status, detail: detail || null, ...(taskIds?.length ? { taskIds } : {}) }
}

function qualityChecks(task: BoardTask, runBrief: RunBrief | null): TaskHandoffCheck[] {
  const gate = task.qualityGate || null
  if (!gate?.enabled) return [check('quality-gate', 'Quality gate', 'ok', 'No task-specific gate is enabled.')]

  const checks: TaskHandoffCheck[] = []
  const resultLength = (task.result || '').trim().length
  const minResultChars = Math.max(0, Math.trunc(gate.minResultChars ?? 0))
  if (minResultChars > 0) {
    checks.push(check(
      'quality-result',
      'Result length',
      resultLength >= minResultChars ? 'ok' : 'warning',
      resultLength >= minResultChars
        ? `Result has ${resultLength} characters.`
        : `Result has ${resultLength} of ${minResultChars} required characters.`,
    ))
  }

  const evidenceCount =
    (Array.isArray(task.outputFiles) ? task.outputFiles.length : 0)
    + (Array.isArray(task.artifacts) ? task.artifacts.length : 0)
    + (runBrief?.evidence.length || 0)
  const minEvidenceItems = Math.max(0, Math.trunc(gate.minEvidenceItems ?? 0))
  if (minEvidenceItems > 0) {
    checks.push(check(
      'quality-evidence',
      'Evidence',
      evidenceCount >= minEvidenceItems ? 'ok' : 'warning',
      evidenceCount >= minEvidenceItems
        ? `${evidenceCount} evidence signal${evidenceCount === 1 ? '' : 's'} available.`
        : `${evidenceCount} of ${minEvidenceItems} required evidence signals are available.`,
    ))
  }

  if (gate.requireVerification) {
    const hasVerification = Boolean(compactText(task.verificationSummary, 240) || runBrief?.warnings.length === 0 && runBrief?.status === 'completed')
    checks.push(check(
      'quality-verification',
      'Verification',
      hasVerification ? 'ok' : 'warning',
      hasVerification ? 'Verification signal is present.' : 'Add verification notes before handoff.',
    ))
  }

  if (gate.requireArtifact) {
    const artifactCount = Array.isArray(task.artifacts) ? task.artifacts.length : 0
    checks.push(check(
      'quality-artifact',
      'Artifact',
      artifactCount > 0 ? 'ok' : 'warning',
      artifactCount > 0 ? `${artifactCount} artifact${artifactCount === 1 ? '' : 's'} attached.` : 'Attach at least one artifact.',
    ))
  }

  if (gate.requireReport) {
    checks.push(check(
      'quality-report',
      'Task report',
      task.completionReportPath ? 'ok' : 'warning',
      task.completionReportPath ? 'Task report path is present.' : 'Generate or attach a task report.',
    ))
  }

  return checks.length > 0 ? checks : [check('quality-gate', 'Quality gate', 'ok', 'Enabled gate has no active requirements.')]
}

function readinessStatus(checks: TaskHandoffCheck[]): TaskHandoffReadinessStatus {
  if (checks.some((item) => item.status === 'blocked')) return 'blocked'
  if (checks.some((item) => item.status === 'warning')) return 'needs_attention'
  return 'ready'
}

function recommendedActions(checks: TaskHandoffCheck[]): string[] {
  const actions: string[] = []
  for (const item of checks) {
    if (item.status === 'ok') continue
    if (item.id === 'dependencies') actions.push('Complete or remove unresolved blockers before queueing the task.')
    else if (item.id === 'workspace') actions.push('Prepare or refresh the task workspace before handing it to another operator.')
    else if (item.id === 'liveness') actions.push('Inspect the current run state and clear stale or failed execution before resuming.')
    else if (item.id.startsWith('quality-')) actions.push(item.detail || 'Resolve the task quality gate before handoff.')
    else if (item.detail) actions.push(item.detail)
  }
  return Array.from(new Set(actions)).slice(0, 8)
}

export function buildTaskHandoffPacket(
  task: BoardTask,
  tasks: Record<string, BoardTask>,
  options: { now?: number; runBrief?: RunBrief | null } = {},
): TaskHandoffPacket {
  const now = options.now ?? Date.now()
  const liveness = computeTaskLiveness(task, tasks, { now })
  const blockedBy = (task.blockedBy || []).map((id) => taskRef(id, tasks, now))
  const blocks = (task.blocks || []).map((id) => taskRef(id, tasks, now))
  const unresolvedBlockerIds = blockedBy
    .filter((ref) => ref.status !== 'completed')
    .map((ref) => ref.id)
  const runBrief = options.runBrief === undefined ? resolveLatestRunBrief(task) : options.runBrief
  const gateChecks = qualityChecks(task, runBrief)
  const executionWorkspace = task.executionWorkspace || null
  const previewLinks = task.previewLinks && task.previewLinks.length > 0
    ? task.previewLinks
    : executionWorkspace?.previewLinks || []
  const runtimeServices = task.runtimeServices && task.runtimeServices.length > 0
    ? task.runtimeServices
    : executionWorkspace?.runtimeServices || []

  const checks: TaskHandoffCheck[] = [
    check(
      'owner',
      'Owner',
      task.agentId ? 'ok' : 'warning',
      task.agentId ? `Assigned to ${task.agentId}.` : 'Assign an agent before execution.',
    ),
    check(
      'dependencies',
      'Dependencies',
      unresolvedBlockerIds.length > 0 ? 'blocked' : 'ok',
      unresolvedBlockerIds.length > 0
        ? `Waiting on ${unresolvedBlockerIds.length} blocker${unresolvedBlockerIds.length === 1 ? '' : 's'}.`
        : 'No unresolved blockers.',
      unresolvedBlockerIds,
    ),
    check(
      'workspace',
      'Execution workspace',
      executionWorkspace ? 'ok' : 'warning',
      executionWorkspace ? 'Workspace is prepared.' : 'No task workspace is prepared.',
    ),
    check(
      'liveness',
      'Liveness',
      liveness.state === 'failed' || liveness.state === 'dead_lettered' || liveness.state === 'cancelled'
        ? 'blocked'
        : liveness.state === 'stale' || liveness.state === 'retrying'
          ? 'warning'
          : 'ok',
      liveness.reason,
    ),
    ...gateChecks,
  ]

  const status = readinessStatus(checks)
  return {
    schemaVersion: 1,
    taskId: task.id,
    title: task.title || task.id,
    description: task.description || null,
    objective: task.objective || null,
    status: task.status,
    priority: task.priority,
    generatedAt: now,
    updatedAt: task.updatedAt,
    owner: {
      agentId: task.agentId || null,
      projectId: task.projectId || null,
      sessionId: task.sessionId || null,
      createdByAgentId: task.createdByAgentId || null,
      delegatedByAgentId: task.delegatedByAgentId || null,
    },
    liveness,
    execution: {
      workspacePath: executionWorkspace?.path || null,
      sourceCwd: executionWorkspace?.sourceCwd || task.cwd || null,
      mode: executionWorkspace?.mode || null,
      contextPath: executionWorkspace?.contextPath || null,
      envPath: executionWorkspace?.envPath || null,
      previewLinks,
      runtimeServices,
    },
    dependencies: {
      blockedBy,
      blocks,
    },
    qualityGate: {
      enabled: Boolean(task.qualityGate?.enabled),
      config: task.qualityGate || null,
      checks: gateChecks,
    },
    outputs: {
      result: task.result || null,
      error: task.error || null,
      outputFiles: Array.isArray(task.outputFiles) ? task.outputFiles : [],
      artifacts: Array.isArray(task.artifacts) ? task.artifacts : [],
      completionReportPath: task.completionReportPath || null,
      verificationSummary: task.verificationSummary || null,
    },
    resume: {
      cliProvider: task.cliProvider || null,
      cliResumeId: task.cliResumeId || null,
      claudeResumeId: task.claudeResumeId || null,
      codexResumeId: task.codexResumeId || null,
      opencodeResumeId: task.opencodeResumeId || null,
      geminiResumeId: task.geminiResumeId || null,
    },
    run: runBrief
      ? {
          runId: runBrief.runId,
          sessionId: runBrief.sessionId,
          title: runBrief.title,
          status: runBrief.status,
          result: runBrief.result,
          error: runBrief.error,
          warnings: runBrief.warnings,
          evidenceCount: runBrief.evidence.length,
        }
      : null,
    readiness: {
      status,
      checks,
      recommendedActions: status === 'ready'
        ? ['Handoff packet is ready to share.']
        : recommendedActions(checks),
    },
  }
}

function lineForRef(ref: TaskHandoffTaskRef): string {
  const suffix = ref.liveness?.reason ? `, ${ref.liveness.reason}` : ''
  return `- ${ref.title} (${ref.id}): ${ref.status}${suffix}`
}

function appendSection(lines: string[], title: string, body: string[] = []) {
  lines.push('', `## ${title}`)
  if (body.length === 0) lines.push('None.')
  else lines.push(...body)
}

export function formatTaskHandoffMarkdown(packet: TaskHandoffPacket): string {
  const lines = [
    `# Task Handoff: ${packet.title}`,
    '',
    `Generated: ${toIso(packet.generatedAt)}`,
    `Task ID: ${packet.taskId}`,
    `Status: ${packet.status}`,
    `Readiness: ${packet.readiness.status}`,
    `Owner: ${packet.owner.agentId || 'unassigned'}`,
    `Updated: ${toIso(packet.updatedAt)}`,
  ]

  const objective = compactText(packet.objective || packet.description, 1400)
  if (objective) appendSection(lines, 'Objective', [objective])

  appendSection(lines, 'Liveness', [
    `- State: ${packet.liveness.state}`,
    `- Reason: ${packet.liveness.reason}`,
    packet.liveness.nextWakeAt ? `- Next wake: ${toIso(packet.liveness.nextWakeAt)}` : '',
  ].filter(Boolean))

  appendSection(lines, 'Workspace', [
    packet.execution.workspacePath ? `- Workspace: ${packet.execution.workspacePath}` : '- Workspace: not prepared',
    packet.execution.sourceCwd ? `- Source: ${packet.execution.sourceCwd}` : '',
    packet.execution.contextPath ? `- Context: ${packet.execution.contextPath}` : '',
    packet.execution.envPath ? `- Env: ${packet.execution.envPath}` : '',
  ].filter(Boolean))

  appendSection(lines, 'Runtime', [
    ...packet.execution.previewLinks.map((link) => `- Preview: ${link.label || 'Preview'} ${link.url}`),
    ...packet.execution.runtimeServices.map((service) => `- Service: ${service.name} (${service.status})${service.url ? ` ${service.url}` : ''}`),
  ])

  appendSection(lines, 'Dependencies', [
    ...packet.dependencies.blockedBy.map(lineForRef),
    ...packet.dependencies.blocks.map((ref) => `- Blocks ${ref.title} (${ref.id}): ${ref.status}`),
  ])

  appendSection(lines, 'Quality Checks', packet.readiness.checks.map((item) => {
    const detail = item.detail ? `, ${item.detail}` : ''
    return `- ${item.label}: ${item.status}${detail}`
  }))

  appendSection(lines, 'Evidence', [
    packet.outputs.result ? `- Result: ${compactText(packet.outputs.result, 500)}` : '',
    packet.outputs.error ? `- Error: ${compactText(packet.outputs.error, 500)}` : '',
    ...packet.outputs.outputFiles.map((file) => `- Output file: ${file}`),
    ...packet.outputs.artifacts.map((artifact) => `- Artifact: ${artifact.filename} ${artifact.url}`),
    packet.outputs.completionReportPath ? `- Task report: ${packet.outputs.completionReportPath}` : '',
    packet.run ? `- Latest run: ${packet.run.title} (${packet.run.status}, ${packet.run.evidenceCount} evidence items)` : '',
  ].filter(Boolean))

  appendSection(lines, 'Resume Handles', [
    packet.resume.cliResumeId ? `- ${packet.resume.cliProvider || 'CLI'}: ${packet.resume.cliResumeId}` : '',
    packet.resume.claudeResumeId ? `- Claude: ${packet.resume.claudeResumeId}` : '',
    packet.resume.codexResumeId ? `- Codex: ${packet.resume.codexResumeId}` : '',
    packet.resume.opencodeResumeId ? `- OpenCode: ${packet.resume.opencodeResumeId}` : '',
    packet.resume.geminiResumeId ? `- Gemini: ${packet.resume.geminiResumeId}` : '',
  ].filter(Boolean))

  appendSection(lines, 'Recommended Actions', packet.readiness.recommendedActions.map((action) => `- ${action}`))

  return `${lines.join('\n')}\n`
}
