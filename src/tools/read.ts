import { readFile, stat } from "node:fs/promises"
import { resolve, isAbsolute } from "node:path"
import type { Tool, ToolContext, ExecutionProfile } from "../core/types"
import { recordFileRead } from "../context/file-state"
import { smartTruncate, formatTruncatedOutput } from "../context/truncation"

const MAX_LINES = 2000
const MAX_LINE_LENGTH = 2000
const LARGE_FILE_THRESHOLD = 500 // Lines
const MAX_TOKENS_PER_READ = 20000 // ~80KB
const CHARS_PER_TOKEN = 4

function estimateContentTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN)
}

async function executeRead(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const filePath = input.path as string
  const offset = (input.offset as number) ?? 0
  const limit = (input.limit as number) ?? MAX_LINES

  if (!filePath) {
    return { output: "Error: path is required", isError: true }
  }

  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(context.workingDirectory, filePath)

  try {
    const stats = await stat(resolvedPath)
    if (!stats.isFile()) {
      return { output: `Error: ${filePath} is not a file`, isError: true }
    }

    const content = await readFile(resolvedPath, "utf-8")
    const lines = content.split("\n")
    const estimatedTokens = estimateContentTokens(content)

    // Apply smart truncation for large files (always, not just when budget is tight)
    if (lines.length > LARGE_FILE_THRESHOLD || estimatedTokens > MAX_TOKENS_PER_READ) {
      const truncated = smartTruncate(content, resolvedPath, {
        maxTokens: MAX_TOKENS_PER_READ,
        targetRange: offset > 0 ? {
          startLine: offset,
          endLine: offset + limit
        } : undefined
      })

      if (truncated.wasTruncated) {
        await recordFileRead(resolvedPath, context.threadId)
        return { output: formatTruncatedOutput(truncated, filePath) }
      }
    }

    // Standard processing for smaller files or when truncation didn't apply
    const startLine = Math.max(0, offset)
    const endLine = Math.min(lines.length, startLine + limit)
    const selectedLines = lines.slice(startLine, endLine)

    const maxLineNum = endLine
    const padding = String(maxLineNum).length

    const numberedLines = selectedLines.map((line, i) => {
      const lineNum = String(startLine + i + 1).padStart(padding)
      const truncatedLine =
        line.length > MAX_LINE_LENGTH
          ? line.slice(0, MAX_LINE_LENGTH) + "..."
          : line
      return `${lineNum}\t${truncatedLine}`
    })

    let output = numberedLines.join("\n")

    if (endLine < lines.length) {
      output += `\n\n(File has ${lines.length} lines total. Use 'offset' parameter to read beyond line ${endLine})`
    }

    await recordFileRead(resolvedPath, context.threadId)

    return { output }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { output: `Error reading file: ${message}`, isError: true }
  }
}

const readExecutionProfile: ExecutionProfile = {
  resourceKeys: (input, workingDirectory) => {
    const pathInput = input.path as string | undefined
    if (pathInput) {
      const resolvedPath = isAbsolute(pathInput)
        ? pathInput
        : resolve(workingDirectory ?? process.cwd(), pathInput)
      return [{ key: resolvedPath, mode: "read" }]
    }
    return []
  },
}

export const readTool: Tool = {
  spec: {
    name: "Read",
    description: `Read file contents. Returns lines with line numbers.

Use this to read files in the codebase. Returns file content with line numbers for reference.

- The path can be absolute or relative to the working directory
- By default reads up to 2000 lines from the start
- Use offset and limit for pagination on large files
- Lines longer than 2000 characters are truncated`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to read (absolute or relative)",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (0-based, default: 0)",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read (default: 2000)",
        },
      },
      required: ["path"],
    },
  },
  execute: executeRead,
  executionProfile: readExecutionProfile,
}
