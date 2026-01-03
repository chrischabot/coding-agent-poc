import Anthropic from "@anthropic-ai/sdk"
import type { Message, ToolSpec, Usage, StopReason, ContentBlock } from "../core/types"
import { ensureValidToken, isAuthenticated, OAUTH_CONFIG, ANTHROPIC_VERSION } from "../auth"

type AnthropicMessageParam = Anthropic.MessageParam
type AnthropicContentBlock = Anthropic.ContentBlock

export interface SummarizeResult {
  summary: string
  prompt: string
  rawResponse: string
}

const SUMMARIZATION_SYSTEM_PROMPT = `You excel at creating summaries that capture salient details from technical conversations.

Return your summary wrapped in <summary> tags with these sections:

<summary>
1. Chronological Play-by-Play
   - Use arrow notation: "User requests X -> Assistant does Y -> Result Z"
   - Capture every significant turn in order

2. Primary Request and Intent
   - What is the session's core goal?

3. Approach
   - How did the assistant approach the problem?

4. Key Technical Work
   - What was implemented or changed?

5. Files Modified
   - Full paths with bullet descriptions of changes

6. Error Resolution
   - Errors encountered and how resolved

7. Pending Tasks
   - Outstanding work items

8. Current Work
   - User's latest message and immediate context

9. Next Steps
   - What should happen next?

10. Important Discoveries
    - Technical constraints, decisions, user preferences
</summary>

Guidelines:
- Prioritize technical details over conversational elements
- Maintain chronological order
- Ensure summary can stand alone as reference`

const SUMMARY_SOFT_CAP = 8000 // Prompt LLM to condense if summary exceeds this

const CLAUDE_CODE_VERSION = "2.0.76"
const CLAUDE_CODE_USER_AGENT =
  process.env.CLAUDE_CODE_USER_AGENT ??
  `claude-cli/${CLAUDE_CODE_VERSION} (external, coding-agent)`
const CLAUDE_CODE_SYSTEM_HEADER =
  "You are Claude Code, Anthropic's official CLI for Claude."
const OAUTH_BETAS = [
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "fine-grained-tool-streaming-2025-05-14",
  "context-management-2025-06-27",
  ...(process.env.CODING_AGENT_ENABLE_CLAUDE_CODE_BETA === "true"
    ? ["claude-code-20250219"]
    : []),
]

function getOauthSystemPrompt(systemPrompt: string): string {
  if (process.env.CODING_AGENT_OAUTH_SYSTEM_MODE === "full") {
    if (!systemPrompt) {
      return CLAUDE_CODE_SYSTEM_HEADER
    }
    if (systemPrompt.includes(CLAUDE_CODE_SYSTEM_HEADER)) {
      return systemPrompt
    }
    return `${CLAUDE_CODE_SYSTEM_HEADER}\n\n${systemPrompt}`
  }
  // OAuth tokens require the system prompt to be exactly the Claude Code header.
  return CLAUDE_CODE_SYSTEM_HEADER
}

// Global auth mode flag
let useApiKeyMode = false

/**
 * Set whether to use API key mode (--use-anthropic-key flag)
 */
export function setUseApiKeyMode(value: boolean): void {
  useApiKeyMode = value
}

/**
 * Get the current auth mode
 */
export function isUsingApiKey(): boolean {
  return useApiKeyMode
}

/**
 * Create an Anthropic client with OAuth or API key authentication
 *
 * Based on analysis of:
 * - ./agent/js/src/auth/plugins.ts
 * - opencode-anthropic-auth npm package
 * - claude.js (official Claude Code)
 *
 * Key differences from standard SDK usage:
 * 1. Custom fetch replaces x-api-key with Bearer token
 * 2. Required beta headers for OAuth: oauth-2025-04-20, claude-code-20250219, etc.
 * 3. apiKey can be empty string - custom fetch handles auth
 */
