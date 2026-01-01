import type { Tool, ToolResult, Message, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock } from "../core/types"
import { loadThread } from "../session/persistence"

function extractTextFromMessage(message: Message): string {
  const parts: string[] = []

  for (const block of message.content) {
    if (block.type === "text") {
      parts.push((block as TextBlock).text)
    } else if (block.type === "tool_use") {
      const toolUse = block as ToolUseBlock
      parts.push(`[Tool: ${toolUse.name}]`)
    } else if (block.type === "tool_result") {
      const toolResult = block as ToolResultBlock
      const preview = toolResult.content.slice(0, 200)
      parts.push(`[Result: ${preview}${toolResult.content.length > 200 ? "..." : ""}]`)
    }
  }

  return parts.join("\n")
}

export const readThreadTool: Tool = {
  spec: {
    name: "ReadThread",
    description: `Read content from a conversation thread.

Use this to extract information from the current conversation or past sessions.
Useful for summarizing, searching, or referencing earlier messages.`,
    inputSchema: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          description: "Thread ID to read (defaults to current thread)",
        },
        query: {
          type: "string",
          description: "Optional: search for messages containing this text",
        },
        role: {
          type: "string",
          enum: ["user", "assistant", "all"],
          description: "Filter by message role (default: all)",
        },
        limit: {
          type: "number",
          description: "Maximum messages to return (default: 10, from most recent)",
        },
        includeToolCalls: {
          type: "boolean",
          description: "Include tool calls and results (default: false)",
        },
      },
      required: [],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const threadId = (input.threadId as string) ?? context.threadId
    const query = input.query as string | undefined
    const roleFilter = (input.role as string) ?? "all"
    const limit = (input.limit as number) ?? 10
    const includeToolCalls = (input.includeToolCalls as boolean) ?? false

    const thread = await loadThread(threadId)
    if (!thread) {
      return { output: `Thread not found: ${threadId}`, isError: true }
    }

    let messages = [...thread.messages]

    if (roleFilter !== "all") {
      messages = messages.filter((m) => m.role === roleFilter)
    }

    if (query) {
      const lowerQuery = query.toLowerCase()
      messages = messages.filter((m) => {
        const text = extractTextFromMessage(m).toLowerCase()
        return text.includes(lowerQuery)
      })
    }

    messages = messages.slice(-limit)

    if (messages.length === 0) {
      return { output: "No messages found matching criteria", isError: false }
    }

    const formatted = messages.map((m, i) => {
      let content = ""

      for (const block of m.content) {
        if (block.type === "text") {
          content += (block as TextBlock).text + "\n"
        } else if (includeToolCalls && block.type === "tool_use") {
          const toolUse = block as ToolUseBlock
          content += `\n[Tool: ${toolUse.name}]\n`
        } else if (includeToolCalls && block.type === "tool_result") {
          const toolResult = block as ToolResultBlock
          const preview = toolResult.content.slice(0, 500)
          content += `\n[Result: ${preview}${toolResult.content.length > 500 ? "..." : ""}]\n`
        }
      }

      return `--- ${m.role.toUpperCase()} (${i + 1}/${messages.length}) ---\n${content.trim()}`
    })

    return {
      output: `Thread: ${thread.id}\nMessages: ${messages.length}\n\n${formatted.join("\n\n")}`,
      isError: false,
    }
  },
}
