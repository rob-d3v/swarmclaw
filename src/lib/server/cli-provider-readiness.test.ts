import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { checkCliProviderReady } from './cli-provider-readiness'

describe('checkCliProviderReady', () => {
  it('accepts a generic CLI provider when its binary is present', () => {
    const result = checkCliProviderReady('aider-cli', {
      resolveBinary: (name) => name === 'aider' ? '/usr/local/bin/aider' : null,
    })

    assert.equal(result.ok, true)
    assert.equal(result.displayName, 'Aider CLI')
    assert.equal(result.binaryName, 'aider')
    assert.equal(result.generic, true)
    assert.match(result.message, /binary is available/)
  })

  it('reports a missing generic CLI binary with install guidance', () => {
    const result = checkCliProviderReady('windsurf-cli', {
      resolveBinary: () => null,
    })

    assert.equal(result.ok, false)
    assert.equal(result.displayName, 'Windsurf CLI')
    assert.equal(result.binaryName, 'windsurf')
    assert.match(result.message, /Install `windsurf`/)
  })

  it('keeps auth-aware checks for bespoke CLI providers', () => {
    const result = checkCliProviderReady('claude-cli', {
      resolveBinary: () => '/usr/local/bin/claude',
      env: { ...process.env },
      probeAuth: () => ({
        authenticated: false,
        errorMessage: 'Claude CLI is not authenticated.',
      }),
    })

    assert.equal(result.ok, false)
    assert.equal(result.displayName, 'Claude Code CLI')
    assert.equal(result.generic, false)
    assert.equal(result.message, 'Claude CLI is not authenticated.')
  })
})
