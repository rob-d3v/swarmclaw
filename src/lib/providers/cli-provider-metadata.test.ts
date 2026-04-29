import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  BESPOKE_CLI_PROVIDER_METADATA,
  CLI_PROVIDER_METADATA,
  CLI_PROVIDER_METADATA_BY_ID,
  GENERIC_CLI_PROVIDER_METADATA,
  isCliProviderId,
} from './cli-provider-metadata'
import { GENERIC_CLI_BINARIES } from './generic-cli'
import { CLI_PROVIDER_CAPABILITIES } from './cli-utils'

describe('CLI provider metadata', () => {
  it('has one unique entry per CLI provider', () => {
    const ids = CLI_PROVIDER_METADATA.map((provider) => provider.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(BESPOKE_CLI_PROVIDER_METADATA.length > 0)
    assert.equal(GENERIC_CLI_PROVIDER_METADATA.length, 31)
  })

  it('drives binary and capability maps for every provider', () => {
    for (const provider of CLI_PROVIDER_METADATA) {
      assert.equal(CLI_PROVIDER_METADATA_BY_ID[provider.id]?.displayName, provider.displayName)
      assert.equal(isCliProviderId(provider.id), true)
      assert.equal(CLI_PROVIDER_CAPABILITIES[provider.id], provider.capability)
      assert.ok(provider.binaryName.length > 0)
      assert.ok(provider.defaultModel.length > 0)
    }
  })

  it('keeps generic CLI binary mappings sourced from metadata', () => {
    assert.deepEqual(
      Object.fromEntries(GENERIC_CLI_PROVIDER_METADATA.map((provider) => [provider.id, provider.binaryName])),
      GENERIC_CLI_BINARIES,
    )
  })
})
