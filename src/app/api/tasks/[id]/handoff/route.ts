import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { buildTaskHandoffPacket, formatTaskHandoffMarkdown } from '@/lib/server/tasks/task-handoff'
import { prepareTaskExecutionWorkspace } from '@/lib/server/tasks/task-execution-workspace'
import { loadTasks, saveTask } from '@/lib/server/tasks/task-repository'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tasks = loadTasks()
  const task = tasks[id]
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const packet = buildTaskHandoffPacket(task, tasks)
  const { searchParams } = new URL(req.url)
  if (searchParams.get('format') === 'markdown') {
    return new Response(formatTaskHandoffMarkdown(packet), {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
      },
    })
  }

  return NextResponse.json(packet)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tasks = loadTasks()
  const task = tasks[id]
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  let body: Record<string, unknown> = {}
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    body = {}
  }

  if (!task.executionWorkspace || body.prepareWorkspace !== false) {
    Object.assign(task, prepareTaskExecutionWorkspace(task, {
      now: Date.now(),
      actor: 'user',
      tasks,
    }))
    task.updatedAt = Date.now()
    tasks[id] = task
    saveTask(id, task)
  }

  const workspacePath = task.executionWorkspace?.path
  if (!workspacePath) {
    return NextResponse.json({ error: 'Task workspace is not available' }, { status: 409 })
  }

  fs.mkdirSync(workspacePath, { recursive: true })
  const packet = buildTaskHandoffPacket(task, tasks)
  const markdown = formatTaskHandoffMarkdown(packet)
  const markdownPath = path.join(workspacePath, 'handoff.md')
  const jsonPath = path.join(workspacePath, 'handoff.json')
  fs.writeFileSync(markdownPath, markdown, 'utf8')
  fs.writeFileSync(jsonPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8')

  return NextResponse.json({
    packet,
    files: {
      markdownPath,
      jsonPath,
    },
  })
}
