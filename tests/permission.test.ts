import { describe, test, expect } from "bun:test"
import { PermissionChecker, BUILTIN_RULES } from "../src/permission"
import type { PermissionRule } from "../src/permission"

describe("Permission System", () => {
  describe("PermissionChecker", () => {
    test("allows Read tool by default", async () => {
      const checker = new PermissionChecker()
      const result = await checker.check("Read", { path: "/some/file.ts" })

      expect(result.permitted).toBe(true)
      expect(result.action).toBe("allow")
    })

    test("allows Grep tool by default", async () => {
      const checker = new PermissionChecker()
      const result = await checker.check("Grep", { pattern: "foo" })

      expect(result.permitted).toBe(true)
      expect(result.action).toBe("allow")
    })

    test("allows safe bash commands", async () => {
      const checker = new PermissionChecker()

      const lsResult = await checker.check("Bash", { command: "ls -la" })
      expect(lsResult.permitted).toBe(true)

      const catResult = await checker.check("Bash", { command: "cat file.txt" })
      expect(catResult.permitted).toBe(true)

      const pwdResult = await checker.check("Bash", { command: "pwd" })
      expect(pwdResult.permitted).toBe(true)
    })

    test("allows npm/bun commands", async () => {
      const checker = new PermissionChecker()

      const npmTest = await checker.check("Bash", { command: "npm test" })
      expect(npmTest.permitted).toBe(true)

      const bunRun = await checker.check("Bash", { command: "bun run build" })
      expect(bunRun.permitted).toBe(true)
    })

    test("allows safe git commands", async () => {
      const checker = new PermissionChecker()

      const status = await checker.check("Bash", { command: "git status" })
      expect(status.permitted).toBe(true)

      const diff = await checker.check("Bash", { command: "git diff HEAD" })
      expect(diff.permitted).toBe(true)

      const commit = await checker.check("Bash", { command: "git commit -m 'test'" })
      expect(commit.permitted).toBe(true)
    })

    test("asks for dangerous commands without prompt handler", async () => {
      const checker = new PermissionChecker()

      const push = await checker.check("Bash", { command: "git push origin main" })
      expect(push.permitted).toBe(false)
      expect(push.action).toBe("ask")

      const rmrf = await checker.check("Bash", { command: "rm -rf /" })
      expect(rmrf.permitted).toBe(false)
      expect(rmrf.action).toBe("ask")

      const sudo = await checker.check("Bash", { command: "sudo rm file" })
      expect(sudo.permitted).toBe(false)
      expect(sudo.action).toBe("ask")
    })

    test("asks for unrecognized bash commands without prompt handler", async () => {
      const checker = new PermissionChecker()

      const result = await checker.check("Bash", { command: "some-random-command" })
      expect(result.permitted).toBe(false)
      expect(result.action).toBe("ask")
    })

    test("calls prompt handler for ask rules", async () => {
      let promptCalled = false
      let capturedToolName = ""
      let capturedInput: Record<string, unknown> = {}

      const promptFn = async (
        toolName: string,
        input: Record<string, unknown>
      ) => {
        promptCalled = true
        capturedToolName = toolName
        capturedInput = input
        return true
      }

      const checker = new PermissionChecker([], promptFn)
      const result = await checker.check("Bash", { command: "git push origin main" })

      expect(promptCalled).toBe(true)
      expect(capturedToolName).toBe("Bash")
      expect(capturedInput.command).toBe("git push origin main")
      expect(result.permitted).toBe(true)
      expect(result.action).toBe("ask")
    })

    test("respects prompt handler rejection", async () => {
      const checker = new PermissionChecker([], async () => false)
      const result = await checker.check("Bash", { command: "git push origin main" })

      expect(result.permitted).toBe(false)
      expect(result.reason).toBe("User rejected")
    })

    test("custom rules take precedence over builtin rules", async () => {
      const customRules: PermissionRule[] = [
        { tool: "Bash", action: "reject", matches: { command: "ls*" } },
      ]

      const checker = new PermissionChecker(customRules)
      const result = await checker.check("Bash", { command: "ls -la" })

      expect(result.permitted).toBe(false)
      expect(result.action).toBe("reject")
    })

    test("allows unknown tools by default", async () => {
      const checker = new PermissionChecker()
      const result = await checker.check("UnknownTool", { foo: "bar" })

      expect(result.permitted).toBe(true)
      expect(result.action).toBe("allow")
    })
  })

  describe("Glob Pattern Matching", () => {
    test("matches exact commands", async () => {
      const rules: PermissionRule[] = [
        { tool: "Bash", action: "reject", matches: { command: "pwd" } },
      ]

      const checker = new PermissionChecker(rules)
      
      const pwd = await checker.check("Bash", { command: "pwd" })
      expect(pwd.permitted).toBe(false)
      expect(pwd.action).toBe("reject")

      const lsCmd = await checker.check("Bash", { command: "ls" })
      expect(lsCmd.permitted).toBe(true)
      expect(lsCmd.action).toBe("allow")
    })

    test("matches wildcard patterns", async () => {
      const rules: PermissionRule[] = [
        { tool: "Bash", action: "reject", matches: { command: "*secret*" } },
      ]

      const checker = new PermissionChecker(rules)

      const match1 = await checker.check("Bash", { command: "cat secret.txt" })
      expect(match1.permitted).toBe(false)

      const match2 = await checker.check("Bash", { command: "echo mysecretkey" })
      expect(match2.permitted).toBe(false)

      const noMatch = await checker.check("Bash", { command: "echo hello" })
      expect(noMatch.permitted).toBe(true)
    })

    test("matches tool name patterns", async () => {
      const rules: PermissionRule[] = [
        { tool: "Bash*", action: "reject" },
      ]

      const checker = new PermissionChecker(rules)

      const bash = await checker.check("Bash", { command: "ls" })
      expect(bash.permitted).toBe(false)

      const bashLike = await checker.check("BashExtended", { command: "ls" })
      expect(bashLike.permitted).toBe(false)

      const read = await checker.check("Read", { path: "file.txt" })
      expect(read.permitted).toBe(true)
    })
  })

  describe("Built-in Rules", () => {
    test("has rules defined", () => {
      expect(BUILTIN_RULES.length).toBeGreaterThan(0)
    })

    test("has git push as ask", () => {
      const pushRule = BUILTIN_RULES.find(
        (r) => r.matches?.command === "*git*push*"
      )
      expect(pushRule).toBeDefined()
      expect(pushRule?.action).toBe("ask")
    })

    test("has safe read commands as allow", () => {
      const readTools = BUILTIN_RULES.filter(
        (r) => r.tool === "Read" || r.tool === "Grep" || r.tool === "Glob"
      )
      expect(readTools.every((r) => r.action === "allow")).toBe(true)
    })
  })
})
