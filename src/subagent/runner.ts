import { AnthropicProvider } from "../provider/anthropic"
import type { Message, ContentBlock, ToolContext, Tool, StopReason, ResourceKey } from "../core/types"
import type { SubagentConfig, SubagentResult, SubagentContext, SubagentDebugInfo } from "./types"

// Global debug callback for testing
let globalDebugCallback: ((info: SubagentDebugInfo) => void) | null = null

export function setGlobalSubagentDebug(callback: ((info: SubagentDebugInfo) => void) | null): void {
  globalDebugCallback = callback
}

export function getGlobalSubagentDebug(): ((info: SubagentDebugInfo) => void) | null {
  return globalDebugCallback
}

/**
 * SubagentRunner executes a nested agent loop with limited tool access.
 * 
 * Key differences from main AgentLoop:
 * - Limited tool access (subset of main tools)
 * - No direct permission prompting (can use parent permissionCheck if provided)
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

    // Emit start debug info (to context callback or global)
    const debugCallback = this.context.onDebug ?? globalDebugCallback
    debugCallback?.({
      phase: "start",
      agentType: this.config.type,
      systemPrompt: this.config.systemPrompt,
      userPrompt: prompt,
    })

    let turns = 0
    let totalToolCalls = 0
    let finalOutput = ""
    let hadError = false

    while (turns < this.config.maxTurns) {
      turns++

      const { content, stopReason, toolCalls } = await this.runTurn(messages)
      totalToolCalls += toolCalls.length

      // Emit turn debug info
      debugCallback?.({
        phase: "turn",
        agentType: this.config.type,
        turnNumber: turns,
        toolCalls: toolCalls.map(tc => ({ name: tc.name, input: tc.input })),
      })

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
      if (toolResults.some((block) => block.type === "tool_result" && block.isError)) {
        hadError = true
      }
      const userMessage: Message = {
        role: "user",
        content: toolResults,
      }
      messages.push(userMessage)
    }

    // Emit complete debug info
    debugCallback?.({
      phase: "complete",
      agentType: this.config.type,
      output: finalOutput,
      isError: hadError,
      totalTurns: turns,
      totalToolCalls: totalToolCalls,
    })

    return {
      output: finalOutput,
      isError: hadError,
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
      model: this.context.model,
      permissionCheck: this.context.permissionCheck,
    }

    const batches = this.batchToolCallsByResources(toolCalls)
    const results: { toolUseId: string; content: string; isError?: boolean }[] = []

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async ({ id, name, input }) => {
          const tool = this.toolMap.get(name)
          if (!tool) {
            return { toolUseId: id, content: `Error: Unknown tool "${name}"`, isError: true }
          }

          if (this.context.permissionCheck) {
            const permission = await this.context.permissionCheck(name, input)
            if (!permission.permitted) {
              return {
                toolUseId: id,
                content: `Error: ${permission.reason ?? "Permission denied"}`,
                isError: true,
              }
            }
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
      results.push(...batchResults)
    }

    return results.map(r => ({
      type: "tool_result" as const,
      toolUseId: r.toolUseId,
      content: r.content,
      isError: r.isError,
    }))
  }

  private batchToolCallsByResources(
    toolCalls: { id: string; name: string; input: Record<string, unknown> }[]
  ): { id: string; name: string; input: Record<string, unknown> }[][] {
    if (toolCalls.length <= 1) {
      return [toolCalls]
    }

    const toolsWithResources = toolCalls.map((tc) => {
      const tool = this.toolMap.get(tc.name)
      const resourceKeys = tool?.executionProfile?.resourceKeys(tc.input) ?? []
      return { ...tc, resourceKeys }
    })

    const batches: { id: string; name: string; input: Record<string, unknown> }[][] = []
    const assigned = new Set<number>()

    while (assigned.size < toolsWithResources.length) {
      const batch: { id: string; name: string; input: Record<string, unknown> }[] = []
      const batchResources: ResourceKey[] = []

      for (let i = 0; i < toolsWithResources.length; i++) {
        if (assigned.has(i)) continue

        const tc = toolsWithResources[i]
        if (this.canAddToBatch(tc.resourceKeys, batchResources)) {
          batch.push({ id: tc.id, name: tc.name, input: tc.input })
          batchResources.push(...tc.resourceKeys)
          assigned.add(i)
        }
      }

      if (batch.length > 0) {
        batches.push(batch)
      }
    }

    return batches
  }

  private canAddToBatch(newKeys: ResourceKey[], existingKeys: ResourceKey[]): boolean {
    for (const newKey of newKeys) {
      for (const existing of existingKeys) {
        if (newKey.key === existing.key) {
          if (newKey.mode === "write" || existing.mode === "write") {
            return false
          }
        }
      }
    }
    return true
  }
}
