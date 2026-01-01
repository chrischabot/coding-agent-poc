import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { registerBuiltinTools } from "../src/tools"
import { taskTool, finderTool, oracleTool } from "../src/tools/subagent"
import {
  createTaskConfig,
  createFinderConfig,
  createOracleConfig,
} from "../src/subagent"
import type { ToolContext } from "../src/core/types"

describe("Subagent Config Tests", () => {
  test("creates task config with correct tools", () => {
    const config = createTaskConfig("claude-sonnet-4-20250514")

    expect(config.type).toBe("task")
    expect(config.model).toBe("claude-sonnet-4-20250514")
    expect(config.maxTurns).toBe(20)
    expect(config.tools.length).toBe(8)
    expect(config.tools.map((t) => t.spec.name)).toContain("Read")
    expect(config.tools.map((t) => t.spec.name)).toContain("Edit")
    expect(config.tools.map((t) => t.spec.name)).toContain("Write")
    expect(config.tools.map((t) => t.spec.name)).toContain("Bash")
    expect(config.tools.map((t) => t.spec.name)).toContain("Grep")
    expect(config.tools.map((t) => t.spec.name)).toContain("Glob")
    expect(config.tools.map((t) => t.spec.name)).toContain("TodoWrite")
    expect(config.tools.map((t) => t.spec.name)).toContain("TodoRead")
  })

  test("creates finder config with read-only tools", () => {
    const config = createFinderConfig("claude-sonnet-4-20250514")

    expect(config.type).toBe("finder")
    expect(config.tools.length).toBe(3)
    expect(config.tools.map((t) => t.spec.name)).toContain("Read")
    expect(config.tools.map((t) => t.spec.name)).toContain("Grep")
    expect(config.tools.map((t) => t.spec.name)).toContain("Glob")
    expect(config.tools.map((t) => t.spec.name)).not.toContain("Edit")
    expect(config.tools.map((t) => t.spec.name)).not.toContain("Bash")
  })

  test("creates oracle config with read-only tools", () => {
    const config = createOracleConfig("claude-sonnet-4-20250514")

    expect(config.type).toBe("oracle")
    expect(config.tools.length).toBe(3)
    expect(config.tools.map((t) => t.spec.name)).toContain("Read")
    expect(config.tools.map((t) => t.spec.name)).toContain("Grep")
    expect(config.tools.map((t) => t.spec.name)).toContain("Glob")
    expect(config.maxTurns).toBe(5)
  })

  test("task config has correct system prompt", () => {
    const config = createTaskConfig("claude-sonnet-4-20250514")

    expect(config.systemPrompt).toContain("Task agent")
    expect(config.systemPrompt).toContain("fire-and-forget")
  })

  test("finder config has correct system prompt", () => {
    const config = createFinderConfig("claude-sonnet-4-20250514")

    expect(config.systemPrompt).toContain("Finder agent")
    expect(config.systemPrompt).toContain("code search")
  })

  test("oracle config has correct system prompt", () => {
    const config = createOracleConfig("claude-sonnet-4-20250514")

    expect(config.systemPrompt).toContain("Oracle")
    expect(config.systemPrompt).toContain("expert")
  })
})

describe("Subagent Tool Specs", () => {
  beforeEach(() => {
    registerBuiltinTools()
  })

  test("task tool has correct spec", () => {
    const spec = taskTool.spec

    expect(spec.name).toBe("Task")
    expect(spec.description).toContain("Fire-and-forget")
    expect(spec.inputSchema.required).toContain("prompt")
    expect(spec.inputSchema.required).toContain("description")
  })

  test("finder tool has correct spec", () => {
    const spec = finderTool.spec

    expect(spec.name).toBe("Finder")
    expect(spec.description).toContain("code search")
    expect(spec.inputSchema.required).toContain("query")
  })

  test("oracle tool has correct spec", () => {
    const spec = oracleTool.spec

    expect(spec.name).toBe("Oracle")
    expect(spec.description).toContain("technical advisor")
    expect(spec.inputSchema.required).toContain("task")
    expect(spec.inputSchema.properties).toHaveProperty("context")
    expect(spec.inputSchema.properties).toHaveProperty("files")
  })
})

describe("Subagent Tool Integration", () => {
  let testDir: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = join(tmpdir(), `coding-agent-subagent-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    context = {
      workingDirectory: testDir,
      threadId: "test-thread",
    }
    registerBuiltinTools()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("getAllToolSpecs includes subagent tools", async () => {
    const { getAllToolSpecs } = await import("../src/tools/registry")
    const specs = getAllToolSpecs()

    const specNames = specs.map((s) => s.name)
    expect(specNames).toContain("Task")
    expect(specNames).toContain("Finder")
    expect(specNames).toContain("Oracle")
  })

  test("subagent tools are registered", async () => {
    const { getTool } = await import("../src/tools/registry")

    expect(getTool("Task")).toBeDefined()
    expect(getTool("Finder")).toBeDefined()
    expect(getTool("Oracle")).toBeDefined()
  })
})
