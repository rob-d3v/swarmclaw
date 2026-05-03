import type { ShareEntityType, ShareLink } from './share-link-repository'
import { loadStoredItem } from '@/lib/server/storage'
import { listMissionReports } from '@/lib/server/missions/mission-repository'

export interface SharedMissionPayload {
  kind: 'mission'
  id: string
  title: string
  goal: string
  successCriteria: string[]
  status: string
  createdAt: number
  updatedAt: number | null
  usage: {
    usdSpent: number
    tokensUsed: number
    toolCallsUsed: number
    turnsRun: number
    wallclockMsElapsed: number
    startedAt: number | null
  }
  budget: {
    maxUsd: number | null
    maxTokens: number | null
    maxToolCalls: number | null
    maxWallclockSec: number | null
    maxTurns: number | null
  }
  milestones: Array<{ at: number; summary: string; kind: string; evidence: string[] }>
  reports: Array<{ id: string; at: number; title: string; format: string; content: string }>
  latestReport: { id: string; at: number; title: string; format: string; content: string } | null
}

export interface SharedSkillPayload {
  kind: 'skill'
  id: string
  name: string
  description: string
  tags: string[]
  content: string
  sourceFormat: string | null
  createdAt: number | null
}

export interface SharedSessionPayload {
  kind: 'session'
  id: string
  name: string
  agentName: string | null
  messages: Array<{ role: string; text: string; at: number | null }>
  createdAt: number
}

export type SharedPayload = SharedMissionPayload | SharedSkillPayload | SharedSessionPayload

const MAX_MESSAGES = 60
const MAX_MILESTONES = 40
const MAX_REPORTS = 10

export function resolveSharedEntity(link: ShareLink): SharedPayload | null {
  switch (link.entityType) {
    case 'mission':
      return resolveMission(link.entityId)
    case 'skill':
      return resolveSkill(link.entityId)
    case 'session':
      return resolveSession(link.entityId)
    default:
      return null
  }
}

function resolveMission(id: string): SharedMissionPayload | null {
  const raw = loadStoredItem('agent_missions', id) as Record<string, unknown> | null
  if (!raw) return null
  const usageRaw = (raw.usage || {}) as Record<string, unknown>
  const budgetRaw = (raw.budget || {}) as Record<string, unknown>
  const milestonesRaw = Array.isArray(raw.milestones) ? raw.milestones : []
  const milestones = milestonesRaw
    .slice(-MAX_MILESTONES)
    .map((m) => {
      const entry = (m || {}) as Record<string, unknown>
      return {
        at: typeof entry.at === 'number' ? entry.at : 0,
        summary: typeof entry.summary === 'string'
          ? entry.summary
          : typeof entry.note === 'string'
            ? entry.note
            : '',
        kind: typeof entry.kind === 'string' ? entry.kind : 'note',
        evidence: Array.isArray(entry.evidence)
          ? entry.evidence.filter((x): x is string => typeof x === 'string')
          : [],
      }
    })

  let reports: SharedMissionPayload['reports'] = []
  try {
    const rows = listMissionReports(id, MAX_REPORTS)
    reports = rows.map((r) => ({
      id: r.id,
      at: r.generatedAt,
      title: r.title,
      format: String(r.format),
      content: r.body,
    }))
  } catch {
    reports = []
  }

  return {
    kind: 'mission',
    id,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled Mission',
    goal: typeof raw.goal === 'string' ? raw.goal : '',
    successCriteria: Array.isArray(raw.successCriteria)
      ? (raw.successCriteria as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : null,
    usage: {
      usdSpent: typeof usageRaw.usdSpent === 'number' ? usageRaw.usdSpent : 0,
      tokensUsed: typeof usageRaw.tokensUsed === 'number' ? usageRaw.tokensUsed : 0,
      toolCallsUsed: typeof usageRaw.toolCallsUsed === 'number' ? usageRaw.toolCallsUsed : 0,
      turnsRun: typeof usageRaw.turnsRun === 'number' ? usageRaw.turnsRun : 0,
      wallclockMsElapsed: typeof usageRaw.wallclockMsElapsed === 'number' ? usageRaw.wallclockMsElapsed : 0,
      startedAt: typeof usageRaw.startedAt === 'number' ? usageRaw.startedAt : null,
    },
    budget: {
      maxUsd: typeof budgetRaw.maxUsd === 'number' ? budgetRaw.maxUsd : null,
      maxTokens: typeof budgetRaw.maxTokens === 'number' ? budgetRaw.maxTokens : null,
      maxToolCalls: typeof budgetRaw.maxToolCalls === 'number' ? budgetRaw.maxToolCalls : null,
      maxWallclockSec: typeof budgetRaw.maxWallclockSec === 'number' ? budgetRaw.maxWallclockSec : null,
      maxTurns: typeof budgetRaw.maxTurns === 'number' ? budgetRaw.maxTurns : null,
    },
    milestones,
    reports,
    latestReport: reports[0] ?? null,
  }
}

function resolveSkill(id: string): SharedSkillPayload | null {
  const raw = loadStoredItem('skills', id) as Record<string, unknown> | null
  if (!raw) return null
  return {
    kind: 'skill',
    id,
    name: typeof raw.name === 'string' ? raw.name : 'Unnamed Skill',
    description: typeof raw.description === 'string' ? raw.description : '',
    tags: Array.isArray(raw.tags)
      ? (raw.tags as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    content: typeof raw.content === 'string' ? raw.content : '',
    sourceFormat: typeof raw.sourceFormat === 'string' ? raw.sourceFormat : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : null,
  }
}

function resolveSession(id: string): SharedSessionPayload | null {
  const raw = loadStoredItem('sessions', id) as Record<string, unknown> | null
  if (!raw) return null
  const messagesRaw = Array.isArray(raw.messages) ? raw.messages : []
  const messages = messagesRaw.slice(-MAX_MESSAGES).map((m) => {
    const entry = (m || {}) as Record<string, unknown>
    return {
      role: typeof entry.role === 'string' ? entry.role : 'unknown',
      text: typeof entry.content === 'string' ? entry.content : '',
      at: typeof entry.at === 'number' ? entry.at : null,
    }
  })

  let agentName: string | null = null
  const agentId = typeof raw.agentId === 'string' ? raw.agentId : null
  if (agentId) {
    const agent = loadStoredItem('agents', agentId) as Record<string, unknown> | null
    if (agent && typeof agent.name === 'string') agentName = agent.name
  }

  return {
    kind: 'session',
    id,
    name: typeof raw.name === 'string' ? raw.name : 'Untitled Session',
    agentName,
    messages,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
  }
}

/**
 * Shape enforced on every outbound shared payload: fields that should never
 * leak off-instance. Reasons kept on the function to keep the allowlist obvious.
 */
export const SHARE_ALLOWED_ENTITY_TYPES: readonly ShareEntityType[] = [
  'mission',
  'skill',
  'session',
] as const
