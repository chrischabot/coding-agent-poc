import { spawn } from "node:child_process"
import { resolve, isAbsolute } from "node:path"
import type { Tool, ToolContext } from "../core/types"

const MAX_RESULTS = 50
const MAX_CODE_LENGTH = 500

interface AstGrepMatch {
  file: string
  range: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
  text: string
}

function formatAstGrepResults(results: AstGrepMatch[], limit: number): string {
  if (results.length === 0) {
    return "No matches found."
  }

  const formatted = results.slice(0, limit).map((match) => {
    const code =
      match.text.length > MAX_CODE_LENGTH
        ? match.text.slice(0, MAX_CODE_LENGTH) + "..."
        : match.text

    // Clean up the code display
    const cleanCode = code
      .split("\n")
      .map((line) => "  " + line)
      .join("\n")

    return `${match.file}:${match.range.start.line}\n${cleanCode}`
  })

  let output = formatted.join("\n\n")

  if (results.length > limit) {
    output += `\n\n[${results.length - limit} more matches truncated. Use 'path' to narrow search.]`
  }

  return output
}

async function executeAstGrep(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const pattern = input.pattern as string
  const language = input.language as string | undefined
  const path = input.path as string | undefined

  if (!pattern) {
    return { output: "Error: pattern is required", isError: true }
  }

  const searchPath = path
    ? isAbsolute(path)
      ? path
      : resolve(context.workingDirectory, path)
    : context.workingDirectory

  return new Promise((resolvePromise) => {
    // Build ast-grep command
    // sg (ast-grep CLI) with JSON output
    const args = ["scan", "--pattern", pattern, "--json"]

    if (language) {
      args.push("--lang", language)
    }

    args.push(searchPath)

    const proc = spawn("sg", args, {
      cwd: context.workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on("close", (code) => {
      // ast-grep returns 0 for success (including no matches)
      if (code === 0) {
        try {
          // Handle empty output
          if (!stdout.trim() || stdout.trim() === "[]") {
            resolvePromise({ output: "No matches found." })
            return
          }

          const results: AstGrepMatch[] = JSON.parse(stdout)
          const formatted = formatAstGrepResults(results, MAX_RESULTS)
          resolvePromise({ output: formatted })
        } catch (parseErr) {
          // If JSON parsing fails, try to return raw output
          if (stdout.includes("No files")) {
            resolvePromise({ output: "No matching files found in the search path." })
          } else {
            resolvePromise({
              output: `Parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n\nRaw output:\n${stdout.slice(0, 500)}`,
              isError: true,
            })
          }
        }
        return
      }

      // Non-zero exit code
      if (stderr) {
        resolvePromise({
          output: `ast-grep error (code ${code}):\n${stderr}`,
          isError: true,
        })
      } else {
        resolvePromise({
          output: `ast-grep exited with code ${code}`,
          isError: true,
        })
      }
    })

    proc.on("error", (err) => {
      if (err.message.includes("ENOENT")) {
        resolvePromise({
          output: `Error: ast-grep (sg) not found.

ast-grep is a structural code search tool that matches AST patterns.

Install with one of:
  cargo install ast-grep --locked
  npm install -g @ast-grep/cli
  brew install ast-grep

Learn more: https://ast-grep.github.io/`,
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

export const astGrepTool: Tool = {
  spec: {
    name: "AstGrep",
    description: `Search code using AST patterns (powered by ast-grep).

More precise than regex - matches code structure, not just text.
Useful for finding specific code patterns across a codebase.

Pattern syntax uses $ for captures:
- $VAR matches any single AST node
- $$$ARGS matches multiple nodes (rest pattern)

Examples:
- "console.log($MSG)" - find all console.log calls
- "function $NAME($$$) { $$$BODY }" - find function declarations
- "if ($COND) { return $X }" - find if-return patterns
- "import { $$$ } from '$MODULE'" - find specific imports
- "const $NAME = async ($$$) => $$$" - find async arrow functions

Note: Requires ast-grep (sg) to be installed.`,
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "AST pattern to match (use $ for captures, $$$ for rest)",
        },
        language: {
          type: "string",
          description: "Force language: typescript, javascript, python, go, rust, java, etc.",
        },
        path: {
          type: "string",
          description: "Directory or file to search (default: working directory)",
        },
      },
      required: ["pattern"],
    },
  },
  execute: executeAstGrep,
}
