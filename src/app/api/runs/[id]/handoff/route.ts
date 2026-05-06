import { NextResponse } from 'next/server'
import { listEvidenceArtifacts } from '@/lib/server/artifacts/artifact-resolver'
import { buildRunBrief } from '@/lib/server/runs/run-brief'
import { buildRunHandoffPacket, formatRunHandoffMarkdown } from '@/lib/server/runs/run-handoff'
import { getUnifiedRunById, listUnifiedRunEvents } from '@/lib/server/runs/unified-run-queries'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = getUnifiedRunById(id)
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const events = listUnifiedRunEvents(id, 300)
  const brief = buildRunBrief(run, events)
  const packet = buildRunHandoffPacket(run, brief, listEvidenceArtifacts({ runId: id }))
  const url = new URL(req.url)

  if (url.searchParams.get('format') === 'markdown') {
    return new NextResponse(formatRunHandoffMarkdown(packet), {
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
    })
  }

  return NextResponse.json(packet)
}
