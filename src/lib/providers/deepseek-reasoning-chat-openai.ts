import {
  ChatOpenAI,
  ChatOpenAICompletions,
  convertMessagesToCompletionsMessageParams,
  type ChatOpenAIFields,
} from '@langchain/openai'
import {
  AIMessage,
  AIMessageChunk,
  isAIMessage,
  type BaseMessage,
  type BaseMessageChunk,
  type UsageMetadata,
} from '@langchain/core/messages'
import { ChatGenerationChunk, type ChatGeneration, type ChatResult } from '@langchain/core/outputs'
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager'
import type { OpenAI as OpenAIClient } from 'openai'

export const REASONING_CONTENT_MD_KEY = 'reasoningContentDelta'

type ChatCompletionMessageParam = OpenAIClient.Chat.Completions.ChatCompletionMessageParam

export function extractReasoningContentDelta(delta: Record<string, unknown> | null | undefined): string {
  if (!delta) return ''
  if (typeof delta.reasoning_content === 'string') return delta.reasoning_content
  if (typeof delta.reasoning === 'string') return delta.reasoning
  return ''
}

export function getReasoningContentFromLangChainMessage(message: Pick<BaseMessage, 'additional_kwargs'>): string {
  const additionalKwargs = message.additional_kwargs || {}
  const reasoningContent = additionalKwargs.reasoning_content
  if (typeof reasoningContent === 'string' && reasoningContent.length > 0) return reasoningContent
  const reasoning = additionalKwargs.reasoning
  return typeof reasoning === 'string' ? reasoning : ''
}

export function attachReasoningContentToCompletionsMessages<T extends ChatCompletionMessageParam>(
  messagesMapped: T[],
  sourceMessages: BaseMessage[],
): T[] {
  return messagesMapped.map((message, index) => {
    const reasoningContent = getReasoningContentFromLangChainMessage(sourceMessages[index])
    if (message.role !== 'assistant' || !reasoningContent) return message
    return {
      ...message,
      reasoning_content: reasoningContent,
    } as T
  })
}

export function mergeReasoningContentIntoMessage<T extends { additional_kwargs: Record<string, unknown> }>(
  message: T,
  delta: Record<string, unknown> | null | undefined,
): T {
  const reasoningContent = extractReasoningContentDelta(delta)
  if (!reasoningContent) return message
  const existing = message.additional_kwargs.reasoning_content
  const nextReasoningContent = typeof existing === 'string' && existing.length > 0
    ? existing.endsWith(reasoningContent) ? existing : `${existing}${reasoningContent}`
    : reasoningContent
  message.additional_kwargs = {
    ...message.additional_kwargs,
    reasoning_content: nextReasoningContent,
  }
  return message
}

export function shouldUseDeepSeekReasoningBridge(
  provider: string | null | undefined,
  endpoint: string | null | undefined,
): boolean {
  if (provider === 'deepseek') return true
  if (!endpoint) return false
  try {
    return new URL(endpoint).hostname === 'api.deepseek.com'
  } catch {
    return false
  }
}

export function createReasoningContentMetadata(reasoningContentDelta: string): Record<string, string> {
  return { [REASONING_CONTENT_MD_KEY]: reasoningContentDelta }
}

