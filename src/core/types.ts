export interface Thread {
  id: string
  version: number
  title?: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  workingDirectory: string
  artifacts?: Artifacts
}

export interface Artifacts {
  plan?: string
  custom?: Record<string, string>
}

export type MessageRole = "user" | "assistant" | "system"

export interface Message {
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

export interface ToolContext {
  workingDirectory: string
  threadId: string
  signal?: AbortSignal
  model?: string
  permissionCheck?: (
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<{ permitted: boolean; reason?: string }>
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
  resourceKeys: (input: Record<string, unknown>) => ResourceKey[]
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
