import { NextResponse } from 'next/server'
import { safeParseBody } from '@/lib/server/safe-parse-body'
import { previewScheduleFromRoute } from '@/lib/server/schedules/schedule-route-service'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { data: body, error } = await safeParseBody(req)
  if (error) return error
  const result = previewScheduleFromRoute((body || {}) as Record<string, unknown>)
  return result.ok
    ? NextResponse.json(result.payload)
    : NextResponse.json(result.payload, { status: result.status })
}
