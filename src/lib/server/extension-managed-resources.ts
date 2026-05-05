import fs from 'fs/promises'
import { constants as fsConstants } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getExtensionManager } from '@/lib/server/extensions'
import { loadAgents, saveAgentMany } from '@/lib/server/agents/agent-repository'
import { loadSchedules, upsertSchedules } from '@/lib/server/schedules/schedule-repository'
import { loadSettings, saveSettings } from '@/lib/server/settings/settings-repository'
import { logActivity } from '@/lib/server/activity/activity-log'
import { notify } from '@/lib/server/ws-hub'
import { WORKSPACE_DIR } from '@/lib/server/data-dir'
import type {
  Agent,
  AppSettings,
  ExtensionManagedAgentDeclaration,
  ExtensionManagedLocalFolderDeclaration,
  ExtensionManagedResourceKind,
  ExtensionManagedResourceMarker,
  ExtensionManagedResourceRef,
  ExtensionManagedResources,
  ExtensionManagedScheduleDeclaration,
  Schedule,
  ScheduleStatus,
  ScheduleType,
} from '@/types'

type ManagedExtensionEntry = ReturnType<ReturnType<typeof getExtensionManager>['getManagedResourceExtensions']>[number]

export interface ManagedResourceSummaryItem {
  extensionId: string
  extensionName: string
  enabled: boolean
  isBuiltin: boolean
  source?: string
  agents: Array<ManagedResourceDeclarationSummary<'agent'>>
  schedules: Array<ManagedResourceDeclarationSummary<'schedule'>>
  localFolders: Array<ManagedResourceDeclarationSummary<'local_folder'>>
  gatewayPlatforms: Array<{
    platformKey: string
    displayName: string
    description?: string | null
    transport?: string
    endpoint?: string | null
    authMode?: string
    setupCheckKey?: string | null
    capabilities?: string[]
  }>
  setupChecks: Array<{
    checkKey: string
    displayName: string
    description?: string | null
    kind: string
    target?: string | null
    required: boolean
  }>
}

export interface ManagedResourceDeclarationSummary<K extends ExtensionManagedResourceKind> {
  resourceKind: K
  resourceKey: string
  displayName: string
  status: 'declared' | 'resolved' | 'missing' | 'missing_ref' | 'unsupported_trigger'
  resourceId: string | null
  declarationHash: string
  configured?: boolean
  healthy?: boolean
  problems?: string[]
}

export interface ManagedResourceSummary {
  extensions: ManagedResourceSummaryItem[]
  totals: {
    extensions: number
    agents: number
    schedules: number
    localFolders: number
    gatewayPlatforms: number
    setupChecks: number
    resolvedAgents: number
    resolvedSchedules: number
    healthyLocalFolders: number
  }
}

export interface ManagedResourceReconcileResult {
  extensionId?: string
  createdAgents: string[]
  updatedAgents: string[]
  createdSchedules: string[]
  updatedSchedules: string[]
  skipped: Array<{ resourceKind: 'agent' | 'schedule'; resourceKey: string; reason: string }>
}

export interface ExtensionLocalFolderProblem {
  code: 'not_configured' | 'not_absolute' | 'missing' | 'not_directory' | 'not_readable' | 'not_writable' | 'missing_directory' | 'missing_file' | 'symlink_escape'
  message: string
  path?: string
}

export interface ExtensionLocalFolderStatus {
  extensionId: string
  folderKey: string
  displayName: string
  configured: boolean
  path: string | null
  realPath: string | null
  access: 'read' | 'readWrite'
  readable: boolean
  writable: boolean
  requiredDirectories: string[]
  requiredFiles: string[]
  missingDirectories: string[]
  missingFiles: string[]
  healthy: boolean
  problems: ExtensionLocalFolderProblem[]
  checkedAt: number
}

export interface ExtensionLocalFolderEntry {
  path: string
  name: string
  kind: 'directory' | 'file'
  size: number | null
  modifiedAt: number
}

export interface ExtensionLocalFolderListing {
  extensionId: string
  folderKey: string
  relativePath: string | null
  entries: ExtensionLocalFolderEntry[]
  truncated: boolean
}

type StoredLocalFolderConfig = ExtensionManagedLocalFolderDeclaration & {
  path?: string | null
  updatedAt?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value)
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
  return `{${entries.join(',')}}`
}

