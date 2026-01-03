/**
 * OAuth Token Storage
 * Stores and retrieves OAuth tokens from ~/.claude.json (matching Claude Code's format)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

export interface OAuthAccount {
  accountUuid: string
  emailAddress: string
  organizationUuid?: string
  displayName?: string
  hasExtraUsageEnabled?: boolean
  organizationRole?: string
  workspaceRole?: string | null
  organizationName?: string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp in milliseconds
  scopes?: string[]
  subscriptionType?: string | null
  rateLimitTier?: string | null
}

// Claude Code's settings file structure (partial)
interface ClaudeSettings {
  oauthAccount?: OAuthAccount
  claudeAiOauth?: OAuthTokens  // Tokens from claude.ai auth
  consoleOauth?: OAuthTokens   // Tokens from console.anthropic.com auth
  [key: string]: unknown
}

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")
}

/**
 * Get the settings file path (matches Claude Code: ~/.claude.json)
 */
function getSettingsFilePath(): string {
  return join(homedir(), ".claude.json")
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  const configDir = getConfigDir()
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 })
  }
}

/**
 * Load Claude settings from ~/.claude.json
 */
function loadSettings(): ClaudeSettings {
  const settingsPath = getSettingsFilePath()

  if (!existsSync(settingsPath)) {
    return {}
  }

  try {
    const data = readFileSync(settingsPath, "utf-8")
    return JSON.parse(data) as ClaudeSettings
  } catch {
    return {}
  }
}

/**
 * Save Claude settings to ~/.claude.json
 */
function saveSettings(settings: ClaudeSettings): void {
  ensureConfigDir()
  const settingsPath = getSettingsFilePath()

  // Write with restrictive permissions (owner read/write only)
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 })
}

/**
 * Get stored OAuth tokens (checks both claudeAiOauth and consoleOauth)
 */
export function getStoredTokens(): OAuthTokens | null {
  const settings = loadSettings()

  // Prefer claudeAiOauth (claude.ai auth), fall back to consoleOauth (console auth)
  const tokens = settings.claudeAiOauth ?? settings.consoleOauth

  if (!tokens?.accessToken) {
    return null
  }

  return tokens
}

/**
 * Save OAuth tokens (stores in claudeAiOauth to match Claude Code)
 */
export function saveTokens(tokens: OAuthTokens, account?: OAuthAccount): void {
  const settings = loadSettings()

  // Store tokens in claudeAiOauth (matching Claude Code's format)
  settings.claudeAiOauth = tokens

  // Also update oauthAccount if provided
  if (account) {
    settings.oauthAccount = account
  }

  saveSettings(settings)
}

/**
 * Clear stored OAuth tokens (logout)
 */
export function clearTokens(): void {
  const settings = loadSettings()

  delete settings.claudeAiOauth
  delete settings.consoleOauth
  delete settings.oauthAccount

  saveSettings(settings)
}

/**
 * Check if tokens are expired or about to expire
 */
export function isTokenExpired(tokens: OAuthTokens, bufferMs: number = 0): boolean {
  if (!tokens.expiresAt) return true
  const now = Date.now()
  return now >= tokens.expiresAt - bufferMs
}

/**
 * Check if user is authenticated with valid tokens
 */
export function isAuthenticated(): boolean {
  const tokens = getStoredTokens()
  if (!tokens) return false
  // Consider authenticated if we have tokens (refresh will handle expiry)
  return !!tokens.accessToken && !!tokens.refreshToken
}

/**
 * Get the current user's account info
 */
export function getCurrentAccount(): OAuthAccount | null {
  const settings = loadSettings()
  return settings.oauthAccount ?? null
}

/**
 * Get the config directory path (exported for other modules)
 */
export { getConfigDir }
