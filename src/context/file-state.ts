import { stat } from "node:fs/promises"

interface FileReadRecord {
  threadId: string
  timestamp: number
  mtime: number
}

const fileReadTimestamps = new Map<string, FileReadRecord>()

export async function recordFileRead(
  filePath: string,
  threadId: string
): Promise<void> {
  try {
    const stats = await stat(filePath)
    fileReadTimestamps.set(filePath, {
      threadId,
      timestamp: Date.now(),
      mtime: stats.mtimeMs,
    })
  } catch {
    fileReadTimestamps.delete(filePath)
  }
}

export async function checkFileConflict(
  filePath: string,
  threadId: string
): Promise<{ hasConflict: boolean; message?: string }> {
  const lastRead = fileReadTimestamps.get(filePath)

  if (!lastRead) {
    return { hasConflict: false }
  }

  if (lastRead.threadId !== threadId) {
    return { hasConflict: false }
  }

  try {
    const stats = await stat(filePath)
    const currentMtime = stats.mtimeMs

    if (currentMtime > lastRead.mtime) {
      return {
        hasConflict: true,
        message: `File "${filePath}" was modified externally since last read. Please re-read the file before editing.`,
      }
    }

    return { hasConflict: false }
  } catch {
    return { hasConflict: false }
  }
}

export function clearFileState(filePath?: string): void {
  if (filePath) {
    fileReadTimestamps.delete(filePath)
  } else {
    fileReadTimestamps.clear()
  }
}

export function clearThreadFileState(threadId: string): void {
  for (const [path, record] of fileReadTimestamps) {
    if (record.threadId === threadId) {
      fileReadTimestamps.delete(path)
    }
  }
}