function declarationHash(value: unknown): string {
  return crypto.createHash('sha1').update(stableJson(value)).digest('hex')
}

function managedResourceId(extensionId: string, kind: 'agent' | 'schedule', key: string): string {
  const hash = crypto.createHash('sha1').update(`${extensionId}:${kind}:${key}`).digest('hex').slice(0, 20)
  return `managed_${kind}_${hash}`
}

function managedMarker(
  extension: ManagedExtensionEntry,
  resourceKind: ExtensionManagedResourceKind,
  resourceKey: string,
  hash: string,
): ExtensionManagedResourceMarker {
  return {
    extensionId: extension.extensionId,
    extensionName: extension.extensionName,
    resourceKind,
    resourceKey,
    declarationHash: hash,
    reconciledAt: Date.now(),
  }
}

function getManagedAgentKey(declaration: ExtensionManagedAgentDeclaration): string {
  return text(declaration.agentKey)
}

function getManagedScheduleKey(declaration: ExtensionManagedScheduleDeclaration): string {
  return text(declaration.scheduleKey) || text(declaration.routineKey)
}

function getManagedScheduleTitle(declaration: ExtensionManagedScheduleDeclaration): string {
  return text(declaration.displayName) || text(declaration.title) || getManagedScheduleKey(declaration)
}

function getManagedAgentDisplayName(declaration: ExtensionManagedAgentDeclaration): string {
  return text(declaration.displayName) || getManagedAgentKey(declaration)
}

function normalizeCapabilities(value: ExtensionManagedAgentDeclaration['capabilities']): string[] {
  if (Array.isArray(value)) return list(value)
  const single = text(value)
  return single ? [single] : []
}

function findManagedAgent(
  agents: Record<string, Agent>,
  extensionId: string,
  agentKey: string,
): Agent | null {
  const stableId = managedResourceId(extensionId, 'agent', agentKey)
  if (agents[stableId]) return agents[stableId]
  return Object.values(agents).find((agent) =>
    agent?.managedByExtension?.extensionId === extensionId
    && agent.managedByExtension.resourceKind === 'agent'
    && agent.managedByExtension.resourceKey === agentKey
  ) || null
}

function findManagedSchedule(
  schedules: Record<string, Schedule>,
  extensionId: string,
  scheduleKey: string,
): Schedule | null {
  const stableId = managedResourceId(extensionId, 'schedule', scheduleKey)
  if (schedules[stableId]) return schedules[stableId]
  return Object.values(schedules).find((schedule) =>
    schedule?.managedByExtension?.extensionId === extensionId
    && schedule.managedByExtension.resourceKind === 'schedule'
    && schedule.managedByExtension.resourceKey === scheduleKey
  ) || null
}

function agentRefKey(ref: ExtensionManagedResourceRef | null | undefined): string {
  if (!ref || ref.resourceKind !== 'agent') return ''
  return text(ref.resourceKey)
}

function resolveManagedScheduleAgentId(
  declaration: ExtensionManagedScheduleDeclaration,
  extension: ManagedExtensionEntry,
  agents: Record<string, Agent>,
): string | null {
  const explicit = text(declaration.agentId)
  if (explicit) return agents[explicit] ? explicit : null
  const refKey = agentRefKey(declaration.agentRef) || agentRefKey(declaration.assigneeRef)
  if (!refKey) return null
  return findManagedAgent(agents, extension.extensionId, refKey)?.id || null
}

function scheduleTiming(declaration: ExtensionManagedScheduleDeclaration): {
  ok: true
  scheduleType: ScheduleType
  cron?: string
  intervalMs?: number
  runAt?: number
  timezone?: string | null
  triggerEnabled?: boolean
} | { ok: false; reason: string } {
  const scheduleTrigger = Array.isArray(declaration.triggers)
    ? declaration.triggers.find((trigger) => trigger.kind === 'schedule' || text(trigger.cronExpression))
    : null
  const cron = text(declaration.cron) || text(scheduleTrigger?.cronExpression)
  if (cron) {
    return {
      ok: true,
      scheduleType: 'cron',
      cron,
      timezone: text(declaration.timezone) || text(scheduleTrigger?.timezone) || null,
      triggerEnabled: scheduleTrigger?.enabled,
    }
  }
  if (typeof declaration.intervalMs === 'number' && Number.isFinite(declaration.intervalMs) && declaration.intervalMs > 0) {
    return {
      ok: true,
      scheduleType: 'interval',
      intervalMs: Math.trunc(declaration.intervalMs),
      timezone: text(declaration.timezone) || null,
      triggerEnabled: scheduleTrigger?.enabled,
    }
  }
  if (typeof declaration.runAt === 'number' && Number.isFinite(declaration.runAt) && declaration.runAt > 0) {
    return {
      ok: true,
      scheduleType: 'once',
      runAt: Math.trunc(declaration.runAt),
      timezone: text(declaration.timezone) || null,
      triggerEnabled: scheduleTrigger?.enabled,
    }
  }
  return { ok: false, reason: 'missing_schedule_timing' }
}

