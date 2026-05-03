'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/app/api-client'
import { MainContent } from '@/components/layout/main-content'
import { HintTip } from '@/components/shared/hint-tip'
import { inputClass } from '@/components/shared/form-styles'
import { MissionTemplateGallery } from '@/components/missions/mission-template-gallery'
import {
  MissionTemplateInstallDialog,
  type InstantiateInput,
} from '@/components/missions/mission-template-install-dialog'
import { MissionEditSheet, isMissionEditable } from '@/components/missions/mission-edit-sheet'
import type { Mission, MissionReport, MissionEvent, MissionTemplate, Session } from '@/types'
import { toast } from 'sonner'

const POLL_MS = 4_000
const RELEASE_QA_TEMPLATE_ID = 'release-candidate-qa'

interface ShareLink {
  id: string
  token: string
  entityType: 'mission' | 'skill' | 'session'
  entityId: string
  label: string | null
  createdAt: number
  expiresAt: number | null
  revokedAt: number | null
}

const STATUS_BADGE: Record<Mission['status'], { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-white/[0.05] text-text-3' },
  running: { label: 'Running', cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' },
  paused: { label: 'Paused', cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' },
  completed: { label: 'Completed', cls: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30' },
  failed: { label: 'Failed', cls: 'bg-rose-500/15 text-rose-300 border border-rose-500/30' },
  cancelled: { label: 'Cancelled', cls: 'bg-white/[0.06] text-text-3' },
  budget_exhausted: { label: 'Budget exhausted', cls: 'bg-orange-500/15 text-orange-300 border border-orange-500/30' },
}

function formatUsd(n: number): string {
  return `$${n.toFixed(n < 0.01 ? 4 : 2)}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  return `${Math.round((min / 60) * 10) / 10}h`
}

function formatTimestamp(at: number | null | undefined): string {
  if (!at) return ''
  try {
    const d = new Date(at)
    return d.toLocaleString()
  } catch {
    return String(at)
  }
}

interface BudgetBarProps {
  label: string
  used: number
  cap: number | null | undefined
  format: (n: number) => string
  hint?: string
}

function BudgetBar({ label, used, cap, format, hint }: BudgetBarProps) {
  const pct = cap && cap > 0 ? Math.min(100, (used / cap) * 100) : 0
  const barCls = pct >= 95 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-text-3">
        <span className="inline-flex items-center gap-1">
          {label}
          {hint && <HintTip text={hint} />}
        </span>
        <span>
          {format(used)}
          {cap != null ? ` / ${format(cap)}` : ' (no cap)'}
        </span>
      </div>
      <div className="relative h-1.5 w-full rounded-full bg-white/[0.04] overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${barCls} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

interface MissionCardProps {
  mission: Mission
  isSelected: boolean
  onSelect: () => void
}

function MissionCard({ mission, isSelected, onSelect }: MissionCardProps) {
  const badge = STATUS_BADGE[mission.status]
  const lastMilestone = mission.milestones.at(-1)
  return (
    <button
      onClick={onSelect}
      className={`text-left w-full rounded-[10px] border transition-all px-4 py-3
        ${isSelected ? 'border-white/[0.16] bg-raised' : 'border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-600 text-text truncate">{mission.title}</div>
          <div className="text-[11px] text-text-3 mt-0.5 line-clamp-2">{mission.goal}</div>
        </div>
        <span className={`text-[10px] font-600 uppercase tracking-wide px-1.5 py-0.5 rounded ${badge.cls} shrink-0`}>
          {badge.label}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-text-3/70">
        <span>{mission.usage.turnsRun} turns</span>
        {mission.usage.usdSpent > 0 && <span>{formatUsd(mission.usage.usdSpent)}</span>}
        {lastMilestone && (
          <span className="truncate">
            Last: {lastMilestone.summary.slice(0, 60)}
          </span>
        )}
      </div>
    </button>
  )
}

interface ControlsProps {
  mission: Mission
  onAction: (action: string, reason?: string) => Promise<void>
  onForceReport: () => Promise<void>
  onEdit: () => void
  busy: boolean
}

function MissionControls({ mission, onAction, onForceReport, onEdit, busy }: ControlsProps) {
  const btn = 'text-[11px] font-600 px-2.5 py-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const editable = isMissionEditable(mission.status)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mission.status === 'draft' || mission.status === 'paused' ? (
        <button
          disabled={busy}
          onClick={() => onAction('start')}
          className={`${btn} border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15`}
        >
          {mission.status === 'paused' ? 'Resume' : 'Start'}
        </button>
      ) : null}
      {mission.status === 'running' ? (
        <button
          disabled={busy}
          onClick={() => onAction('pause')}
          className={`${btn} border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15`}
        >
          Pause
        </button>
      ) : null}
      {mission.status === 'running' || mission.status === 'paused' ? (
        <button
          disabled={busy}
          onClick={() => onAction('complete', 'User marked complete')}
          className={`${btn} border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15`}
        >
          Mark complete
        </button>
      ) : null}
      {editable ? (
        <button
          disabled={busy}
          onClick={onEdit}
          className={`${btn} border-white/[0.12] bg-white/[0.04] text-text hover:bg-white/[0.08]`}
        >
          Edit
        </button>
      ) : null}
      {mission.status !== 'completed' && mission.status !== 'cancelled' ? (
        <button
          disabled={busy}
          onClick={() => {
            const reason = window.prompt('Cancel reason (optional)') || undefined
            void onAction('cancel', reason)
          }}
          className={`${btn} border-rose-500/20 bg-rose-500/5 text-rose-300 hover:bg-rose-500/10`}
        >
          Cancel
        </button>
      ) : null}
      <button
        disabled={busy}
        onClick={onForceReport}
        className={`${btn} border-white/[0.08] bg-white/[0.03] text-text-3 hover:bg-white/[0.06]`}
      >
        Generate report now
      </button>
    </div>
  )
}

