import { stat } from "node:fs/promises"

interface FileReadRecord {
  timestamp: number
  mtime: number
}

type ThreadFileRecords = Map<string, FileReadRecord>
const fileReadsByThread = new Map<string, ThreadFileRecords>()

export async function recordFileRead(
  filePath: string,
  threadId: string
): Promise<void> {
  try {
    const stats = await stat(filePath)
    
    let threadRecords = fileReadsByThread.get(threadId)
    if (!threadRecords) {
      threadRecords = new Map()
      fileReadsByThread.set(threadId, threadRecords)
    }
    
    threadRecords.set(filePath, {
      timestamp: Date.now(),
      mtime: stats.mtimeMs,
    })
  } catch {
    const threadRecords = fileReadsByThread.get(threadId)
    if (threadRecords) {
      threadRecords.delete(filePath)
    }
  }
}

export async function checkFileConflict(
  filePath: string,
  threadId: string
): Promise<{ hasConflict: boolean; message?: string }> {
  const threadRecords = fileReadsByThread.get(threadId)
  if (!threadRecords) {
    return { hasConflict: false }
  }

  const lastRead = threadRecords.get(filePath)
  if (!lastRead) {
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
    for (const threadRecords of fileReadsByThread.values()) {
      threadRecords.delete(filePath)
    }
  } else {
    fileReadsByThread.clear()
  }
}

export function clearThreadFileState(threadId: string): void {
  fileReadsByThread.delete(threadId)
}
