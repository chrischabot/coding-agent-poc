# Claude Code OAuth Authentication - Comprehensive Documentation

This document details the OAuth implementation for Claude Code based on analysis of three working implementations:
1. `./agent/js/src/auth/plugins.ts` - Link Assistant Agent implementation
2. `./opencode` + `opencode-anthropic-auth` npm package - OpenCode implementation
3. `./claude.js` - Official Claude Code CLI bundle

## 1. OAuth Configuration Constants

### Client ID (CRITICAL - Same across all implementations)
```
9d1c250a-e61b-44d9-88ed-5944d1962f5e
```

### API Endpoints

| Endpoint | URL |
|----------|-----|
| **Authorization (claude.ai)** | `https://claude.ai/oauth/authorize` |
| **Authorization (console)** | `https://console.anthropic.com/oauth/authorize` |
| **Token Exchange** | `https://console.anthropic.com/v1/oauth/token` |
| **API Base URL** | `https://api.anthropic.com` |
| **Manual Redirect URI** | `https://console.anthropic.com/oauth/code/callback` |
| **Create API Key** | `https://api.anthropic.com/api/oauth/claude_cli/create_api_key` |
| **Profile** | `https://api.anthropic.com/api/oauth/profile` |

### OAuth Scopes
```
org:create_api_key user:profile user:inference
```

## 2. Complete OAuth Flow

### Step 1: Generate PKCE Pair

All implementations use PKCE (Proof Key for Code Exchange) with S256 method:

```typescript
import crypto from 'crypto';

function generateRandomString(length: number): string {
  return crypto.randomBytes(length).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

async function generatePKCE() {
  const verifier = generateRandomString(32);
  const challenge = generateCodeChallenge(verifier);
  return { verifier, challenge };
}
```

### Step 2: Build Authorization URL

```typescript
const pkce = await generatePKCE();

const url = new URL('https://claude.ai/oauth/authorize');
url.searchParams.set('code', 'true');                        // REQUIRED
url.searchParams.set('client_id', '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
url.searchParams.set('response_type', 'code');
url.searchParams.set('redirect_uri', 'https://console.anthropic.com/oauth/code/callback');
url.searchParams.set('scope', 'org:create_api_key user:profile user:inference');
url.searchParams.set('code_challenge', pkce.challenge);
url.searchParams.set('code_challenge_method', 'S256');
url.searchParams.set('state', pkce.verifier);  // CRITICAL: state = verifier
```

**IMPORTANT**: The `state` parameter MUST be set to the `verifier` value. This is non-standard but required by Anthropic's OAuth.

### Step 3: Token Exchange

After user authenticates, they receive a code in format: `CODE#STATE`

```typescript
async function exchangeCodeForTokens(codeWithState: string, verifier: string) {
  const splits = codeWithState.split('#');
  const code = splits[0];
  const state = splits[1];  // Should equal verifier

  const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',  // MUST be JSON, NOT form-urlencoded
    },
    body: JSON.stringify({
      code: code,
      state: state,                         // REQUIRED
      grant_type: 'authorization_code',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  return response.json();
  // Returns: { access_token, refresh_token, expires_in, token_type }
}
```

**CRITICAL**:
- Content-Type MUST be `application/json`
- Body MUST be JSON (not form-urlencoded)
- `state` field MUST be included in the body

### Step 4: Token Refresh

```typescript
async function refreshToken(refreshToken: string) {
  const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  return response.json();
}
```

## 3. Making API Calls with OAuth Token

### Required Headers for API Requests

```typescript
const headers = {
  'Content-Type': 'application/json',
  'x-app': 'cli',
  'User-Agent': 'claude-cli/2.0.76 (external, coding-agent)',
  'authorization': `Bearer ${accessToken}`,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,context-management-2025-06-27',
};

// CRITICAL: Remove x-api-key if present
delete headers['x-api-key'];
```

### Required System Prompt Header (Body)

For Claude Code OAuth tokens, requests must include the Claude Code header line
**inside the request body** (system prompt). This is the detail that comes after
headers and still needs to match Claude Code. In practice, the system prompt must
be **exactly** this line — adding extra system text can trigger the
`This credential is only authorized for use with Claude Code` error.

```typescript
const system = "You are Claude Code, Anthropic's official CLI for Claude.";
```

If you need custom system instructions, use an API key (or move that guidance into
the user message as a fallback).

### Beta Headers Breakdown

