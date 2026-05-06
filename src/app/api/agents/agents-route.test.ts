import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

// Disable daemon autostart during tests
process.env.SWARMCLAW_DAEMON_AUTOSTART = '0'

import { GET as getAgent, PUT as putAgent } from './[id]/route'
import { POST as createAgent } from './route'
import { loadAgents, saveAgents } from '@/lib/server/storage'

const originalAgents = loadAgents()

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function seedAgent(id: string, overrides: Record<string, unknown> = {}) {
  const agents = loadAgents()
  const now = Date.now()
  agents[id] = {
    id,
    name: 'Test Agent',
    description: 'Route test',
    systemPrompt: '',
    provider: 'ollama',
    model: 'qwen3.5',
    credentialId: null,
    fallbackCredentialIds: [],
    apiEndpoint: null,
    gatewayProfileId: null,
    extensions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
  saveAgents(agents)
}

afterEach(() => {
  saveAgents(originalAgents)
})

// --- GET /api/agents/:id ---

test('GET /api/agents/:id returns the agent when it exists', async () => {
  seedAgent('agent-get-test', { name: 'GetMe' })

  const response = await getAgent(
    new Request('http://local/api/agents/agent-get-test'),
    routeParams('agent-get-test'),
  )

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.id, 'agent-get-test')
  assert.equal(body.name, 'GetMe')
})

test('GET /api/agents/:id returns 404 for a non-existent agent', async () => {
  const response = await getAgent(
    new Request('http://local/api/agents/does-not-exist'),
    routeParams('does-not-exist'),
  )

  assert.equal(response.status, 404)
  const body = await response.json()
  assert.equal(body.error, 'Not found')
})

// --- POST /api/agents (provider validation) ---

test('POST /api/agents rejects an unknown provider with a 400', async () => {
  const response = await createAgent(new Request('http://local/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bad Provider Agent', provider: 'nonexistent_provider', model: 'x' }),
  }))

  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.error, 'Validation failed')
  assert.ok(body.issues.some((i: { path: string; message: string }) => i.path === 'provider'))
})

test('POST /api/agents accepts a valid provider and creates the agent', async () => {
  const response = await createAgent(new Request('http://local/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Good Agent', provider: 'ollama', model: 'qwen3.5' }),
  }))

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.name, 'Good Agent')
  assert.equal(body.provider, 'ollama')
  assert.ok(body.id)

  // Clean up
  const agents = loadAgents()
  delete agents[body.id]
  saveAgents(agents)
})

test('POST /api/agents persists strict planning mode for created agents', async () => {
  const response = await createAgent(new Request('http://local/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Planning Agent',
      provider: 'ollama',
      model: 'qwen3.5',
      planningMode: 'strict',
    }),
  }))

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.planningMode, 'strict')

  const agents = loadAgents()
  delete agents[body.id]
  saveAgents(agents)
})

test('POST /api/agents rejects missing required fields with a 400', async () => {
  const response = await createAgent(new Request('http://local/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }))

  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.error, 'Validation failed')
})

// --- PUT /api/agents/:id (validation & field preservation) ---

test('PUT /api/agents/:id rejects a non-array tools value with a 400', async () => {
  seedAgent('agent-tools-reject', { tools: ['memory', 'files', 'web_search'] })

  const response = await putAgent(new Request('http://local/api/agents/agent-tools-reject', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tools: 'not_an_array' }),
  }), routeParams('agent-tools-reject'))

  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.error, 'Validation failed')
  assert.ok(body.issues.some((i: { path: string }) => i.path === 'tools'))

  const agentAfter = loadAgents()['agent-tools-reject']
  assert.deepEqual(agentAfter.tools, ['memory', 'files', 'web_search'], 'stored tools must be untouched')
})

test('PUT /api/agents/:id does not clobber untouched fields with schema defaults', async () => {
  // Seed with non-default values; PUT a body that omits those fields. The route
  // must filter zod defaults so missing keys do NOT reset the stored values.
  seedAgent('agent-partial-update', {
    name: 'Original',
    tools: ['memory'],
    delegationEnabled: true,
    delegationTargetMode: 'selected',
    delegationTargetAgentIds: ['other-agent'],
    heartbeatEnabled: false,
    proactiveMemory: false,
  })

  const response = await putAgent(new Request('http://local/api/agents/agent-partial-update', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'edited' }),
  }), routeParams('agent-partial-update'))

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.description, 'edited')
  assert.equal(body.name, 'Original')
  assert.deepEqual(body.tools, ['memory'])
  assert.equal(body.delegationEnabled, true)
  assert.equal(body.delegationTargetMode, 'selected')
  assert.equal(body.heartbeatEnabled, false)
  assert.equal(body.proactiveMemory, false)
})

test('PUT /api/agents/:id updates planning mode without clobbering other fields', async () => {
  seedAgent('agent-planning-mode', {
    name: 'Planner',
    tools: ['memory'],
    planningMode: 'off',
    proactiveMemory: false,
  })

  const response = await putAgent(new Request('http://local/api/agents/agent-planning-mode', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ planningMode: 'strict' }),
  }), routeParams('agent-planning-mode'))

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.planningMode, 'strict')
  assert.equal(body.name, 'Planner')
  assert.deepEqual(body.tools, ['memory'])
  assert.equal(body.proactiveMemory, false)
})

test('PUT /api/agents/:id rejects non-string name', async () => {
  seedAgent('agent-bad-name', { name: 'Good' })

  const response = await putAgent(new Request('http://local/api/agents/agent-bad-name', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 12345 }),
  }), routeParams('agent-bad-name'))

  assert.equal(response.status, 400)
  const agentAfter = loadAgents()['agent-bad-name']
  assert.equal(agentAfter.name, 'Good')
})
