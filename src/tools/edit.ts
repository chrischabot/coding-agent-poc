import { readFile, writeFile, mkdir } from "node:fs/promises"
import { resolve, isAbsolute, dirname } from "node:path"
import type { Tool, ToolContext, ExecutionProfile } from "../core/types"
import { checkFileConflict, recordFileRead } from "../context/file-state"

function createUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string
): string {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")

  const diff: string[] = []
  diff.push(`--- a/${filePath}`)
  diff.push(`+++ b/${filePath}`)

  let i = 0
  let j = 0

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++
      j++
      continue
    }

    const hunkStartOld = Math.max(0, i - 3)
    const hunkStartNew = Math.max(0, j - 3)

    let hunkEndOld = i
    let hunkEndNew = j

    while (hunkEndOld < oldLines.length || hunkEndNew < newLines.length) {
      if (
        hunkEndOld < oldLines.length &&
        hunkEndNew < newLines.length &&
        oldLines[hunkEndOld] === newLines[hunkEndNew]
      ) {
        let contextCount = 0
        let k = 0
        while (
          hunkEndOld + k < oldLines.length &&
          hunkEndNew + k < newLines.length &&
          oldLines[hunkEndOld + k] === newLines[hunkEndNew + k] &&
          contextCount < 3
        ) {
          contextCount++
          k++
        }
        if (contextCount >= 3) {
          hunkEndOld += contextCount
          hunkEndNew += contextCount
          break
        }
      }
      if (hunkEndOld < oldLines.length) hunkEndOld++
      if (hunkEndNew < newLines.length) hunkEndNew++
    }

    const oldLen = hunkEndOld - hunkStartOld
    const newLen = hunkEndNew - hunkStartNew
    diff.push(`@@ -${hunkStartOld + 1},${oldLen} +${hunkStartNew + 1},${newLen} @@`)

    let oi = hunkStartOld
    let ni = hunkStartNew

    while (oi < hunkEndOld || ni < hunkEndNew) {
      if (oi < hunkEndOld && ni < hunkEndNew && oldLines[oi] === newLines[ni]) {
        diff.push(` ${oldLines[oi]}`)
        oi++
        ni++
      } else if (oi < hunkEndOld && (ni >= hunkEndNew || oldLines[oi] !== newLines[ni])) {
        diff.push(`-${oldLines[oi]}`)
        oi++
      } else if (ni < hunkEndNew) {
        diff.push(`+${newLines[ni]}`)
        ni++
      }
    }

    i = hunkEndOld
    j = hunkEndNew
  }

  return diff.join("\n")
}

async function executeEdit(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const filePath = input.path as string
  const oldStr = input.old_str as string
  const newStr = input.new_str as string
  const createIfMissing = input.create_if_missing as boolean | undefined

  if (!filePath) {
    return { output: "Error: path is required", isError: true }
  }

  if (oldStr === undefined) {
    return { output: "Error: old_str is required", isError: true }
  }

  if (newStr === undefined) {
    return { output: "Error: new_str is required", isError: true }
  }

  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(context.workingDirectory, filePath)

  try {
    let content: string
    try {
      content = await readFile(resolvedPath, "utf-8")
    } catch (err) {
      if (createIfMissing && oldStr === "") {
        await mkdir(dirname(resolvedPath), { recursive: true })
        await writeFile(resolvedPath, newStr, "utf-8")
        return { output: `Created new file: ${filePath}` }
      }
      return { output: `Error: File not found: ${filePath}`, isError: true }
    }

    const occurrences = content.split(oldStr).length - 1

    if (occurrences === 0) {
      return {
        output: `Error: old_str not found in file. Make sure to include exact whitespace and content.`,
        isError: true,
      }
    }

    if (occurrences > 1) {
      return {
        output: `Error: old_str found ${occurrences} times. Include more context to make it unique.`,
        isError: true,
      }
    }

    const conflict = await checkFileConflict(resolvedPath, context.threadId)
    if (conflict.hasConflict) {
      return {
        output: `Error: ${conflict.message}`,
        isError: true,
      }
    }

    const newContent = content.replace(oldStr, newStr)
    await writeFile(resolvedPath, newContent, "utf-8")
    await recordFileRead(resolvedPath, context.threadId)

    const diff = createUnifiedDiff(content, newContent, filePath)
    return { output: `File edited successfully.\n\n${diff}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { output: `Error editing file: ${message}`, isError: true }
  }
}

const editExecutionProfile: ExecutionProfile = {
  resourceKeys: (input) => {
    const path = input.path as string | undefined
    if (path) {
      return [{ key: path, mode: "write" }]
    }
    return []
  },
}

export const editTool: Tool = {
  spec: {
    name: "Edit",
    description: `Edit a file by replacing text. Uses exact string matching.

Replaces the first occurrence of old_str with new_str in the file.

Rules:
- old_str must match EXACTLY including whitespace and indentation
- old_str must be unique in the file (include more context if needed)
- For creating new files, use old_str="" with create_if_missing=true
- Always read the file first to see exact content before editing`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to edit",
        },
        old_str: {
          type: "string",
          description: "Exact string to replace (must match including whitespace)",
        },
        new_str: {
          type: "string",
          description: "New string to insert",
        },
        create_if_missing: {
          type: "boolean",
          description: "Create the file if it doesn't exist (use with old_str='')",
        },
      },
      required: ["path", "old_str", "new_str"],
    },
  },
  execute: executeEdit,
  executionProfile: editExecutionProfile,
}
