import path from "path";
import os from "os";
import type { CoreMessage } from "ai";
import type { WorkingMemoryState } from "../layer/working.js";

/**
 * Session information stored on disk
 */
export interface SessionInfo {
  id: string;
  createdAt: number;
  workingDirectory: string;
  fastModel: string;
  deepModel: string;
  workingMemory: WorkingMemoryState;
  messages: CoreMessage[];
  messageCount: number;
}

/**
 * Summary of a session for listing
 */
export interface SessionSummary {
  id: string;
  createdAt: number;
  workingDirectory: string;
  messageCount: number;
}

/**
 * Get the sessions directory
 */
function getSessionsDir(): string {
  return path.join(os.homedir(), ".coding-agent", "sessions");
}

/**
 * Get the path to a session file
 */
function getSessionPath(sessionId: string): string {
  return path.join(getSessionsDir(), `${sessionId}.json`);
}

/**
 * Session persistence utilities
 */
export const SessionPersistence = {
  /**
   * Save a session to disk
   */
  async save(session: SessionInfo): Promise<void> {
    const sessionPath = getSessionPath(session.id);
    const dir = path.dirname(sessionPath);

    // Ensure directory exists
    await Bun.write(path.join(dir, ".gitkeep"), "");

    // Write session
    await Bun.write(sessionPath, JSON.stringify(session, null, 2));
  },

  /**
   * Load a session from disk
   */
  async load(sessionId: string): Promise<SessionInfo | null> {
    const sessionPath = getSessionPath(sessionId);
    const file = Bun.file(sessionPath);

    if (!(await file.exists())) {
      return null;
    }

    try {
      const content = await file.text();
      return JSON.parse(content) as SessionInfo;
    } catch (error) {
      console.error(`Failed to load session ${sessionId}:`, error);
      return null;
    }
  },

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<boolean> {
    const sessionPath = getSessionPath(sessionId);
    const file = Bun.file(sessionPath);

    if (!(await file.exists())) {
      return false;
    }

    try {
      // Bun doesn't have a direct delete, use fs
      const fs = await import("fs/promises");
      await fs.unlink(sessionPath);
      return true;
    } catch (error) {
      console.error(`Failed to delete session ${sessionId}:`, error);
      return false;
    }
  },

  /**
   * List all sessions
   */
  async list(): Promise<SessionSummary[]> {
    const sessionsDir = getSessionsDir();
    const summaries: SessionSummary[] = [];

    try {
      const fs = await import("fs/promises");

      // Check if directory exists
      try {
        await fs.access(sessionsDir);
      } catch {
        return [];
      }

      const entries = await fs.readdir(sessionsDir);

      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;

        const sessionId = entry.replace(".json", "");
        const session = await SessionPersistence.load(sessionId);

        if (session) {
          summaries.push({
            id: session.id,
            createdAt: session.createdAt,
            workingDirectory: session.workingDirectory,
            messageCount: session.messageCount,
          });
        }
      }

      // Sort by creation date, newest first
      summaries.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      console.error("Failed to list sessions:", error);
    }

    return summaries;
  },

  /**
   * Get the most recent session for a directory
   */
  async getMostRecentForDirectory(
    directory: string
  ): Promise<SessionInfo | null> {
    const summaries = await SessionPersistence.list();
    const matching = summaries.find(
      (s) => s.workingDirectory === directory
    );

    if (matching) {
      return SessionPersistence.load(matching.id);
    }

    return null;
  },

  /**
   * Clean up old sessions (older than given days)
   */
  async cleanup(olderThanDays: number = 30): Promise<number> {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const summaries = await SessionPersistence.list();
    let deleted = 0;

    for (const summary of summaries) {
      if (summary.createdAt < cutoff) {
        const success = await SessionPersistence.delete(summary.id);
        if (success) deleted++;
      }
    }

    return deleted;
  },
};