async function createAuthenticatedClient(): Promise<Anthropic> {
  if (useApiKeyMode) {
    // API key mode - use environment variable
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required when using --use-anthropic-key flag"
      )
    }
    return new Anthropic({
      apiKey,
      defaultHeaders: {
        "x-app": "cli",
        "User-Agent": CLAUDE_CODE_USER_AGENT,
      },
    })
  }

  // OAuth mode (default)
  if (!isAuthenticated()) {
    throw new Error("Not authenticated. Please run 'coding-agent login' first.")
  }

  // Create client with custom fetch that uses OAuth Bearer token
  // NOTE: SDK validates apiKey/authToken presence; use a non-empty placeholder.
  return new Anthropic({
    apiKey: "oauth-token-used-via-custom-fetch", // Placeholder for SDK validation
    baseURL: OAUTH_CONFIG.BASE_API_URL,
    defaultHeaders: {
      "x-app": "cli",
      "User-Agent": CLAUDE_CODE_USER_AGENT,
    },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      // Get fresh token on each request (handles refresh if needed)
      const accessToken = await ensureValidToken()

      // Get existing beta headers from SDK
      const initHeaders = (init?.headers || {}) as Record<string, string>
      const incomingBeta = initHeaders["anthropic-beta"] || ""
      const incomingBetasList = incomingBeta
        .split(",")
        .map((b: string) => b.trim())
        .filter(Boolean)

      // Merge beta headers (matching opencode-anthropic-auth and ./agent)
      // These are REQUIRED for OAuth to work
      const mergedBetas = [...new Set([...OAUTH_BETAS, ...incomingBetasList])].join(",")

      // Build headers
      const headers: Record<string, string> = {
        ...initHeaders,
        "authorization": `Bearer ${accessToken}`,
        "anthropic-beta": mergedBetas,
      }

      // CRITICAL: Remove x-api-key - it MUST NOT be present for OAuth
      delete headers["x-api-key"]

      if (process.env.CODING_AGENT_DEBUG_AUTH === "true") {
        const authHeader = headers["authorization"] ?? headers["Authorization"]
        const hasAuth = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        let systemPreview: string | null = null
        let bodySummary: Record<string, unknown> | null = null
        if (typeof init?.body === "string") {
          try {
            const parsed = JSON.parse(init.body) as {
              system?: string
              model?: string
              max_tokens?: number
              messages?: Array<{ role: string; content: unknown }>
              tools?: unknown[]
            }
            if (typeof parsed.system === "string") {
              systemPreview = parsed.system.split("\n")[0] ?? null
            }
            bodySummary = {
              model: parsed.model ?? null,
              max_tokens: parsed.max_tokens ?? null,
              messages: Array.isArray(parsed.messages)
                ? parsed.messages.map((msg) => ({
                    role: msg.role,
                    contentType: Array.isArray((msg as { content?: unknown }).content)
                      ? "blocks"
                      : typeof (msg as { content?: unknown }).content,
                  }))
                : null,
              tools: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
            }
          } catch {
            systemPreview = null
          }
        }
        console.error(
          JSON.stringify(
            {
              url: typeof input === "string" ? input : input.toString(),
              method: init?.method ?? "GET",
              headers: {
                "x-app": headers["x-app"],
                "user-agent": headers["User-Agent"] ?? headers["user-agent"],
                "anthropic-beta": headers["anthropic-beta"],
                "anthropic-version": headers["anthropic-version"],
                authorization: hasAuth ? "Bearer <redacted>" : null,
                "x-api-key": headers["x-api-key"] ?? null,
              },
              system: systemPreview,
              body: bodySummary,
            },
            null,
            2
          )
        )
      }

      return fetch(input, {
        ...init,
        headers,
      })
    },
  })
}

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
  private client: Anthropic | null = null

  constructor() {
    // Client is created lazily with authentication
  }

  /**
   * Get or create an authenticated client
   */
  private async getClient(): Promise<Anthropic> {
    if (!this.client) {
      this.client = await createAuthenticatedClient()
    }
    return this.client
  }

  /**
   * Refresh the client (e.g., after token refresh)
   */
  async refreshClient(): Promise<void> {
    this.client = await createAuthenticatedClient()
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
    const client = await this.getClient()
    const anthropicMessages = convertMessagesToAnthropic(messages)
    const anthropicTools = tools.map(convertToolSpecToAnthropic)

    const request = {
      model,
      max_tokens: maxTokens,
      system: isUsingApiKey() ? systemPrompt : getOauthSystemPrompt(systemPrompt),
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    }
    const stream = isUsingApiKey()
      ? client.messages.stream(request)
      : await client.beta.messages.create({ ...request, betas: OAUTH_BETAS, stream: true })

    let currentToolId = ""
    let currentToolName = ""
    let currentToolInput = ""
    let pendingInputTokens = 0
    let usageEmitted = false

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
        if (event.usage && !usageEmitted) {
          yield {
            type: "usage",
            usage: {
              inputTokens: pendingInputTokens,
              outputTokens: event.usage.output_tokens,
            },
          }
          usageEmitted = true
        }
        if (event.delta.stop_reason) {
          yield {
            type: "stop",
            stopReason: event.delta.stop_reason as StopReason,
          }
        }
      } else if (event.type === "message_start") {
        if (event.message.usage) {
          pendingInputTokens = event.message.usage.input_tokens
          if (event.message.usage.output_tokens > 0 && !usageEmitted) {
            yield {
              type: "usage",
              usage: {
                inputTokens: pendingInputTokens,
                outputTokens: event.message.usage.output_tokens,
              },
            }
            usageEmitted = true
          }
        }
      }
    }
  }

  async summarize(
    messages: Message[],
    model: string = "claude-opus-4-5-20251101",
    options?: {
      previousSummary?: string
      previousSummaryTokens?: number
      todoState?: string
    }
  ): Promise<SummarizeResult> {
    const client = await this.getClient()
    const conversationText = this.serializeMessages(messages)

    let userPrompt: string
    if (options?.previousSummary) {
      // Incremental/delta summarization
      const trimNote = options.previousSummaryTokens && options.previousSummaryTokens > SUMMARY_SOFT_CAP
        ? "\nIMPORTANT: The previous summary is getting long. Please condense less important information while preserving key facts."
        : ""

      userPrompt = `Previous summary:
\`\`\`
${options.previousSummary}
\`\`\`${trimNote}

These messages were sent since the previous summary:
\`\`\`
${conversationText}
\`\`\`

${options.todoState ? `Current TODO state to preserve:\n${options.todoState}\n\n` : ""}Please incorporate the new messages into the existing summary, preserving important details from both. Remember to wrap your final summary in <summary> tags.`
    } else {
      // Full summarization
      userPrompt = `Please summarize the following conversation:
\`\`\`
${conversationText}
\`\`\`

${options?.todoState ? `Current TODO state to preserve:\n${options.todoState}\n\n` : ""}Remember to wrap your final summary in <summary> tags.`
    }

    const summaryRequest = {
      model,
      max_tokens: 4096,
      system: isUsingApiKey()
        ? SUMMARIZATION_SYSTEM_PROMPT
        : getOauthSystemPrompt(SUMMARIZATION_SYSTEM_PROMPT),
      messages: [{ role: "user", content: userPrompt }],
    }
    const response = isUsingApiKey()
      ? await client.messages.create(summaryRequest)
      : await client.beta.messages.create({ ...summaryRequest, betas: OAUTH_BETAS })

    const textBlock = response.content.find((b) => b.type === "text")
    const rawText = textBlock?.type === "text" ? textBlock.text : ""

    // Extract content from <summary> tags if present
    const summaryMatch = rawText.match(/<summary>([\s\S]*?)<\/summary>/i)
    const summary = summaryMatch ? summaryMatch[1].trim() : rawText.trim()

    return {
      summary,
      prompt: userPrompt,
      rawResponse: rawText,
    }
  }

  private serializeMessages(messages: Message[]): string {
    return messages
      .map((m) => {
        const role = m.role.toUpperCase()
        const content = m.content
          .map((b) => {
            if (b.type === "text") return b.text
            if (b.type === "tool_use") return `[Tool: ${b.name}](${JSON.stringify(b.input).slice(0, 200)}...)`
            if (b.type === "tool_result") return `[Result: ${b.content.slice(0, 500)}...]`
            if (b.type === "summary") return `[Previous Summary: ${b.summary.slice(0, 200)}...]`
            return ""
          })
          .join("\n")
        return `${role}:\n${content}`
      })
      .join("\n\n---\n\n")
  }
}