function normalizeScheduleStatus(value: unknown, triggerEnabled?: boolean): ScheduleStatus {
  if (value === 'active' || value === 'paused' || value === 'completed' || value === 'failed' || value === 'archived') {
    return value
  }
  if (triggerEnabled === false) return 'paused'
  return 'paused'
}

function buildManagedAgent(
  existing: Agent | null,
  extension: ManagedExtensionEntry,
  declaration: ExtensionManagedAgentDeclaration,
): Agent | null {
  const agentKey = getManagedAgentKey(declaration)
  const displayName = getManagedAgentDisplayName(declaration)
  if (!agentKey || !displayName) return null
  const hash = declarationHash(declaration)
  const now = Date.now()
  const id = existing?.id || managedResourceId(extension.extensionId, 'agent', agentKey)
  const extensionIds = Array.from(new Set([...list(declaration.extensions), extension.extensionId]))
  const prompt = text(declaration.systemPrompt) || text(declaration.instructions?.content)
  return {
    ...(existing || {}),
    id,
    name: displayName,
    description: text(declaration.description) || existing?.description || `Managed by ${extension.extensionName}.`,
    systemPrompt: prompt || existing?.systemPrompt || `You are ${displayName}. Follow the extension-managed instructions for ${extension.extensionName}.`,
    provider: (text(declaration.provider) || existing?.provider || 'openai') as Agent['provider'],
    model: text(declaration.model) || existing?.model || 'gpt-4o-mini',
    apiEndpoint: declaration.apiEndpoint !== undefined ? declaration.apiEndpoint || null : existing?.apiEndpoint ?? null,
    credentialId: declaration.credentialId !== undefined ? declaration.credentialId || null : existing?.credentialId ?? null,
    fallbackCredentialIds: list(declaration.fallbackCredentialIds).length ? list(declaration.fallbackCredentialIds) : existing?.fallbackCredentialIds || [],
    gatewayProfileId: declaration.gatewayProfileId !== undefined ? declaration.gatewayProfileId || null : existing?.gatewayProfileId ?? null,
    preferredGatewayTags: list(declaration.preferredGatewayTags).length ? list(declaration.preferredGatewayTags) : existing?.preferredGatewayTags || [],
    preferredGatewayUseCase: declaration.preferredGatewayUseCase !== undefined ? declaration.preferredGatewayUseCase || null : existing?.preferredGatewayUseCase ?? null,
    capabilities: normalizeCapabilities(declaration.capabilities).length
      ? normalizeCapabilities(declaration.capabilities)
      : existing?.capabilities || [],
    tools: list(declaration.tools).length ? list(declaration.tools) : existing?.tools,
    extensions: extensionIds.length ? extensionIds : existing?.extensions || [],
    skills: list(declaration.skills).length ? list(declaration.skills) : existing?.skills,
    skillIds: list(declaration.skillIds).length ? list(declaration.skillIds) : existing?.skillIds || [],
    mcpServerIds: list(declaration.mcpServerIds).length ? list(declaration.mcpServerIds) : existing?.mcpServerIds || [],
    monthlyBudget: typeof declaration.monthlyBudget === 'number' ? declaration.monthlyBudget : existing?.monthlyBudget ?? null,
    dailyBudget: typeof declaration.dailyBudget === 'number' ? declaration.dailyBudget : existing?.dailyBudget ?? null,
    hourlyBudget: typeof declaration.hourlyBudget === 'number' ? declaration.hourlyBudget : existing?.hourlyBudget ?? null,
    disabled: declaration.disabled !== undefined ? declaration.disabled === true : existing?.disabled === true,
    heartbeatEnabled: declaration.heartbeatEnabled !== undefined ? declaration.heartbeatEnabled !== false : existing?.heartbeatEnabled ?? true,
    planningMode: declaration.planningMode !== undefined ? declaration.planningMode : existing?.planningMode ?? null,
    managedByExtension: managedMarker(extension, 'agent', agentKey, hash),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  } as Agent
}

