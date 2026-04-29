import { spawn } from 'child_process'
import type { StreamChatOptions } from './index'
import { log } from '../server/logger'
import { loadRuntimeSettings } from '@/lib/server/runtime/runtime-settings'
import { GENERIC_CLI_PROVIDER_METADATA } from './cli-provider-metadata'
import { resolveCliBinary, buildCliEnv, attachAbortHandler, isStderrNoise } from './cli-utils'

/**
 * Map of swarmclaw provider id to the binary name we look up on PATH.
 * Used by the generic CLI streamer for tools without a bespoke handler.
 */
export const GENERIC_CLI_BINARIES: Record<string, string> = {
  ...Object.fromEntries(GENERIC_CLI_PROVIDER_METADATA.map((provider) => [provider.id, provider.binaryName])),
}

interface GenericCliOptions extends StreamChatOptions {
  binaryName: string
  displayName: string
}

/**
 * Generic streamer for CLI providers without a bespoke stream parser.
 *
 * Spawns the configured binary with the prompt as the final argv, captures
 * stdout/stderr line-by-line, and emits each line as a delta. No JSON event
 * parsing — callers that need structured event streams should use a tool-
 * specific provider instead.
 */
export function streamGenericCliChat(opts: GenericCliOptions): Promise<string> {
  const { session, message, systemPrompt, write, active, signal, binaryName, displayName } = opts
  const processTimeoutMs = loadRuntimeSettings().cliProcessTimeoutMs
  const binary = resolveCliBinary(binaryName)
  if (!binary) {
    const msg = `${displayName} not found. Install \`${binaryName}\` and ensure it is on your PATH, or remove this provider.`
    write(`data: ${JSON.stringify({ t: 'err', text: msg })}\n\n`)
    return Promise.resolve('')
  }

  const env = buildCliEnv()
  const prompt = systemPrompt ? `[System instructions]\n${systemPrompt}\n\n${message}` : message

  log.info('generic-cli', `Spawning: ${binary}`, {
    binaryName,
    cwd: session.cwd,
    hasSystemPrompt: Boolean(systemPrompt),
    promptLength: prompt.length,
  })

  const proc = spawn(binary, [prompt], {
    cwd: session.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: processTimeoutMs,
  })

  active.set(session.id, proc)
  attachAbortHandler(proc, signal)

  let fullResponse = ''
  let buf = ''
  let stderrText = ''

  proc.stdout?.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line) continue
      fullResponse += `${line}\n`
      write(`data: ${JSON.stringify({ t: 'd', text: `${line}\n` })}\n\n`)
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderrText += text
    if (stderrText.length > 16_000) stderrText = stderrText.slice(-16_000)
    if (isStderrNoise(text)) {
      log.debug('generic-cli', `stderr noise [${binaryName}/${session.id}]`, text.slice(0, 400))
    } else {
      log.warn('generic-cli', `stderr [${binaryName}/${session.id}]`, text.slice(0, 400))
    }
  })

  return new Promise((resolve) => {
    proc.on('close', (code, sig) => {
      active.delete(session.id)
      if (buf) {
        fullResponse += buf
        write(`data: ${JSON.stringify({ t: 'd', text: buf })}\n\n`)
        buf = ''
      }
      if ((code ?? 0) !== 0 && !fullResponse.trim()) {
        const msg = stderrText.trim()
          ? `${displayName} exited with code ${code ?? 'unknown'}${sig ? ` (${sig})` : ''}: ${stderrText.trim().slice(0, 1200)}`
          : `${displayName} exited with code ${code ?? 'unknown'}${sig ? ` (${sig})` : ''} and returned no output.`
        write(`data: ${JSON.stringify({ t: 'err', text: msg })}\n\n`)
      }
      log.info('generic-cli', `Process closed [${binaryName}]: code=${code} signal=${sig} response=${fullResponse.length}chars`)
      resolve(fullResponse.trim())
    })

    proc.on('error', (err) => {
      active.delete(session.id)
      write(`data: ${JSON.stringify({ t: 'err', text: err.message })}\n\n`)
      resolve(fullResponse.trim())
    })
  })
}
