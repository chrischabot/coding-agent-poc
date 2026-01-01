import type { Message, ContentBlock } from "../core/types"

const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateContentBlockTokens(block: ContentBlock): number {
  if (block.type === "text") {
    return estimateTokens(block.text)
  }
  if (block.type === "tool_use") {
    return estimateTokens(block.name) + estimateTokens(JSON.stringify(block.input))
  }
  if (block.type === "tool_result") {
    return estimateTokens(block.content)
  }
  return 0
}

export function estimateMessageTokens(message: Message): number {
  let tokens = 10
  for (const block of message.content) {
    tokens += estimateContentBlockTokens(block)
  }
  return tokens
}

export function estimateThreadTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
}

export interface TokenUsage {
  estimated: number
  actual?: number
}

export function createTokenTracker() {
  let totalInputTokens = 0
  let totalOutputTokens = 0

  return {
    addUsage(inputTokens: number, outputTokens: number) {
      totalInputTokens += inputTokens
      totalOutputTokens += outputTokens
    },
    getTotal() {
      return {
        input: totalInputTokens,
        output: totalOutputTokens,
        total: totalInputTokens + totalOutputTokens,
      }
    },
    reset() {
      totalInputTokens = 0
      totalOutputTokens = 0
    },
  }
}
