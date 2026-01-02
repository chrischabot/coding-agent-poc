import { AnthropicProvider } from "../provider/anthropic"
import { getTool, getAllToolSpecs } from "../tools/registry"
import { PermissionChecker } from "../permission"
import { estimateThreadTokens } from "../context"
import { checkForCorrection, formatCorrectionMessage } from "./correction"
import type { PermissionPromptFn, PermissionRule } from "../permission"
import type { Message, ContentBlock, ToolContext, Thread, Usage, StopReason, SummaryBlock, ResourceKey } from "../core/types"

const DEFAULT_CONTEXT_LIMIT = 150000
const CONTEXT_COMPRESSION_THRESHOLD = 0.90
const MESSAGES_TO_KEEP = 10
const CORRECTION_CHECK_INTERVAL = 3

export interface AgentCallbacks {
  onText?: (text: string) => void
  onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void
  onToolEnd?: (id: string, result: string, isError: boolean) => void
  onPermissionRequest?: (
    toolName: string,
    input: Record<string, unknown>,
    rule: PermissionRule
  ) => Promise<boolean>
  onPermissionDenied?: (toolName: string, reason: string) => void
  onCourseCorrection?: (reason: string, suggestion: string) => void
  onUsage?: (usage: Usage) => void
  onMessageComplete?: (message: Message) => void
  onTurnComplete?: () => void
}

export interface AgentOptions {
  model: string
  systemPrompt: string
  maxTurns?: number
  maxTokens?: number
  contextLimit?: number
}

export class AgentLoop {
  private provider: AnthropicProvider
  private thread: Thread
  private options: AgentOptions
  private callbacks: AgentCallbacks
  private abortController: AbortController | null = null
  private permissionChecker: PermissionChecker

  constructor(
    thread: Thread,
    options: AgentOptions,
    callbacks: AgentCallbacks = {}
  ) {
    this.provider = new AnthropicProvider()
    this.thread = thread
    this.options = options
    this.callbacks = callbacks

    const promptFn: PermissionPromptFn | null = callbacks.onPermissionRequest
      ? (toolName, input, rule) => callbacks.onPermissionRequest!(toolName, input, rule)
      : null
    this.permissionChecker = new PermissionChecker([], promptFn)
  }

  async run(userMessage: string): Promise<void> {
    this.abortController = new AbortController()

    this.addUserMessage(userMessage)

    const maxTurns = this.options.maxTurns ?? 50
    let turnCount = 0

    while (turnCount < maxTurns) {
      if (this.abortController.signal.aborted) break

      turnCount++

      if (turnCount > 1 && turnCount % CORRECTION_CHECK_INTERVAL === 0) {
        this.checkAndApplyCorrection()
      }

      const continueLoop = await this.runTurn()

      if (!continueLoop) break
    }

    this.callbacks.onTurnComplete?.()
  }

  abort(): void {
    this.abortController?.abort()
  }

  private addUserMessage(text: string): void {
    const message: Message = {
      role: "user",
      content: [{ type: "text", text }],
    }
    this.thread.messages.push(message)
  }

  private async runTurn(): Promise<boolean> {
    await this.compressContextIfNeeded()

    const content: ContentBlock[] = []
    let stopReason: StopReason | undefined
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = []

    const tools = getAllToolSpecs()
    const stream = this.provider.stream(
      this.options.model,
      this.options.systemPrompt,
      this.thread.messages,
      tools,
      this.options.maxTokens
    )

    for await (const event of stream) {
      if (this.abortController?.signal.aborted) break

      if (event.type === "text" && event.text) {
        this.callbacks.onText?.(event.text)
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
        this.callbacks.onToolStart?.(id, name, input)
      } else if (event.type === "usage" && event.usage) {
        this.callbacks.onUsage?.(event.usage)
      } else if (event.type === "stop" && event.stopReason) {
        stopReason = event.stopReason
      }
    }

    const assistantMessage: Message = {
      role: "assistant",
      content,
      state: { type: "complete", stopReason },
    }
    this.thread.messages.push(assistantMessage)
    this.callbacks.onMessageComplete?.(assistantMessage)

    if (toolCalls.length === 0) {
      return false
    }

    const toolResults = await this.executeToolsParallel(toolCalls)

    const userMessage: Message = {
      role: "user",
      content: toolResults,
    }
    this.thread.messages.push(userMessage)

    return true
  }

