/**
 * OAuth Authorization Flow
 * Implements the browser-based OAuth 2.0 authorization code flow with PKCE
 * Uses manual redirect flow where user pastes the code back
 */

import { exec } from "node:child_process"
import { platform } from "node:os"
import { createInterface } from "node:readline"
import { OAUTH_CONFIG, OAUTH_SCOPES } from "./config"
import { generatePKCE, type PKCEPair } from "./pkce"
import { saveTokens, getStoredTokens, getCurrentAccount, type OAuthTokens, type OAuthAccount } from "./storage"

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  scope?: string
}

interface ProfileResponse {
  account: {
    uuid: string
    email: string
    full_name?: string
    display_name?: string
    has_claude_max?: boolean
    has_claude_pro?: boolean
  }
  organization?: {
    uuid: string
    name: string
    organization_type?: string
    rate_limit_tier?: string
    has_extra_usage_enabled?: boolean
  }
}

/**
 * Open a URL in the default browser
 */
function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const os = platform()
    let command: string

    switch (os) {
      case "darwin":
        command = `open "${url}"`
        break
      case "win32":
        command = `start "" "${url}"`
        break
      default:
        // Linux and others
        command = `xdg-open "${url}"`
    }

    exec(command, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

/**
 * Build the authorization URL
 * Uses the MANUAL redirect flow - user will paste the code back
 * The state parameter is set to the code verifier (required by Anthropic's OAuth)
 */
export function buildAuthorizationUrl(pkce: PKCEPair, useClaude: boolean = true): string {
  const baseUrl = useClaude
    ? OAUTH_CONFIG.CLAUDE_AI_AUTHORIZE_URL
    : OAUTH_CONFIG.CONSOLE_AUTHORIZE_URL

  const params = new URLSearchParams()
  params.set("code", "true")
  params.set("client_id", OAUTH_CONFIG.CLIENT_ID)
  params.set("response_type", "code")
  params.set("redirect_uri", OAUTH_CONFIG.MANUAL_REDIRECT_URL)
  params.set("scope", OAUTH_SCOPES.join(" "))
  params.set("code_challenge", pkce.codeChallenge)
  params.set("code_challenge_method", pkce.codeChallengeMethod)
  // IMPORTANT: state is set to the verifier - the returned code will include this
  params.set("state", pkce.codeVerifier)

  return `${baseUrl}?${params.toString()}`
}

/**
 * Exchange authorization code for tokens
 * The code from manual redirect is in format "code#state"
 * Uses JSON format as required by the OAuth endpoint
 */
async function exchangeCodeForTokens(codeWithState: string, codeVerifier: string): Promise<TokenResponse> {
  // Parse the code#state format from manual redirect
  const parts = codeWithState.split("#")
  const code = parts[0]
  const state = parts[1] || codeVerifier // state should equal verifier

  // Build JSON body - this is the correct format that works
  const body = JSON.stringify({
    grant_type: "authorization_code",
    client_id: OAUTH_CONFIG.CLIENT_ID,
    redirect_uri: OAUTH_CONFIG.MANUAL_REDIRECT_URL,
    code,
    state,
    code_verifier: codeVerifier,
  })

  try {
    const response = await fetch(OAUTH_CONFIG.TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    })

    if (!response.ok) {
      const error = await response.text()
      console.error("Token exchange request failed:")
      console.error("  URL:", OAUTH_CONFIG.TOKEN_URL)
      console.error("  Status:", response.status)
      console.error("  Response:", error)
      throw new Error(`Token exchange failed: ${response.status} ${error}`)
    }

    return response.json() as Promise<TokenResponse>
  } catch (error) {
    if (error instanceof Error) {
      console.error("Token exchange error:", error.message)
    }
    throw error
  }
}

/**
 * Fetch the user's profile
 */
