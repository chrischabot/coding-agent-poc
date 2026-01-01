import { AnthropicProvider } from "../provider/anthropic"
import type { Message, ContentBlock, ToolContext, Tool, ToolSpec, StopReason } from "../core/types"
import type { SubagentConfig, SubagentResult, SubagentContext } from "./types"

/**
 * SubagentRunner executes a nested agent loop with limited tool access.
 * 
 * Key differences from main AgentLoop:
 * - Limited tool access (subset of main tools)
 * - No permission prompting (inherits parent permissions)
 * - No context compression (short-lived)
 * - No course correction
 * - Returns final text output to parent
 */
export class SubagentRunner {
  private provider: AnthropicProvider
  private config: SubagentConfig
  private context: SubagentContext
  private toolMap: Map<string, Tool>

  constructor(config: SubagentConfig, context: SubagentContext) {
    this.provider = new AnthropicProvider()
    this.config = config
    this.context = context
    this.toolMap = new Map(config.tools.map(t => [t.spec.name, t]))
  }

  async run(prompt: string): Promise<SubagentResult> {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: prompt }] }
    ]

    let turns = 0
    let totalToolCalls = 0
    let finalOutput = ""

    while (turns < this.config.maxTurns) {
      turns++

      const { content, stopReason, toolCalls } = await this.runTurn(messages)
      totalToolCalls += toolCalls.length

      const assistantMessage: Message = {
        role: "assistant",
        content,
        state: { type: "complete", stopReason },
      }
      messages.push(assistantMessage)

      const textBlocks = content.filter(b => b.type === "text")
      if (textBlocks.length > 0) {
        finalOutput = textBlocks.map(b => b.type === "text" ? b.text : "").join("\n")
      }

      if (toolCalls.length === 0) {
        break
      }

      const toolResults = await this.executeTools(toolCalls)
      const userMessage: Message = {
        role: "user",
        content: toolResults,
      }
      messages.push(userMessage)
    }

    return {
      output: finalOutput,
      isError: false,
      toolCalls: totalToolCalls,
      turns,
    }
  }

  private async runTurn(messages: Message[]): Promise<{
    content: ContentBlock[]
    stopReason: StopReason | undefined
    toolCalls: { id: string; name: string; input: Record<string, unknown> }[]
  }> {
    const content: ContentBlock[] = []
    let stopReason: StopReason | undefined
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = []

    const toolSpecs = this.config.tools.map(t => t.spec)
    const stream = this.provider.stream(
      this.config.model,
      this.config.systemPrompt,
      messages,
      toolSpecs,
      this.config.maxTokens
    )

    for await (const event of stream) {
      if (event.type === "text" && event.text) {
        const lastBlock = content[content.length - 1]
        if (lastBlock?.type === "text") {
          lastBlock.text += event.text
        } else {
          content.push({ type: "text", text: event.text })
        }
      } else if (event.type === "tool_use" && event.toolUse) {
        const { id, name, input } = event.toolUse
        content.push({ type: "tool_use", id, name, input })
        toolCalls.push({ id, name, input })
      } else if (event.type === "stop" && event.stopReason) {
        stopReason = event.stopReason
      }
    }

    return { content, stopReason, toolCalls }
  }

  private async executeTools(
    toolCalls: { id: string; name: string; input: Record<string, unknown> }[]
  ): Promise<ContentBlock[]> {
    const toolContext: ToolContext = {
      workingDirectory: this.context.workingDirectory,
      threadId: this.context.parentThreadId,
      signal: this.context.signal,
    }

    const results = await Promise.all(
      toolCalls.map(async ({ id, name, input }) => {
        const tool = this.toolMap.get(name)
        if (!tool) {
          return { toolUseId: id, content: `Error: Unknown tool "${name}"`, isError: true }
        }

        try {
          const result = await tool.execute(input, toolContext)
          return {
            toolUseId: id,
            content: result.output,
            isError: result.isError,
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          return { toolUseId: id, content: errorMessage, isError: true }
        }
      })
    )

    return results.map(r => ({
      type: "tool_result" as const,
      toolUseId: r.toolUseId,
      content: r.content,
      isError: r.isError,
    }))
  }
}
