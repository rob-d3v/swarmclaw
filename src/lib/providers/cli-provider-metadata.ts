import type { ProviderType } from '../../types/provider.ts'

export type CliAuthBackend =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'gemini'
  | 'copilot'
  | 'droid'
  | 'cursor'
  | 'qwen'
  | 'goose'

export interface CliProviderMetadata {
  id: ProviderType
  displayName: string
  binaryName: string
  capability: string
  description: string
  defaultModel: string
  icon: string
  setupBadge: string
  generic: boolean
  optionalApiKey?: boolean
  authBackend?: CliAuthBackend
  keyUrl?: string
  keyLabel?: string
  keyPlaceholder?: string
  modelLibraryUrl?: string
}

export const BESPOKE_CLI_PROVIDER_METADATA = [
  {
    id: 'claude-cli',
    displayName: 'Claude Code CLI',
    binaryName: 'claude',
    capability: 'multi-file code editing, refactoring, debugging, code review',
    description: "Anthropic's coding agent with native tools, strong edits, and first-class CLI workflows.",
    defaultModel: 'claude-sonnet-4-6',
    icon: 'C',
    setupBadge: 'CLI',
    generic: false,
    authBackend: 'claude',
    modelLibraryUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
  },
  {
    id: 'codex-cli',
    displayName: 'OpenAI Codex CLI',
    binaryName: 'codex',
    capability: 'code generation, file creation, automated coding tasks',
    description: "OpenAI's terminal coding agent with resume support and structured headless output.",
    defaultModel: 'gpt-5.4-codex',
    icon: 'O',
    setupBadge: 'CLI',
    generic: false,
    authBackend: 'codex',
    modelLibraryUrl: 'https://platform.openai.com/docs/models',
  },
  {
    id: 'opencode-cli',
    displayName: 'OpenCode CLI',
    binaryName: 'opencode',
    capability: 'code analysis, generation across multiple LLM backends',
    description: 'A flexible coding CLI that can route across multiple model backends.',
    defaultModel: 'claude-sonnet-4-6',
    icon: 'O',
    setupBadge: 'CLI',
    generic: false,
    authBackend: 'opencode',
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    binaryName: 'gemini',
    capability: 'code generation, analysis with Gemini models',
    description: "Google's terminal coding agent with project-aware headless mode and resume support.",
    defaultModel: 'gemini-3.1-pro',
    icon: 'G',
    setupBadge: 'CLI',
    generic: false,
    authBackend: 'gemini',
    modelLibraryUrl: 'https://ai.google.dev/gemini-api/docs/models',
  },
  {
    id: 'copilot-cli',
    displayName: 'GitHub Copilot CLI',
    binaryName: 'copilot',
    capability: 'code generation, analysis, multi-model support via GitHub Copilot',
    description: "GitHub's multi-model terminal agent for coding and automation.",
    defaultModel: 'claude-sonnet-4-6',
    icon: 'P',
    setupBadge: 'CLI',
    generic: false,
    authBackend: 'copilot',
  },
  {
    id: 'droid-cli',
    displayName: 'Factory Droid CLI',
    binaryName: 'droid',
    capability: 'code generation, refactoring, and automation via Factory Droid with configurable autonomy',
    description: "Factory.ai's terminal coding agent with headless exec mode, session resume, and autonomy controls.",
    defaultModel: 'default',
    icon: 'F',
    setupBadge: 'CLI',
    generic: false,
    optionalApiKey: true,
    authBackend: 'droid',
    keyUrl: 'https://app.factory.ai/settings/api-keys',
    keyLabel: 'app.factory.ai',
    keyPlaceholder: 'FACTORY_API_KEY (optional if signed in via `droid`)',
  },
  {
    id: 'cursor-cli',
    displayName: 'Cursor Agent CLI',
    binaryName: 'cursor-agent',
    capability: 'full-agent coding workflows, multi-file edits, project-aware code changes',
    description: "Cursor's terminal agent with resume support, JSON output, and Cursor-native coding workflows.",
    defaultModel: 'auto',
    icon: 'U',
    setupBadge: 'CLI',
    generic: false,
    authBackend: 'cursor',
  },
  {
    id: 'qwen-code-cli',
    displayName: 'Qwen Code CLI',
    binaryName: 'qwen',
    capability: 'terminal-native coding workflows, code generation, review, and automation',
    description: "Qwen's terminal coding agent with structured headless mode and multi-provider model config.",
    defaultModel: 'default',
    icon: 'Q',
    setupBadge: 'CLI',
    generic: false,
    authBackend: 'qwen',
  },
  {
    id: 'goose',
    displayName: 'Goose',
    binaryName: 'goose',
    capability: 'agentic coding workflows with extensions, tools, and runtime-managed execution',
    description: 'A runtime-managed terminal agent with extensions, session history, and ACP support.',
    defaultModel: 'default',
    icon: 'G',
    setupBadge: 'Runtime',
    generic: false,
    optionalApiKey: true,
    authBackend: 'goose',
  },
] as const satisfies readonly CliProviderMetadata[]

