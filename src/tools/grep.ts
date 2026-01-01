import { spawn } from "node:child_process"
import { resolve, isAbsolute } from "node:path"
import type { Tool, ToolContext } from "../core/types"

const MAX_RESULTS = 100
const MAX_LINE_LENGTH = 200

async function executeGrep(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const pattern = input.pattern as string
  const path = input.path as string | undefined
  const caseSensitive = input.case_sensitive as boolean | undefined
  const glob = input.glob as string | undefined

  if (!pattern) {
    return { output: "Error: pattern is required", isError: true }
  }

  const searchPath = path
    ? isAbsolute(path)
      ? path
      : resolve(context.workingDirectory, path)
    : context.workingDirectory

  return new Promise((resolvePromise) => {
    const args = [
      "--with-filename",
      "--line-number",
      "--no-heading",
      `--max-columns=${MAX_LINE_LENGTH}`,
      "--trim",
    ]

    if (!caseSensitive) {
      args.push("-i")
    }

    if (glob) {
      args.push("--glob", glob)
    }

    args.push("--regexp", pattern, searchPath)

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
        resolvePromise({ output: "No results found." })
        return
      }

      if (code && code >= 2) {
        resolvePromise({
          output: `ripgrep error (code ${code}):\n${output}`,
          isError: true,
        })
        return
      }

      const lines = output.trim().split("\n").filter(Boolean)

      if (lines.length > MAX_RESULTS) {
        const truncated = lines.length - MAX_RESULTS
        const result = lines.slice(0, MAX_RESULTS).join("\n")
        resolvePromise({
          output: `${result}\n\n[${truncated} more results truncated. Use 'path' or 'glob' to narrow search.]`,
        })
        return
      }

      resolvePromise({ output: lines.join("\n") || "No results found." })
    })

    proc.on("error", (err) => {
      if (err.message.includes("ENOENT")) {
        resolvePromise({
          output:
            "Error: ripgrep (rg) not found. Please install it: brew install ripgrep",
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

export const grepTool: Tool = {
  spec: {
    name: "Grep",
    description: `Search for patterns in files using ripgrep.

Fast regex-based search across files. Uses Rust regex syntax.

Tips:
- Use 'path' to search a specific directory
- Use 'glob' to filter by file type (e.g. "*.ts")
- Results limited to 100 matches
- Lines truncated at 200 characters`,
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for",
        },
        path: {
          type: "string",
          description: "Directory or file to search in",
        },
        glob: {
          type: "string",
          description: "Glob pattern to filter files (e.g. '*.ts')",
        },
        case_sensitive: {
          type: "boolean",
          description: "Case sensitive search (default: false)",
        },
      },
      required: ["pattern"],
    },
  },
  execute: executeGrep,
}
