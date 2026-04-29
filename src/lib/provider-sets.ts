import { CLI_PROVIDER_METADATA } from '@/lib/providers/cli-provider-metadata'

const CLI_PROVIDER_IDS = CLI_PROVIDER_METADATA.map((provider) => provider.id)
const DIRECT_CLI_PROVIDER_IDS = CLI_PROVIDER_IDS.filter((providerId) => providerId !== 'goose')

/** CLI providers that use their own tool execution outside the shared tool-runtime path. */
export const NON_LANGGRAPH_PROVIDER_IDS = new Set([...DIRECT_CLI_PROVIDER_IDS, 'opencode-web'])

/** Providers that manage their own runtime/tool loop even when reached over an API endpoint. */
export const RUNTIME_MANAGED_PROVIDER_IDS = new Set(['hermes', 'goose'])

/** Providers with native tool/capability support (CLI providers + OpenClaw + Hermes). */
export const NATIVE_CAPABILITY_PROVIDER_IDS = new Set([...CLI_PROVIDER_IDS, 'openclaw', 'hermes'])

/** Providers that can only act as workers — no coordinator role, no heartbeat, no advanced settings. */
export const WORKER_ONLY_PROVIDER_IDS = new Set([...CLI_PROVIDER_IDS, 'openclaw', 'hermes'])

/** CLI providers that support MCP server and skill injection at runtime (via provider-specific config mechanisms). */
export const MCP_INJECTION_PROVIDER_IDS = new Set(['copilot-cli', 'codex-cli'])
