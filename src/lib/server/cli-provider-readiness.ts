import {
  CLI_PROVIDER_METADATA_BY_ID,
  isCliProviderId,
  type CliAuthBackend,
  type CliProviderMetadata,
} from '@/lib/providers/cli-provider-metadata'
import { buildCliEnv, probeCliAuth, resolveCliBinary, type AuthProbeResult } from '@/lib/providers/cli-utils'

export interface CliProviderReadyResult {
  ok: boolean
  message: string
  providerId?: string
  displayName?: string
  binaryName?: string
  binaryPath?: string
  generic?: boolean
}

interface CheckCliProviderReadyOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  resolveBinary?: (name: string) => string | null
  probeAuth?: (
    binary: string,
    backend: CliAuthBackend,
    env: NodeJS.ProcessEnv,
    cwd?: string,
  ) => AuthProbeResult
}

function missingBinaryMessage(meta: CliProviderMetadata): string {
  return `${meta.displayName} is not installed. Install \`${meta.binaryName}\` and ensure it is on your PATH.`
}

export function checkCliProviderReady(
  providerId: string,
  options: CheckCliProviderReadyOptions = {},
): CliProviderReadyResult {
  if (!isCliProviderId(providerId)) {
    return { ok: false, message: 'Unknown CLI provider.', providerId }
  }

  const meta = CLI_PROVIDER_METADATA_BY_ID[providerId]
  const resolveBinary = options.resolveBinary || resolveCliBinary
  const binaryPath = resolveBinary(meta.binaryName)
  if (!binaryPath) {
    return {
      ok: false,
      message: missingBinaryMessage(meta),
      providerId,
      displayName: meta.displayName,
      binaryName: meta.binaryName,
      generic: meta.generic,
    }
  }

  if (meta.authBackend) {
    const env = options.env || buildCliEnv()
    const auth = (options.probeAuth || probeCliAuth)(binaryPath, meta.authBackend, env, options.cwd || process.cwd())
    if (!auth.authenticated) {
      return {
        ok: false,
        message: auth.errorMessage || `${meta.displayName} is not configured.`,
        providerId,
        displayName: meta.displayName,
        binaryName: meta.binaryName,
        binaryPath,
        generic: meta.generic,
      }
    }
  }

  return {
    ok: true,
    message: meta.authBackend
      ? `${meta.displayName} is installed and ready.`
      : `${meta.displayName} binary is available. If it requires account setup, complete that in \`${meta.binaryName}\` before running agent turns.`,
    providerId,
    displayName: meta.displayName,
    binaryName: meta.binaryName,
    binaryPath,
    generic: meta.generic,
  }
}
