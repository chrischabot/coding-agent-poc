import Anthropic from "@anthropic-ai/sdk"
import type { Message, ToolSpec, Usage, StopReason, ContentBlock } from "../core/types"

type AnthropicMessageParam = Anthropic.MessageParam
type AnthropicContentBlock = Anthropic.ContentBlock

const SUMMARIZATION_PROMPT = `Summarize this conversation concisely, preserving:
1. Task Overview - Core request and success criteria
2. Current State - What has been completed
3. Important Discoveries - Technical constraints, decisions made
4. Key Context - File paths, patterns, user preferences

Be concise but complete. The summary will replace the original messages to save context space.`

function convertToolSpecToAnthropic(spec: ToolSpec): Anthropic.Tool {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.inputSchema as Anthropic.Tool.InputSchema,
  }
}

function convertMessagesToAnthropic(messages: Message[]): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = []

  for (const msg of messages) {
    if (msg.role === "system") continue

    const content: (Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam)[] = []

    for (const block of msg.content) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text })
      } else if (block.type === "tool_use") {
        content.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        })
      } else if (block.type === "tool_result") {
        content.push({
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content,
          is_error: block.isError,
        })
      } else if (block.type === "summary") {
        content.push({
          type: "text",
          text: `[Previous conversation summary]\n${block.summary}`,
        })
      }
    }

    if (content.length > 0) {
      result.push({
        role: msg.role as "user" | "assistant",
        content,
      })
    }
  }

  return result
}

export class AnthropicProvider {
  private client: Anthropic

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    })
  }

  async *stream(
    model: string,
    systemPrompt: string,
    messages: Message[],
    tools: ToolSpec[],
    maxTokens: number = 8192
  ): AsyncGenerator<{
    type: "text" | "tool_use" | "usage" | "stop"
    text?: string
    toolUse?: { id: string; name: string; input: Record<string, unknown> }
    usage?: Usage
    stopReason?: StopReason
  }> {
    const anthropicMessages = convertMessagesToAnthropic(messages)
    const anthropicTools = tools.map(convertToolSpecToAnthropic)

    const stream = this.client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    })

    let currentToolId = ""
    let currentToolName = ""
    let currentToolInput = ""

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolId = event.content_block.id
          currentToolName = event.content_block.name
          currentToolInput = ""
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text }
        } else if (event.delta.type === "input_json_delta") {
          currentToolInput += event.delta.partial_json
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolId && currentToolName) {
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(currentToolInput || "{}")
          } catch {
            input = {}
          }
          yield {
            type: "tool_use",
            toolUse: { id: currentToolId, name: currentToolName, input },
          }
          currentToolId = ""
          currentToolName = ""
          currentToolInput = ""
        }
      } else if (event.type === "message_delta") {
        if (event.usage) {
          yield {
            type: "usage",
            usage: {
              inputTokens: 0,
              outputTokens: event.usage.output_tokens,
            },
          }
        }
        if (event.delta.stop_reason) {
          yield {
            type: "stop",
            stopReason: event.delta.stop_reason as StopReason,
          }
        }
      } else if (event.type === "message_start") {
        if (event.message.usage) {
          yield {
            type: "usage",
            usage: {
              inputTokens: event.message.usage.input_tokens,
              outputTokens: event.message.usage.output_tokens,
            },
          }
        }
      }
    }
  }

  async summarize(messages: Message[], model: string = "claude-sonnet-4-20250514"): Promise<string> {
    const conversationText = messages
      .map((m) => {
        const role = m.role.toUpperCase()
        const content = m.content
          .map((b) => {
            if (b.type === "text") return b.text
            if (b.type === "tool_use") return `[Tool: ${b.name}]`
            if (b.type === "tool_result") return `[Result: ${b.content.slice(0, 500)}...]`
            return ""
          })
          .join("\n")
        return `${role}:\n${content}`
      })
      .join("\n\n---\n\n")

    const response = await this.client.messages.create({
      model,
      max_tokens: 2048,
      system: SUMMARIZATION_PROMPT,
      messages: [{ role: "user", content: conversationText }],
    })

    const textBlock = response.content.find((b) => b.type === "text")
    return textBlock?.type === "text" ? textBlock.text : ""
  }
}
