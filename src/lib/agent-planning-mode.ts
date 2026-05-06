import type { Agent } from '@/types'

export type AgentPlanningMode = NonNullable<Agent['planningMode']>

export const AGENT_PLANNING_MODE_OPTIONS: ReadonlyArray<{
  value: AgentPlanningMode
  label: string
  description: string
}> = [
  {
    value: 'off',
    label: 'Standard',
    description: 'No extra plan contract. The agent can answer, plan, or act normally based on the task.',
  },
  {
    value: 'strict',
    label: 'Strict planning',
    description: 'Require a machine-readable plan block before multi-step tool work so progress can be tracked.',
  },
]

export function normalizeAgentPlanningMode(value: unknown): AgentPlanningMode {
  return value === 'strict' ? 'strict' : 'off'
}

export function isAgentPlanningModeEnabled(value: Agent['planningMode'] | undefined): boolean {
  return normalizeAgentPlanningMode(value) === 'strict'
}

export function describeAgentPlanningMode(value: Agent['planningMode'] | undefined): string {
  const mode = normalizeAgentPlanningMode(value)
  return AGENT_PLANNING_MODE_OPTIONS.find((option) => option.value === mode)?.description
    || AGENT_PLANNING_MODE_OPTIONS[0].description
}
