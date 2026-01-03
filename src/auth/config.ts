/**
 * OAuth Configuration
 * Replicates Claude Code's OAuth endpoints and client configuration
 */

export interface OAuthConfig {
  BASE_API_URL: string
  CONSOLE_AUTHORIZE_URL: string
  CLAUDE_AI_AUTHORIZE_URL: string
  TOKEN_URL: string
  API_KEY_URL: string
  ROLES_URL: string
  CONSOLE_SUCCESS_URL: string
  CLAUDEAI_SUCCESS_URL: string
  MANUAL_REDIRECT_URL: string
  CLIENT_ID: string
}

// Production OAuth configuration - matches Claude Code exactly
export const OAUTH_CONFIG: OAuthConfig = {
  BASE_API_URL: "https://api.anthropic.com",
  CONSOLE_AUTHORIZE_URL: "https://console.anthropic.com/oauth/authorize",
  CLAUDE_AI_AUTHORIZE_URL: "https://claude.ai/oauth/authorize",
  // IMPORTANT: Token URL is on console.anthropic.com, NOT api.anthropic.com!
  TOKEN_URL: "https://console.anthropic.com/v1/oauth/token",
  API_KEY_URL: "https://api.anthropic.com/api/oauth/claude_cli/create_api_key",
  ROLES_URL: "https://api.anthropic.com/api/oauth/claude_cli/roles",
  CONSOLE_SUCCESS_URL: "https://console.anthropic.com/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dclaude-code",
  CLAUDEAI_SUCCESS_URL: "https://console.anthropic.com/oauth/code/success?app=claude-code",
  MANUAL_REDIRECT_URL: "https://console.anthropic.com/oauth/code/callback",
  CLIENT_ID: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
}

// Scopes required for the CLI (matches claude.js and opencode-anthropic-auth)
export const OAUTH_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
]

// Local callback server port
export const CALLBACK_PORT = 51423

// Token refresh settings
export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000 // Refresh 5 minutes before expiry

// API version header
export const ANTHROPIC_VERSION = "2023-06-01"
