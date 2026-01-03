import { extname } from "node:path"
import { SimpleLSPClient } from "./client"
import type { SupportedLanguage, LSPClient, LSPManager, LSPServerConfig } from "./types"
import { LSP_SERVER_CONFIGS } from "./types"

const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  // TypeScript
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  // JavaScript
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  // Python
  ".py": "python",
  ".pyw": "python",
  ".pyi": "python",
  // Go
  ".go": "go",
  // Rust
  ".rs": "rust",
  // Java
  ".java": "java",
  // C
  ".c": "c",
  ".h": "c",
  // C++
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  // C#
  ".cs": "csharp",
  // Ruby
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  // PHP
  ".php": "php",
  ".phtml": "php",
}

export function detectLanguageFromFile(filePath: string): SupportedLanguage | null {
  const ext = extname(filePath).toLowerCase()
  return EXTENSION_TO_LANGUAGE[ext] || null
}

export function createLSPManager(workingDirectory: string): LSPManager {
  const clients: Map<SupportedLanguage, SimpleLSPClient> = new Map()
  const initPromises: Map<SupportedLanguage, Promise<SimpleLSPClient | null>> = new Map()
  const availabilityCache: Map<SupportedLanguage, boolean> = new Map()

  async function checkAvailability(language: SupportedLanguage): Promise<boolean> {
    if (availabilityCache.has(language)) {
      return availabilityCache.get(language)!
    }

    const config = LSP_SERVER_CONFIGS[language]
    if (!config) {
      availabilityCache.set(language, false)
      return false
    }

    // Check if command exists using Bun.which
    const path = Bun.which(config.command)
    const available = path !== null

    availabilityCache.set(language, available)
    return available
  }

  return {
    async getClient(language: SupportedLanguage): Promise<LSPClient | null> {
      // Return existing client if initialized
      const existingClient = clients.get(language)
      if (existingClient?.isInitialized()) {
        return existingClient
      }

      // Return pending initialization if in progress
      if (initPromises.has(language)) {
        return initPromises.get(language)!
      }

      // Check availability first
      const available = await checkAvailability(language)
      if (!available) {
        return null
      }

      // Start initialization
      const initPromise = (async (): Promise<SimpleLSPClient | null> => {
        const config = LSP_SERVER_CONFIGS[language]

        try {
          const client = new SimpleLSPClient(config)
          await client.initialize(workingDirectory)
          clients.set(language, client)
          return client
        } catch (err) {
          console.warn(`[LSP] Failed to initialize ${language} server:`, err)
          return null
        } finally {
          initPromises.delete(language)
        }
      })()

      initPromises.set(language, initPromise)
      return initPromise
    },

    async getClientForFile(filePath: string): Promise<LSPClient | null> {
      const language = detectLanguageFromFile(filePath)
      if (!language) {
        return null
      }
      return this.getClient(language)
    },

    async isAvailable(language: SupportedLanguage): Promise<boolean> {
      return checkAvailability(language)
    },

    async shutdownAll(): Promise<void> {
      const shutdownPromises: Promise<void>[] = []

      for (const client of clients.values()) {
        if (client.isInitialized()) {
          shutdownPromises.push(client.shutdown())
        }
      }

      await Promise.all(shutdownPromises)
      clients.clear()
      initPromises.clear()
    },

    getActiveServers(): SupportedLanguage[] {
      const active: SupportedLanguage[] = []
      for (const [language, client] of clients.entries()) {
        if (client.isInitialized()) {
          active.push(language)
        }
      }
      return active.sort()
    },
  }
}