async function fetchProfile(accessToken: string): Promise<ProfileResponse> {
  const response = await fetch(`${OAUTH_CONFIG.BASE_API_URL}/api/oauth/profile`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to fetch profile: ${response.status} ${text}`)
  }

  return response.json() as Promise<ProfileResponse>
}


export interface LoginOptions {
  useClaude?: boolean // Use claude.ai instead of console.anthropic.com
  onStatusChange?: (status: string) => void
}

/**
 * Perform the OAuth login flow using manual code entry
 * User authenticates in browser, then pastes the code back
 */
export async function login(options: LoginOptions = {}): Promise<OAuthTokens> {
  // Default to claude.ai (personal accounts) instead of console.anthropic.com (organizations)
  const { useClaude = true, onStatusChange } = options

  const log = (msg: string) => {
    if (onStatusChange) {
      onStatusChange(msg)
    } else {
      console.log(msg)
    }
  }

  // Generate PKCE pair - state will be set to verifier in the auth URL
  const pkce = generatePKCE()

  // Build authorization URL (state = verifier for this OAuth flow)
  const authUrl = buildAuthorizationUrl(pkce, useClaude)

  log("Opening browser for authentication...")

  try {
    await openBrowser(authUrl)
    log(`\nIf your browser doesn't open, visit:\n${authUrl}\n`)
  } catch {
    // If browser doesn't open, show the URL
    log(`Please open this URL in your browser:\n${authUrl}\n`)
  }

  log("\nAfter authenticating, you'll see a code on the page.")
  log("Please paste the complete code below (it may include a # character):\n")

  // Prompt for the code
  const codeWithState = await prompt("Authorization code: ")

  if (!codeWithState || codeWithState.trim() === "") {
    throw new Error("No authorization code provided")
  }

  log("\nExchanging code for tokens...")

  // Exchange code for tokens
  const tokenResponse = await exchangeCodeForTokens(codeWithState.trim(), pkce.codeVerifier)

  // Calculate expiry timestamp
  const expiresAt = Date.now() + tokenResponse.expires_in * 1000

  log("Fetching user profile...")

  // Fetch user profile
  let account: OAuthAccount | undefined
  try {
    const profile = await fetchProfile(tokenResponse.access_token)
    account = {
      accountUuid: profile.account.uuid,
      emailAddress: profile.account.email,
      organizationUuid: profile.organization?.uuid,
      displayName: profile.account.display_name || profile.account.full_name,
      hasExtraUsageEnabled: profile.organization?.has_extra_usage_enabled,
      organizationName: profile.organization?.name,
    }
  } catch {
    // Profile fetch is optional, continue without it
  }

  // Build tokens object
  const tokens: OAuthTokens = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt,
    scopes: tokenResponse.scope?.split(" ") ?? ["user:inference", "user:profile"],
  }

  // Save tokens and account
  saveTokens(tokens, account)

  log("Authentication successful!")

  return tokens
}

/**
 * Test if the current credentials work by making a simple API call
 */
export async function testCredentials(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${OAUTH_CONFIG.BASE_API_URL}/api/oauth/profile`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Test if an API key works
 */
export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${OAUTH_CONFIG.BASE_API_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      }),
    })
    // 200 or 400 (invalid request but auth worked) means the key is valid
    return response.status === 200 || response.status === 400
  } catch {
    return false
  }
}

/**
 * Prompt user for input
 */
function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/**
 * Interactive authentication flow - called when credentials are missing or invalid
 */
export async function interactiveAuth(): Promise<{ method: "oauth" | "apikey"; success: boolean }> {
  console.log("\n┌─────────────────────────────────────────────┐")
  console.log("│         Authentication Required             │")
  console.log("├─────────────────────────────────────────────┤")
  console.log("│ Choose an authentication method:            │")
  console.log("│                                             │")
  console.log("│  1. OAuth (Recommended)                     │")
  console.log("│     Opens browser to authenticate           │")
  console.log("│                                             │")
  console.log("│  2. API Key                                 │")
  console.log("│     Enter your ANTHROPIC_API_KEY            │")
  console.log("└─────────────────────────────────────────────┘\n")

  const choice = await prompt("Enter choice (1 or 2): ")

  if (choice === "1") {
    // OAuth flow
    try {
      console.log("\nStarting OAuth authentication...\n")
      await login()

      // Test the credentials
      const tokens = getStoredTokens()
      if (tokens) {
        console.log("Testing credentials...")
        const valid = await testCredentials(tokens.accessToken)
        if (valid) {
          const account = getCurrentAccount()
          console.log(`\nAuthenticated as: ${account?.emailAddress ?? "unknown"}`)
          return { method: "oauth", success: true }
        }
      }
      console.log("\nAuthentication failed. Please try again.")
      return { method: "oauth", success: false }
    } catch (error) {
      console.error("\nOAuth failed:", error instanceof Error ? error.message : String(error))
      return { method: "oauth", success: false }
    }
  } else if (choice === "2") {
    // API Key flow
    console.log("")
    const apiKey = await prompt("Enter your ANTHROPIC_API_KEY: ")

    if (!apiKey) {
      console.log("\nNo API key provided.")
      return { method: "apikey", success: false }
    }

    console.log("\nTesting API key...")
    const valid = await testApiKey(apiKey)

    if (valid) {
      // Store the API key in environment for this session
      process.env.ANTHROPIC_API_KEY = apiKey
      console.log("\nAPI key validated successfully!")
      return { method: "apikey", success: true }
    } else {
      console.log("\nInvalid API key. Please check and try again.")
      return { method: "apikey", success: false }
    }
  } else {
    console.log("\nInvalid choice. Please enter 1 or 2.")
    return await interactiveAuth() // Retry
  }
}
