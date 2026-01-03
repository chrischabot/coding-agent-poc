/**
 * PKCE (Proof Key for Code Exchange) Implementation
 * Generates code_verifier and code_challenge for OAuth 2.0 PKCE flow
 */

import { randomBytes, createHash } from "node:crypto"

export interface PKCEPair {
  codeVerifier: string
  codeChallenge: string
  codeChallengeMethod: "S256"
}

/**
 * Generate a cryptographically random code verifier
 * Per RFC 7636, should be 43-128 characters from unreserved URI characters
 */
function generateCodeVerifier(): string {
  // Generate 32 random bytes, base64url encode to get 43 characters
  const buffer = randomBytes(32)
  return base64UrlEncode(buffer)
}

/**
 * Base64 URL encode (no padding, URL-safe characters)
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

/**
 * Generate code challenge from code verifier using SHA256
 * code_challenge = BASE64URL(SHA256(code_verifier))
 */
function generateCodeChallenge(codeVerifier: string): string {
  const hash = createHash("sha256").update(codeVerifier).digest()
  return base64UrlEncode(hash)
}

/**
 * Generate a PKCE pair (code_verifier and code_challenge)
 */
export function generatePKCE(): PKCEPair {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
  }
}
