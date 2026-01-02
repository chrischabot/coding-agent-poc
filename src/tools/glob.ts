import { spawn } from "node:child_process"
import { resolve, isAbsolute } from "node:path"
import type { Tool, ToolContext } from "../core/types"

const MAX_RESULTS = 100

async function executeGlob(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const pattern = input.pattern as string
  const path = input.path as string | undefined
  const limit = (input.limit as number) ?? MAX_RESULTS

  if (!pattern) {
    return { output: "Error: pattern is required", isError: true }
  }

  const searchPath = path
    ? isAbsolute(path)
      ? path
      : resolve(context.workingDirectory, path)
    : context.workingDirectory

  return new Promise((resolvePromise) => {
    const args = ["--files", "--glob", pattern, searchPath]

    const proc = spawn("rg", args, {
      cwd: context.workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""

    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString()
    })

    proc.stderr?.on("data", (data: Buffer) => {
      output += data.toString()
    })

    proc.on("close", (code) => {
      if (code === 1 && output === "") {
        resolvePromise({ output: "No files found matching pattern." })
        return
      }

      if (code && code >= 2) {
        resolvePromise({
          output: `Error (code ${code}):\n${output}`,
          isError: true,
        })
        return
      }

      const files = output.trim().split("\n").filter(Boolean)

      if (files.length > limit) {
        const truncated = files.length - limit
        const result = files.slice(0, limit).join("\n")
        resolvePromise({
          output: `${result}\n\n[${truncated} more files truncated. Use 'limit' to see more or narrow pattern.]`,
        })
        return
      }

      resolvePromise({ output: files.join("\n") || "No files found." })
    })

    proc.on("error", (err) => {
      if (err.message.includes("ENOENT")) {
        resolvePromise({
          output: "Error: ripgrep (rg) not found. Please install it.",
          isError: true,
        })
        return
      }
      resolvePromise({
        output: `Error: ${err.message}`,
        isError: true,
      })
    })
  })
}

export const globTool: Tool = {
  spec: {
    name: "Glob",
    description: `Find files by glob pattern.

Use this to find files matching a pattern. Order is not guaranteed.

Pattern examples:
- "**/*.ts" - all TypeScript files
- "src/**/*.tsx" - all TSX files in src
- "*.json" - JSON files in current directory
- "**/*test*" - files with "test" in name`,
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g. '**/*.ts')",
        },
        path: {
          type: "string",
          description: "Base path to search from",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 100)",
        },
      },
      required: ["pattern"],
    },
  },
  execute: executeGlob,
}