function buildManagedSchedule(
  existing: Schedule | null,
  extension: ManagedExtensionEntry,
  declaration: ExtensionManagedScheduleDeclaration,
  agents: Record<string, Agent>,
): Schedule | { skipped: string } {
  const scheduleKey = getManagedScheduleKey(declaration)
  const title = getManagedScheduleTitle(declaration)
  if (!scheduleKey || !title) return { skipped: 'invalid_schedule_declaration' }
  const agentId = resolveManagedScheduleAgentId(declaration, extension, agents)
  if (!agentId) return { skipped: 'missing_agent_ref' }
  const timing = scheduleTiming(declaration)
  if (!timing.ok) return { skipped: timing.reason }

  const hash = declarationHash(declaration)
  const now = Date.now()
  const id = existing?.id || managedResourceId(extension.extensionId, 'schedule', scheduleKey)
  const taskPrompt = text(declaration.taskPrompt) || text(declaration.description) || title
  return {
    ...(existing || {}),
    id,
    name: title,
    agentId,
    taskPrompt,
    taskMode: declaration.taskMode || existing?.taskMode || (text(declaration.message) ? 'wake_only' : 'task'),
    message: text(declaration.message) || existing?.message,
    description: text(declaration.description) || existing?.description,
    scheduleType: timing.scheduleType,
    cron: timing.scheduleType === 'cron' ? timing.cron : undefined,
    intervalMs: timing.scheduleType === 'interval' ? timing.intervalMs : undefined,
    runAt: timing.scheduleType === 'once' ? timing.runAt : undefined,
    timezone: timing.timezone ?? existing?.timezone ?? null,
    status: existing?.status === 'archived'
      ? 'archived'
      : normalizeScheduleStatus(declaration.status, timing.triggerEnabled),
    managedByExtension: managedMarker(extension, 'schedule', scheduleKey, hash),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  } as Schedule
}

function configuredLocalFolders(extensionId: string): Record<string, StoredLocalFolderConfig> {
  const settings = loadSettings()
  const resources = settings.extensionManagedResources?.[extensionId]
  return resources?.localFolders || {}
}

function declarationForLocalFolder(extensionId: string, folderKey: string): ExtensionManagedLocalFolderDeclaration | null {
  const resources = getExtensionManager().getManagedResources(extensionId)
  return resources?.localFolders?.find((folder) => text(folder.folderKey) === folderKey) || null
}

function mergeLocalFolderConfig(
  declaration: ExtensionManagedLocalFolderDeclaration,
  stored?: StoredLocalFolderConfig | null,
  override?: Partial<StoredLocalFolderConfig> | null,
): StoredLocalFolderConfig {
  return {
    ...declaration,
    ...(stored || {}),
    ...(override || {}),
    access: declaration.access || override?.access || stored?.access || 'readWrite',
    requiredDirectories: declaration.requiredDirectories || override?.requiredDirectories || stored?.requiredDirectories || [],
    requiredFiles: declaration.requiredFiles || override?.requiredFiles || stored?.requiredFiles || [],
  }
}

function problem(code: ExtensionLocalFolderProblem['code'], message: string, problemPath?: string): ExtensionLocalFolderProblem {
  return { code, message, path: problemPath }
}

function assertLocalFolderKey(folderKey: string): void {
  const trimmed = text(folderKey)
  if (!trimmed || trimmed.length > 128) throw new Error('folderKey is required')
  const first = trimmed.charCodeAt(0)
  const startsOk = (first >= 97 && first <= 122) || (first >= 48 && first <= 57)
  if (!startsOk) throw new Error('folderKey must start with a lowercase letter or digit')
  for (const char of trimmed) {
    const code = char.charCodeAt(0)
    const ok = (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || char === '.'
      || char === '_'
      || char === '-'
      || char === ':'
    if (!ok) throw new Error('folderKey contains unsupported characters')
  }
}

function normalizeRelativePath(relativePath: string): string {
  const raw = text(relativePath)
  if (!raw || path.isAbsolute(raw) || raw.includes('\\')) {
    throw new Error('Local folder relative paths must stay inside the configured root')
  }
  const segments = raw.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Local folder relative paths must stay inside the configured root')
  }
  return raw
}