interface CreateDialogProps {
  open: boolean
  sessions: Session[]
  onClose: () => void
  onCreate: (input: {
    title: string
    goal: string
    successCriteria: string[]
    rootSessionId: string
    budget: {
      maxUsd?: number | null
      maxTokens?: number | null
      maxWallclockSec?: number | null
      maxTurns?: number | null
    }
    reportSchedule: { intervalSec: number; format: 'markdown'; enabled: boolean } | null
  }) => Promise<void>
}

function CreateMissionDialog({ open, sessions, onClose, onCreate }: CreateDialogProps) {
  const [title, setTitle] = useState('Autonomous mission')
  const [goal, setGoal] = useState('')
  const [criteriaText, setCriteriaText] = useState('')
  const [rootSessionId, setRootSessionId] = useState('')
  const [maxUsd, setMaxUsd] = useState<string>('2')
  const [maxTokens, setMaxTokens] = useState<string>('50000')
  const [maxWallclockSec, setMaxWallclockSec] = useState<string>('28800')
  const [maxTurns, setMaxTurns] = useState<string>('200')
  const [reportsEnabled, setReportsEnabled] = useState(true)
  const [reportIntervalMin, setReportIntervalMin] = useState<string>('60')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!rootSessionId && sessions.length > 0) setRootSessionId(sessions[0].id)
  }, [sessions, rootSessionId])

  if (!open) return null

  const numOrNull = (s: string): number | null => {
    const n = Number.parseFloat(s)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const intOrNull = (s: string): number | null => {
    const n = numOrNull(s)
    return n == null ? null : Math.round(n)
  }

  const submit = async () => {
    if (!title.trim() || !goal.trim()) {
      toast.error('Title and goal are required')
      return
    }
    if (!rootSessionId) {
      toast.error('Pick a session to drive this mission')
      return
    }
    setBusy(true)
    try {
      const successCriteria = criteriaText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const intervalMin = numOrNull(reportIntervalMin) ?? 60
      await onCreate({
        title: title.trim(),
        goal: goal.trim(),
        successCriteria,
        rootSessionId,
        budget: {
          maxUsd: numOrNull(maxUsd),
          maxTokens: intOrNull(maxTokens),
          maxWallclockSec: intOrNull(maxWallclockSec),
          maxTurns: intOrNull(maxTurns),
        },
        reportSchedule: reportsEnabled
          ? { intervalSec: Math.round(intervalMin * 60), format: 'markdown', enabled: true }
          : null,
      })
      onClose()
    } catch (error) {
      toast.error(`Create failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-[12px] border border-white/[0.08] bg-bg shadow-[0_24px_64px_rgba(0,0,0,0.6)] p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[14px] font-600 text-text mb-1">New autonomous mission</div>
        <div className="text-[11px] text-text-3 mb-4">Hand your agent team a goal. They run through heartbeats until done or budget hits.</div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-3">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-3 inline-flex items-center gap-1">
              Goal <HintTip text="A natural-language objective. The team will work on this until budget or success criteria are hit." />
            </span>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              className={`${inputClass} resize-none`}
              placeholder="e.g., Research the top 3 open-source note-taking apps and draft a comparison doc"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-3 inline-flex items-center gap-1">
              Success criteria <HintTip text="One per line. Used in reports and final verification." />
            </span>
            <textarea
              value={criteriaText}
              onChange={(e) => setCriteriaText(e.target.value)}
              rows={3}
              className={`${inputClass} resize-none`}
              placeholder="File comparison.md exists\nEach app has pros/cons\nSource links are cited"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-3 inline-flex items-center gap-1">
              Root session <HintTip text="The session whose heartbeat drives this mission. Usually an agent thread." />
            </span>
            <select value={rootSessionId} onChange={(e) => setRootSessionId(e.target.value)} className={inputClass}>
              {sessions.length === 0 && <option value="">No sessions available</option>}
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.id}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-3 inline-flex items-center gap-1">
                Max USD <HintTip text="Hard spend cap. Leave blank for no limit." />
              </span>
              <input value={maxUsd} onChange={(e) => setMaxUsd(e.target.value)} className={inputClass} inputMode="decimal" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-3">Max tokens</span>
              <input value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} className={inputClass} inputMode="numeric" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-3 inline-flex items-center gap-1">
                Max wallclock (sec) <HintTip text="Scheduler aborts the mission after this many seconds of elapsed wallclock time." />
              </span>
              <input value={maxWallclockSec} onChange={(e) => setMaxWallclockSec(e.target.value)} className={inputClass} inputMode="numeric" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-3">Max turns</span>
              <input value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)} className={inputClass} inputMode="numeric" />
            </label>
          </div>

          <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
            <div className="text-[11px] font-600 text-text-3 uppercase tracking-wide mb-1.5">Periodic reports</div>
            <label className="flex items-center gap-2 flex-wrap">
              <input type="checkbox" checked={reportsEnabled} onChange={(e) => setReportsEnabled(e.target.checked)} />
              <span className="text-[11px] text-text-3">Send a markdown progress report every</span>
              <input
                disabled={!reportsEnabled}
                value={reportIntervalMin}
                onChange={(e) => setReportIntervalMin(e.target.value)}
                className={`${inputClass} w-16`}
                inputMode="numeric"
              />
              <span className="text-[11px] text-text-3">minutes</span>
            </label>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[12px] px-3 py-1.5 rounded border border-white/[0.08] hover:bg-white/[0.04]"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="text-[12px] font-600 px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40"
          >
            {busy ? 'Creating...' : 'Create mission'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface DetailProps {
  mission: Mission
  reports: MissionReport[]
  events: MissionEvent[]
  busy: boolean
  onAction: (action: string, reason?: string) => Promise<void>
  onForceReport: () => Promise<void>
  onEdit: () => void
}

function MissionDetail({ mission, reports, events, busy, onAction, onForceReport, onEdit }: DetailProps) {
  const [selectedReport, setSelectedReport] = useState<MissionReport | null>(null)
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([])
  const [shareBusy, setShareBusy] = useState<string | null>(null)
  const wallclockCapMs = mission.budget.maxWallclockSec != null ? mission.budget.maxWallclockSec * 1000 : null
  const activeShare = useMemo(
    () => shareLinks.find((link) => !link.revokedAt && (!link.expiresAt || link.expiresAt > Date.now())) ?? null,
    [shareLinks],
  )

  const loadShareLinks = useCallback(async () => {
    try {
      const links = await api<ShareLink[]>('GET', `/share?entityType=mission&entityId=${encodeURIComponent(mission.id)}`)
      setShareLinks(Array.isArray(links) ? links : [])
    } catch {
      setShareLinks([])
    }
  }, [mission.id])

  useEffect(() => {
    void loadShareLinks()
  }, [loadShareLinks])

  const shareUrl = activeShare && typeof window !== 'undefined'
    ? `${window.location.origin}/s/${activeShare.token}`
    : ''

  const createShareLink = useCallback(async () => {
    setShareBusy('create')
    try {
      const link = await api<ShareLink>('POST', '/share', {
        entityType: 'mission',
        entityId: mission.id,
        label: `${mission.title} public report`,
      })
      setShareLinks((prev) => [link, ...prev])
      toast.success('Mission share link created')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create share link')
    } finally {
      setShareBusy(null)
    }
  }, [mission.id, mission.title])

  const revokeShareLink = useCallback(async () => {
    if (!activeShare) return
    setShareBusy(activeShare.id)
    try {
      const revoked = await api<ShareLink>('DELETE', `/share/${activeShare.id}`)
      setShareLinks((prev) => prev.map((link) => (link.id === revoked.id ? revoked : link)))
      toast.success('Mission share link revoked')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to revoke share link')
    } finally {
      setShareBusy(null)
    }
  }, [activeShare])

  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success('Share URL copied')
    } catch {
      toast.error('Unable to copy share URL')
    }
  }, [shareUrl])

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[10px] font-600 uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_BADGE[mission.status].cls}`}>
            {STATUS_BADGE[mission.status].label}
          </span>
          <span className="text-[10px] text-text-3/60">Created {formatTimestamp(mission.createdAt)}</span>
          {mission.endedAt && <span className="text-[10px] text-text-3/60">Ended {formatTimestamp(mission.endedAt)}</span>}
        </div>
        <h2 className="text-[15px] font-600 text-text">{mission.title}</h2>
        <p className="text-[12px] text-text-3 mt-1">{mission.goal}</p>
        {mission.endReason && <p className="text-[11px] text-rose-300/80 mt-2">End reason: {mission.endReason}</p>}
      </div>

      <div className="rounded-[10px] border border-white/[0.06] p-4 flex flex-col gap-3">
        <div className="text-[11px] font-600 uppercase tracking-wide text-text-3">Budget</div>
        <BudgetBar label="USD" used={mission.usage.usdSpent} cap={mission.budget.maxUsd} format={formatUsd} />
        <BudgetBar label="Tokens" used={mission.usage.tokensUsed} cap={mission.budget.maxTokens} format={(n) => `${Math.round(n).toLocaleString()}`} />
        <BudgetBar label="Turns" used={mission.usage.turnsRun} cap={mission.budget.maxTurns} format={(n) => String(Math.round(n))} />
        <BudgetBar label="Wallclock" used={mission.usage.wallclockMsElapsed} cap={wallclockCapMs} format={formatDuration} hint="Hard time budget enforced by the scheduler." />
      </div>

      <div>
        <div className="text-[11px] font-600 uppercase tracking-wide text-text-3 mb-2">Controls</div>
        <MissionControls mission={mission} onAction={onAction} onForceReport={onForceReport} onEdit={onEdit} busy={busy} />
      </div>

      <div className="rounded-[12px] border border-white/[0.06] bg-white/[0.025] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] font-600 uppercase tracking-wide text-text-3">Public share</div>
            <p className="mt-1 max-w-[620px] text-[12px] leading-relaxed text-text-3/70">
              Publish a revocable mission artifact with status, budgets, milestones, and generated reports. Secrets, credentials, private files, and hidden runtime metadata stay out of the payload.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {activeShare ? (
              <>
                <button
                  type="button"
                  onClick={() => void copyShareUrl()}
                  className="rounded-[9px] border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-700 text-emerald-200 hover:bg-emerald-500/15"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  disabled={!!shareBusy}
                  onClick={() => void revokeShareLink()}
                  className="rounded-[9px] border border-rose-500/20 bg-rose-500/[0.06] px-2.5 py-1.5 text-[11px] font-700 text-rose-200 hover:bg-rose-500/[0.1] disabled:opacity-40"
                >
                  {shareBusy === activeShare.id ? 'Revoking...' : 'Revoke'}
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!!shareBusy}
                onClick={() => void createShareLink()}
                className="rounded-[9px] border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-700 text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-40"
              >
                {shareBusy === 'create' ? 'Creating...' : 'Create share link'}
              </button>
            )}
          </div>
        </div>
        {activeShare && (
          <div className="mt-3 rounded-[10px] border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] text-text-3">
            <span className="font-mono text-text">{shareUrl}</span>
            <span className="ml-2 text-text-3/55">Created {formatTimestamp(activeShare.createdAt)}</span>
          </div>
        )}
      </div>

      {mission.successCriteria.length > 0 && (
        <div>
          <div className="text-[11px] font-600 uppercase tracking-wide text-text-3 mb-2">Success criteria</div>
          <ul className="flex flex-col gap-1">
            {mission.successCriteria.map((c, i) => (
              <li key={i} className="text-[12px] text-text flex items-start gap-2">
                <span className="text-text-3/50 mt-[2px]">-</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-[11px] font-600 uppercase tracking-wide text-text-3 mb-2">Timeline</div>
        {mission.milestones.length === 0 ? (
          <div className="text-[11px] text-text-3/60">No milestones yet.</div>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto">
            {[...mission.milestones].reverse().map((ms) => (
              <div key={ms.id} className="text-[11px] flex items-start gap-2">
                <span className="text-text-3/50 font-mono">{new Date(ms.at).toLocaleTimeString()}</span>
                <span className="text-text-3 font-600">{ms.kind}</span>
                <span className="text-text">{ms.summary}</span>
              </div>
            ))}
          </div>
        )}
        {events.length > 0 && (
          <div className="text-[10px] text-text-3/50 mt-2">{events.length} total events in log</div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-600 uppercase tracking-wide text-text-3">Reports ({reports.length})</div>
        </div>
        {reports.length === 0 ? (
          <div className="text-[11px] text-text-3/60">No reports yet. Click &quot;Generate report now&quot; to produce one.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedReport(r)}
                className="text-left text-[11px] text-text-3 px-2 py-1.5 rounded border border-white/[0.04] hover:border-white/[0.12] hover:bg-white/[0.02]"
              >
                <span className="text-text">{r.title}</span>
                <span className="text-text-3/60 ml-2">{formatTimestamp(r.generatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedReport(null)}>
          <div
            className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-[12px] border border-white/[0.08] bg-bg shadow-[0_24px_64px_rgba(0,0,0,0.6)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13px] font-600 text-text">{selectedReport.title}</div>
              <button onClick={() => setSelectedReport(null)} className="text-text-3 text-[12px] hover:text-text">Close</button>
            </div>
            <pre className="text-[12px] text-text-3 whitespace-pre-wrap font-mono leading-relaxed">{selectedReport.body}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MissionsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [missions, setMissions] = useState<Mission[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reports, setReports] = useState<MissionReport[]>([])
  const [events, setEvents] = useState<MissionEvent[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [templates, setTemplates] = useState<MissionTemplate[]>([])
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [installTemplate, setInstallTemplate] = useState<MissionTemplate | null>(null)
  const [editMission, setEditMission] = useState<Mission | null>(null)

  const selected = useMemo(() => missions.find((m) => m.id === selectedId) ?? null, [missions, selectedId])

  const refreshList = useCallback(async () => {
    try {
      const list = await api<Mission[]>('GET', '/missions')
      setMissions(list)
      if (!selectedId && list.length > 0) setSelectedId(list[0].id)
    } catch {
      // swallow poll errors
    } finally {
      setLoaded(true)
    }
  }, [selectedId])

  const refreshDetail = useCallback(async (id: string) => {
    try {
      const [r, e] = await Promise.all([
        api<MissionReport[]>('GET', `/missions/${id}/reports`),
        api<MissionEvent[]>('GET', `/missions/${id}/events`),
      ])
      setReports(r)
      setEvents(e)
    } catch {
      // swallow
    }
  }, [])

  useEffect(() => {
    void refreshList()
    const timer = setInterval(() => void refreshList(), POLL_MS)
    return () => clearInterval(timer)
  }, [refreshList])

  useEffect(() => {
    if (!selectedId) return
    void refreshDetail(selectedId)
    const timer = setInterval(() => void refreshDetail(selectedId), POLL_MS)
    return () => clearInterval(timer)
  }, [selectedId, refreshDetail])

  useEffect(() => {
    api<Record<string, Session>>('GET', '/chats').then((s) => {
      setSessions(s ? Object.values(s) : [])
    }).catch(() => setSessions([]))
  }, [createOpen, galleryOpen, installTemplate])

  useEffect(() => {
    let cancelled = false
    api<MissionTemplate[]>('GET', '/missions/templates')
      .then((list) => { if (!cancelled) setTemplates(Array.isArray(list) ? list : []) })
      .catch(() => { if (!cancelled) setTemplates([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const templateId = searchParams.get('template')?.trim()
    if (!templateId || templates.length === 0) return
    const template = templates.find((item) => item.id === templateId)
    if (!template) return
    setGalleryOpen(false)
    setInstallTemplate(template)
    router.replace('/missions', { scroll: false })
  }, [router, searchParams, templates])

  const handleAction = useCallback(async (action: string, reason?: string) => {
    if (!selectedId) return
    setBusy(true)
    try {
      await api('POST', `/missions/${selectedId}/control`, reason ? { action, reason } : { action })
      await refreshList()
      await refreshDetail(selectedId)
    } catch (error) {
      toast.error(`Action failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [selectedId, refreshList, refreshDetail])

  const handleForceReport = useCallback(async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await api('POST', `/missions/${selectedId}/reports`)
      await refreshDetail(selectedId)
      toast.success('Report generated')
    } catch (error) {
      toast.error(`Report failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [selectedId, refreshDetail])

  const handleCreate = useCallback(async (input: Parameters<CreateDialogProps['onCreate']>[0]) => {
    const created = await api<Mission>('POST', '/missions', input)
    await refreshList()
    setSelectedId(created.id)
    toast.success(`Mission "${created.title}" created`)
  }, [refreshList])

  const handleMissionSaved = useCallback((updated: Mission) => {
    setMissions((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
    void refreshList()
  }, [refreshList])

  const handleInstallTemplate = useCallback(async (template: MissionTemplate, input: InstantiateInput) => {
    const result = await api<{ mission: Mission }>(
      'POST',
      `/missions/templates/${encodeURIComponent(template.id)}/instantiate`,
      input,
    )
    await refreshList()
    setSelectedId(result.mission.id)
    setGalleryOpen(false)
    toast.success(`Mission "${result.mission.title}" installed`)
  }, [refreshList])

  return (
    <MainContent>
      <div className="flex-1 flex min-h-0">
        <div className="w-[340px] shrink-0 border-r border-white/[0.06] flex flex-col min-h-0">
          <div className="p-3 border-b border-white/[0.06]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[13px] font-600">Missions</div>
                <div className="text-[10px] text-text-3">Autonomous goal-driven runs</div>
              </div>
              <button
                onClick={() => {
                  const template = templates.find((item) => item.id === RELEASE_QA_TEMPLATE_ID)
                  if (template) {
                    setInstallTemplate(template)
                    return
                  }
                  setCreateOpen(true)
                }}
                className="text-[11px] font-600 px-2.5 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
              >
                + Mission
              </button>
            </div>
            {templates.length > 0 && (
              <button
                onClick={() => setGalleryOpen(true)}
                className="w-full text-left text-[11px] font-600 px-2.5 py-1.5 rounded border border-white/[0.08] bg-white/[0.02] text-text-3 hover:border-white/[0.16] hover:text-text"
              >
                Browse {templates.length} starter templates →
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
            {!loaded ? (
              <div className="text-[11px] text-text-3 p-3">Loading...</div>
            ) : missions.length === 0 ? (
              <div className="flex flex-col gap-2 p-3">
                <div className="text-[11px] text-text-3">
                  No missions yet. Start from a template or create one from scratch.
                </div>
                {templates.length > 0 && (
                  <button
                    onClick={() => setGalleryOpen(true)}
                    className="text-[11px] font-600 px-2.5 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15 self-start"
                  >
                    Open template gallery
                  </button>
                )}
              </div>
            ) : (
              missions.map((m) => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  isSelected={selectedId === m.id}
                  onSelect={() => setSelectedId(m.id)}
                />
              ))
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {selected ? (
            <MissionDetail
              mission={selected}
              reports={reports}
              events={events}
              busy={busy}
              onAction={handleAction}
              onForceReport={handleForceReport}
              onEdit={() => setEditMission(selected)}
            />
          ) : loaded && missions.length === 0 && templates.length > 0 ? (
            <div className="p-6">
              <MissionTemplateGallery
                templates={templates}
                onInstall={(t) => setInstallTemplate(t)}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-text-3 text-[12px]">
              {loaded && missions.length === 0 ? 'Create a mission to get started.' : 'Select a mission'}
            </div>
          )}
        </div>
      </div>

      <CreateMissionDialog
        open={createOpen}
        sessions={sessions}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />

      {galleryOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setGalleryOpen(false)}
        >
          <div
            className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[14px] border border-white/[0.08] bg-bg shadow-[0_24px_64px_rgba(0,0,0,0.6)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-[15px] font-700 text-text">Mission templates</div>
              <button onClick={() => setGalleryOpen(false)} className="text-text-3 text-[12px] hover:text-text">Close</button>
            </div>
            <MissionTemplateGallery
              templates={templates}
              onInstall={(t) => setInstallTemplate(t)}
            />
          </div>
        </div>
      )}

      <MissionTemplateInstallDialog
        template={installTemplate}
        sessions={sessions}
        onClose={() => setInstallTemplate(null)}
        onInstall={handleInstallTemplate}
        onSessionCreated={(session) => {
          setSessions((prev) => [session, ...prev.filter((item) => item.id !== session.id)])
        }}
      />

      <MissionEditSheet
        mission={editMission}
        onClose={() => setEditMission(null)}
        onSaved={handleMissionSaved}
      />
    </MainContent>
  )
}
