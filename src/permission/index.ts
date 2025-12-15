import * as readline from "readline";

/**
 * Types of approval requests
 */
export enum ApprovalType {
  WRITE_FILE = "write_file",
  BASH_COMMAND = "bash_command",
  NETWORK_REQUEST = "network_request",
}

/**
 * Approval request information
 */
export interface ApprovalRequest {
  type: ApprovalType;
  sessionId: string;
  title: string;
  details: string;
  metadata?: Record<string, unknown>;
}

/**
 * Approval response
 */
export type ApprovalResponse = "once" | "always" | "reject";

/**
 * Store for "always allow" permissions per session
 */
const alwaysAllowed: Map<string, Set<string>> = new Map();

/**
 * Get a key for the always-allowed cache
 */
function getApprovalKey(request: ApprovalRequest): string {
  return `${request.type}:${request.title}`;
}

/**
 * Check if an action is always allowed
 */
function isAlwaysAllowed(request: ApprovalRequest): boolean {
  const sessionAllowed = alwaysAllowed.get(request.sessionId);
  if (!sessionAllowed) return false;
  return sessionAllowed.has(getApprovalKey(request));
}

/**
 * Mark an action as always allowed
 */
function markAlwaysAllowed(request: ApprovalRequest): void {
  let sessionAllowed = alwaysAllowed.get(request.sessionId);
  if (!sessionAllowed) {
    sessionAllowed = new Set();
    alwaysAllowed.set(request.sessionId, sessionAllowed);
  }
  sessionAllowed.add(getApprovalKey(request));
}

/**
 * Request user approval for an action
 * @returns true if approved, false if rejected
 */
export async function requestApproval(
  request: ApprovalRequest
): Promise<boolean> {
  // Check if already always allowed
  if (isAlwaysAllowed(request)) {
    return true;
  }

  // Display the approval request
  console.log("\n╭─── Approval Required ───────────────────────────────────────╮");
  console.log(`│ Type: ${request.type.padEnd(53)} │`);
  console.log(`│ ${request.title.slice(0, 58).padEnd(58)} │`);
  console.log("├─────────────────────────────────────────────────────────────┤");

  // Show details (truncated)
  const detailLines = request.details.split("\n").slice(0, 20);
  for (const line of detailLines) {
    const truncated = line.slice(0, 57);
    console.log(`│ ${truncated.padEnd(58)} │`);
  }
  if (request.details.split("\n").length > 20) {
    console.log(`│ ${"... (truncated)".padEnd(58)} │`);
  }

  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ [y] Allow once  [a] Always allow  [n] Reject               │");
  console.log("╰─────────────────────────────────────────────────────────────╯");

  // Get user input
  const response = await prompt("> ");
  const normalized = response.toLowerCase().trim();

  switch (normalized) {
    case "y":
    case "yes":
      return true;

    case "a":
    case "always":
      markAlwaysAllowed(request);
      return true;

    case "n":
    case "no":
    case "":
    default:
      return false;
  }
}

/**
 * Simple readline prompt
 */
async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Clear session permissions
 */
export function clearSessionPermissions(sessionId: string): void {
  alwaysAllowed.delete(sessionId);
}
