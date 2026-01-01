import { spawn } from "node:child_process"
import { resolve, isAbsolute } from "node:path"
import type { Tool, ToolContext } from "../core/types"

const DEFAULT_TIMEOUT = 120000
const MAX_OUTPUT_LENGTH = 100000

async function executeBash(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const command = input.command as string
  const cwd = input.cwd as string | undefined
  const timeout = (input.timeout as number) ?? DEFAULT_TIMEOUT

  if (!command) {
    return { output: "Error: command is required", isError: true }
  }

  const workingDir = cwd
    ? isAbsolute(cwd)
      ? cwd
      : resolve(context.workingDirectory, cwd)
    : context.workingDirectory

  return new Promise((resolvePromise) => {
    let output = ""
    let killed = false

    const proc = spawn(command, [], {
      shell: true,
      cwd: workingDir,
      env: { ...process.env, TERM: "dumb" },
      stdio: ["ignore", "pipe", "pipe"],
    })

    const timeoutId = setTimeout(() => {
      killed = true
      proc.kill("SIGTERM")
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL")
      }, 5000)
    }, timeout)

    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString()
      if (output.length > MAX_OUTPUT_LENGTH * 2) {
        output = output.slice(-MAX_OUTPUT_LENGTH)
      }
    })

    proc.stderr?.on("data", (data: Buffer) => {
      output += data.toString()
      if (output.length > MAX_OUTPUT_LENGTH * 2) {
        output = output.slice(-MAX_OUTPUT_LENGTH)
      }
    })

    proc.on("close", (code) => {
      clearTimeout(timeoutId)

      if (output.length > MAX_OUTPUT_LENGTH) {
        const truncated = output.length - MAX_OUTPUT_LENGTH
        output = `[Output truncated - ${truncated} characters removed from start]\n\n` + output.slice(-MAX_OUTPUT_LENGTH)
      }

      if (killed) {
        resolvePromise({
          output: `Command timed out after ${timeout}ms.\n\n${output}`,
          isError: true,
        })
        return
      }

      if (code !== 0 && code !== null) {
        resolvePromise({
          output: `Command exited with code ${code}.\n\n${output}`,
          isError: true,
        })
        return
      }

      resolvePromise({ output: output || "(no output)" })
    })

    proc.on("error", (err) => {
      clearTimeout(timeoutId)
      resolvePromise({
        output: `Error spawning command: ${err.message}`,
        isError: true,
      })
    })

    if (context.signal) {
      context.signal.addEventListener("abort", () => {
        proc.kill("SIGTERM")
      })
    }
  })
}

export const bashTool: Tool = {
  spec: {
    name: "Bash",
    description: `Execute a shell command.

Use this to run commands on the system. Commands run in a non-interactive shell.

Rules:
- Do NOT chain commands with ; or && - make separate tool calls instead
- Do NOT use interactive commands (vim, nano, less, etc.)
- Output is truncated to last 100k characters
- Commands time out after 2 minutes by default
- Use cwd parameter to change working directory instead of cd`,
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command (defaults to project root)",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 120000)",
        },
      },
      required: ["command"],
    },
  },
  execute: executeBash,
}