function normalizeOptionalRelativePath(relativePath: unknown): string | null {
  const raw = text(relativePath)
  return raw ? normalizeRelativePath(raw) : null
}

function isInsideRoot(rootRealPath: string, candidateRealPath: string): boolean {
  const relative = path.relative(rootRealPath, candidateRealPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function resolveInsideRoot(rootRealPath: string, relativePath: string): Promise<string> {
  const normalized = normalizeRelativePath(relativePath)
  const absolutePath = path.resolve(rootRealPath, normalized)
  const relativeFromRoot = path.relative(rootRealPath, absolutePath)
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error('Local folder path traversal is not allowed')
  }
  const realPath = await fs.realpath(absolutePath)
  if (!isInsideRoot(rootRealPath, realPath)) {
    throw new Error('Local folder symlink escape is not allowed')
  }
  return realPath
}

function normalizeMaxEntries(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 1000
  return Math.max(1, Math.min(5000, Math.trunc(parsed)))
}

async function checkRequiredPath(rootRealPath: string, relativePath: string, kind: 'directory' | 'file'): Promise<'ok' | 'missing' | 'escape' | 'wrong_kind'> {
  try {
    const realPath = await resolveInsideRoot(rootRealPath, relativePath)
    const stat = await fs.stat(realPath)
    if (kind === 'directory') return stat.isDirectory() ? 'ok' : 'wrong_kind'
    return stat.isFile() ? 'ok' : 'wrong_kind'
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('escape') || message.includes('traversal')) return 'escape'
    return 'missing'
  }
}

export function listExtensionManagedResources(): ManagedResourceSummary {
  const agents = loadAgents()
  const schedules = loadSchedules()
  const extensions = getExtensionManager().getManagedResourceExtensions()
  const items: ManagedResourceSummaryItem[] = []

  for (const extension of extensions) {
    const resources: ExtensionManagedResources = extension.managedResources
    const storedFolders = configuredLocalFolders(extension.extensionId)
    const agentSummaries = (resources.agents || []).flatMap((declaration) => {
      const resourceKey = getManagedAgentKey(declaration)
      if (!resourceKey) return []
      const resolved = findManagedAgent(agents, extension.extensionId, resourceKey)
      return [{
        resourceKind: 'agent' as const,
        resourceKey,
        displayName: getManagedAgentDisplayName(declaration),
        status: resolved ? 'resolved' as const : 'missing' as const,
        resourceId: resolved?.id || null,
        declarationHash: declarationHash(declaration),
      }]
    })
    const scheduleDeclarations = [...(resources.schedules || []), ...(resources.routines || [])]
    const scheduleSummaries = scheduleDeclarations.flatMap((declaration) => {
      const resourceKey = getManagedScheduleKey(declaration)
      if (!resourceKey) return []
      const resolved = findManagedSchedule(schedules, extension.extensionId, resourceKey)
      const agentId = resolveManagedScheduleAgentId(declaration, extension, agents)
      const timing = scheduleTiming(declaration)
      return [{
        resourceKind: 'schedule' as const,
        resourceKey,
        displayName: getManagedScheduleTitle(declaration),
        status: resolved
          ? 'resolved' as const
          : !agentId
            ? 'missing_ref' as const
            : !timing.ok
              ? 'unsupported_trigger' as const
              : 'missing' as const,
        resourceId: resolved?.id || null,
        declarationHash: declarationHash(declaration),
      }]
    })
    const folderSummaries = (resources.localFolders || []).flatMap((declaration) => {
      const resourceKey = text(declaration.folderKey)
      if (!resourceKey) return []
      const stored = storedFolders[resourceKey]
      const configured = !!stored?.path
      return [{
        resourceKind: 'local_folder' as const,
        resourceKey,
        displayName: text(declaration.displayName) || resourceKey,
        status: configured ? 'declared' as const : 'missing' as const,
        resourceId: null,
        declarationHash: declarationHash(declaration),
        configured,
        healthy: false,
        problems: configured ? [] : ['not_configured'],
      }]
    })

    items.push({
      extensionId: extension.extensionId,
      extensionName: extension.extensionName,
      enabled: extension.enabled,
      isBuiltin: extension.isBuiltin,
      source: extension.source,
      agents: agentSummaries,
      schedules: scheduleSummaries,
      localFolders: folderSummaries,
      gatewayPlatforms: resources.gatewayPlatforms || [],
      setupChecks: (resources.setupChecks || []).map((check) => ({
        ...check,
        required: check.required !== false,
      })),
    })
  }

  return {
    extensions: items,
    totals: {
      extensions: items.length,
      agents: items.reduce((sum, item) => sum + item.agents.length, 0),
      schedules: items.reduce((sum, item) => sum + item.schedules.length, 0),
      localFolders: items.reduce((sum, item) => sum + item.localFolders.length, 0),
      gatewayPlatforms: items.reduce((sum, item) => sum + item.gatewayPlatforms.length, 0),
      setupChecks: items.reduce((sum, item) => sum + item.setupChecks.length, 0),
      resolvedAgents: items.reduce((sum, item) => sum + item.agents.filter((agent) => agent.status === 'resolved').length, 0),
      resolvedSchedules: items.reduce((sum, item) => sum + item.schedules.filter((schedule) => schedule.status === 'resolved').length, 0),
      healthyLocalFolders: items.reduce((sum, item) => sum + item.localFolders.filter((folder) => folder.healthy).length, 0),
    },
  }
}

