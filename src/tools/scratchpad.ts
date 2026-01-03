import type { Tool, ToolResult } from "../core/types"
import { loadThread, saveThread } from "../session/persistence"
import { estimateTokens } from "../context/tokens"

const DEFAULT_SCRATCHPAD = `### Goal
[Overall objective]

### Plan
[High-level milestones]
- [ ]

### Current Tasks
[Steps for current milestone]
- [ ]

### Knowledge
[Facts you've discovered]

### Failed Approaches
[What didn't work and why]

### Open Questions
[Need answers to proceed]

### Notes
[Scratch space]
`

interface ScratchpadOperation {
  command: "overwrite" | "str_replace" | "insert"
  newContent?: string
  oldStr?: string
  newStr?: string
  insertLine?: number
}

/**
 * Add line numbers to content for display
 */
function addLineNumbers(content: string): string {
  const lines = content.split("\n")
  const padding = String(lines.length).length
  return lines
    .map((line, i) => `${String(i + 1).padStart(padding)}: ${line}`)
    .join("\n")
}

/**
 * Apply a single operation to the scratchpad content
 */
function applyOperation(
  content: string,
  op: ScratchpadOperation
): { content: string; error?: string } {
  switch (op.command) {
    case "overwrite":
      if (op.newContent === undefined) {
        return { content, error: "overwrite requires newContent" }
      }
      return { content: op.newContent }

    case "str_replace":
      if (op.oldStr === undefined || op.newStr === undefined) {
        return { content, error: "str_replace requires oldStr and newStr" }
      }
      if (!content.includes(op.oldStr)) {
        return {
          content,
          error: `str_replace failed: could not find "${op.oldStr.slice(0, 50)}..."`,
        }
      }
      const matches = content.split(op.oldStr).length - 1
      if (matches > 1) {
        return {
          content,
          error: `str_replace failed: found ${matches} occurrences. Provide a more specific substring.`,
        }
      }
      return { content: content.replace(op.oldStr, op.newStr) }

    case "insert":
      if (op.insertLine === undefined || op.newStr === undefined) {
        return { content, error: "insert requires insertLine and newStr" }
      }
      const lines = content.split("\n")
      const lineIndex = op.insertLine === -1 ? lines.length : op.insertLine - 1
      if (lineIndex < 0 || lineIndex > lines.length) {
        return {
          content,
          error: `insert failed: line ${op.insertLine} out of range (1-${lines.length}, or -1 for end)`,
        }
      }
      lines.splice(lineIndex, 0, op.newStr)
      return { content: lines.join("\n") }

    default:
      return { content, error: `Unknown command: ${(op as any).command}` }
  }
}

export const scratchpadTool: Tool = {
  spec: {
    name: "EditScratchpad",
    description: `Edit the session scratchpad - persistent working memory that survives context compression.

Operations can be chained and are applied in order:
- **overwrite**: Replace entire scratchpad with new content
- **str_replace**: Replace a unique substring (oldStr -> newStr)
- **insert**: Insert text at a specific line (1-indexed, -1 for end)

The scratchpad uses a structured format:
- **Goal**: Overall objective
- **Plan**: High-level milestones
- **Current Tasks**: Immediate steps
- **Knowledge**: Discovered facts
- **Failed Approaches**: What didn't work
- **Open Questions**: Need answers
- **Notes**: Scratch space

The output includes line numbers for reference. Use them for targeted edits.

Examples:
1. Initialize: { "operations": [{ "command": "overwrite", "newContent": "### Goal\\n..." }] }
2. Mark done: { "operations": [{ "command": "str_replace", "oldStr": "- [ ] Task", "newStr": "- [x] Task" }] }
3. Append note: { "operations": [{ "command": "insert", "insertLine": -1, "newStr": "- New discovery" }] }`,
    inputSchema: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          description: "Array of operations to apply in order",
          items: {
            type: "object",
            properties: {
              command: {
                type: "string",
                enum: ["overwrite", "str_replace", "insert"],
                description: "Operation type",
              },
              newContent: {
                type: "string",
                description: "For overwrite: the new content",
              },
              oldStr: {
                type: "string",
                description: "For str_replace: text to find",
              },
              newStr: {
                type: "string",
                description: "For str_replace/insert: text to use",
              },
              insertLine: {
                type: "number",
                description: "For insert: line number (1-indexed, -1 for end)",
              },
            },
            required: ["command"],
          },
        },
      },
      required: ["operations"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const operations = input.operations as ScratchpadOperation[]

    if (!Array.isArray(operations) || operations.length === 0) {
      return {
        output: "Error: operations must be a non-empty array",
        isError: true,
      }
    }

    try {
      const thread = await loadThread(context.threadId)
      if (!thread) {
        return { output: "Thread not found", isError: true }
      }

      // Get current scratchpad or default
      let content = thread.artifacts?.scratchpad ?? DEFAULT_SCRATCHPAD

      // Apply operations in order
      for (const op of operations) {
        const result = applyOperation(content, op)
        if (result.error) {
          return { output: `Error: ${result.error}`, isError: true }
        }
        content = result.content
      }

      // Save updated scratchpad
      thread.artifacts = thread.artifacts ?? {}
      thread.artifacts.scratchpad = content
      thread.updatedAt = Date.now()

      await saveThread(thread)

      const tokens = estimateTokens(content)
      const numbered = addLineNumbers(content)

      return {
        output: `Scratchpad updated (~${tokens} tokens)\n\n${numbered}`,
        isError: false,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Failed to edit scratchpad: ${message}`, isError: true }
    }
  },
}

export const readScratchpadTool: Tool = {
  spec: {
    name: "ReadScratchpad",
    description: `Read the current scratchpad content.

Returns the scratchpad with line numbers for reference.`,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  async execute(_input, context): Promise<ToolResult> {
    try {
      const thread = await loadThread(context.threadId)
      if (!thread) {
        return {
          output: addLineNumbers(DEFAULT_SCRATCHPAD),
          isError: false,
        }
      }

      const content = thread.artifacts?.scratchpad ?? DEFAULT_SCRATCHPAD
      const tokens = estimateTokens(content)
      const numbered = addLineNumbers(content)

      return {
        output: `Scratchpad (~${tokens} tokens)\n\n${numbered}`,
        isError: false,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Failed to read scratchpad: ${message}`, isError: true }
    }
  },
}
