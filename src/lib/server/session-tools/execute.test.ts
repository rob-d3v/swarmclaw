import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, test } from 'node:test'
import { redactSecrets, buildCredentialEnv } from './credential-env'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..')

function runWithTempDataDir<T extends Record<string, unknown>>(script: string): T {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-execute-tool-'))
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATA_DIR: path.join(tempDir, 'data'),
        WORKSPACE_DIR: path.join(tempDir, 'workspace'),
        SWARMCLAW_BUILD_MODE: '1',
      },
      encoding: 'utf-8',
      timeout: 15000,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout || 'subprocess failed')
    const lines = (result.stdout || '')
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const jsonLine = [...lines].reverse().find((line) => line.startsWith('{'))
    return JSON.parse(jsonLine || '{}') as T
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

describe('credential-env', () => {
  describe('redactSecrets', () => {
    it('redacts secret values from text', () => {
      const secrets = ['sk-abc123456789']
      const text = 'Response: Bearer sk-abc123456789 was used'
      const result = redactSecrets(text, secrets)
      assert.equal(result, 'Response: Bearer [REDACTED] was used')
    })

    it('skips secrets shorter than 5 characters', () => {
      const secrets = ['abc']
      const text = 'Contains abc value'
      const result = redactSecrets(text, secrets)
      assert.equal(result, 'Contains abc value')
    })

    it('handles empty secrets list', () => {
      const text = 'No secrets here'
      const result = redactSecrets(text, [])
      assert.equal(result, 'No secrets here')
    })

    it('handles empty text', () => {
      const result = redactSecrets('', ['secret123'])
      assert.equal(result, '')
    })

    it('redacts multiple occurrences', () => {
      const secrets = ['mytoken12345']
      const text = 'First: mytoken12345, Second: mytoken12345'
      const result = redactSecrets(text, secrets)
      assert.equal(result, 'First: [REDACTED], Second: [REDACTED]')
    })

    it('redacts multiple different secrets', () => {
      const secrets = ['secret_one_value', 'secret_two_value']
      const text = 'Key1=secret_one_value Key2=secret_two_value'
      const result = redactSecrets(text, secrets)
      assert.equal(result, 'Key1=[REDACTED] Key2=[REDACTED]')
    })
  })

  describe('buildCredentialEnv', () => {
    it('returns empty env for empty credential list', () => {
      const result = buildCredentialEnv([])
      assert.deepEqual(result, { env: {}, secrets: [] })
    })

    it('handles non-existent credential IDs gracefully', () => {
      const result = buildCredentialEnv(['nonexistent-id'])
      assert.deepEqual(result, { env: {}, secrets: [] })
    })
  })
})

test('buildExecuteTools uses the current agent executeConfig backend', () => {
  const output = runWithTempDataDir<{
    hostOutput: string
    sandboxOutput: string
  }>(`
    const storageMod = await import('@/lib/server/storage')
    const executeModImport = await import('./src/lib/server/session-tools/execute.ts')
    const executeMod = executeModImport.default || executeModImport
    const storage = storageMod.default || storageMod
    const now = Date.now()

    storage.saveAgents({
      'agent-host': {
        id: 'agent-host',
        name: 'Host Agent',
        provider: 'openai',
        model: 'gpt-test',
        executeConfig: { backend: 'host', network: { enabled: true }, timeout: 30 },
        createdAt: now,
        updatedAt: now,
      },
      'agent-sandbox': {
        id: 'agent-sandbox',
        name: 'Sandbox Agent',
        provider: 'openai',
        model: 'gpt-test',
        createdAt: now,
        updatedAt: now,
      },
    })

    const makeContext = (agentId) => ({
      cwd: process.cwd(),
      ctx: { agentId, sessionId: 'session-' + agentId },
      hasExtension: (name) => name === 'execute',
      hasTool: (name) => name === 'execute',
      cleanupFns: [],
      commandTimeoutMs: 30000,
      claudeTimeoutMs: 30000,
      cliProcessTimeoutMs: 30000,
      persistDelegateResumeId: () => {},
      readStoredDelegateResumeId: () => null,
      resolveCurrentSession: () => ({ id: 'session-' + agentId, agentId }),
      activeExtensions: ['execute'],
      agentRecord: storage.loadAgent(agentId),
    })

    const hostTool = executeMod.buildExecuteTools(makeContext('agent-host'))[0]
    const sandboxTool = executeMod.buildExecuteTools(makeContext('agent-sandbox'))[0]
    const hostOutput = await hostTool.invoke({ code: 'printf host-ok', persistent: true })
    const sandboxOutput = await sandboxTool.invoke({ code: 'printf sandbox-no', persistent: true })

    console.log(JSON.stringify({ hostOutput, sandboxOutput }))
  `)

  assert.equal(output.hostOutput, 'host-ok')
  assert.match(output.sandboxOutput, /requires `executeConfig\.backend = "host"`/)
})