export function reconcileExtensionManagedResources(extensionId?: string | null): ManagedResourceReconcileResult {
  const manager = getExtensionManager()
  const candidates = manager.getManagedResourceExtensions()
    .filter((entry) => !extensionId || entry.extensionId === extensionId)
  if (extensionId && candidates.length === 0) {
    throw new Error(`Extension has no managed resources: ${extensionId}`)
  }

  const result: ManagedResourceReconcileResult = {
    extensionId: extensionId || undefined,
    createdAgents: [],
    updatedAgents: [],
    createdSchedules: [],
    updatedSchedules: [],
    skipped: [],
  }
  const agents = loadAgents()
  const schedules = loadSchedules()
  const agentEntries: Array<[string, Agent]> = []
  const scheduleEntries: Array<[string, Schedule]> = []

  for (const extension of candidates) {
    for (const declaration of extension.managedResources.agents || []) {
      const resourceKey = getManagedAgentKey(declaration)
      const existing = resourceKey ? findManagedAgent(agents, extension.extensionId, resourceKey) : null
      const next = buildManagedAgent(existing, extension, declaration)
      if (!next) {
        result.skipped.push({ resourceKind: 'agent', resourceKey: resourceKey || 'unknown', reason: 'invalid_agent_declaration' })
        continue
      }
      agents[next.id] = next
      agentEntries.push([next.id, next])
      ;(existing ? result.updatedAgents : result.createdAgents).push(next.id)
    }
  }

  if (agentEntries.length > 0) {
    saveAgentMany(agentEntries)
  }

  for (const extension of candidates) {
    const declarations = [...(extension.managedResources.schedules || []), ...(extension.managedResources.routines || [])]
    for (const declaration of declarations) {
      const resourceKey = getManagedScheduleKey(declaration)
      const existing = resourceKey ? findManagedSchedule(schedules, extension.extensionId, resourceKey) : null
      const next = buildManagedSchedule(existing, extension, declaration, agents)
      if ('skipped' in next) {
        result.skipped.push({ resourceKind: 'schedule', resourceKey: resourceKey || 'unknown', reason: next.skipped })
        continue
      }
      schedules[next.id] = next
      scheduleEntries.push([next.id, next])
      ;(existing ? result.updatedSchedules : result.createdSchedules).push(next.id)
    }
  }

  if (scheduleEntries.length > 0) {
    upsertSchedules(scheduleEntries)
  }
  if (agentEntries.length > 0 || scheduleEntries.length > 0) {
    logActivity({
      entityType: 'extension',
      entityId: extensionId || 'managed-resources',
      action: 'reconciled',
      actor: 'user',
      summary: `Extension managed resources reconciled (${agentEntries.length} agents, ${scheduleEntries.length} schedules)`,
      detail: result as unknown as Record<string, unknown>,
    })
    notify('agents')
    notify('schedules')
    notify('extensions')
  }

  return result
}

