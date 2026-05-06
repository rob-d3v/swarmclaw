import type { EvidenceArtifact } from './artifact'
import type { ExecutionOwnerType, SessionRunStatus } from './run'
import type { RunBriefEvidenceItem, RunBriefTimelineItem } from './run-brief'

export type RunHandoffReadinessStatus = 'ready' | 'needs_attention' | 'blocked'

export interface RunHandoffPacket {
  schemaVersion: 1
  runId: string
  sessionId: string
  title: string
  objective: string
  source: string
  mode: string
  status: SessionRunStatus
  owner: { type: ExecutionOwnerType; id: string } | null
  generatedAt: number
  timing: {
    queuedAt: number
    startedAt: number | null
    endedAt: number | null
    durationMs: number | null
  }
  outcome: {
    result: string | null
    error: string | null
    warnings: string[]
  }
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    estimatedCost: number | null
    citationCount: number
    sourceIds: string[]
  }
  timeline: RunBriefTimelineItem[]
  evidence: RunBriefEvidenceItem[]
  artifacts: EvidenceArtifact[]
  resume: {
    sessionId: string
    commands: string[]
    links: Array<{ label: string; href: string }>
  }
  readiness: {
    status: RunHandoffReadinessStatus
    recommendedActions: string[]
  }
}
