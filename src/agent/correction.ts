import type { Message } from "../core/types"

export interface CorrectionResult {
  needsCorrection: boolean
  reason?: string
  suggestion?: string
}

interface ToolCall {
  id: string
  name: string
  failed: boolean
}

function extractToolCalls(messages: Message[]): ToolCall[] {
  const calls: ToolCall[] = []
  const callsById = new Map<string, ToolCall>()

  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_use") {
        const call = { id: block.id, name: block.name, failed: false }
        calls.push(call)
        callsById.set(block.id, call)
      }
      if (block.type === "tool_result" && block.isError) {
        const call = callsById.get(block.toolUseId)
        if (call) {
          call.failed = true
        }
      }
    }
  }

  return calls
}

function detectRepeatedFailures(calls: ToolCall[], threshold: number = 3): CorrectionResult | null {
  const recentCalls = calls.slice(-10)
  const failedByTool = new Map<string, number>()

  for (const call of recentCalls) {
    if (call.failed) {
      const count = (failedByTool.get(call.name) ?? 0) + 1
      failedByTool.set(call.name, count)

      if (count >= threshold) {
        return {
          needsCorrection: true,
          reason: `Tool "${call.name}" has failed ${count} times recently`,
          suggestion: `The ${call.name} tool keeps failing. Try a different approach or verify the inputs are correct.`,
        }
      }
    }
  }

  return null
}

function detectToolLoop(calls: ToolCall[], patternLength: number = 3): CorrectionResult | null {
  if (calls.length < patternLength * 2) {
    return null
  }

  const recent = calls.slice(-patternLength * 2)
  const pattern1 = recent.slice(0, patternLength).map((c) => c.name).join(",")
  const pattern2 = recent.slice(patternLength).map((c) => c.name).join(",")

  if (pattern1 === pattern2) {
    return {
      needsCorrection: true,
      reason: "Detected repeating tool call pattern",
      suggestion: "You appear to be in a loop. Stop and reconsider your approach.",
    }
  }

  return null
}

function detectConsecutiveFailures(calls: ToolCall[], threshold: number = 5): CorrectionResult | null {
  const recentCalls = calls.slice(-threshold)

  if (recentCalls.length < threshold) {
    return null
  }

  const allFailed = recentCalls.every((c) => c.failed)

  if (allFailed) {
    return {
      needsCorrection: true,
      reason: `Last ${threshold} tool calls all failed`,
      suggestion: "Multiple consecutive failures. Stop and reassess what you're trying to do.",
    }
  }

  return null
}

export function checkForCorrection(messages: Message[]): CorrectionResult {
  const calls = extractToolCalls(messages)

  if (calls.length === 0) {
    return { needsCorrection: false }
  }

  const repeatedFailure = detectRepeatedFailures(calls)
  if (repeatedFailure) {
    return repeatedFailure
  }

  const consecutiveFailure = detectConsecutiveFailures(calls)
  if (consecutiveFailure) {
    return consecutiveFailure
  }

  const loop = detectToolLoop(calls)
  if (loop) {
    return loop
  }

  return { needsCorrection: false }
}

export function formatCorrectionMessage(result: CorrectionResult): string {
  return `[COURSE CORRECTION]
${result.reason}

${result.suggestion}

Please acknowledge this and try a different approach.`
}