export function setExtensionLocalFolderConfig(input: {
  extensionId: string
  folderKey: string
  path: string
  access?: 'read' | 'readWrite'
}): StoredLocalFolderConfig {
  const extensionId = text(input.extensionId)
  const folderKey = text(input.folderKey)
  assertLocalFolderKey(folderKey)
  const declaration = declarationForLocalFolder(extensionId, folderKey)
  if (!declaration) throw new Error('Local folder key is not declared by this extension')
  const configuredPath = text(input.path)
  if (!configuredPath) throw new Error('path is required')
  const settings = loadSettings() as AppSettings
  const extensionResources = { ...(settings.extensionManagedResources || {}) }
  const current = extensionResources[extensionId]?.localFolders || {}
  const nextFolder = mergeLocalFolderConfig(declaration, current[folderKey], {
    path: configuredPath,
    access: input.access,
    updatedAt: Date.now(),
  })
  extensionResources[extensionId] = {
    ...(extensionResources[extensionId] || {}),
    localFolders: {
      ...current,
      [folderKey]: nextFolder,
    },
  }
  saveSettings({
    ...settings,
    extensionManagedResources: extensionResources,
  })
  notify('extensions')
  return nextFolder
}

export async function inspectExtensionLocalFolder(input: {
  extensionId: string
  folderKey: string
  overridePath?: string | null
}): Promise<ExtensionLocalFolderStatus> {
  const extensionId = text(input.extensionId)
  const folderKey = text(input.folderKey)
  assertLocalFolderKey(folderKey)
  const declaration = declarationForLocalFolder(extensionId, folderKey)
  if (!declaration) throw new Error('Local folder key is not declared by this extension')
  const stored = configuredLocalFolders(extensionId)[folderKey]
  const config = mergeLocalFolderConfig(declaration, stored, input.overridePath ? { path: input.overridePath } : null)
  const requiredDirectories = list(config.requiredDirectories).map(normalizeRelativePath)
  const requiredFiles = list(config.requiredFiles).map(normalizeRelativePath)
  const checkedAt = Date.now()
  const access = config.access || 'readWrite'
  const configuredPath = text(config.path)

  if (!configuredPath) {
    return {
      extensionId,
      folderKey,
      displayName: text(config.displayName) || folderKey,
      configured: false,
      path: null,
      realPath: null,
      access,
      readable: false,
      writable: false,
      requiredDirectories,
      requiredFiles,
      missingDirectories: requiredDirectories,
      missingFiles: requiredFiles,
      healthy: false,
      problems: [problem('not_configured', 'No local folder path is configured.')],
      checkedAt,
    }
  }

  const resolvedPath = path.resolve(configuredPath)
  const problems: ExtensionLocalFolderProblem[] = []
  const missingDirectories: string[] = []
  const missingFiles: string[] = []
  let realPath: string | null = null
  let readable = false
  let writable = false

  if (!path.isAbsolute(configuredPath)) {
    problems.push(problem('not_absolute', 'Local folder path must be absolute.', configuredPath))
  }

  try {
    const stat = await fs.stat(resolvedPath)
    if (!stat.isDirectory()) {
      problems.push(problem('not_directory', 'Configured local folder path is not a directory.', resolvedPath))
      missingDirectories.push(...requiredDirectories)
      missingFiles.push(...requiredFiles)
    } else {
      realPath = await fs.realpath(resolvedPath)
      try {
        await fs.access(realPath, fsConstants.R_OK)
        readable = true
      } catch {
        problems.push(problem('not_readable', 'Configured local folder is not readable.', resolvedPath))
      }
      if (access === 'readWrite') {
        try {
          await fs.access(realPath, fsConstants.W_OK)
          const probePath = path.join(realPath, `.swarmclaw-local-folder-probe-${process.pid}-${Date.now()}`)
          await fs.writeFile(probePath, '')
          await fs.rm(probePath, { force: true })
          writable = true
        } catch {
          problems.push(problem('not_writable', 'Configured local folder is not writable.', resolvedPath))
        }
      }
      for (const requiredDir of requiredDirectories) {
        const status = await checkRequiredPath(realPath, requiredDir, 'directory')
        if (status === 'missing' || status === 'wrong_kind') {
          missingDirectories.push(requiredDir)
          problems.push(problem('missing_directory', 'Required directory is missing.', requiredDir))
        } else if (status === 'escape') {
          problems.push(problem('symlink_escape', 'Required directory escapes the configured root.', requiredDir))
        }
      }
      for (const requiredFile of requiredFiles) {
        const status = await checkRequiredPath(realPath, requiredFile, 'file')
        if (status === 'missing' || status === 'wrong_kind') {
          missingFiles.push(requiredFile)
          problems.push(problem('missing_file', 'Required file is missing.', requiredFile))
        } else if (status === 'escape') {
          problems.push(problem('symlink_escape', 'Required file escapes the configured root.', requiredFile))
        }
      }
    }
  } catch (err: unknown) {
    const code = isRecord(err) && typeof err.code === 'string' ? err.code : ''
    problems.push(problem(code === 'ENOENT' ? 'missing' : 'not_readable', 'Configured local folder cannot be inspected.', resolvedPath))
    if (code === 'ENOENT') {
      missingDirectories.push(...requiredDirectories)
      missingFiles.push(...requiredFiles)
    }
  }

  return {
    extensionId,
    folderKey,
    displayName: text(config.displayName) || folderKey,
    configured: true,
    path: resolvedPath,
    realPath,
    access,
    readable,
    writable: access === 'read' ? false : writable,
    requiredDirectories,
    requiredFiles,
    missingDirectories,
    missingFiles,
    healthy: problems.length === 0 && readable && (access === 'read' || writable),
    problems,
    checkedAt,
  }
}

