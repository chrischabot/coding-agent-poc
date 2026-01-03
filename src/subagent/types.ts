import type { Tool, ToolContext } from "../core/types"

export type SubagentType = "task" | "finder" | "oracle" | "painter" | "librarian" | "kraken-scope" | "kraken-executor"

export interface SubagentConfig {
  type: SubagentType
  model: string
  systemPrompt: string
  tools: Tool[]
  maxTurns: number
  maxTokens: number
}

export interface SubagentInput {
  prompt: string
  description: string
  context?: string
  files?: string[]
}

export interface SubagentResult {
  output: string
  isError: boolean
  toolCalls: number
  turns: number
}

export interface SubagentContext extends ToolContext {
  parentThreadId: string
  onDebug?: (info: SubagentDebugInfo) => void
}

export interface SubagentDebugInfo {
  phase: "start" | "turn" | "complete"
  agentType: SubagentType
  systemPrompt?: string
  userPrompt?: string
  turnNumber?: number
  toolCalls?: { name: string; input: Record<string, unknown> }[]
  output?: string
  isError?: boolean
  totalTurns?: number
  totalToolCalls?: number
}
