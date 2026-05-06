import type { EvidenceArtifact, RunBrief, RunHandoffPacket, RunHandoffReadinessStatus, SessionRunRecord } from '@/types'

const MAX_TEXT = 900
const MAX_EVIDENCE = 12
const MAX_ARTIFACTS = 16

function compactText(value: string | null | undefined, maxChars = MAX_TEXT): string | null {
  const text = (value || '').split(/\s+/).filter(Boolean).join(' ').trim()
  if (!text) return null
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text
}

function toIso(value: number | null | undefined): string {
  return value && Number.isFinite(value) ? new Date(value).toISOString() : 'n/a'
}

function durationMs(run: SessionRunRecord, now: number): number | null {
  if (!run.startedAt) return null
  const end = run.endedAt || now
  if (!Number.isFinite(end) || end < run.startedAt) return null
  return Math.max(0, Math.trunc(end - run.startedAt))
}

function readinessStatus(run: SessionRunRecord, brief: RunBrief, artifacts: EvidenceArtifact[]): RunHandoffReadinessStatus {
  if (run.status === 'failed') return 'blocked'
  if (run.status === 'cancelled') return 'needs_attention'
  if (run.status === 'queued' || run.status === 'running') return 'needs_attention'
  if (brief.warnings.length > 0) return 'needs_attention'
  if (!compactText(brief.result || run.resultPreview)) return 'needs_attention'
  if (brief.evidence.length === 0 && artifacts.length === 0) return 'needs_attention'
  return 'ready'
}

function recommendedActions(run: SessionRunRecord, brief: RunBrief, artifacts: EvidenceArtifact[]): string[] {
  const actions: string[] = []
  if (run.status === 'failed') actions.push('Review the run error, fix the cause, then rerun from the source session or owner.')
  if (run.status === 'cancelled') actions.push('Review why the run was cancelled before continuing the handoff.')
  if (run.status === 'queued' || run.status === 'running') actions.push('Wait for the run to finish or cancel it before using the result as final.')
  if (!compactText(brief.result || run.resultPreview) && run.status === 'completed') actions.push('Record a result summary before sharing this run.')
  if (brief.evidence.length === 0 && artifacts.length === 0 && run.status === 'completed') {
    actions.push('Attach evidence, artifacts, or a task report if another operator will continue from this run.')
  }
  for (const warning of brief.warnings) {
    actions.push(warning)
  }
  return actions.length > 0 ? Array.from(new Set(actions)).slice(0, 8) : ['Handoff packet is ready to share.']
}

function resumeCommands(run: SessionRunRecord): string[] {
  return [
    `swarmclaw runs handoff ${run.id} --query format=markdown`,
    `swarmclaw runs brief ${run.id}`,
    `swarmclaw chats context-pack ${run.sessionId} --query format=markdown`,
  ]
}

export function buildRunHandoffPacket(
  run: SessionRunRecord,
  brief: RunBrief,
  artifacts: EvidenceArtifact[] = [],
  now = Date.now(),
): RunHandoffPacket {
  const limitedArtifacts = artifacts.slice(0, MAX_ARTIFACTS)
  return {
    schemaVersion: 1,
    runId: run.id,
    sessionId: run.sessionId,
    title: compactText(brief.title || run.messagePreview, 160) || run.id,
    objective: compactText(brief.objective || run.messagePreview, 1400) || run.source,
    source: run.source,
    mode: run.mode,
    status: run.status,
    owner: brief.owner || (run.ownerType && run.ownerId ? { type: run.ownerType, id: run.ownerId } : null),
    generatedAt: now,
    timing: {
      queuedAt: run.queuedAt,
      startedAt: run.startedAt || null,
      endedAt: run.endedAt || null,
      durationMs: durationMs(run, now),
    },
    outcome: {
      result: compactText(brief.result || run.resultPreview, 1400),
      error: compactText(brief.error || run.error, 1400),
      warnings: brief.warnings.slice(0, 12),
    },
    usage: brief.usage,
    timeline: brief.timeline.slice(0, 20),
    evidence: brief.evidence.slice(0, MAX_EVIDENCE),
    artifacts: limitedArtifacts,
    resume: {
      sessionId: run.sessionId,
      commands: resumeCommands(run),
      links: [
        { label: 'Run events', href: `/api/runs/${encodeURIComponent(run.id)}/events` },
        { label: 'Run brief', href: `/api/runs/${encodeURIComponent(run.id)}/brief` },
        { label: 'Session context pack', href: `/api/chats/${encodeURIComponent(run.sessionId)}/context-pack?format=markdown` },
      ],
    },
    readiness: {
      status: readinessStatus(run, brief, limitedArtifacts),
      recommendedActions: recommendedActions(run, brief, limitedArtifacts),
    },
  }
}

