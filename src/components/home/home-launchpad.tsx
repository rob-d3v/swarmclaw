'use client'

import { AgentAvatar } from '@/components/agents/agent-avatar'
import { LaunchActionCard } from '@/components/shared/launch-action-card'
import type { Agent } from '@/types'

function SnapshotItem({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.03] px-4 py-3">
      <div className="text-[11px] font-700 uppercase tracking-[0.12em] text-text-3/55">{label}</div>
      <div className="mt-2 text-[24px] font-display font-700 tracking-[-0.03em] text-text">{value}</div>
      <div className="mt-1 text-[12px] leading-relaxed text-text-3/68">{hint}</div>
    </div>
  )
}

function PathCard({
  kicker,
  title,
  description,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  kicker: string
  title: string
  description: string
  primaryLabel: string
  secondaryLabel: string
  onPrimary: () => void
  onSecondary: () => void
}) {
  return (
    <div className="flex min-h-[220px] flex-col rounded-[18px] border border-white/[0.07] bg-white/[0.03] p-5">
      <div className="text-[11px] font-700 uppercase tracking-[0.12em] text-text-3/55">{kicker}</div>
      <div className="mt-3 text-[18px] font-display font-700 tracking-normal text-text">{title}</div>
      <p className="mt-2 flex-1 text-[13px] leading-relaxed text-text-3/72">{description}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPrimary}
          className="rounded-[10px] bg-accent-bright px-3.5 py-2 text-[12px] font-display font-700 text-black transition-opacity hover:opacity-90"
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={onSecondary}
          className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-[12px] font-display font-700 text-text-2 transition-colors hover:bg-white/[0.08]"
        >
          {secondaryLabel}
        </button>
      </div>
    </div>
  )
}

type Props = {
  firstAgent: Agent | null
  agentCount: number
  sessionCount: number
  taskCount: number
  scheduleCount: number
  connectorCount: number
  todayCost: number
  onOpenFirstAgent: () => void
  onOpenProtocols: () => void
  onOpenBuilder: () => void
  onOpenConnectors: () => void
  onOpenUsage: () => void
  onRunEvalSuite: () => void
  onReviewApprovals: () => void
  onInspectFailedRuns: () => void
  onStartReleaseQaMission: () => void
  onStartLaunchSprintMission: () => void
  onStartCostAuditMission: () => void
  onStartConnectorSmokeMission: () => void
}

