import { AnthropicProvider } from "../provider/anthropic"
import { getTool, getAllToolSpecs } from "../tools/registry"
import { PermissionChecker } from "../permission"
import { estimateThreadTokens, createContextBudget } from "../context"
import type { ContextBudget } from "../context"
import { createLSPManager } from "../lsp"
import type { LSPManager } from "../lsp"
import { checkForCorrection, formatCorrectionMessage } from "./correction"
import type { PermissionPromptFn, PermissionRule } from "../permission"
import type { Message, ContentBlock, ToolContext, Thread, Usage, StopReason, SummaryBlock, ResourceKey, ToolContextBudget, ToolContextLSPManager, CompactionState, TodoItem } from "../core/types"
import { saveCompactionState, loadLatestCompactionState, loadLatestLlmCompactionState } from "../session/persistence"
import { estimateTokens, estimateMessageTokens } from "../context/tokens"
import { ulid } from "ulid"

const DEFAULT_CONTEXT_LIMIT = 150000
const CONTEXT_COMPRESSION_THRESHOLD = 0.90
const CORRECTION_CHECK_INTERVAL = 3

// Token budget constants for compaction
const POST_COMPRESSION_TARGET = 30000  // tokens after compression
const SUMMARY_SOFT_CAP = 8000          // prompt LLM to condense if summary exceeds this
const SUMMARY_RESERVE = 8000           // reserved for summary itself
const SYSTEM_PROMPT_ESTIMATE = 4000    // estimate for system prompt