| Beta Header | Purpose |
|-------------|---------|
| `oauth-2025-04-20` | **REQUIRED** - Enables OAuth token authentication |
| `claude-code-20250219` | Identifies as Claude Code client (**optional**, some OAuth tokens reject it) |
| `interleaved-thinking-2025-05-14` | Enables interleaved thinking feature |
| `fine-grained-tool-streaming-2025-05-14` | Enables fine-grained tool streaming |
| `context-management-2025-06-27` | Enables context management features |

### Custom Fetch Implementation Pattern

All three implementations use a custom `fetch` wrapper:

```typescript
async function customFetch(input: RequestInfo | URL, init?: RequestInit) {
  // Get current auth
  const auth = await getAuth();
  if (!auth || auth.type !== 'oauth') {
    return fetch(input, init);
  }

  // Refresh token if expired
  if (!auth.access || auth.expires < Date.now()) {
    const refreshed = await refreshToken(auth.refresh);
    auth.access = refreshed.access_token;
    auth.expires = Date.now() + refreshed.expires_in * 1000;
    // Save updated tokens
  }

  // Merge beta headers
  const incomingBeta = (init?.headers as Record<string, string>)?.['anthropic-beta'] || '';
  const incomingBetasList = incomingBeta.split(',').map(b => b.trim()).filter(Boolean);

  const mergedBetas = [
    ...new Set([
      'oauth-2025-04-20',
      'interleaved-thinking-2025-05-14',
      'fine-grained-tool-streaming-2025-05-14',
      'context-management-2025-06-27',
      // Only include if your token accepts Claude Code beta
      // 'claude-code-20250219',
      ...incomingBetasList,
    ]),
  ].join(',');

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
    'x-app': 'cli',
    'User-Agent': 'claude-cli/2.0.76 (external, coding-agent)',
    'authorization': `Bearer ${auth.access}`,
    'anthropic-beta': mergedBetas,
  };

  // CRITICAL: Remove x-api-key - it MUST NOT be present
  delete headers['x-api-key'];

  return fetch(input, {
    ...init,
    headers,
  });
}
```

**Important**: For OAuth tokens, Claude Code uses the **beta Messages API** (`/v1/messages?beta=true`), which is what the SDK's `client.beta.messages` methods hit. Using the non-beta path can trigger the "credential only authorized for Claude Code" error. The system header above is also required for Claude Code-scoped tokens.

## 4. SDK Integration

### Using with @anthropic-ai/sdk

The Anthropic SDK requires a **non-empty** `apiKey` to pass validation. Use a dummy value:

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: 'oauth-token-used-via-custom-fetch',  // Placeholder for SDK validation
  baseURL: 'https://api.anthropic.com',
  fetch: customFetch,  // Custom fetch handles OAuth
});
```

**Note from opencode-anthropic-auth**: Some older versions used `apiKey: ''`, but recent SDKs reject empty strings.

**Note from agent/plugins.ts**: They use `apiKey: 'oauth-token-used-via-custom-fetch'` (placeholder).

## 5. Implementation Comparison

### ./agent/js/src/auth/plugins.ts

```typescript
// Authorization URL
const url = new URL('https://claude.ai/oauth/authorize');
url.searchParams.set('code', 'true');
url.searchParams.set('client_id', ANTHROPIC_CLIENT_ID);
url.searchParams.set('response_type', 'code');
url.searchParams.set('redirect_uri', 'https://console.anthropic.com/oauth/code/callback');
url.searchParams.set('scope', 'org:create_api_key user:profile user:inference');
url.searchParams.set('code_challenge', pkce.challenge);
url.searchParams.set('code_challenge_method', 'S256');
url.searchParams.set('state', pkce.verifier);

// Token Exchange - JSON body
body: JSON.stringify({
  code: splits[0],
  state: splits[1],
  grant_type: 'authorization_code',
  client_id: ANTHROPIC_CLIENT_ID,
  redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
  code_verifier: pkce.verifier,
}),

// API Call Headers
headers: {
  authorization: `Bearer ${currentAuth.access}`,
  'anthropic-beta': mergedBetas,
};
delete headers['x-api-key'];
```

### opencode-anthropic-auth (npm package)

```javascript
// Authorization URL - identical
const url = new URL('https://claude.ai/oauth/authorize');
// ... same params ...

// Token Exchange - identical JSON format
body: JSON.stringify({
  code: splits[0],
  state: splits[1],
  grant_type: 'authorization_code',
  client_id: CLIENT_ID,
  redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
  code_verifier: verifier,
}),

