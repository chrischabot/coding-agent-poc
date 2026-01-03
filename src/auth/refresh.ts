/**
 * OAuth Token Refresh
 * Handles automatic token refresh with file-based locking to prevent race conditions
 */

import { existsSync, writeFileSync, unlinkSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { OAUTH_CONFIG, TOKEN_REFRESH_BUFFER_MS } from "./config"
import {
  getStoredTokens,
  saveTokens,
  isTokenExpired,
  getConfigDir,
  type OAuthTokens,
} from "./storage"

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

// Lock file path
function getLockFilePath(): string {
  return join(getConfigDir(), ".token_refresh.lock")
}

// Lock timeout (30 seconds)
const LOCK_TIMEOUT_MS = 30 * 1000

/**
 * Simple file-based lock implementation
 */
async function acquireLock(maxRetries: number = 5): Promise<() => void> {
  const lockPath = getLockFilePath()

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Check if lock exists and is not stale
    if (existsSync(lockPath)) {
      try {
        const lockData = readFileSync(lockPath, "utf-8")
        const lockTime = parseInt(lockData, 10)
        const now = Date.now()

        // If lock is stale (older than timeout), remove it
        if (now - lockTime > LOCK_TIMEOUT_MS) {
          unlinkSync(lockPath)
        } else {
          // Lock is held by another process, wait and retry
          await new Promise((resolve) => setTimeout(resolve, 500))
          continue
        }
      } catch {
        // If we can't read the lock file, try to remove it
        try {
          unlinkSync(lockPath)
        } catch {
          // Ignore
        }
      }
    }

    // Try to create lock file
    try {
      writeFileSync(lockPath, Date.now().toString(), { flag: "wx" })
      // Lock acquired successfully
      return () => {
        try {
          unlinkSync(lockPath)
        } catch {
          // Ignore errors when releasing lock
        }
      }
    } catch {
      // Lock file already exists (race condition), retry
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  throw new Error("Failed to acquire token refresh lock after max retries")
}

/**
 * Refresh the access token using the refresh token
 * Uses JSON format matching opencode-anthropic-auth
 */
async function performTokenRefresh(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(OAUTH_CONFIG.TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OAUTH_CONFIG.CLIENT_ID,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed: ${response.status} ${text}`)
  }

  return response.json() as Promise<TokenResponse>
}

/**
 * Refresh tokens if needed (with locking)
 * Returns the current valid access token
 */
export async function ensureValidToken(): Promise<string> {
  let tokens = getStoredTokens()

  if (!tokens) {
    throw new Error("Not authenticated. Please run 'coding-agent login' first.")
  }

  // Check if token needs refresh
  if (!isTokenExpired(tokens, TOKEN_REFRESH_BUFFER_MS)) {
    return tokens.accessToken
  }

  // Token needs refresh, acquire lock
  let releaseLock: (() => void) | null = null

  try {
    releaseLock = await acquireLock()

    // Re-check tokens after acquiring lock (another process may have refreshed)
    tokens = getStoredTokens()
    if (!tokens) {
      throw new Error("Not authenticated. Please run 'coding-agent login' first.")
    }

    // Check again if still needs refresh
    if (!isTokenExpired(tokens, TOKEN_REFRESH_BUFFER_MS)) {
      return tokens.accessToken
    }

    // Perform the refresh
    const tokenResponse = await performTokenRefresh(tokens.refreshToken)

    // Calculate new expiry
    const expiresAt = Date.now() + tokenResponse.expires_in * 1000

    // Update tokens (preserve scopes and other metadata)
    const newTokens: OAuthTokens = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
      scopes: tokens.scopes,
    }

    // Save tokens (account is already stored separately)
    saveTokens(newTokens)

    return newTokens.accessToken
  } finally {
    if (releaseLock) {
      releaseLock()
    }
  }
}

/**
 * Check if we need to refresh (for UI indicators)
 */
export function needsRefresh(): boolean {
  const tokens = getStoredTokens()
  if (!tokens) return false
  return isTokenExpired(tokens, TOKEN_REFRESH_BUFFER_MS)
}