export interface CompactionDebugInfo {
  phase: "start" | "summarizing" | "complete"
  reason?: "threshold" | "incremental"
  isIncremental?: boolean
  messageCount?: number
  previousSummaryTokens?: number
  newSummaryTokens?: number
  tokensBeforeCompaction?: number
  tokensAfterCompaction?: number
  summaryPrompt?: string
  rawSummary?: string
  compactionState?: CompactionState
  todoState?: string
}

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
  onCompactionDebug?: (info: CompactionDebugInfo) => void
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
  private budget: ContextBudget
  private lspManager: LSPManager

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

    this.budget = createContextBudget({
      contextLimit: options.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
      compressionThreshold: CONTEXT_COMPRESSION_THRESHOLD,
    })

    // Initialize shared LSP manager for code intelligence
    this.lspManager = createLSPManager(thread.workingDirectory)
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

  async shutdown(): Promise<void> {
    this.abort()
    await this.lspManager.shutdownAll()
  }

  private addUserMessage(text: string): void {
    const message: Message = {
      role: "user",
      content: [{ type: "text", text }],
    }
    this.thread.messages.push(message)
  }

  private async runTurn(): Promise<boolean> {
    // Update budget with current thread token usage
    const currentTokens = estimateThreadTokens(this.thread.messages)
    this.budget.setCurrentThreadTokens(currentTokens)

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
    // Create budget interface for tools
    const budgetForTools: ToolContextBudget = {
      available: () => this.budget.available(),
      canAccommodate: (tokens: number) => this.budget.canAccommodate(tokens),
      wouldTriggerCompression: (tokens: number) => this.budget.wouldTriggerCompression(tokens),
      estimateFileTokens: (filePath: string) => this.budget.estimateFileTokens(filePath),
      estimateContentTokens: (content: string) => this.budget.estimateContentTokens(content),
    }

    // Create LSP manager interface for tools
    const lspManagerForTools: ToolContextLSPManager = {
      getClientForFile: (filePath: string) => this.lspManager.getClientForFile(filePath),
      getClient: (language: string) => this.lspManager.getClient(language as any),
      isAvailable: (language: string) => this.lspManager.isAvailable(language as any),
      shutdownAll: () => this.lspManager.shutdownAll(),
      getActiveServers: () => this.lspManager.getActiveServers(),
    }

    const context: ToolContext = {
      workingDirectory: this.thread.workingDirectory,
      threadId: this.thread.id,
      signal: this.abortController?.signal,
      model: this.options.model,
      permissionCheck: async (toolName, input) => {
        const permission = await this.permissionChecker.check(toolName, input)
        return { permitted: permission.permitted, reason: permission.reason }
      },
      budget: budgetForTools,
      lspManager: lspManagerForTools,
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
      const resourceKeys = tool?.executionProfile?.resourceKeys(tc.input, this.thread.workingDirectory) ?? []
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

  getActiveLSPServers(): string[] {
    return this.lspManager.getActiveServers()
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
    if (messageCount <= 2) {
      return // Need at least a few messages to compress
    }

    const percentUsed = Math.round((estimatedTokens / contextLimit) * 100)

    // Find existing summary and its anchor (for incremental summarization)
    const existingSummary = this.findExistingSummary()
    const lastCompactionState = loadLatestLlmCompactionState(this.thread)

    // Calculate token budget for suffix (messages to keep)
    const availableBudget = POST_COMPRESSION_TARGET - SUMMARY_RESERVE - SYSTEM_PROMPT_ESTIMATE

    // Select suffix using token-based approach
    const { suffixStart, suffixTokens } = this.selectSuffix(availableBudget)

    if (suffixStart === 0) {
      // Nothing to summarize
      return
    }

    // Determine what messages to summarize
    let messagesToSummarize: Message[]
    let previousSummary: string | undefined
    let previousSummaryTokens: number | undefined

    if (existingSummary && lastCompactionState) {
      // Incremental summarization: only summarize messages since last anchor
      const anchorIndex = this.resolveAnchorIndex(lastCompactionState)
      const deltaStart = Math.max(0, anchorIndex + 1)

      // Skip the summary message itself if it's at the start
      const effectiveStart = this.thread.messages[0]?.content[0]?.type === "summary" ? 1 : deltaStart

      messagesToSummarize = this.thread.messages.slice(effectiveStart, suffixStart)
      previousSummary = lastCompactionState.summaryText
      previousSummaryTokens = lastCompactionState.summaryTokens

      this.callbacks.onText?.(`\n[Context at ${percentUsed}% - incrementally compressing ${messagesToSummarize.length} new messages...]\n`)
    } else {
      // Full summarization
      messagesToSummarize = this.thread.messages.slice(0, suffixStart)
      this.callbacks.onText?.(`\n[Context at ${percentUsed}% - compressing ${messagesToSummarize.length} messages...]\n`)
    }

    if (messagesToSummarize.length === 0) {
      return
    }

    // Extract TODO state to preserve
    const todoState = this.extractTodoState(messagesToSummarize)

    // Emit debug info before summarization
    this.callbacks.onCompactionDebug?.({
      phase: "start",
      reason: previousSummary ? "incremental" : "threshold",
      isIncremental: !!previousSummary,
      messageCount: messagesToSummarize.length,
      previousSummaryTokens,
      tokensBeforeCompaction: estimatedTokens,
      todoState,
    })

    // Generate summary
    const summarizeResult = await this.provider.summarize(
      messagesToSummarize,
      this.options.model,
      {
        previousSummary,
        previousSummaryTokens,
        todoState,
      }
    )

    const summary = summarizeResult.summary
    const summaryTokens = estimateTokens(summary)

    // Emit debug info after summarization
    this.callbacks.onCompactionDebug?.({
      phase: "summarizing",
      summaryPrompt: summarizeResult.prompt,
      rawSummary: summarizeResult.rawResponse,
      newSummaryTokens: summaryTokens,
    })

    // Get anchor info from last summarized message
    const anchorIndex = suffixStart - 1
    const anchorMessage = this.thread.messages[anchorIndex]
    const anchorMessageId = anchorMessage?.id ?? `msg-${ulid()}`

    // Ensure anchor message has an ID
    if (!anchorMessage.id) {
      anchorMessage.id = anchorMessageId
    }

    // Create summary block with anchor info
    const summaryBlock: SummaryBlock = {
      type: "summary",
      summary,
      originalMessageCount: messagesToSummarize.length + (previousSummary ? lastCompactionState?.removedCount ?? 0 : 0),
      anchorMessageId,
      anchorIndex,
      summaryTokens,
      isIncremental: !!previousSummary,
    }

    const summaryMessage: Message = {
      id: `summary-${ulid()}`,
      role: "user",
      content: [summaryBlock],
    }

    // Keep suffix messages
    const messagesToKeep = this.thread.messages.slice(suffixStart)
    this.thread.messages = [summaryMessage, ...messagesToKeep]

    // Save compaction state for future incremental summarization
    const compactionStateId = await saveCompactionState(this.thread, {
      summaryText: summary,
      summaryTokens,
      summaryKind: "llm_summary",
      anchorMessageId,
      anchorIndex,
      removedCount: suffixStart,
    })

    const newTokens = estimateThreadTokens(this.thread.messages)
    const newPercent = Math.round((newTokens / contextLimit) * 100)

    // Emit debug info after compaction complete
    const latestState = loadLatestCompactionState(this.thread)
    this.callbacks.onCompactionDebug?.({
      phase: "complete",
      isIncremental: !!previousSummary,
      tokensAfterCompaction: newTokens,
      compactionState: latestState ?? undefined,
    })

    this.callbacks.onText?.(`[Context compressed to ${newPercent}% (${previousSummary ? "incremental" : "full"})]\n`)
  }

  /**
   * Find existing summary block in messages
   */
  private findExistingSummary(): SummaryBlock | null {
    for (const msg of this.thread.messages) {
      for (const block of msg.content) {
        if (block.type === "summary") {
          return block
        }
      }
    }
    return null
  }

  /**
   * Resolve anchor index from compaction state
   */
  private resolveAnchorIndex(state: CompactionState): number {
    // Try to find by message ID first
    if (state.anchorMessageId) {
      const idx = this.thread.messages.findIndex(m => m.id === state.anchorMessageId)
      if (idx >= 0) return idx
    }
    // Fall back to stored index
    return state.anchorIndex
  }

  /**
   * Select suffix (messages to keep) based on token budget
   */
  private selectSuffix(availableBudget: number): { suffixStart: number; suffixTokens: number } {
    let keptTokens = 0
    let suffixStart = this.thread.messages.length
    const messages = this.thread.messages

    // Work backwards, keeping messages until budget exhausted
    let i = messages.length - 1
    while (i >= 0) {
      const msg = messages[i]
      const msgTokens = estimateMessageTokens(msg)

      // Check if this is a tool_result that should be paired with preceding tool_use
      if (this.isToolResultMessage(msg) && i > 0) {
        const prevMsg = messages[i - 1]
        if (this.hasToolUseForResult(prevMsg, msg)) {
          // Include both tool_use and tool_result together
          const prevTokens = estimateMessageTokens(prevMsg)
          const pairTokens = msgTokens + prevTokens

          if (keptTokens + pairTokens > availableBudget) {
            break
          }

          keptTokens += pairTokens
          suffixStart = i - 1 // Include both messages
          i -= 2 // Skip both
          continue
        }
      }

      if (keptTokens + msgTokens > availableBudget) {
        break
      }

      keptTokens += msgTokens
      suffixStart = i
      i--
    }

    return { suffixStart, suffixTokens: keptTokens }
  }

  /**
   * Check if message is a tool result message
   */
  private isToolResultMessage(msg: Message): boolean {
    return msg.content.some(b => b.type === "tool_result")
  }

  /**
   * Check if message has tool_use that matches the tool_result
   */
  private hasToolUseForResult(prevMsg: Message, resultMsg: Message): boolean {
    const resultIds = new Set(
      resultMsg.content
        .filter((b): b is { type: "tool_result"; toolUseId: string; content: string } => b.type === "tool_result")
        .map(b => b.toolUseId)
    )

    return prevMsg.content.some(
      b => b.type === "tool_use" && resultIds.has(b.id)
    )
  }

  /**
   * Extract TODO state from messages to preserve in summary
   */
  private extractTodoState(messages: Message[]): string | undefined {
    // Search backwards for the last TodoWrite tool call
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== "assistant") continue

      for (const block of msg.content) {
        if (block.type === "tool_use" && block.name === "TodoWrite") {
          const input = block.input as { todos?: TodoItem[] }
          if (input.todos && Array.isArray(input.todos)) {
            return input.todos
              .map(t => `[${t.status}] ${t.content}`)
              .join("\n")
          }
        }
      }
    }
    return undefined
  }
}