  private async executeToolsParallel(
    toolCalls: { id: string; name: string; input: Record<string, unknown> }[]
  ): Promise<ContentBlock[]> {
    const context: ToolContext = {
      workingDirectory: this.thread.workingDirectory,
      threadId: this.thread.id,
      signal: this.abortController?.signal,
      model: this.options.model,
      permissionCheck: async (toolName, input) => {
        const permission = await this.permissionChecker.check(toolName, input)
        return { permitted: permission.permitted, reason: permission.reason }
      },
    }

    // Group tools into batches based on resource conflicts
    const batches = this.batchToolCallsByResources(toolCalls)
    const allResults: { toolUseId: string; content: string; isError?: boolean }[] = []

    // Execute batches sequentially, tools within batch in parallel
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async ({ id, name, input }) => {
          const tool = getTool(name)
          if (!tool) {
            const result = `Error: Unknown tool "${name}"`
            this.callbacks.onToolEnd?.(id, result, true)
            return { toolUseId: id, content: result, isError: true }
          }

          const permission = await this.permissionChecker.check(name, input)
          if (!permission.permitted) {
            const reason = permission.reason ?? "Permission denied"
            this.callbacks.onPermissionDenied?.(name, reason)
            this.callbacks.onToolEnd?.(id, reason, true)
            return { toolUseId: id, content: `Error: ${reason}`, isError: true }
          }

          try {
            const result = await tool.execute(input, context)
            this.callbacks.onToolEnd?.(id, result.output, result.isError ?? false)
            return {
              toolUseId: id,
              content: result.output,
              isError: result.isError,
            }
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            this.callbacks.onToolEnd?.(id, errorMessage, true)
            return { toolUseId: id, content: errorMessage, isError: true }
          }
        })
      )
      allResults.push(...batchResults)
    }

    return allResults.map((r) => ({
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
      const tool = getTool(tc.name)
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
          // Conflict if either is a write
          if (newKey.mode === "write" || existing.mode === "write") {
            return false
          }
        }
      }
    }
    return true
  }

  getThread(): Thread {
    return this.thread
  }

  private checkAndApplyCorrection(): void {
    const result = checkForCorrection(this.thread.messages)

    if (result.needsCorrection && result.reason && result.suggestion) {
      this.callbacks.onCourseCorrection?.(result.reason, result.suggestion)

      const correctionMessage: Message = {
        role: "user",
        content: [{ type: "text", text: formatCorrectionMessage(result) }],
      }
      this.thread.messages.push(correctionMessage)
    }
  }

  private async compressContextIfNeeded(): Promise<void> {
    const contextLimit = this.options.contextLimit ?? DEFAULT_CONTEXT_LIMIT
    const compressionThreshold = contextLimit * CONTEXT_COMPRESSION_THRESHOLD
    const estimatedTokens = estimateThreadTokens(this.thread.messages)

    if (estimatedTokens < compressionThreshold) {
      return
    }

    const messageCount = this.thread.messages.length
    if (messageCount <= MESSAGES_TO_KEEP) {
      return
    }

    const messagesToSummarize = this.thread.messages.slice(0, messageCount - MESSAGES_TO_KEEP)
    const messagesToKeep = this.thread.messages.slice(messageCount - MESSAGES_TO_KEEP)

    const percentUsed = Math.round((estimatedTokens / contextLimit) * 100)
    this.callbacks.onText?.(`\n[Context at ${percentUsed}% - compressing ${messagesToSummarize.length} messages...]\n`)

    const summary = await this.provider.summarize(messagesToSummarize, this.options.model)

    const summaryBlock: SummaryBlock = {
      type: "summary",
      summary,
      originalMessageCount: messagesToSummarize.length,
    }

    const summaryMessage: Message = {
      role: "user",
      content: [summaryBlock],
    }

    this.thread.messages = [summaryMessage, ...messagesToKeep]
    
    const newTokens = estimateThreadTokens(this.thread.messages)
    const newPercent = Math.round((newTokens / contextLimit) * 100)
    this.callbacks.onText?.(`[Context compressed to ${newPercent}%]\n`)
  }
}
