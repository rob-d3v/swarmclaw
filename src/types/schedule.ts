import type { ExtensionManagedResourceMarker } from './extension'

export type ScheduleType = 'cron' | 'interval' | 'once'
export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'failed' | 'archived'
export type ScheduleTaskMode = 'task' | 'wake_only' | 'protocol'
export type ScheduleHistoryAction = 'created' | 'updated' | 'archived' | 'restored' | 'run_started' | 'skipped' | 'failed'

export interface ScheduleHistoryChange {
  field: string
  label: string
  before: string | null
  after: string | null
}

export interface ScheduleHistoryEntry {
  id: string
  at: number
  actor: string
  actorId?: string | null
  action: ScheduleHistoryAction
  revision: number
  summary: string
  changes?: ScheduleHistoryChange[]
  metadata?: Record<string, string | number | boolean | null>
}

export interface Schedule {
  id: string
  name: string
  agentId: string
  projectId?: string
  taskPrompt: string
  /** 'task' creates a board task, 'wake_only' just wakes the agent, and 'protocol' launches a structured session run. */
  taskMode?: ScheduleTaskMode
  /** Wake message sent to agent when taskMode is 'wake_only' */
  message?: string
  /** Structured session template launched when taskMode is 'protocol'. */
  protocolTemplateId?: string | null
  protocolParticipantAgentIds?: string[]
  protocolFacilitatorAgentId?: string | null
  protocolObserverAgentIds?: string[]
  protocolConfig?: Record<string, unknown> | null
  scheduleType: ScheduleType
  action?: string
  path?: string
  command?: string
  description?: string
  frequency?: string
  cron?: string
  /** Natural time expression e.g. "at 09:00" — resolved to cron on creation */
  atTime?: string | null
  intervalMs?: number
  runAt?: number
  lastRunAt?: number
  nextRunAt?: number
  /** IANA timezone for schedule evaluation (default: system local) */
  timezone?: string | null
  /** Random stagger window in seconds added to nextRunAt to avoid thundering herd */
  staggerSec?: number | null
  /** Last delivery status for this schedule */
  lastDeliveryStatus?: 'ok' | 'error' | null
  /** Timestamp of last delivery attempt */
  lastDeliveredAt?: number | null
  /** Error message from last failed delivery */
  lastDeliveryError?: string | null
  status: ScheduleStatus
  archivedAt?: number | null
  archivedFromStatus?: Exclude<ScheduleStatus, 'archived'> | null
  linkedTaskId?: string | null
  linkedMissionId?: string | null
  runNumber?: number
  createdByAgentId?: string | null
  createdInSessionId?: string | null
  followupConnectorId?: string | null
  followupChannelId?: string | null
  followupThreadId?: string | null
  followupSenderId?: string | null
  followupSenderName?: string | null
  managedByExtension?: ExtensionManagedResourceMarker | null
  revision?: number
  history?: ScheduleHistoryEntry[]
  createdAt: number
  updatedAt?: number
}

export interface SchedulePreviewRun {
  at: number
  iso: string
  label: string
}

export type SchedulePreviewResponse =
  | {
      ok: true
      scheduleType: ScheduleType
      cadence: string
      timezone: string | null
      nextRunAt: number | null
      nextRuns: SchedulePreviewRun[]
      warnings: string[]
      normalized: Partial<Schedule> & Record<string, unknown>
    }
  | {
      ok: false
      error: string
      warnings?: string[]
    }