function appendSection(lines: string[], title: string, body: string[] = []) {
  lines.push('', `## ${title}`)
  if (body.length === 0) lines.push('None.')
  else lines.push(...body)
}

function artifactLine(artifact: EvidenceArtifact): string {
  const target = artifact.url || artifact.href || ''
  const preview = compactText(artifact.preview || artifact.description, 280)
  return `- ${artifact.title} (${artifact.kind})${target ? ` ${target}` : ''}${preview ? `: ${preview}` : ''}`
}

export function formatRunHandoffMarkdown(packet: RunHandoffPacket): string {
  const owner = packet.owner ? `${packet.owner.type}:${packet.owner.id}` : 'unassigned'
  const duration = packet.timing.durationMs == null ? 'n/a' : `${Math.round(packet.timing.durationMs / 1000)}s`
  const lines = [
    `# Run Handoff: ${packet.title}`,
    '',
    `Generated: ${toIso(packet.generatedAt)}`,
    `Run ID: ${packet.runId}`,
    `Session ID: ${packet.sessionId}`,
    `Status: ${packet.status}`,
    `Readiness: ${packet.readiness.status}`,
    `Source: ${packet.source}`,
    `Owner: ${owner}`,
    `Duration: ${duration}`,
  ]

  appendSection(lines, 'Objective', [packet.objective])

  appendSection(lines, 'Outcome', [
    packet.outcome.result ? `- Result: ${packet.outcome.result}` : '',
    packet.outcome.error ? `- Error: ${packet.outcome.error}` : '',
    ...packet.outcome.warnings.map((warning) => `- Warning: ${warning}`),
  ].filter(Boolean))

  appendSection(lines, 'Timeline', packet.timeline.map((item) => {
    const status = item.status ? ` (${item.status})` : ''
    const detail = item.detail ? `: ${compactText(item.detail, 260)}` : ''
    return `- ${item.label}${status} at ${toIso(item.at)}${detail}`
  }))

  appendSection(lines, 'Evidence', packet.evidence.map((item) => {
    const url = item.url ? ` ${item.url}` : ''
    return `- ${item.title} (${item.kind})${url}: ${item.summary}`
  }))

  appendSection(lines, 'Artifacts', packet.artifacts.map(artifactLine))

  appendSection(lines, 'Usage', [
    `- Input tokens: ${packet.usage.inputTokens ?? 0}`,
    `- Output tokens: ${packet.usage.outputTokens ?? 0}`,
    packet.usage.estimatedCost != null ? `- Estimated cost: $${packet.usage.estimatedCost.toFixed(4)}` : '',
    `- Citations: ${packet.usage.citationCount}`,
    packet.usage.sourceIds.length > 0 ? `- Sources: ${packet.usage.sourceIds.join(', ')}` : '',
  ].filter(Boolean))

  appendSection(lines, 'Resume', [
    ...packet.resume.commands.map((command) => `- \`${command}\``),
    ...packet.resume.links.map((link) => `- ${link.label}: ${link.href}`),
  ])

  appendSection(lines, 'Recommended Actions', packet.readiness.recommendedActions.map((action) => `- ${action}`))

  return `${lines.join('\n')}\n`
}
