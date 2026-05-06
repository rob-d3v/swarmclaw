import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AGENT_PLANNING_MODE_OPTIONS,
  describeAgentPlanningMode,
  isAgentPlanningModeEnabled,
  normalizeAgentPlanningMode,
} from './agent-planning-mode'

test('normalizeAgentPlanningMode accepts only supported persisted values', () => {
  assert.equal(normalizeAgentPlanningMode('strict'), 'strict')
  assert.equal(normalizeAgentPlanningMode('off'), 'off')
  assert.equal(normalizeAgentPlanningMode(null), 'off')
  assert.equal(normalizeAgentPlanningMode(undefined), 'off')
  assert.equal(normalizeAgentPlanningMode('unexpected'), 'off')
})

test('planning mode options include a safe default and strict mode', () => {
  assert.deepEqual(
    AGENT_PLANNING_MODE_OPTIONS.map((option) => option.value),
    ['off', 'strict'],
  )
  assert.equal(isAgentPlanningModeEnabled('strict'), true)
  assert.equal(isAgentPlanningModeEnabled('off'), false)
  assert.equal(isAgentPlanningModeEnabled(null), false)
})

test('describeAgentPlanningMode returns operator-facing copy for each mode', () => {
  assert.match(describeAgentPlanningMode('off'), /No extra plan contract/)
  assert.match(describeAgentPlanningMode('strict'), /machine-readable plan block/)
})
