import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { ulid } from "ulid"
import type { Thread, Message } from "../core/types"

const SESSION_DIR = join(homedir(), ".coding-agent", "sessions")

export async function ensureSessionDir(): Promise<void> {
  await mkdir(SESSION_DIR, { recursive: true })
}

export function createThread(workingDirectory: string): Thread {
  const id = `T-${ulid()}`
  const now = Date.now()
  return {
    id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    messages: [],
    workingDirectory,
  }
}

export async function saveThread(thread: Thread): Promise<void> {
  await ensureSessionDir()
  const filePath = join(SESSION_DIR, `${thread.id}.json`)
  thread.updatedAt = Date.now()
  await writeFile(filePath, JSON.stringify(thread, null, 2), "utf-8")
}

export async function loadThread(threadId: string): Promise<Thread | null> {
  try {
    const filePath = join(SESSION_DIR, `${threadId}.json`)
    const content = await readFile(filePath, "utf-8")
    return JSON.parse(content) as Thread
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
