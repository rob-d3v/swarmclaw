import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { getExtensionManager } from './extensions'
import {
  inspectExtensionLocalFolder,
  listExtensionLocalFolderEntries,
  listExtensionManagedResources,
  reconcileExtensionManagedResources,
  setExtensionLocalFolderConfig,
} from './extension-managed-resources'
import { loadAgents, loadSchedules, loadSettings, saveAgents, saveSchedules, saveSettings } from './storage'

const originalAgents = loadAgents()
const originalSchedules = loadSchedules()
const originalSettings = loadSettings()

let seq = 0

function extensionId(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now()}_${seq}`
}

afterEach(() => {
  saveAgents(originalAgents)
  saveSchedules(originalSchedules)
  saveSettings(originalSettings)
})

test('managed resources summary and reconcile create extension-owned agents and schedules', () => {
  const id = extensionId('managed_resources')
  getExtensionManager().registerBuiltin(id, {
    name: 'Managed Resource Fixture',
    description: 'Declares resources for tests.',
    managedResources: {
      agents: [
        {
          agentKey: 'researcher',
          displayName: 'Managed Researcher',
          description: 'Research managed by an extension.',
          systemPrompt: 'Research carefully.',
          provider: 'openai',
          model: 'gpt-4o-mini',
          capabilities: ['research'],
          extensions: ['web'],
        },
      ],
      routines: [
        {
          routineKey: 'daily-digest',
          title: 'Daily Digest',
          assigneeRef: { resourceKind: 'agent', resourceKey: 'researcher' },
          taskPrompt: 'Prepare a digest.',
          triggers: [{ kind: 'schedule', cronExpression: '0 9 * * *', timezone: 'UTC' }],
        },
      ],
      gatewayPlatforms: [
        {
          platformKey: 'openai-api',
          displayName: 'OpenAI-compatible API',
          transport: 'http',
          endpoint: 'http://127.0.0.1:8642/v1',
        },
      ],
      setupChecks: [
        { checkKey: 'api-key', displayName: 'API key configured', kind: 'env', target: 'OPENAI_API_KEY' },
      ],
    },
  })

  const before = listExtensionManagedResources().extensions.find((entry) => entry.extensionId === id)
  assert.ok(before)
  assert.equal(before.agents[0].status, 'missing')
  assert.equal(before.schedules[0].status, 'missing_ref')

  const result = reconcileExtensionManagedResources(id)
  assert.equal(result.createdAgents.length, 1)
  assert.equal(result.createdSchedules.length, 1)
  assert.deepEqual(result.skipped, [])

  const agents = loadAgents()
  const agent = agents[result.createdAgents[0]]
  assert.equal(agent.name, 'Managed Researcher')
  assert.equal(agent.managedByExtension?.extensionId, id)
  assert.equal(agent.managedByExtension?.resourceKey, 'researcher')
  assert.ok(agent.extensions?.includes(id))
  assert.ok(agent.extensions?.includes('web'))

  const schedules = loadSchedules()
  const schedule = schedules[result.createdSchedules[0]]
  assert.equal(schedule.name, 'Daily Digest')
  assert.equal(schedule.agentId, agent.id)
  assert.equal(schedule.scheduleType, 'cron')
  assert.equal(schedule.cron, '0 9 * * *')
  assert.equal(schedule.status, 'paused')
  assert.equal(schedule.managedByExtension?.resourceKey, 'daily-digest')

  const after = listExtensionManagedResources().extensions.find((entry) => entry.extensionId === id)
  assert.equal(after?.agents[0].status, 'resolved')
  assert.equal(after?.schedules[0].status, 'resolved')
  assert.equal(after?.gatewayPlatforms.length, 1)
  assert.equal(after?.setupChecks.length, 1)
})

test('local folder inspection and listing stay inside configured roots', async () => {
  const id = extensionId('managed_folder')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-managed-folder-'))
  fs.mkdirSync(path.join(tempDir, 'inputs'))
  fs.mkdirSync(path.join(tempDir, 'outputs'))
  fs.writeFileSync(path.join(tempDir, 'inputs', 'brief.txt'), 'hello\n')

  getExtensionManager().registerBuiltin(id, {
    name: 'Managed Folder Fixture',
    managedResources: {
      localFolders: [
        {
          folderKey: 'workspace',
          displayName: 'Workspace Folder',
          access: 'readWrite',
          requiredDirectories: ['inputs', 'outputs'],
          requiredFiles: ['inputs/brief.txt'],
        },
      ],
    },
  })

  setExtensionLocalFolderConfig({
    extensionId: id,
    folderKey: 'workspace',
    path: tempDir,
  })

  const status = await inspectExtensionLocalFolder({ extensionId: id, folderKey: 'workspace' })
  assert.equal(status.healthy, true)
  assert.equal(status.readable, true)
  assert.equal(status.writable, true)

  const listing = await listExtensionLocalFolderEntries({
    extensionId: id,
    folderKey: 'workspace',
    recursive: true,
  })
  assert.ok(listing.entries.some((entry) => entry.path === 'inputs/brief.txt' && entry.kind === 'file'))

  await assert.rejects(
    () => listExtensionLocalFolderEntries({
      extensionId: id,
      folderKey: 'workspace',
      relativePath: '../outside',
    }),
    /inside the configured root|traversal/,
  )

  fs.rmSync(tempDir, { recursive: true, force: true })
})
