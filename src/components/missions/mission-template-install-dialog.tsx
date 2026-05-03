'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/app/api-client'
import { HintTip } from '@/components/shared/hint-tip'
import { AdvancedSettingsSection } from '@/components/shared/advanced-settings-section'
import { inputClass } from '@/components/shared/form-styles'
import type { MissionTemplate, Session } from '@/types'
import { toast } from 'sonner'

export interface InstantiateInput {
  rootSessionId: string
  overrides: {
    title: string
    goal: string
    successCriteria: string[]
    budget: {
      maxUsd: number | null
      maxTokens: number | null
      maxWallclockSec: number | null
      maxTurns: number | null
    }
    reportSchedule: { intervalSec: number; format: 'markdown'; enabled: boolean } | null
  }
}

interface Props {
  template: MissionTemplate | null
  sessions: Session[]
  onClose: () => void
  onInstall: (template: MissionTemplate, input: InstantiateInput) => Promise<void>
  onSessionCreated?: (session: Session) => void
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '-'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86_400) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86_400)}d`
}

function numOrNull(s: string): number | null {
  const n = Number.parseFloat(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

function intOrNull(s: string): number | null {
  const n = numOrNull(s)
  return n == null ? null : Math.round(n)
}

export function MissionTemplateInstallDialog({ template, sessions, onClose, onInstall, onSessionCreated }: Props) {
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [criteriaText, setCriteriaText] = useState('')
  const [rootSessionId, setRootSessionId] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [maxUsd, setMaxUsd] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [maxWallclockSec, setMaxWallclockSec] = useState('')
  const [maxTurns, setMaxTurns] = useState('')
  const [reportsEnabled, setReportsEnabled] = useState(true)
  const [reportIntervalMin, setReportIntervalMin] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!template) return
    setTitle(template.defaults.title)
    setGoal(template.defaults.goal)
    setCriteriaText(template.defaults.successCriteria.join('\n'))
    setMaxUsd(template.defaults.budget.maxUsd != null ? String(template.defaults.budget.maxUsd) : '')
    setMaxTokens(template.defaults.budget.maxTokens != null ? String(template.defaults.budget.maxTokens) : '')
    setMaxWallclockSec(template.defaults.budget.maxWallclockSec != null ? String(template.defaults.budget.maxWallclockSec) : '')
    setMaxTurns(template.defaults.budget.maxTurns != null ? String(template.defaults.budget.maxTurns) : '')
    setReportsEnabled(template.defaults.reportSchedule?.enabled ?? false)
    setReportIntervalMin(
      template.defaults.reportSchedule?.intervalSec != null
        ? String(Math.round(template.defaults.reportSchedule.intervalSec / 60))
        : '60',
    )
    setAdvancedOpen(false)
  }, [template])

  useEffect(() => {
    if (!rootSessionId && sessions.length > 0) setRootSessionId(sessions[0].id)
  }, [sessions, rootSessionId])

  const badges = useMemo(() => {
    if (!template) return []
    const out: string[] = []
    if (template.defaults.budget.maxUsd != null) out.push(`$${template.defaults.budget.maxUsd} cap`)
    if (template.defaults.budget.maxTurns != null) out.push(`${template.defaults.budget.maxTurns} turns`)
    if (template.defaults.budget.maxWallclockSec != null) out.push(formatDuration(template.defaults.budget.maxWallclockSec))
    if (template.defaults.reportSchedule) out.push(`Reports every ${formatDuration(template.defaults.reportSchedule.intervalSec)}`)
    return out
  }, [template])

  if (!template) return null

  const submit = async () => {
    if (!rootSessionId) {
      toast.error('Pick a session to drive this mission')
      return
    }
    if (!title.trim() || !goal.trim()) {
      toast.error('Title and goal are required')
      return
    }
    setBusy(true)
    try {
      const successCriteria = criteriaText.split('\n').map((s) => s.trim()).filter(Boolean)
      const intervalMin = numOrNull(reportIntervalMin) ?? 60
      await onInstall(template, {
        rootSessionId,
        overrides: {
          title: title.trim(),
          goal: goal.trim(),
          successCriteria,
          budget: {
            maxUsd: numOrNull(maxUsd),
            maxTokens: intOrNull(maxTokens),
            maxWallclockSec: intOrNull(maxWallclockSec),
            maxTurns: intOrNull(maxTurns),
          },
          reportSchedule: reportsEnabled
            ? { intervalSec: Math.round(intervalMin * 60), format: 'markdown', enabled: true }
            : null,
        },
      })
      onClose()
    } catch (error) {
      toast.error(`Install failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const createDriverSession = async () => {
    if (!template) return
    setBusy(true)
    try {
      const session = await api<Session>('POST', '/chats', {
        name: `${template.name} mission driver`,
        sessionType: 'human',
        heartbeatEnabled: true,
        heartbeatIntervalSec: 300,
      })
      setRootSessionId(session.id)
      onSessionCreated?.(session)
      toast.success('Mission driver chat created')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create mission driver chat')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-[14px] border border-white/[0.08] bg-bg shadow-[0_24px_64px_rgba(0,0,0,0.6)] p-5 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <span className="text-[28px] leading-none" aria-hidden>{template.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-700 text-text">{template.name}</div>
            <div className="text-[12px] text-text-3 leading-[1.5] mt-1">{template.description}</div>
            {badges.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {badges.map((badge) => (
                  <span
                    key={badge}
                    className="text-[10px] font-600 px-1.5 py-0.5 rounded border border-white/[0.08] bg-white/[0.02] text-text-3"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {template.setupNote && (
          <div className="mb-4 text-[11px] text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-[10px] px-3 py-2 leading-[1.5]">
            <span className="font-700">Setup: </span>
            {template.setupNote}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-3">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-3 inline-flex items-center gap-1">
              Goal <HintTip text="The natural-language objective your team will work on." />
            </span>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              className={`${inputClass} resize-none`}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-3 inline-flex items-center gap-1">
              Root session <HintTip text="The session whose heartbeat drives this mission." />
            </span>
            <select value={rootSessionId} onChange={(e) => setRootSessionId(e.target.value)} className={inputClass}>
              {sessions.length === 0 && <option value="">No sessions available. Create a chat first.</option>}
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.id}
                </option>
              ))}
            </select>
            {sessions.length === 0 && (
              <button
                type="button"
                onClick={() => void createDriverSession()}
                disabled={busy}
                className="mt-2 self-start rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] font-700 text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-40"
              >
                Create mission driver chat
              </button>
            )}
          </label>
        </div>

        <div className="mt-4">
          <AdvancedSettingsSection
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((o) => !o)}
            summary="Budgets, criteria, reports"
          >
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-text-3 inline-flex items-center gap-1">
                  Success criteria <HintTip text="One per line. Used in reports and final verification." />
                </span>
                <textarea
                  value={criteriaText}
                  onChange={(e) => setCriteriaText(e.target.value)}
                  rows={4}
                  className={`${inputClass} resize-none`}
                />
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
                    Max wallclock (sec) <HintTip text="Scheduler aborts after this many seconds of elapsed wallclock." />
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
          </AdvancedSettingsSection>
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
            {busy ? 'Installing…' : 'Install mission'}
          </button>
        </div>
      </div>
    </div>
  )
}
