import {
  isShareLinkActive,
  loadShareLinkByToken,
} from '@/lib/server/sharing/share-link-repository'
import { resolveSharedEntity } from '@/lib/server/sharing/share-resolver'

export const dynamic = 'force-dynamic'

/**
 * Public raw-content endpoint for shared entities. Skills return markdown so
 * a second SwarmClaw instance can install via `POST /api/skills/import`
 * without any auth handshake. Missions and sessions return plain-text
 * summaries sized for quick sharing.
 *
 * Returns 404 for missing, expired, or revoked tokens to avoid leaking
 * shape information to a probe.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const link = loadShareLinkByToken(token)
  if (!link || !isShareLinkActive(link)) {
    return new Response('Not found', { status: 404 })
  }
  const payload = resolveSharedEntity(link)
  if (!payload) {
    return new Response('Not found', { status: 404 })
  }

  if (payload.kind === 'skill') {
    return new Response(payload.content, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'public, max-age=60',
        'x-skill-name': encodeURIComponent(payload.name),
      },
    })
  }

  if (payload.kind === 'mission') {
    const lines: string[] = []
    lines.push(`# ${payload.title}`, '')
    if (payload.goal) lines.push(payload.goal, '')
    if (payload.successCriteria.length > 0) {
      lines.push('## Success criteria', '')
      for (const c of payload.successCriteria) lines.push(`- ${c}`)
      lines.push('')
    }
    if (payload.milestones.length > 0) {
      lines.push('## Milestones', '')
      for (const m of payload.milestones) {
        lines.push(`- ${new Date(m.at).toISOString().slice(0, 19).replace('T', ' ')}: ${m.summary}`)
      }
      lines.push('')
    }
    return new Response(lines.join('\n'), {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'public, max-age=60',
      },
    })
  }

  // session
  const lines: string[] = []
  lines.push(`# ${payload.name}`, '')
  if (payload.agentName) lines.push(`Agent: ${payload.agentName}`, '')
  for (const m of payload.messages) {
    lines.push(`### ${m.role}`, '', m.text, '')
  }
  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  })
}
