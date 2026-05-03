'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { MainContent } from '@/components/layout/main-content'
import { RunList } from '@/components/runs/run-list'
import { PageLoader } from '@/components/ui/page-loader'
import { useWs } from '@/hooks/use-ws'
import { api } from '@/lib/app/api-client'
import {
  buildQualityOverviewSummary,
  groupApprovalsByCategory,
  summarizeEvalRuns,
  summarizeRunHealth,
} from '@/lib/quality/quality-summary'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/use-app-store'
import type { EvalRun, EvalSuiteResult } from '@/lib/server/eval/types'
import type { Agent, ApprovalRequest, SessionRunRecord } from '@/types'

type QualityTab = 'overview' | 'evals' | 'approvals' | 'runs'

interface EvalSuiteSummary {
  name: string
  count: number
  maxScore: number
  categories: string[]
}

interface EvalScenarioSummary {
  id: string
  name: string
  category: string
  suite: string
  description: string
  tools: string[]
  timeoutMs: number
  criteriaCount: number
  maxScore: number
}

const TABS: Array<{ id: QualityTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'evals', label: 'Eval Lab' },
  { id: 'approvals', label: 'Approval Desk' },
  { id: 'runs', label: 'Run Review' },
]

function formatPercent(value: number | null): string {
  return value == null ? 'n/a' : `${value}%`
}

function scorePercent(score: number, maxScore: number): number | null {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return null
  return Math.round((score / maxScore) * 100)
}

function formatTimestamp(at: number | null | undefined): string {
  if (!at) return 'not recorded'
  return new Date(at).toLocaleString()
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  return `${Math.round((min / 60) * 10) / 10}h`
}

function agentLabel(agent: Agent | undefined, id: string): string {
  return agent ? `${agent.name} (${agent.model || agent.provider})` : id
}

function StatTile({ label, value, hint, tone = 'default' }: {
  label: string
  value: string
  hint: string
  tone?: 'default' | 'good' | 'warn' | 'danger'
}) {
  const toneClass = {
    default: 'text-text',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    danger: 'text-rose-300',
  }[tone]
  return (
    <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] font-700 uppercase tracking-[0.12em] text-text-3/55">{label}</div>
      <div className={cn('mt-2 font-display text-[26px] font-700 tracking-[-0.03em]', toneClass)}>{value}</div>
      <div className="mt-1 text-[12px] leading-relaxed text-text-3/68">{hint}</div>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[14px] border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6">
      <div className="text-[13px] font-700 text-text">{title}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-text-3/65">{description}</p>
    </div>
  )
}

