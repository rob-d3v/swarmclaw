import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  isStderrNoise,
  buildCliEnv,
  isCliProvider,
  CLI_PROVIDER_CAPABILITIES,
  resolveCodexProbeInvocation,
  ensureCliWorkingDirectory,
} from './cli-utils'

// ---------------------------------------------------------------------------
// isStderrNoise
// ---------------------------------------------------------------------------

describe('isStderrNoise', () => {
  it('returns true for MallocStackLogging lines', () => {
    assert.equal(isStderrNoise('MallocStackLogging: could not tag MSL'), true)
  })

  it('returns true for blank/whitespace lines', () => {
    assert.equal(isStderrNoise(''), true)
    assert.equal(isStderrNoise('   '), true)
    assert.equal(isStderrNoise('\t'), true)
  })

  it('returns false for real error text', () => {
    assert.equal(isStderrNoise('Error: connection refused'), false)
    assert.equal(isStderrNoise('FATAL: segfault'), false)
    assert.equal(isStderrNoise('Permission denied'), false)
  })
})

// ---------------------------------------------------------------------------
// buildCliEnv
// ---------------------------------------------------------------------------

describe('buildCliEnv', () => {
  it('strips SWARMCLAW_ prefixed vars from env', () => {
    const orig = process.env.SWARMCLAW_TEST_VAR
    process.env.SWARMCLAW_TEST_VAR = 'should_be_stripped'
    try {
      const env = buildCliEnv()
      assert.equal(env.SWARMCLAW_TEST_VAR, undefined)
    } finally {
      if (orig === undefined) delete process.env.SWARMCLAW_TEST_VAR
      else process.env.SWARMCLAW_TEST_VAR = orig
    }
  })

  it('deletes MallocStackLogging', () => {
    const orig = process.env.MallocStackLogging
    process.env.MallocStackLogging = '1'
    try {
      const env = buildCliEnv()
      assert.equal(env.MallocStackLogging, undefined)
    } finally {
      if (orig === undefined) delete process.env.MallocStackLogging
      else process.env.MallocStackLogging = orig
    }
  })

  it('injects provided key-value pairs', () => {
    const env = buildCliEnv({ inject: { MY_CUSTOM_KEY: 'hello' } })
    assert.equal(env.MY_CUSTOM_KEY, 'hello')
  })

  it('preserves unrelated user env vars', () => {
    const env = buildCliEnv()
    assert.equal(env.PATH, process.env.PATH)
  })

  it('supports custom stripPrefixes', () => {
    const orig = process.env.CUSTOM_PREFIX_VAR
    process.env.CUSTOM_PREFIX_VAR = 'should_be_stripped'
    try {
      const env = buildCliEnv({ stripPrefixes: ['CUSTOM_PREFIX_'] })
      assert.equal(env.CUSTOM_PREFIX_VAR, undefined)
    } finally {
      if (orig === undefined) delete process.env.CUSTOM_PREFIX_VAR
      else process.env.CUSTOM_PREFIX_VAR = orig
    }
  })

  it('sets TERM=dumb and NO_COLOR=1', () => {
    const env = buildCliEnv()
    assert.equal(env.TERM, 'dumb')
    assert.equal(env.NO_COLOR, '1')
  })
})

// ---------------------------------------------------------------------------
// isCliProvider
// ---------------------------------------------------------------------------

describe('isCliProvider', () => {
  it('returns true for known CLI providers', () => {
    assert.equal(isCliProvider('claude-cli'), true)
    assert.equal(isCliProvider('codex-cli'), true)
    assert.equal(isCliProvider('opencode-cli'), true)
    assert.equal(isCliProvider('gemini-cli'), true)
    assert.equal(isCliProvider('copilot-cli'), true)
    assert.equal(isCliProvider('droid-cli'), true)
    assert.equal(isCliProvider('cursor-cli'), true)
    assert.equal(isCliProvider('qwen-code-cli'), true)
    assert.equal(isCliProvider('goose'), true)
  })

  it('returns false for non-CLI providers', () => {
    assert.equal(isCliProvider('openai'), false)
    assert.equal(isCliProvider('anthropic'), false)
    assert.equal(isCliProvider(''), false)
    assert.equal(isCliProvider('google'), false)
  })
})

// ---------------------------------------------------------------------------
// CLI_PROVIDER_CAPABILITIES
// ---------------------------------------------------------------------------

describe('CLI_PROVIDER_CAPABILITIES', () => {
  it('has entries for all supported local CLI-backed providers', () => {
    assert.ok('claude-cli' in CLI_PROVIDER_CAPABILITIES)
    assert.ok('codex-cli' in CLI_PROVIDER_CAPABILITIES)
    assert.ok('opencode-cli' in CLI_PROVIDER_CAPABILITIES)
    assert.ok('gemini-cli' in CLI_PROVIDER_CAPABILITIES)
    assert.ok('copilot-cli' in CLI_PROVIDER_CAPABILITIES)
    assert.ok('droid-cli' in CLI_PROVIDER_CAPABILITIES)
    assert.ok('cursor-cli' in CLI_PROVIDER_CAPABILITIES)
    assert.ok('qwen-code-cli' in CLI_PROVIDER_CAPABILITIES)
    assert.ok('goose' in CLI_PROVIDER_CAPABILITIES)
  })

  it('each entry is a non-empty string', () => {
    for (const [key, value] of Object.entries(CLI_PROVIDER_CAPABILITIES)) {
      assert.equal(typeof value, 'string', `${key} should be a string`)
      assert.ok(value.length > 0, `${key} should be non-empty`)
    }
  })
})

// ---------------------------------------------------------------------------
// resolveCodexProbeInvocation
// ---------------------------------------------------------------------------

describe('resolveCodexProbeInvocation', () => {
  it('uses node directly for codex JS wrappers discovered through a symlink', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-codex-probe-'))
    try {
      const realScript = path.join(tmpRoot, 'codex.js')
      fs.writeFileSync(realScript, '#!/usr/bin/env node\nconsole.log("ok")\n')
      fs.chmodSync(realScript, 0o755)

      const wrapperPath = path.join(tmpRoot, 'codex')
      fs.symlinkSync(realScript, wrapperPath)

      const invocation = resolveCodexProbeInvocation(wrapperPath)
      assert.equal(invocation.command, process.execPath)
      assert.deepEqual(invocation.args, [realScript, 'login', 'status'])
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('uses the binary directly for non-JS executables', () => {
    const invocation = resolveCodexProbeInvocation('/usr/local/bin/codex-bin')
    assert.equal(invocation.command, '/usr/local/bin/codex-bin')
    assert.deepEqual(invocation.args, ['login', 'status'])
  })
})

// ---------------------------------------------------------------------------
// ensureCliWorkingDirectory
// ---------------------------------------------------------------------------

describe('ensureCliWorkingDirectory', () => {
  it('creates a missing working directory recursively', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-cli-cwd-'))
    const target = path.join(tmpRoot, 'nested', 'room')
    try {
      assert.equal(fs.existsSync(target), false)
      const resolved = ensureCliWorkingDirectory(target)
      assert.equal(resolved, target)
      assert.equal(fs.existsSync(target), true)
      assert.equal(fs.statSync(target).isDirectory(), true)
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('falls back to process.cwd when cwd is blank', () => {
    assert.equal(ensureCliWorkingDirectory(''), process.cwd())
  })
})
