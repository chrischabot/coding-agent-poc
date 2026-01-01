import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { registerBuiltinTools } from "../src/tools"
import { buildSystemPrompt } from "../src/prompt/system"
import { discoverGuidanceFiles, formatGuidanceFiles } from "../src/prompt/guidance"
import { createThread } from "../src/session/persistence"
import {
  estimateTokens,
  estimateMessageTokens,
  estimateThreadTokens,
  createTokenTracker,
} from "../src/context"
import { checkForCorrection, formatCorrectionMessage } from "../src/agent/correction"
import type { Message } from "../src/core/types"

describe("Agent Integration Tests", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `coding-agent-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    registerBuiltinTools()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe("Thread Management", () => {
    test("creates thread with correct properties", () => {
      const thread = createThread(testDir)

      expect(thread.id).toMatch(/^T-/)
      expect(thread.version).toBe(1)
      expect(thread.workingDirectory).toBe(testDir)
      expect(thread.messages).toEqual([])
      expect(thread.createdAt).toBeLessThanOrEqual(Date.now())
    })
  })

  describe("System Prompt", () => {
    test("builds system prompt with working directory", async () => {
      const prompt = await buildSystemPrompt({ workingDirectory: testDir })

      expect(prompt).toContain(testDir)
      expect(prompt).toContain("Read")
      expect(prompt).toContain("Edit")
      expect(prompt).toContain("Bash")
      expect(prompt).toContain("Grep")
      expect(prompt).toContain("Glob")
    })

    test("includes platform info", async () => {
      const prompt = await buildSystemPrompt({ workingDirectory: testDir })

      expect(prompt).toContain("Platform:")
    })
  })
})

describe("Non-destructive Command Tests", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `coding-agent-cmd-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    registerBuiltinTools()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("ls command shows files", async () => {
    await writeFile(join(testDir, "test1.txt"), "")
    await writeFile(join(testDir, "test2.txt"), "")

    const { bashTool } = await import("../src/tools/bash")
    const result = await bashTool.execute(
      { command: "ls" },
      { workingDirectory: testDir, threadId: "test" }
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("test1.txt")
    expect(result.output).toContain("test2.txt")
  })

  test("pwd command shows current directory", async () => {
    const { bashTool } = await import("../src/tools/bash")
    const result = await bashTool.execute(
      { command: "pwd" },
      { workingDirectory: testDir, threadId: "test" }
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("coding-agent-cmd-test")
  })

  test("cat command reads file content", async () => {
    await writeFile(join(testDir, "content.txt"), "file content here")

    const { bashTool } = await import("../src/tools/bash")
    const result = await bashTool.execute(
      { command: "cat content.txt" },
      { workingDirectory: testDir, threadId: "test" }
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("file content here")
  })

  test("wc command counts lines", async () => {
    await writeFile(join(testDir, "lines.txt"), "line1\nline2\nline3")

    const { bashTool } = await import("../src/tools/bash")
    const result = await bashTool.execute(
      { command: "wc -l lines.txt" },
      { workingDirectory: testDir, threadId: "test" }
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toMatch(/[23]/)
  })

  test("head command shows first lines", async () => {
    await writeFile(join(testDir, "multi.txt"), "line1\nline2\nline3\nline4\nline5")

    const { bashTool } = await import("../src/tools/bash")
    const result = await bashTool.execute(
      { command: "head -n 2 multi.txt" },
      { workingDirectory: testDir, threadId: "test" }
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("line1")
    expect(result.output).toContain("line2")
    expect(result.output).not.toContain("line5")
  })

  test("tail command shows last lines", async () => {
    await writeFile(join(testDir, "multi.txt"), "line1\nline2\nline3\nline4\nline5")

    const { bashTool } = await import("../src/tools/bash")
    const result = await bashTool.execute(
      { command: "tail -n 2 multi.txt" },
      { workingDirectory: testDir, threadId: "test" }
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("line4")
    expect(result.output).toContain("line5")
    expect(result.output).not.toContain("line1")
  })

  test("find command locates files", async () => {
    await mkdir(join(testDir, "subdir"))
    await writeFile(join(testDir, "subdir", "nested.txt"), "")

    const { bashTool } = await import("../src/tools/bash")
    const result = await bashTool.execute(
      { command: "find . -name '*.txt'" },
      { workingDirectory: testDir, threadId: "test" }
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("nested.txt")
  })
})

describe("Guidance File Discovery", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `coding-agent-guidance-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("discovers AGENTS.md in working directory", async () => {
    await writeFile(join(testDir, "AGENTS.md"), "# Test Agents\nBuild: npm run build")

    const files = await discoverGuidanceFiles(testDir)

    expect(files).toHaveLength(1)
    expect(files[0].path).toContain("AGENTS.md")
    expect(files[0].content).toContain("Build: npm run build")
  })

  test("falls back to CLAUDE.md when AGENTS.md not present", async () => {
    await writeFile(join(testDir, "CLAUDE.md"), "# Claude Instructions")

    const files = await discoverGuidanceFiles(testDir)

    expect(files).toHaveLength(1)
    expect(files[0].path).toContain("CLAUDE.md")
    expect(files[0].content).toContain("Claude Instructions")
  })

  test("prefers AGENTS.md over CLAUDE.md", async () => {
    await writeFile(join(testDir, "AGENTS.md"), "# Agents")
    await writeFile(join(testDir, "CLAUDE.md"), "# Claude")

    const files = await discoverGuidanceFiles(testDir)

    expect(files).toHaveLength(1)
    expect(files[0].path).toContain("AGENTS.md")
  })

  test("returns empty array when no guidance files exist", async () => {
    const files = await discoverGuidanceFiles(testDir)

    expect(files).toHaveLength(0)
  })

  test("formatGuidanceFiles returns empty string for no files", () => {
    const formatted = formatGuidanceFiles([])

    expect(formatted).toBe("")
  })

  test("formatGuidanceFiles formats files with XML tags", () => {
    const files = [
      { path: "/path/to/AGENTS.md", content: "# Test" }
    ]

    const formatted = formatGuidanceFiles(files)

    expect(formatted).toContain("guidance_file")
    expect(formatted).toContain('path="/path/to/AGENTS.md"')
    expect(formatted).toContain("# Test")
  })

  test("buildSystemPrompt includes guidance content", async () => {
    const guidanceContent = "\n# My Guidance\nFollow these rules"

    const prompt = await buildSystemPrompt({
      workingDirectory: testDir,
      guidanceContent
    })

    expect(prompt).toContain("My Guidance")
    expect(prompt).toContain("Follow these rules")
  })
})

describe("Context Management", () => {
  describe("Token Estimation", () => {
    test("estimates tokens from text length", () => {
      const text = "Hello, world!"
      const tokens = estimateTokens(text)

      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBe(Math.ceil(text.length / 4))
    })

    test("estimates message tokens", () => {
      const message: Message = {
        role: "user",
        content: [{ type: "text", text: "This is a test message" }],
      }

      const tokens = estimateMessageTokens(message)

      expect(tokens).toBeGreaterThan(0)
    })

    test("estimates thread tokens", () => {
      const messages: Message[] = [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
      ]

      const tokens = estimateThreadTokens(messages)

      expect(tokens).toBeGreaterThan(0)
    })

    test("includes tool_use and tool_result in estimation", () => {
      const messages: Message[] = [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "123", name: "Read", input: { path: "/file.txt" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", toolUseId: "123", content: "file contents here" },
          ],
        },
      ]

      const tokens = estimateThreadTokens(messages)

      expect(tokens).toBeGreaterThan(20)
    })
  })

  describe("Token Tracker", () => {
    test("tracks cumulative usage", () => {
      const tracker = createTokenTracker()

      tracker.addUsage(100, 50)
      tracker.addUsage(200, 100)

      const total = tracker.getTotal()

      expect(total.input).toBe(300)
      expect(total.output).toBe(150)
      expect(total.total).toBe(450)
    })

    test("resets to zero", () => {
      const tracker = createTokenTracker()

      tracker.addUsage(100, 50)
      tracker.reset()

      const total = tracker.getTotal()

      expect(total.input).toBe(0)
      expect(total.output).toBe(0)
    })
  })
})

describe("Course Correction", () => {
  test("returns no correction for empty messages", () => {
    const result = checkForCorrection([])

    expect(result.needsCorrection).toBe(false)
  })

  test("returns no correction for successful tool calls", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "1", name: "Read", input: { path: "/file.txt" } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "1", content: "file contents" }],
      },
    ]

    const result = checkForCorrection(messages)

    expect(result.needsCorrection).toBe(false)
  })

  test("detects repeated failures of same tool", () => {
    const messages: Message[] = []

    for (let i = 0; i < 4; i++) {
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: `${i}`, name: "Read", input: { path: "/bad.txt" } }],
      })
      messages.push({
        role: "user",
        content: [{ type: "tool_result", toolUseId: `${i}`, content: "Error", isError: true }],
      })
    }

    const result = checkForCorrection(messages)

    expect(result.needsCorrection).toBe(true)
    expect(result.reason).toContain("Read")
    expect(result.reason).toContain("failed")
  })

  test("detects consecutive failures", () => {
    const messages: Message[] = []
    const tools = ["Read", "Grep", "Bash", "Edit", "Glob"]

    for (let i = 0; i < 5; i++) {
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: `${i}`, name: tools[i], input: {} }],
      })
      messages.push({
        role: "user",
        content: [{ type: "tool_result", toolUseId: `${i}`, content: "Error", isError: true }],
      })
    }

    const result = checkForCorrection(messages)

    expect(result.needsCorrection).toBe(true)
    expect(result.reason).toContain("failed")
  })

  test("detects tool call loops", () => {
    const messages: Message[] = []
    const pattern = ["Read", "Grep", "Edit"]

    for (let i = 0; i < 6; i++) {
      const toolName = pattern[i % 3]
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: `${i}`, name: toolName, input: {} }],
      })
      messages.push({
        role: "user",
        content: [{ type: "tool_result", toolUseId: `${i}`, content: "ok" }],
      })
    }

    const result = checkForCorrection(messages)

    expect(result.needsCorrection).toBe(true)
    expect(result.reason).toContain("repeating")
  })

  test("formatCorrectionMessage includes reason and suggestion", () => {
    const result = {
      needsCorrection: true,
      reason: "Tool failed 3 times",
      suggestion: "Try a different approach",
    }

    const message = formatCorrectionMessage(result)

    expect(message).toContain("COURSE CORRECTION")
    expect(message).toContain("Tool failed 3 times")
    expect(message).toContain("Try a different approach")
  })
})