export async function listExtensionLocalFolderEntries(input: {
  extensionId: string
  folderKey: string
  relativePath?: string | null
  recursive?: boolean
  maxEntries?: number
}): Promise<ExtensionLocalFolderListing> {
  const status = await inspectExtensionLocalFolder({
    extensionId: input.extensionId,
    folderKey: input.folderKey,
  })
  if (!status.configured || !status.realPath || !status.readable) {
    throw new Error('Local folder is not configured or readable')
  }
  if (!status.healthy) {
    throw new Error('Local folder is not healthy')
  }

  const relativePath = normalizeOptionalRelativePath(input.relativePath)
  const targetPath = relativePath
    ? await resolveInsideRoot(status.realPath, relativePath)
    : status.realPath
  const targetStat = await fs.stat(targetPath)
  if (!targetStat.isDirectory()) throw new Error('Local folder list target must be a directory')

  const maxEntries = normalizeMaxEntries(input.maxEntries)
  const entries: ExtensionLocalFolderEntry[] = []
  let truncated = false

  async function visit(directoryRealPath: string, directoryRelativePath: string | null): Promise<void> {
    if (truncated) return
    const dirents = await fs.readdir(directoryRealPath, { withFileTypes: true })
    dirents.sort((left, right) => left.name.localeCompare(right.name))

    for (const dirent of dirents) {
      if (entries.length >= maxEntries) {
        truncated = true
        return
      }
      const childRelativePath = directoryRelativePath ? `${directoryRelativePath}/${dirent.name}` : dirent.name
      let childRealPath: string
      try {
        childRealPath = await resolveInsideRoot(status.realPath!, childRelativePath)
      } catch {
        continue
      }
      const stat = await fs.stat(childRealPath).catch(() => null)
      if (!stat) continue
      const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : null
      if (!kind) continue
      entries.push({
        path: childRelativePath,
        name: dirent.name,
        kind,
        size: kind === 'file' ? stat.size : null,
        modifiedAt: stat.mtimeMs,
      })
      if (input.recursive && kind === 'directory') {
        await visit(childRealPath, childRelativePath)
        if (truncated) return
      }
    }
  }

  await visit(targetPath, relativePath)
  return {
    extensionId: text(input.extensionId),
    folderKey: text(input.folderKey),
    relativePath,
    entries,
    truncated,
  }
}

export function defaultExtensionLocalFolderBasePath(extensionId: string): string {
  const safe = crypto.createHash('sha1').update(extensionId).digest('hex').slice(0, 12)
  return path.join(WORKSPACE_DIR, 'extension-folders', safe)
}
