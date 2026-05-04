import assert from 'node:assert/strict'
import test from 'node:test'

import { AIMessage } from '@langchain/core/messages'
import { streamOpenAiChat } from './openai'
import {
  attachReasoningContentToCompletionsMessages,
  getReasoningContentFromLangChainMessage,
} from './deepseek-reasoning-chat-openai'

function sseChunk(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`
}

function parseSseEvents(frames: string[]) {
  return frames
    .flatMap((frame) => frame.trim().split('\n\n'))
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data: /, '')) as { t: string; text?: string })
}

test('OpenAI-compatible reasoning deltas stream as thinking instead of visible text', async () => {
  const originalFetch = globalThis.fetch
  const encoded = new TextEncoder()
  const frames = [
    sseChunk({ choices: [{ delta: { reasoning_content: 'internal reasoning ' } }] }),
    sseChunk({ choices: [{ delta: { content: 'visible answer' } }] }),
    'data: [DONE]\n\n',
  ]
  const writes: string[] = []

  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoded.encode(frame))
      controller.close()
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })

  try {
    const result = await streamOpenAiChat({
      session: { id: 'session-1', provider: 'openai', model: 'test-model' },
      message: 'hello',
      write: (data) => writes.push(data),
      active: new Map(),
      loadHistory: () => [],
    } as Parameters<typeof streamOpenAiChat>[0])

    assert.equal(result, 'visible answer')
    const events = parseSseEvents(writes)
    assert.deepEqual(events, [
      { t: 'thinking', text: 'internal reasoning ' },
      { t: 'md', text: JSON.stringify({ reasoningContentDelta: 'internal reasoning ' }) },
      { t: 'd', text: 'visible answer' },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('OpenAI-compatible DeepSeek history replays stored assistant reasoning_content', async () => {
  const originalFetch = globalThis.fetch
  const encoded = new TextEncoder()
  const frames = [
    sseChunk({ choices: [{ delta: { content: 'next answer' } }] }),
    'data: [DONE]\n\n',
  ]
  const writes: string[] = []
  const capture: { requestBody?: { messages?: Array<Record<string, unknown>> } } = {}

  globalThis.fetch = async (_url, init) => {
    capture.requestBody = JSON.parse(String(init?.body || '{}')) as { messages?: Array<Record<string, unknown>> }
    return new Response(new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoded.encode(frame))
        controller.close()
      },
    }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  try {
    await streamOpenAiChat({
      session: {
        id: 'session-1',
        provider: 'deepseek',
        model: 'deepseek-reasoner',
        apiEndpoint: 'https://api.deepseek.com/v1',
      },
      message: 'next',
      write: (data) => writes.push(data),
      active: new Map(),
      loadHistory: () => [{
        role: 'assistant',
        text: 'visible answer',
        reasoningContent: 'hidden chain',
      }],
    } as Parameters<typeof streamOpenAiChat>[0])

    const messages = capture.requestBody?.messages
    assert.deepEqual(messages, [
      { role: 'assistant', content: 'visible answer', reasoning_content: 'hidden chain' },
      { role: 'user', content: 'next' },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('DeepSeek reasoning helper preserves native reasoning for LangChain replay', () => {
  const assistant = new AIMessage({
    content: 'visible answer',
    additional_kwargs: { reasoning_content: 'hidden chain' },
  })

  assert.equal(getReasoningContentFromLangChainMessage(assistant), 'hidden chain')
  assert.deepEqual(attachReasoningContentToCompletionsMessages([
    { role: 'assistant', content: 'visible answer' },
  ], [assistant]), [
    { role: 'assistant', content: 'visible answer', reasoning_content: 'hidden chain' },
  ])
})