export const GENERIC_CLI_PROVIDER_METADATA = [
  ['aider-cli', 'Aider CLI', 'aider', 'paired-programming-style multi-file edits and git-aware code changes'],
  ['amp-cli', 'Amp CLI', 'amp', 'agentic coding via Sourcegraph Amp'],
  ['augment-cli', 'Augment CLI', 'augment', 'codebase-aware agentic edits via Augment'],
  ['adal-cli', 'AdaL CLI', 'adal', 'AdaL coding agent for terminal-driven workflows'],
  ['bob-cli', 'IBM Bob CLI', 'bob', 'IBM watsonx Code Assistant terminal coding workflows'],
  ['cline-cli', 'Cline CLI', 'cline', 'autonomous file-level edits and terminal automation via Cline'],
  ['codebuddy-cli', 'CodeBuddy CLI', 'codebuddy', 'CodeBuddy agentic coding workflows'],
  ['command-code-cli', 'Command Code CLI', 'commandcode', 'Command Code terminal-native coding agent'],
  ['continue-cli', 'Continue CLI', 'continue', 'agentic coding via the Continue CLI'],
  ['cortex-cli', 'Cortex Code CLI', 'cortex', 'Snowflake Cortex Code agentic workflows'],
  ['crush-cli', 'Crush CLI', 'crush', 'Crush terminal coding agent'],
  ['deepagents-cli', 'Deep Agents CLI', 'deepagents', 'long-horizon planning and multi-step coding via Deep Agents'],
  ['firebender-cli', 'Firebender CLI', 'firebender', 'Firebender JetBrains-aligned coding agent'],
  ['iflow-cli', 'iFlow CLI', 'iflow', 'iFlow CLI agentic coding workflows'],
  ['junie-cli', 'Junie CLI', 'junie', 'JetBrains Junie coding agent for terminal use'],
  ['kilo-code-cli', 'Kilo Code CLI', 'kilocode', 'Kilo Code agentic coding workflows'],
  ['kimi-cli', 'Kimi CLI', 'kimi', 'Kimi Code CLI coding agent'],
  ['kode-cli', 'Kode CLI', 'kode', 'Kode terminal coding agent'],
  ['mcpjam-cli', 'MCPJam CLI', 'mcpjam', 'MCPJam-tooled agentic coding workflows'],
  ['mistral-vibe-cli', 'Mistral Vibe CLI', 'vibe', 'Mistral Vibe coding agent'],
  ['mux-cli', 'Mux CLI', 'mux', 'Mux multi-tool coding agent'],
  ['neovate-cli', 'Neovate CLI', 'neovate', 'Neovate coding agent for terminal workflows'],
  ['openhands-cli', 'OpenHands CLI', 'openhands', 'OpenHands agentic coding via terminal'],
  ['pochi-cli', 'Pochi CLI', 'pochi', 'Pochi coding agent'],
  ['qoder-cli', 'Qoder CLI', 'qoder', 'Qoder agentic coding workflows'],
  ['replit-cli', 'Replit Agent CLI', 'replit', 'Replit Agent terminal coding workflows'],
  ['roo-code-cli', 'Roo Code CLI', 'roo', 'Roo Code agentic coding workflows'],
  ['trae-cn-cli', 'TRAE CN CLI', 'trae-cn', 'TRAE CN coding agent'],
  ['warp-cli', 'Warp Agent CLI', 'warp', 'Warp Agent terminal-native coding workflows'],
  ['windsurf-cli', 'Windsurf CLI', 'windsurf', 'Windsurf agentic coding workflows'],
  ['zencoder-cli', 'Zencoder CLI', 'zencoder', 'Zencoder agentic coding workflows'],
].map(([id, displayName, binaryName, capability]) => ({
  id: id as ProviderType,
  displayName,
  binaryName,
  capability,
  description: `${displayName}: ${capability}.`,
  defaultModel: 'default',
  icon: displayName.charAt(0),
  setupBadge: 'CLI',
  generic: true,
  optionalApiKey: true,
})) satisfies readonly CliProviderMetadata[]

export const CLI_PROVIDER_METADATA = [
  ...BESPOKE_CLI_PROVIDER_METADATA,
  ...GENERIC_CLI_PROVIDER_METADATA,
] as const satisfies readonly CliProviderMetadata[]

export type CliProviderId = (typeof CLI_PROVIDER_METADATA)[number]['id']

export const CLI_PROVIDER_METADATA_BY_ID: Record<string, CliProviderMetadata> =
  Object.fromEntries(CLI_PROVIDER_METADATA.map((provider) => [provider.id, provider]))

export function isCliProviderId(providerId: string): providerId is CliProviderId {
  return providerId in CLI_PROVIDER_METADATA_BY_ID
}
