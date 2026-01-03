import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { ulid } from "ulid"
import type { Thread, Message, CompactionState } from "../core/types"

const SESSION_DIR = join(homedir(), ".coding-agent", "sessions")
const threadCache = new Map<string, Thread>()

export async function ensureSessionDir(): Promise<void> {
  await mkdir(SESSION_DIR, { recursive: true })
}

export function createThread(workingDirectory: string): Thread {
  const id = `T-${ulid()}`
  const now = Date.now()
  const thread: Thread = {
    id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    messages: [],
    workingDirectory,
  }
  threadCache.set(id, thread)
  return thread
}

export async function saveThread(thread: Thread): Promise<void> {
  await ensureSessionDir()
  const filePath = join(SESSION_DIR, `${thread.id}.json`)
  thread.updatedAt = Date.now()
  await writeFile(filePath, JSON.stringify(thread, null, 2), "utf-8")
  threadCache.set(thread.id, thread)
}

export async function loadThread(threadId: string): Promise<Thread | null> {
  const cached = threadCache.get(threadId)
  if (cached) {
    return cached
  }

  try {
    const filePath = join(SESSION_DIR, `${threadId}.json`)
    const content = await readFile(filePath, "utf-8")
    const thread = JSON.parse(content) as Thread
    threadCache.set(threadId, thread)
    return thread
  } catch {
    return null
  }
}

export async function listThreads(): Promise<{ id: string; title?: string; updatedAt: number }[]> {
  await ensureSessionDir()
  const files = await readdir(SESSION_DIR)
  const threads: { id: string; title?: string; updatedAt: number }[] = []

  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      const content = await readFile(join(SESSION_DIR, file), "utf-8")
      const thread = JSON.parse(content) as Thread
      threads.push({
        id: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt,
      })
    } catch {
      continue
    }
  }

  return threads.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getLatestThread(): Promise<Thread | null> {
  const threads = await listThreads()
  if (threads.length === 0) return null
  return loadThread(threads[0].id)
}

/**
 * Save a compaction state to the thread and persist to disk
 * @returns The ID of the saved compaction state
 */
export async function saveCompactionState(
  thread: Thread,
  state: Omit<CompactionState, "id" | "timestamp">
): Promise<string> {
  const id = `CS-${ulid()}`
  const compactionState: CompactionState = {
    ...state,
    id,
    timestamp: new Date().toISOString(),
  }

  if (!thread.compactionStates) {
    thread.compactionStates = []
  }
  thread.compactionStates.push(compactionState)

  await saveThread(thread)
  return id
}

/**
 * Load the latest compaction state from a thread
 * @returns The most recent compaction state, or null if none exists
 */
export function loadLatestCompactionState(thread: Thread): CompactionState | null {
  if (!thread.compactionStates || thread.compactionStates.length === 0) {
    return null
  }
  return thread.compactionStates[thread.compactionStates.length - 1]
}

/**
 * Load the latest LLM-generated compaction summary (not serialized)
 * @returns The most recent LLM summary, or null if none exists
 */
export function loadLatestLlmCompactionState(thread: Thread): CompactionState | null {
  if (!thread.compactionStates || thread.compactionStates.length === 0) {
    return null
  }

  // Find the most recent LLM summary (not serialized)
  for (let i = thread.compactionStates.length - 1; i >= 0; i--) {
    const state = thread.compactionStates[i]
    if (state.summaryKind === "llm_summary") {
      return state
    }
  }
  return null
}