export function HomeLaunchpad({
  firstAgent,
  agentCount,
  sessionCount,
  taskCount,
  scheduleCount,
  connectorCount,
  todayCost,
  onOpenFirstAgent,
  onOpenProtocols,
  onOpenBuilder,
  onOpenConnectors,
  onOpenUsage,
  onRunEvalSuite,
  onReviewApprovals,
  onInspectFailedRuns,
  onStartReleaseQaMission,
  onStartLaunchSprintMission,
  onStartCostAuditMission,
  onStartConnectorSmokeMission,
}: Props) {
  return (
    <div className="max-w-[980px] mx-auto px-6 py-10">
      <div className="rounded-[20px] border border-white/[0.06] bg-white/[0.025] p-6">
        <div className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] font-700 uppercase tracking-[0.16em] text-text-3/70">
          Mission Command
        </div>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-[620px]">
            <h1 className="font-display text-[34px] font-700 tracking-normal text-text">
              Pick a path and watch the workspace move.
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-text-3/72">
              Start with a local assistant, a reusable workflow, or a budgeted autonomous mission. The rest of the control plane stays one click away.
            </p>
          </div>
          <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-4 min-w-[240px]">
            <div className="text-[11px] font-700 uppercase tracking-[0.12em] text-text-3/55">Workspace Anchor</div>
            <div className="mt-3 flex items-center gap-3">
              {firstAgent ? (
                <>
                  <AgentAvatar
                    seed={firstAgent.avatarSeed}
                    avatarUrl={firstAgent.avatarUrl}
                    name={firstAgent.name}
                    size={44}
                  />
                  <div>
                    <div className="text-[14px] font-display font-700 text-text">{firstAgent.name}</div>
                    <div className="text-[12px] text-text-3/70">
                      {firstAgent.model ? firstAgent.model.split('/').pop()?.split(':')[0] : firstAgent.provider}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-[13px] leading-relaxed text-text-3/72">
                  No agents yet. Start by creating one or use the workflow tools first.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <PathCard
          kicker="Self-hosted assistant"
          title={firstAgent ? `Work with ${firstAgent.name}` : 'Create the first agent'}
          description="Open a live agent chat, then add memory, local tools, provider routing, or connector access as the work demands."
          primaryLabel={firstAgent ? 'Open Chat' : 'Open Agents'}
          secondaryLabel="Connect Platform"
          onPrimary={onOpenFirstAgent}
          onSecondary={onOpenConnectors}
        />
        <PathCard
          kicker="Visual workflow"
          title="Shape a reusable run"
          description="Use protocol templates and the builder to turn review, research, planning, or release checks into durable workflows."
          primaryLabel="Open Builder"
          secondaryLabel="Use Templates"
          onPrimary={onOpenBuilder}
          onSecondary={onOpenProtocols}
        />
        <PathCard
          kicker="Autonomous mission"
          title="Run with budgets"
          description="Start a mission template for release QA, research, support triage, cost audit, or failed-run review with reports and caps."
          primaryLabel="Release QA"
          secondaryLabel="Quality Center"
          onPrimary={onStartReleaseQaMission}
          onSecondary={onRunEvalSuite}
        />
      </div>

      <div className="mt-6 rounded-[18px] border border-white/[0.06] bg-white/[0.025] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[11px] font-700 uppercase tracking-[0.12em] text-text-3/55">Mission starters</div>
            <p className="mt-1 max-w-[620px] text-[12px] leading-relaxed text-text-3/68">
              Jump directly into the workflows that produce reusable evidence and shareable reports.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onStartReleaseQaMission}
              className="rounded-[10px] border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[12px] font-display font-700 text-emerald-200 hover:bg-emerald-500/15"
            >
              Release QA
            </button>
            <button
              type="button"
              onClick={onStartLaunchSprintMission}
              className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-display font-700 text-text-2 hover:bg-white/[0.08]"
            >
              Launch Sprint
            </button>
            <button
              type="button"
              onClick={onStartCostAuditMission}
              className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-display font-700 text-text-2 hover:bg-white/[0.08]"
            >
              Cost Audit
            </button>
            <button
              type="button"
              onClick={onStartConnectorSmokeMission}
              className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-display font-700 text-text-2 hover:bg-white/[0.08]"
            >
              Connector Smoke
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <LaunchActionCard
          title={firstAgent ? 'Open First Agent Chat' : 'Open Agents'}
          description={firstAgent
            ? `Jump into ${firstAgent.name} and start using the workspace immediately.`
            : 'Open the agents workspace to create or tune the first specialist agent.'}
          actionLabel={firstAgent ? 'Open Chat' : 'Open Agents'}
          onClick={onOpenFirstAgent}
          tone="primary"
        />
        <LaunchActionCard
          title="Start Structured Session"
          description="Open bounded collaboration runs for planning, review, decision-making, or focused multi-agent work."
          actionLabel="Open Protocols"
          onClick={onOpenProtocols}
        />
        <LaunchActionCard
          title="Open Workflow Builder"
          description="Move straight into reusable orchestration graphs if you want a durable workflow instead of a one-off run."
          actionLabel="Open Builder"
          onClick={onOpenBuilder}
        />
        <LaunchActionCard
          title="Connect a Platform"
          description="Bridge agents into chat surfaces like Discord, Slack, Telegram, and WhatsApp."
          actionLabel="Open Connectors"
          onClick={onOpenConnectors}
        />
        <LaunchActionCard
          title="Review Usage"
          description="Check cost, provider health, and activity so the workspace stays observable from the start."
          actionLabel="Open Usage"
          onClick={onOpenUsage}
        />
        <LaunchActionCard
          title="Run Eval Suite"
          description="Open the Quality Center and run scenario or suite checks against an agent before shipping."
          actionLabel="Open Eval Lab"
          onClick={onRunEvalSuite}
        />
        <LaunchActionCard
          title="Review Approvals"
          description="Clear pending human-loop, tool, connector, skill, agent, and budget requests from one desk."
          actionLabel="Open Approvals"
          onClick={onReviewApprovals}
        />
        <LaunchActionCard
          title="Inspect Failed Runs"
          description="Filter recent run failures and open replay evidence without leaving the operator workflow."
          actionLabel="Open Run Review"
          onClick={onInspectFailedRuns}
        />
        <LaunchActionCard
          title="Start Release QA Mission"
          description="Use a budgeted mission template to collect release readiness evidence and quality notes."
          actionLabel="Open Missions"
          onClick={onStartReleaseQaMission}
        />
      </div>

      <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <SnapshotItem label="Agents" value={String(agentCount)} hint="Configured specialists available in this workspace." />
        <SnapshotItem label="Chats" value={String(sessionCount)} hint="Durable conversations already created." />
        <SnapshotItem label="Tasks" value={String(taskCount)} hint="Queued or archived work items in the board." />
        <SnapshotItem label="Schedules" value={String(scheduleCount)} hint="Recurring or delayed automations ready to run." />
        <SnapshotItem label="Connectors" value={String(connectorCount)} hint="Platform bridges currently configured." />
        <SnapshotItem label="Today's Cost" value={`$${todayCost.toFixed(2)}`} hint="Estimated usage cost for today across providers." />
      </div>
    </div>
  )
}
