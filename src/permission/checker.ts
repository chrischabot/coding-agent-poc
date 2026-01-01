import type { PermissionRule, PermissionResult, PermissionPromptFn } from "./types"
import { BUILTIN_RULES } from "./rules"

function globMatch(pattern: string, value: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${regex}$`, "i").test(value)
}

function matchesRule(
  rule: PermissionRule,
  toolName: string,
  input: Record<string, unknown>
): boolean {
  if (!globMatch(rule.tool, toolName)) {
    return false
  }

  if (!rule.matches) {
    return true
  }

  for (const [key, patterns] of Object.entries(rule.matches)) {
    const inputValue = input[key]
    if (inputValue === undefined) {
      return false
    }

    const valueStr = String(inputValue)
    const patternList = Array.isArray(patterns) ? patterns : [patterns]

    const matched = patternList.some((p) => globMatch(p, valueStr))
    if (!matched) {
      return false
    }
  }

  return true
}

export class PermissionChecker {
  private rules: PermissionRule[]
  private promptFn: PermissionPromptFn | null

  constructor(
    customRules: PermissionRule[] = [],
    promptFn: PermissionPromptFn | null = null
  ) {
    this.rules = [...customRules, ...BUILTIN_RULES]
    this.promptFn = promptFn
  }

  async check(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionResult> {
    for (const rule of this.rules) {
      if (matchesRule(rule, toolName, input)) {
        if (rule.action === "allow") {
          return { permitted: true, action: "allow", rule }
        }

        if (rule.action === "reject") {
          return {
            permitted: false,
            action: "reject",
            rule,
            reason: `Rejected by rule: ${rule.tool}`,
          }
        }

        if (rule.action === "ask") {
          if (!this.promptFn) {
            return {
              permitted: false,
              action: "ask",
              rule,
              reason: "Permission required but no prompt handler available",
            }
          }

          const userApproved = await this.promptFn(toolName, input, rule)
          return {
            permitted: userApproved,
            action: "ask",
            rule,
            reason: userApproved ? "User approved" : "User rejected",
          }
        }
      }
    }

    return { permitted: true, action: "allow" }
  }

  addRule(rule: PermissionRule): void {
    this.rules.unshift(rule)
  }

  setPromptFn(fn: PermissionPromptFn): void {
    this.promptFn = fn
  }
}