export function QualityWorkspace() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const agents = useAppStore((s) => s.agents)
  const agentOptions = useMemo(
    () => Object.values(agents).filter((agent) => !agent.trashedAt),
    [agents],
  )

  const [activeTab, setActiveTab] = useState<QualityTab>('overview')
  const [runs, setRuns] = useState<SessionRunRecord[]>([])
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>([])
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [suites, setSuites] = useState<EvalSuiteSummary[]>([])
  const [scenarios, setScenarios] = useState<EvalScenarioSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [selectedSuite, setSelectedSuite] = useState('core')
  const [selectedScenarioId, setSelectedScenarioId] = useState('')
  const [evalBusy, setEvalBusy] = useState<string | null>(null)
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null)

  useEffect(() => {
    const tab = searchParams.get('tab') as QualityTab | null
    if (tab && TABS.some((item) => item.id === tab)) setActiveTab(tab)
  }, [searchParams])

  const selectTab = useCallback((tab: QualityTab) => {
    setActiveTab(tab)
    router.replace(`/quality?tab=${tab}`, { scroll: false })
  }, [router])

  const openMissionTemplate = useCallback((templateId: string) => {
    router.push(`/missions?template=${encodeURIComponent(templateId)}`)
  }, [router])

  const loadQualityData = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (opts.silent) setRefreshing(true)
    else setLoading(true)
    setLoadError(null)
    try {
      const [nextRuns, nextEvalRuns, nextApprovals, nextSuites, nextScenarios] = await Promise.all([
        api<SessionRunRecord[]>('GET', '/runs?limit=200'),
        api<EvalRun[]>('GET', '/eval/run?limit=100'),
        api<ApprovalRequest[]>('GET', '/approvals'),
        api<EvalSuiteSummary[]>('GET', '/eval/suites'),
        api<EvalScenarioSummary[]>('GET', '/eval/scenarios'),
      ])
      setRuns(Array.isArray(nextRuns) ? nextRuns : [])
      setEvalRuns(Array.isArray(nextEvalRuns) ? nextEvalRuns : [])
      setApprovals(Array.isArray(nextApprovals) ? nextApprovals : [])
      setSuites(Array.isArray(nextSuites) ? nextSuites : [])
      setScenarios(Array.isArray(nextScenarios) ? nextScenarios : [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load quality data'
      setLoadError(message)
      if (!opts.silent) toast.error(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadQualityData()
  }, [loadQualityData])

  useWs('runs', () => { void loadQualityData({ silent: true }) }, 5000)

  useEffect(() => {
    if (!selectedAgentId && agentOptions[0]) setSelectedAgentId(agentOptions[0].id)
  }, [agentOptions, selectedAgentId])

  useEffect(() => {
    if (!selectedScenarioId && scenarios[0]) setSelectedScenarioId(scenarios[0].id)
  }, [scenarios, selectedScenarioId])

  useEffect(() => {
    if (!suites.some((suite) => suite.name === selectedSuite) && suites[0]) {
      setSelectedSuite(suites[0].name)
    }
  }, [selectedSuite, suites])

  const scenarioById = useMemo(() => {
    return new Map(scenarios.map((scenario) => [scenario.id, scenario]))
  }, [scenarios])

  const runHealth = useMemo(() => summarizeRunHealth(runs), [runs])
  const evalSummary = useMemo(() => summarizeEvalRuns(evalRuns), [evalRuns])
  const approvalGroups = useMemo(() => groupApprovalsByCategory(approvals), [approvals])
  const overview = useMemo(() => buildQualityOverviewSummary({ runs, evalRuns, approvals }), [approvals, evalRuns, runs])
  const selectedSuiteScenarios = useMemo(
    () => scenarios.filter((scenario) => scenario.suite === selectedSuite),
    [scenarios, selectedSuite],
  )

  const runScenario = useCallback(async () => {
    if (!selectedAgentId || !selectedScenarioId) {
      toast.error('Choose an agent and scenario first')
      return
    }
    setEvalBusy(`scenario:${selectedScenarioId}`)
    try {
      await api<EvalRun>('POST', '/eval/run', { agentId: selectedAgentId, scenarioId: selectedScenarioId }, { timeoutMs: 180_000 })
      toast.success('Eval scenario completed')
      await loadQualityData({ silent: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eval scenario failed')
    } finally {
      setEvalBusy(null)
    }
  }, [loadQualityData, selectedAgentId, selectedScenarioId])

  const runSuite = useCallback(async (suiteName: string) => {
    if (!selectedAgentId) {
      toast.error('Choose an agent first')
      return
    }
    setEvalBusy(`suite:${suiteName}`)
    try {
      const result = await api<EvalSuiteResult>('POST', '/eval/suite', { agentId: selectedAgentId, suite: suiteName }, { timeoutMs: 300_000 })
      toast.success(`Suite completed at ${Math.round(result.percentage)}%`)
      await loadQualityData({ silent: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eval suite failed')
    } finally {
      setEvalBusy(null)
    }
  }, [loadQualityData, selectedAgentId])

  const actOnApproval = useCallback(async (approval: ApprovalRequest, approved: boolean) => {
    setApprovalBusy(approval.id)
    try {
      await api('POST', '/approvals', { id: approval.id, approved })
      toast.success(approved ? 'Approval granted' : 'Approval denied')
      await loadQualityData({ silent: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to update approval')
    } finally {
      setApprovalBusy(null)
    }
  }, [loadQualityData])

  if (loading) {
    return (
      <MainContent>
        <PageLoader label="Loading quality center..." />
      </MainContent>
    )
  }

  return (
    <MainContent>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[10px] font-700 uppercase tracking-[0.16em] text-accent-bright/75">Operator Quality Center</div>
              <h1 className="mt-2 font-display text-[28px] font-700 tracking-[-0.03em] text-text">Quality</h1>
              <p className="mt-2 max-w-[720px] text-[13px] leading-relaxed text-text-3/70">
                Evals, approvals, run evidence, and release readiness in one operator workspace.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {refreshing && <span className="text-[11px] text-text-3/60">Refreshing...</span>}
              <button
                type="button"
                onClick={() => void loadQualityData({ silent: true })}
                className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-700 text-text-2 transition-colors hover:bg-white/[0.08]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 12a9 9 0 0 1-15.5 6.2" /><path d="M3 12A9 9 0 0 1 18.5 5.8" /><path d="M3 19v-5h5" /><path d="M21 5v5h-5" />
                </svg>
                Refresh
              </button>
            </div>
          </div>

          {loadError && (
            <div className="rounded-[12px] border border-rose-500/25 bg-rose-500/[0.06] px-4 py-3 text-[12px] text-rose-200">
              {loadError}
            </div>
          )}

          <div className="flex gap-1 overflow-x-auto rounded-[12px] border border-white/[0.06] bg-white/[0.025] p-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => selectTab(tab.id)}
                className={cn(
                  'min-w-fit rounded-[9px] px-3 py-2 text-[12px] font-700 transition-colors',
                  activeTab === tab.id
                    ? 'bg-white/[0.1] text-text'
                    : 'text-text-3 hover:bg-white/[0.05] hover:text-text-2',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div className="flex flex-col gap-6">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <StatTile
                  label="Needs Attention"
                  value={String(overview.needsAttention)}
                  hint="Failed runs, failed evals, and pending approvals."
                  tone={overview.needsAttention > 0 ? 'danger' : 'good'}
                />
                <StatTile
                  label="Active Runs"
                  value={String(overview.activeRuns)}
                  hint={`${runHealth.byStatus.running} running, ${runHealth.byStatus.queued} queued.`}
                  tone={overview.activeRuns > 0 ? 'warn' : 'default'}
                />
                <StatTile
                  label="Pending Approvals"
                  value={String(overview.pendingApprovals)}
                  hint={`${approvalGroups.categories.length} approval group${approvalGroups.categories.length === 1 ? '' : 's'}.`}
                  tone={overview.pendingApprovals > 0 ? 'warn' : 'good'}
                />
                <StatTile
                  label="Eval Average"
                  value={formatPercent(overview.evalAveragePercent)}
                  hint={`${evalSummary.completedRuns} completed eval run${evalSummary.completedRuns === 1 ? '' : 's'}.`}
                  tone={overview.evalAveragePercent == null || overview.evalAveragePercent >= 80 ? 'good' : 'warn'}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <section className="rounded-[16px] border border-white/[0.06] bg-white/[0.025] p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-display text-[15px] font-700 text-text">Needs Attention</h2>
                      <p className="mt-1 text-[12px] text-text-3/65">Shortest path to unblock operator review.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => openMissionTemplate('release-candidate-qa')} className="rounded-[9px] border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-700 text-emerald-200 hover:bg-emerald-500/15">Start QA Mission</button>
                      <button onClick={() => selectTab('evals')} className="rounded-[9px] border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-700 text-text-2 hover:bg-white/[0.05]">Eval Lab</button>
                      <button onClick={() => selectTab('approvals')} className="rounded-[9px] border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-700 text-text-2 hover:bg-white/[0.05]">Approvals</button>
                      <button onClick={() => selectTab('runs')} className="rounded-[9px] border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-700 text-text-2 hover:bg-white/[0.05]">Runs</button>
                    </div>
                  </div>
                  {runHealth.recentFailures.length === 0 && approvalGroups.totalPending === 0 && evalSummary.failedRuns === 0 ? (
                    <EmptyState title="No quality blockers" description="Recent runs, evals, and approvals do not need immediate operator action." />
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                      {runHealth.recentFailures.slice(0, 4).map((run) => (
                        <button
                          key={run.id}
                          onClick={() => selectTab('runs')}
                          className="rounded-[12px] border border-rose-500/20 bg-rose-500/[0.04] px-3 py-3 text-left transition-colors hover:bg-rose-500/[0.07]"
                        >
                          <div className="text-[11px] font-700 uppercase tracking-[0.1em] text-rose-300">Failed Run</div>
                          <div className="mt-1 truncate text-[13px] font-600 text-text">{run.messagePreview || run.id}</div>
                          <div className="mt-1 text-[11px] text-text-3/60">{run.source} - {formatTimestamp(run.endedAt ?? run.queuedAt)}</div>
                        </button>
                      ))}
                      {approvalGroups.categories.slice(0, 4).map((group) => (
                        <button
                          key={group.category}
                          onClick={() => selectTab('approvals')}
                          className="rounded-[12px] border border-amber-500/20 bg-amber-500/[0.04] px-3 py-3 text-left transition-colors hover:bg-amber-500/[0.07]"
                        >
                          <div className="text-[11px] font-700 uppercase tracking-[0.1em] text-amber-300">Approval</div>
                          <div className="mt-1 text-[13px] font-600 text-text">{group.count} pending {group.category.replaceAll('_', ' ')}</div>
                          <div className="mt-1 text-[11px] text-text-3/60">{group.approvals[0]?.title || 'Review request'}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-[16px] border border-white/[0.06] bg-white/[0.025] p-4">
                  <h2 className="font-display text-[15px] font-700 text-text">Latest Eval Scores</h2>
                  <p className="mt-1 text-[12px] text-text-3/65">Most recent scored evidence across agents.</p>
                  <div className="mt-4 flex flex-col gap-2">
                    {evalRuns.slice(0, 5).length === 0 ? (
                      <EmptyState title="No eval history" description="Run a scenario or suite to start building score history." />
                    ) : (
                      evalRuns.slice(0, 5).map((run) => {
                        const percent = scorePercent(run.score, run.maxScore)
                        return (
                          <div key={run.id} className="rounded-[12px] border border-white/[0.06] bg-white/[0.025] px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-700 text-text">{scenarioById.get(run.scenarioId)?.name || run.scenarioId}</div>
                                <div className="mt-1 text-[11px] text-text-3/60">{agentLabel(agents[run.agentId], run.agentId)}</div>
                              </div>
                              <div className={cn('shrink-0 text-[16px] font-display font-700', percent == null || percent >= 80 ? 'text-emerald-300' : 'text-amber-300')}>
                                {formatPercent(percent)}
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {activeTab === 'evals' && (
            <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
              <section className="rounded-[16px] border border-white/[0.06] bg-white/[0.025] p-4">
                <h2 className="font-display text-[15px] font-700 text-text">Eval Lab</h2>
                <p className="mt-1 text-[12px] leading-relaxed text-text-3/65">Run focused scenarios or complete suites against one agent.</p>
                <div className="mt-4 flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-700 uppercase tracking-[0.12em] text-text-3/55">Agent</span>
                    <select
                      value={selectedAgentId}
                      onChange={(event) => setSelectedAgentId(event.target.value)}
                      className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] text-text outline-none"
                    >
                      {agentOptions.length === 0 && <option value="">No agents available</option>}
                      {agentOptions.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-700 uppercase tracking-[0.12em] text-text-3/55">Scenario</span>
                    <select
                      value={selectedScenarioId}
                      onChange={(event) => setSelectedScenarioId(event.target.value)}
                      className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] text-text outline-none"
                    >
                      {scenarios.map((scenario) => (
                        <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
                      ))}
                    </select>
                  </label>
                  {selectedScenarioId && scenarioById.get(selectedScenarioId) && (
                    <div className="rounded-[12px] border border-white/[0.06] bg-white/[0.025] px-3 py-3">
                      <div className="text-[13px] font-700 text-text">{scenarioById.get(selectedScenarioId)!.name}</div>
                      <p className="mt-1 text-[12px] leading-relaxed text-text-3/65">{scenarioById.get(selectedScenarioId)!.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[10px] font-700 text-text-3">{scenarioById.get(selectedScenarioId)!.category}</span>
                        <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[10px] font-700 text-text-3">{scenarioById.get(selectedScenarioId)!.criteriaCount} criteria</span>
                        <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[10px] font-700 text-text-3">{formatDuration(scenarioById.get(selectedScenarioId)!.timeoutMs)}</span>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => openMissionTemplate('release-candidate-qa')}
                    className="mt-3 w-full rounded-[10px] border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[12px] font-800 text-emerald-200 transition-colors hover:bg-emerald-500/15"
                  >
                    Start Release QA Mission
                  </button>
                  <button
                    type="button"
                    disabled={!selectedAgentId || !selectedScenarioId || !!evalBusy}
                    onClick={() => void runScenario()}
                    className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-accent-bright px-3 py-2.5 text-[12px] font-800 text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    {evalBusy?.startsWith('scenario:') ? 'Running Scenario' : 'Run Scenario'}
                  </button>
                </div>
              </section>

              <div className="flex flex-col gap-5">
                <section className="rounded-[16px] border border-white/[0.06] bg-white/[0.025] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-[15px] font-700 text-text">Suites</h2>
                      <p className="mt-1 text-[12px] text-text-3/65">Release-oriented eval suites available through the existing eval API.</p>
                    </div>
                    <select
                      value={selectedSuite}
                      onChange={(event) => setSelectedSuite(event.target.value)}
                      className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] text-text outline-none"
                    >
                      {suites.map((suite) => (
                        <option key={suite.name} value={suite.name}>{suite.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {suites.map((suite) => (
                      <div key={suite.name} className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[13px] font-800 text-text">{suite.name}</div>
                            <div className="mt-1 text-[11px] text-text-3/65">{suite.count} scenarios - {suite.maxScore} max score</div>
                          </div>
                          <button
                            type="button"
                            disabled={!selectedAgentId || !!evalBusy}
                            onClick={() => void runSuite(suite.name)}
                            className="rounded-[8px] border border-white/[0.08] px-2 py-1 text-[11px] font-700 text-text-2 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {evalBusy === `suite:${suite.name}` ? 'Running' : 'Run'}
                          </button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {suite.categories.map((category) => (
                            <span key={category} className="rounded-full bg-white/[0.05] px-2 py-1 text-[10px] font-700 text-text-3">{category}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 text-[11px] text-text-3/60">
                    {selectedSuiteScenarios.length} scenario{selectedSuiteScenarios.length === 1 ? '' : 's'} selected in {selectedSuite}.
                  </div>
                </section>

                <section className="rounded-[16px] border border-white/[0.06] bg-white/[0.025] p-4">
                  <h2 className="font-display text-[15px] font-700 text-text">Score History</h2>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {evalRuns.length === 0 ? (
                      <EmptyState title="No eval results yet" description="Run a scenario or suite to see criteria scores and evidence." />
                    ) : (
                      evalRuns.slice(0, 12).map((run) => {
                        const percent = scorePercent(run.score, run.maxScore)
                        const scenario = scenarioById.get(run.scenarioId)
                        return (
                          <div key={run.id} className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-800 text-text">{scenario?.name || run.scenarioId}</div>
                                <div className="mt-1 text-[11px] text-text-3/60">{agentLabel(agents[run.agentId], run.agentId)}</div>
                                <div className="mt-1 text-[10px] text-text-3/50">{formatTimestamp(run.endedAt ?? run.startedAt)}</div>
                              </div>
                              <div className={cn('rounded-[8px] px-2 py-1 text-[13px] font-800', percent == null || percent >= 80 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300')}>
                                {formatPercent(percent)}
                              </div>
                            </div>
                            <div className="mt-3 flex flex-col gap-2">
                              {run.details.slice(0, 3).map((detail) => (
                                <div key={detail.criterion} className="rounded-[10px] bg-white/[0.025] px-3 py-2">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-[11px] font-700 text-text-2">{detail.criterion}</div>
                                    <div className="text-[10px] text-text-3/70">{detail.score}/{detail.maxScore}</div>
                                  </div>
                                  {detail.evidence && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-3/65">{detail.evidence}</p>}
                                </div>
                              ))}
                              {run.details.length > 3 && (
                                <div className="text-[10px] text-text-3/50">+{run.details.length - 3} more criteria</div>
                              )}
                              {run.error && <div className="rounded-[10px] bg-rose-500/[0.06] px-3 py-2 text-[11px] text-rose-200">{run.error}</div>}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {activeTab === 'approvals' && (
            <section className="rounded-[16px] border border-white/[0.06] bg-white/[0.025] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-[15px] font-700 text-text">Approval Desk</h2>
                  <p className="mt-1 text-[12px] text-text-3/65">Pending human-loop, tool, connector, skill, agent, and budget requests.</p>
                </div>
                <div className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-700 text-text-3">
                  {approvalGroups.totalPending} pending
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-4">
                {approvalGroups.totalPending === 0 ? (
                  <EmptyState title="No pending approvals" description="The approval queue is clear." />
                ) : (
                  approvalGroups.categories.map((group) => (
                    <div key={group.category} className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-[12px] font-800 uppercase tracking-[0.1em] text-text-2">{group.category.replaceAll('_', ' ')}</div>
                        <div className="text-[11px] font-700 text-text-3/65">{group.count} request{group.count === 1 ? '' : 's'}</div>
                      </div>
                      <div className="grid gap-2 lg:grid-cols-2">
                        {group.approvals.map((approval) => (
                          <div key={approval.id} className="rounded-[12px] border border-white/[0.06] bg-surface px-3 py-3">
                            <div className="text-[13px] font-800 text-text">{approval.title}</div>
                            {approval.description && <p className="mt-1 text-[12px] leading-relaxed text-text-3/65">{approval.description}</p>}
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-3/55">
                              <span>{formatTimestamp(approval.createdAt)}</span>
                              {approval.agentId && <span>agent {agents[approval.agentId]?.name || approval.agentId}</span>}
                              {approval.sessionId && <span>session {approval.sessionId.slice(0, 8)}</span>}
                            </div>
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                disabled={approvalBusy === approval.id}
                                onClick={() => void actOnApproval(approval, true)}
                                className="inline-flex items-center gap-1.5 rounded-[9px] bg-emerald-400 px-3 py-1.5 text-[11px] font-800 text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={approvalBusy === approval.id}
                                onClick={() => void actOnApproval(approval, false)}
                                className="inline-flex items-center gap-1.5 rounded-[9px] border border-rose-400/25 bg-rose-500/[0.06] px-3 py-1.5 text-[11px] font-800 text-rose-200 transition-colors hover:bg-rose-500/[0.1] disabled:opacity-40"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                                  <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                                </svg>
                                Deny
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {activeTab === 'runs' && (
            <div className="flex min-h-[680px] flex-col rounded-[16px] border border-white/[0.06] bg-white/[0.025]">
              <div className="border-b border-white/[0.06] px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="font-display text-[15px] font-700 text-text">Run Review</h2>
                    <p className="mt-1 text-[12px] text-text-3/65">Filter recent runs and open replay evidence from the detail sheet.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-rose-500/[0.08] px-2.5 py-1 text-[11px] font-700 text-rose-300">{runHealth.byStatus.failed} failed</span>
                    <span className="rounded-full bg-blue-500/[0.08] px-2.5 py-1 text-[11px] font-700 text-blue-300">{runHealth.byStatus.running} running</span>
                    <span className="rounded-full bg-emerald-500/[0.08] px-2.5 py-1 text-[11px] font-700 text-emerald-300">{runHealth.byStatus.completed} completed</span>
                  </div>
                </div>
              </div>
              <RunList />
            </div>
          )}
        </div>
      </div>
    </MainContent>
  )
}
