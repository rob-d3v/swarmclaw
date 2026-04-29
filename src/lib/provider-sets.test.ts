import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { GENERIC_CLI_PROVIDER_METADATA } from './providers/cli-provider-metadata'
import {
  NATIVE_CAPABILITY_PROVIDER_IDS,
  NON_LANGGRAPH_PROVIDER_IDS,
  WORKER_ONLY_PROVIDER_IDS,
} from './provider-sets'

describe('provider sets', () => {
  it('routes generic CLI providers through direct provider runtime', () => {
    for (const provider of GENERIC_CLI_PROVIDER_METADATA) {
      assert.equal(NON_LANGGRAPH_PROVIDER_IDS.has(provider.id), true, `${provider.id} should bypass LangGraph`)
      assert.equal(NATIVE_CAPABILITY_PROVIDER_IDS.has(provider.id), true, `${provider.id} should be native-capability`)
      assert.equal(WORKER_ONLY_PROVIDER_IDS.has(provider.id), true, `${provider.id} should be worker-only`)
    }
  })
})
