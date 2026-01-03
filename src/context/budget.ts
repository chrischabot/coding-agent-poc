import { stat } from "node:fs/promises"

const CHARS_PER_TOKEN = 4

export interface BudgetConfig {
  contextLimit: number
  compressionThreshold: number
  reserveTokens: number
}

export interface BudgetStatus {
  used: number
  available: number
  total: number
  percentUsed: number
  compressionImminent: boolean
}

export interface ContextBudget {
  getStatus(): BudgetStatus
  available(): number
  canAccommodate(tokens: number): boolean
  wouldTriggerCompression(tokens: number): boolean
  estimateFileTokens(filePath: string): Promise<number>
  estimateContentTokens(content: string): number
  setCurrentThreadTokens(tokens: number): void
  configure(config: Partial<BudgetConfig>): void
}

const DEFAULT_CONFIG: BudgetConfig = {
  contextLimit: 150000,
  compressionThreshold: 0.9,
  reserveTokens: 4096,
}

export function createContextBudget(
  initialConfig?: Partial<BudgetConfig>
): ContextBudget {
  let config: BudgetConfig = { ...DEFAULT_CONFIG, ...initialConfig }
  let currentThreadTokens = 0

  function getCompressionPoint(): number {
    return config.contextLimit * config.compressionThreshold
  }

  function getAvailableTokens(): number {
    const compressionPoint = getCompressionPoint()
    return Math.max(0, compressionPoint - currentThreadTokens - config.reserveTokens)
  }

  return {
    getStatus(): BudgetStatus {
      const compressionPoint = getCompressionPoint()
      const available = getAvailableTokens()
      const percentUsed = (currentThreadTokens / config.contextLimit) * 100

      return {
        used: currentThreadTokens,
        available,
        total: config.contextLimit,
        percentUsed: Math.round(percentUsed * 10) / 10,
        compressionImminent: currentThreadTokens > compressionPoint * 0.95,
      }
    },

    available(): number {
      return getAvailableTokens()
    },

    canAccommodate(tokens: number): boolean {
      return getAvailableTokens() >= tokens
    },

    wouldTriggerCompression(tokens: number): boolean {
      const afterAdding = currentThreadTokens + tokens
      return afterAdding >= getCompressionPoint()
    },

    async estimateFileTokens(filePath: string): Promise<number> {
      try {
        const stats = await stat(filePath)
        return Math.ceil(stats.size / CHARS_PER_TOKEN)
      } catch {
        return 0
      }
    },

    estimateContentTokens(content: string): number {
      return Math.ceil(content.length / CHARS_PER_TOKEN)
    },

    setCurrentThreadTokens(tokens: number): void {
      currentThreadTokens = tokens
    },

    configure(newConfig: Partial<BudgetConfig>): void {
      config = { ...config, ...newConfig }
    },
  }
}
