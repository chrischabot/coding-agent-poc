export interface Thread {
  id: string
  version: number
  title?: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  workingDirectory: string
  artifacts?: Artifacts
  compactionStates?: CompactionState[]  // History of compressions
}

export interface Artifacts {
  plan?: string
  custom?: Record<string, string>
  scratchpad?: string  // Persistent working memory that survives compression
}

export type MessageRole = "user" | "assistant" | "system"

export interface Message {
  id?: string  // Unique message ID for anchor tracking
  role: MessageRole
  content: ContentBlock[]
  state?: MessageState
  usage?: Usage
}

export interface MessageState {
  type: "pending" | "streaming" | "complete" | "error"
  stopReason?: StopReason
  error?: string
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence"

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | SummaryBlock

export interface TextBlock {
  type: "text"
  text: string
}

export interface ToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: "tool_result"
  toolUseId: string
  content: string
  isError?: boolean
}

export interface SummaryBlock {
  type: "summary"
  summary: string
  originalMessageCount: number
  // Incremental summarization fields
  anchorMessageId?: string      // ID of last message that was summarized
  anchorIndex?: number          // Index fallback for anchor resolution
  summaryTokens?: number        // Track summary size for soft cap
  isIncremental?: boolean       // Was this a delta summary?
}

export interface CompactionState {
  id: string                    // Unique ID (ULID)
  timestamp: string             // ISO timestamp
  summaryText: string           // The actual summary
  summaryTokens: number         // Token count
  summaryKind: "llm_summary" | "serialized"
  anchorMessageId: string       // Last summarized message ID
  anchorIndex: number           // Index for fallback
  removedCount: number          // How many messages were removed
}

export interface ToolSpec {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface ToolContextBudget {
  available(): number
  canAccommodate(tokens: number): boolean
  wouldTriggerCompression(tokens: number): boolean
  estimateFileTokens(filePath: string): Promise<number>
  estimateContentTokens(content: string): number
}

export interface ToolContextLSPManager {
  getClientForFile(filePath: string): Promise<LSPClient | null>
  getClient(language: string): Promise<LSPClient | null>
  isAvailable(language: string): Promise<boolean>
  shutdownAll(): Promise<void>
  getActiveServers(): string[]
}

export interface LSPClient {
  getDocumentSymbols(filePath: string): Promise<SymbolInfo[]>
  getDefinition(filePath: string, line: number, column: number): Promise<SymbolLocation[]>
  getReferences(filePath: string, line: number, column: number): Promise<SymbolLocation[]>
  getHover(filePath: string, line: number, column: number): Promise<string | null>
  shutdown(): Promise<void>
}

export interface SymbolInfo {
  name: string
  kind: string
  line: number
  endLine?: number
  signature?: string
}

export interface SymbolLocation {
  file: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

export interface ToolContext {
  workingDirectory: string
  threadId: string
  signal?: AbortSignal
  model?: string
  permissionCheck?: (
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<{ permitted: boolean; reason?: string }>
  budget?: ToolContextBudget
  lspManager?: ToolContextLSPManager
}

export interface ToolResult {
  output: string
  isError?: boolean
}

export type ResourceMode = "read" | "write"

export interface ResourceKey {
  key: string
  mode: ResourceMode
}

export interface ExecutionProfile {
  resourceKeys: (input: Record<string, unknown>, workingDirectory?: string) => ResourceKey[]
}

export type ToolExecuteFn = (
  input: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>

export interface Tool {
  spec: ToolSpec
  execute: ToolExecuteFn
  executionProfile?: ExecutionProfile
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface AgentConfig {
  model: string
  provider: "anthropic"
  workingDirectory: string
  maxTokens?: number
  debugMode?: boolean
  nonInteractive?: boolean
}

export interface TodoItem {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed"
}
