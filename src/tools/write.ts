import { writeFile, mkdir } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import type { Tool, ToolContext, ToolResult, ExecutionProfile } from "../core/types"

const writeExecutionProfile: ExecutionProfile = {
  resourceKeys: (input) => {
    const path = input.path as string | undefined
    if (path) {
      return [{ key: path, mode: "write" }]
    }
    return []
  },
}

export const writeTool: Tool = {
  spec: {
    name: "Write",
    description: `Create a new file with the specified content.

Use this to create new files. For modifying existing files, use Edit instead.

The file path can be absolute or relative to the working directory.
Parent directories will be created automatically if they don't exist.`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to create",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  executionProfile: writeExecutionProfile,
  async execute(input, context): Promise<ToolResult> {
    const pathInput = input.path as string
    const content = input.content as string

    if (!pathInput) {
      return { output: "Error: path is required", isError: true }
    }

    const filePath = isAbsolute(pathInput)
      ? pathInput
      : join(context.workingDirectory, pathInput)

    try {
      const dir = dirname(filePath)
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, content, "utf-8")
      return { output: `Created file: ${filePath} (${content.length} bytes)` }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Error creating file: ${message}`, isError: true }
    }
  },
}