// API Call Headers - identical
headers = {
  ...init.headers,
  authorization: `Bearer ${auth.access}`,
  'anthropic-beta': mergedBetas,
};
delete headers['x-api-key'];

// SDK options
return {
  apiKey: 'oauth-token-used-via-custom-fetch',  // Placeholder for SDK validation
  fetch: customFetchFunction,
};
```

### claude.js (Official Claude Code)

From the bundled code analysis:

```javascript
// OAuth Configuration
{
  TOKEN_URL: 'https://console.anthropic.com/v1/oauth/token',
  MANUAL_REDIRECT_URL: 'https://console.anthropic.com/oauth/code/callback',
  CLIENT_ID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  API_KEY_URL: 'https://api.anthropic.com/api/oauth/claude_cli/create_api_key',
}

// Beta Headers Set
Set([
  'claude-code-20250219',
  'interleaved-thinking-2025-05-14',
  'fine-grained-tool-streaming-2025-05-14',
  'context-management-2025-06-27'
])
```

## 6. Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `invalid x-api-key` | SDK sending x-api-key header | Delete `x-api-key` in custom fetch |
| `Could not resolve authentication method` | SDK validation fails | Pass non-empty apiKey to SDK |
| `Invalid request format` | Wrong Content-Type or body format | Use JSON body, not form-urlencoded |
| `Token exchange failed` | Missing state field | Include `state` in token exchange body |
| `credential only authorized for use with Claude Code` | `claude-code-20250219` beta rejected by token | Remove `claude-code-20250219` or gate it per token |

### Model Restrictions (IMPORTANT)

OAuth tokens from claude.ai MAY have restrictions on which models can be used. Test observed:
- Haiku models: Work with basic OAuth
- Sonnet/Opus models: May require specific conditions

This needs further investigation - all three implementations use the same approach but the API may be checking additional factors.

## 7. Profile API

```typescript
interface ProfileResponse {
  account: {
    uuid: string;
    email: string;
    full_name?: string;
    display_name?: string;
    has_claude_max?: boolean;
    has_claude_pro?: boolean;
  };
  organization?: {
    uuid: string;
    name: string;
    organization_type?: string;
    rate_limit_tier?: string;
    has_extra_usage_enabled?: boolean;
  };
}

async function fetchProfile(accessToken: string): Promise<ProfileResponse> {
  const response = await fetch('https://api.anthropic.com/api/oauth/profile', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  return response.json();
}
```

## 8. Create API Key Flow (Alternative)

Some implementations offer creating a proper API key from OAuth token:

```typescript
async function createApiKey(accessToken: string) {
  const response = await fetch(
    'https://api.anthropic.com/api/oauth/claude_cli/create_api_key',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );
  const data = await response.json();
  return data.raw_key;  // This is a real API key
}
```

**Note**: This requires the `org:create_api_key` scope.

## 9. Token Storage

### Token Structure

```typescript
interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;  // Unix timestamp in milliseconds
  scopes?: string[];
}

interface OAuthAccount {
  accountUuid: string;
  emailAddress: string;
  displayName?: string;
  organizationUuid?: string;
  organizationName?: string;
  hasExtraUsageEnabled?: boolean;
}
```

### Token Expiry Buffer

Refresh tokens before they expire. Recommended buffer: 5 minutes (300,000 ms).

```typescript
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function isTokenExpired(tokens: OAuthTokens): boolean {
  return tokens.expiresAt < Date.now() + TOKEN_REFRESH_BUFFER_MS;
}
```

## 10. Summary Checklist

For a working OAuth implementation:

- [ ] Use client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- [ ] Generate PKCE with S256 method
- [ ] Set `state` parameter to PKCE verifier
- [ ] Set `code=true` in authorization URL params
- [ ] Use `https://claude.ai/oauth/authorize` for personal accounts
- [ ] Use `https://console.anthropic.com/oauth/code/callback` as redirect URI
- [ ] Token exchange with JSON body (not form-urlencoded)
- [ ] Include `state` field in token exchange body
- [ ] Token refresh with JSON body
- [ ] API calls use `Authorization: Bearer {token}` header
- [ ] Include `anthropic-beta: oauth-2025-04-20,...` header
- [ ] Remove `x-api-key` header from all requests
- [ ] SDK: pass empty or placeholder apiKey, use custom fetch