class DeepSeekReasoningChatOpenAICompletions extends ChatOpenAICompletions {
  override async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    options.signal?.throwIfAborted()
    const usageMetadata: UsageMetadata = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    }
    const params = this.invocationParams(options)
    const messagesMapped = attachReasoningContentToCompletionsMessages(
      convertMessagesToCompletionsMessageParams({
        messages,
        model: this.model,
      }),
      messages,
    )
    if (params.stream) {
      const stream = this._streamResponseChunks(messages, options, runManager)
      const finalChunks: Record<string, ChatGenerationChunk> = {}
      for await (const chunk of stream) {
        chunk.message.response_metadata = {
          ...chunk.generationInfo,
          ...chunk.message.response_metadata,
        }
        const index = chunk.generationInfo?.completion ?? 0
        if (finalChunks[index] === undefined) finalChunks[index] = chunk
        else finalChunks[index] = finalChunks[index].concat(chunk)
      }
      const generations = Object.entries(finalChunks)
        .sort(([aKey], [bKey]) => parseInt(aKey, 10) - parseInt(bKey, 10))
        .map(([, value]) => value)
      const { functions, function_call } = this.invocationParams(options)
      const promptTokenUsage = await this._getEstimatedTokenCountFromPrompt(messages, functions, function_call)
      const completionTokenUsage = await this._getNumTokensFromGenerations(generations)
      usageMetadata.input_tokens = promptTokenUsage
      usageMetadata.output_tokens = completionTokenUsage
      usageMetadata.total_tokens = promptTokenUsage + completionTokenUsage
      return {
        generations,
        llmOutput: {
          estimatedTokenUsage: {
            promptTokens: usageMetadata.input_tokens,
            completionTokens: usageMetadata.output_tokens,
            totalTokens: usageMetadata.total_tokens,
          },
        },
      }
    }

    const data = await this.completionWithRetry({
      ...params,
      stream: false,
      messages: messagesMapped,
    }, {
      signal: options?.signal,
      ...options?.options,
    })
    const {
      completion_tokens: completionTokens,
      prompt_tokens: promptTokens,
      total_tokens: totalTokens,
      prompt_tokens_details: promptTokensDetails,
      completion_tokens_details: completionTokensDetails,
    } = data?.usage ?? {}
    if (completionTokens) usageMetadata.output_tokens = (usageMetadata.output_tokens ?? 0) + completionTokens
    if (promptTokens) usageMetadata.input_tokens = (usageMetadata.input_tokens ?? 0) + promptTokens
    if (totalTokens) usageMetadata.total_tokens = (usageMetadata.total_tokens ?? 0) + totalTokens
    if (promptTokensDetails?.audio_tokens !== null || promptTokensDetails?.cached_tokens !== null) {
      usageMetadata.input_token_details = {
        ...(promptTokensDetails?.audio_tokens !== null && { audio: promptTokensDetails?.audio_tokens }),
        ...(promptTokensDetails?.cached_tokens !== null && { cache_read: promptTokensDetails?.cached_tokens }),
      }
    }
    if (completionTokensDetails?.audio_tokens !== null || completionTokensDetails?.reasoning_tokens !== null) {
      usageMetadata.output_token_details = {
        ...(completionTokensDetails?.audio_tokens !== null && { audio: completionTokensDetails?.audio_tokens }),
        ...(completionTokensDetails?.reasoning_tokens !== null && { reasoning: completionTokensDetails?.reasoning_tokens }),
      }
    }
    const generations = []
    for (const part of data?.choices ?? []) {
      const generation: ChatGeneration = {
        text: part.message?.content ?? '',
        message: this._convertCompletionsMessageToBaseMessage(part.message ?? { role: 'assistant' }, data),
      }
      generation.generationInfo = {
        ...(part.finish_reason ? { finish_reason: part.finish_reason } : {}),
        ...(part.logprobs ? { logprobs: part.logprobs } : {}),
      }
      if (isAIMessage(generation.message)) generation.message.usage_metadata = usageMetadata
      generation.message = new AIMessage(Object.fromEntries(
        Object.entries(generation.message).filter(([key]) => !key.startsWith('lc_')),
      ) as ConstructorParameters<typeof AIMessage>[0])
      generations.push(generation)
    }
    return {
      generations,
      llmOutput: {
        tokenUsage: {
          promptTokens: usageMetadata.input_tokens,
          completionTokens: usageMetadata.output_tokens,
          totalTokens: usageMetadata.total_tokens,
        },
      },
    }
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const messagesMapped = attachReasoningContentToCompletionsMessages(
      convertMessagesToCompletionsMessageParams({
        messages,
        model: this.model,
      }),
      messages,
    )
    const params = {
      ...this.invocationParams(options, { streaming: true }),
      messages: messagesMapped,
      stream: true,
    } satisfies OpenAIClient.Chat.Completions.ChatCompletionCreateParamsStreaming
    let defaultRole: OpenAIClient.Chat.ChatCompletionRole | undefined
    const streamIterable = await this.completionWithRetry(params, options)
    let usage: OpenAIClient.Completions.CompletionUsage | undefined
    for await (const data of streamIterable) {
      if (options.signal?.aborted) return
      const choice = data?.choices?.[0]
      if (data.usage) usage = data.usage
      if (!choice) continue
      const { delta } = choice
      if (!delta) continue
      const chunk = this._convertCompletionsDeltaToBaseMessageChunk(delta as unknown as Record<string, unknown>, data, defaultRole)
      defaultRole = delta.role ?? defaultRole
      const newTokenIndices = {
        prompt: options.promptIndex ?? 0,
        completion: choice.index ?? 0,
      }
      if (typeof chunk.content !== 'string') {
        continue
      }
      const generationInfo: Record<string, unknown> = { ...newTokenIndices }
      if (choice.finish_reason != null) {
        generationInfo.finish_reason = choice.finish_reason
        generationInfo.system_fingerprint = data.system_fingerprint
        generationInfo.model_name = data.model
        generationInfo.service_tier = data.service_tier
      }
      if (this.logprobs) generationInfo.logprobs = choice.logprobs
      const generationChunk = new ChatGenerationChunk({
        message: chunk,
        text: chunk.content,
        generationInfo,
      })
      yield generationChunk
      await runManager?.handleLLMNewToken(generationChunk.text ?? '', newTokenIndices, undefined, undefined, undefined, {
        chunk: generationChunk,
      })
    }
    if (usage) {
      const inputTokenDetails = {
        ...(usage.prompt_tokens_details?.audio_tokens !== null && { audio: usage.prompt_tokens_details?.audio_tokens }),
        ...(usage.prompt_tokens_details?.cached_tokens !== null && { cache_read: usage.prompt_tokens_details?.cached_tokens }),
      }
      const outputTokenDetails = {
        ...(usage.completion_tokens_details?.audio_tokens !== null && { audio: usage.completion_tokens_details?.audio_tokens }),
        ...(usage.completion_tokens_details?.reasoning_tokens !== null && { reasoning: usage.completion_tokens_details?.reasoning_tokens }),
      }
      yield new ChatGenerationChunk({
        message: new AIMessageChunk({
          content: '',
          response_metadata: { usage: { ...usage } },
          usage_metadata: {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            ...(Object.keys(inputTokenDetails).length > 0 && { input_token_details: inputTokenDetails }),
            ...(Object.keys(outputTokenDetails).length > 0 && { output_token_details: outputTokenDetails }),
          },
        }),
        text: '',
      })
    }
    if (options.signal?.aborted) throw new Error('AbortError')
  }

  protected override _convertCompletionsDeltaToBaseMessageChunk(
    delta: Record<string, unknown>,
    rawResponse: OpenAIClient.Chat.Completions.ChatCompletionChunk,
    defaultRole?: OpenAIClient.Chat.ChatCompletionRole,
  ): BaseMessageChunk {
    return mergeReasoningContentIntoMessage(
      super._convertCompletionsDeltaToBaseMessageChunk(delta, rawResponse, defaultRole),
      delta,
    )
  }

  protected override _convertCompletionsMessageToBaseMessage(
    message: OpenAIClient.ChatCompletionMessage,
    rawResponse: OpenAIClient.ChatCompletion,
  ): BaseMessage {
    return mergeReasoningContentIntoMessage(
      super._convertCompletionsMessageToBaseMessage(message, rawResponse),
      message as unknown as Record<string, unknown>,
    )
  }
}

export function createDeepSeekReasoningChatOpenAI(fields: ChatOpenAIFields): ChatOpenAI {
  return new ChatOpenAI({
    ...fields,
    completions: new DeepSeekReasoningChatOpenAICompletions(fields),
  })
}
