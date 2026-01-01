export type PermissionAction = "allow" | "ask" | "reject"

export interface PermissionRule {
  tool: string
  action: PermissionAction
  matches?: Record<string, string | string[]>
}

export interface PermissionResult {
  permitted: boolean
  action: PermissionAction
  rule?: PermissionRule
  reason?: string
}

export type PermissionPromptFn = (
  toolName: string,
  input: Record<string, unknown>,
  rule: PermissionRule
) => Promise<boolean>
