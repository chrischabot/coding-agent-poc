import { rm, stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import type { Tool, ToolContext, ToolResult, ExecutionProfile } from "../core/types"

const deleteExecutionProfile: ExecutionProfile = {
  resourceKeys: (input, workingDirectory) => {
    const pathInput = input.path as string | undefined
    if (pathInput) {
      const resolvedPath = isAbsolute(pathInput)
        ? pathInput
        : resolve(workingDirectory ?? process.cwd(), pathInput)
      return [{ key: resolvedPath, mode: "write" }]
    }
    return []
  },
}

export const deleteTool: Tool = {
  spec: {
    name: "Delete",
    description: `Delete a file or directory.

Use this to remove files or directories. For directories, use recursive: true.
Be careful - this operation cannot be undone.`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file or directory to delete",
        },
        recursive: {
          type: "boolean",
          description: "If true, recursively delete directories. Required for non-empty directories.",
        },
      },
      required: ["path"],
    },
  },
  executionProfile: deleteExecutionProfile,
  async execute(input, context): Promise<ToolResult> {
    const pathInput = input.path as string
    const recursive = input.recursive as boolean | undefined

    if (!pathInput) {
      return { output: "Error: path is required", isError: true }
    }

    const filePath = isAbsolute(pathInput)
      ? pathInput
      : join(context.workingDirectory, pathInput)

    try {
      const stats = await stat(filePath)
      const isDir = stats.isDirectory()

      if (isDir && !recursive) {
        return {
          output: "Error: Cannot delete directory without recursive: true",
          isError: true,
        }
      }

      await rm(filePath, { recursive: recursive ?? false, force: false })
      return { output: `Deleted: ${filePath}` }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("ENOENT")) {
        return { output: `Error: File not found: ${filePath}`, isError: true }
      }
      return { output: `Error deleting: ${message}`, isError: true }
    }
  },
}
