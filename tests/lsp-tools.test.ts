import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ToolContext } from "../src/core/types"
import {
  goToDefinitionTool,
  findReferencesTool,
  getTypeInfoTool,
  cleanupSharedLSPManager,
} from "../src/tools/lsp-tools"
import { detectLanguageFromFile, LSP_SERVER_CONFIGS } from "../src/lsp"
import type { SupportedLanguage } from "../src/lsp"

describe("LSP Language Detection", () => {
  test("detects TypeScript files", () => {
    expect(detectLanguageFromFile("file.ts")).toBe("typescript")
    expect(detectLanguageFromFile("file.tsx")).toBe("typescript")
    expect(detectLanguageFromFile("file.mts")).toBe("typescript")
    expect(detectLanguageFromFile("file.cts")).toBe("typescript")
  })

  test("detects JavaScript files", () => {
    expect(detectLanguageFromFile("file.js")).toBe("javascript")
    expect(detectLanguageFromFile("file.jsx")).toBe("javascript")
    expect(detectLanguageFromFile("file.mjs")).toBe("javascript")
    expect(detectLanguageFromFile("file.cjs")).toBe("javascript")
  })

  test("detects Python files", () => {
    expect(detectLanguageFromFile("file.py")).toBe("python")
    expect(detectLanguageFromFile("file.pyw")).toBe("python")
    expect(detectLanguageFromFile("file.pyi")).toBe("python")
  })

  test("detects Go files", () => {
    expect(detectLanguageFromFile("file.go")).toBe("go")
  })

  test("detects Rust files", () => {
    expect(detectLanguageFromFile("file.rs")).toBe("rust")
  })

  test("detects Java files", () => {
    expect(detectLanguageFromFile("file.java")).toBe("java")
  })

  test("detects C files", () => {
    expect(detectLanguageFromFile("file.c")).toBe("c")
    expect(detectLanguageFromFile("file.h")).toBe("c")
  })

  test("detects C++ files", () => {
    expect(detectLanguageFromFile("file.cpp")).toBe("cpp")
    expect(detectLanguageFromFile("file.cc")).toBe("cpp")
    expect(detectLanguageFromFile("file.cxx")).toBe("cpp")
    expect(detectLanguageFromFile("file.hpp")).toBe("cpp")
    expect(detectLanguageFromFile("file.hh")).toBe("cpp")
  })

  test("detects C# files", () => {
    expect(detectLanguageFromFile("file.cs")).toBe("csharp")
  })

  test("detects Ruby files", () => {
    expect(detectLanguageFromFile("file.rb")).toBe("ruby")
    expect(detectLanguageFromFile("file.rake")).toBe("ruby")
    expect(detectLanguageFromFile("file.gemspec")).toBe("ruby")
  })

  test("detects PHP files", () => {
    expect(detectLanguageFromFile("file.php")).toBe("php")
    expect(detectLanguageFromFile("file.phtml")).toBe("php")
  })

  test("returns null for unknown extensions", () => {
    expect(detectLanguageFromFile("file.xyz")).toBeNull()
    expect(detectLanguageFromFile("file.unknown")).toBeNull()
  })
})

describe("LSP Server Configs", () => {
  const languages: SupportedLanguage[] = [
    "typescript",
    "javascript",
    "python",
    "go",
    "rust",
    "java",
    "c",
    "cpp",
    "csharp",
    "ruby",
    "php",
  ]

  test("all supported languages have configs", () => {
    for (const lang of languages) {
      expect(LSP_SERVER_CONFIGS[lang]).toBeDefined()
      expect(LSP_SERVER_CONFIGS[lang].language).toBe(lang)
      expect(LSP_SERVER_CONFIGS[lang].command).toBeTruthy()
      expect(LSP_SERVER_CONFIGS[lang].installInstructions).toBeTruthy()
    }
  })

  test("TypeScript and JavaScript use the same server", () => {
    expect(LSP_SERVER_CONFIGS.typescript.command).toBe(
      LSP_SERVER_CONFIGS.javascript.command
    )
  })

  test("C and C++ use the same server (clangd)", () => {
    expect(LSP_SERVER_CONFIGS.c.command).toBe(LSP_SERVER_CONFIGS.cpp.command)
    expect(LSP_SERVER_CONFIGS.c.command).toBe("clangd")
  })
})

describe("GoToDefinition Tool", () => {
  let testDir: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = join(tmpdir(), `gotodef-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    context = {
      workingDirectory: testDir,
      threadId: "test-thread",
    }
  })

  afterEach(async () => {
    await cleanupSharedLSPManager()
    await rm(testDir, { recursive: true, force: true })
  })

  test("returns error when path is missing", async () => {
    const result = await goToDefinitionTool.execute({ line: 1 }, context)
    expect(result.isError).toBe(true)
    expect(result.output).toContain("path is required")
  })

  test("returns error when line is missing", async () => {
    const result = await goToDefinitionTool.execute(
      { path: "test.ts" },
      context
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("line is required")
  })

  test("returns error for unsupported file types", async () => {
    const testFile = join(testDir, "test.xyz")
    await writeFile(testFile, "content")

    const result = await goToDefinitionTool.execute(
      { path: testFile, line: 1 },
      context
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("Unsupported file type")
  })

  test("returns error for non-existent file", async () => {
    const result = await goToDefinitionTool.execute(
      { path: "/nonexistent/file.ts", line: 1 },
      context
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("Error")
  })

  test("shows install instructions when LSP server not available", async () => {
    const testFile = join(testDir, "test.java")
    await writeFile(testFile, "public class Test {}")

    const result = await goToDefinitionTool.execute(
      { path: testFile, line: 1, symbol: "Test" },
      context
    )

    // Either finds definition (if jdtls installed) or shows install instructions
    if (result.isError) {
      expect(result.output).toContain("Install")
    }
  })
})

describe("FindReferences Tool", () => {
  let testDir: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = join(tmpdir(), `findref-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    context = {
      workingDirectory: testDir,
      threadId: "test-thread",
    }
  })

  afterEach(async () => {
    await cleanupSharedLSPManager()
    await rm(testDir, { recursive: true, force: true })
  })

  test("returns error when path is missing", async () => {
    const result = await findReferencesTool.execute({ line: 1 }, context)
    expect(result.isError).toBe(true)
    expect(result.output).toContain("path is required")
  })

  test("returns error when line is missing", async () => {
    const result = await findReferencesTool.execute(
      { path: "test.ts" },
      context
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("line is required")
  })

  test("returns error for unsupported file types", async () => {
    const testFile = join(testDir, "test.xyz")
    await writeFile(testFile, "content")

    const result = await findReferencesTool.execute(
      { path: testFile, line: 1 },
      context
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("Unsupported file type")
  })

  test("accepts max_results parameter", async () => {
    const testFile = join(testDir, "test.ts")
    await writeFile(testFile, "const x = 1")

    // Just verify it doesn't error with the parameter
    const result = await findReferencesTool.execute(
      { path: testFile, line: 1, max_results: 10 },
      context
    )

    // Will either work or show install instructions
    expect(result.output).toBeTruthy()
  })
})

describe("GetTypeInfo Tool", () => {
  let testDir: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = join(tmpdir(), `typeinfo-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    context = {
      workingDirectory: testDir,
      threadId: "test-thread",
    }
  })

  afterEach(async () => {
    await cleanupSharedLSPManager()
    await rm(testDir, { recursive: true, force: true })
  })

  test("returns error when path is missing", async () => {
    const result = await getTypeInfoTool.execute({ line: 1 }, context)
    expect(result.isError).toBe(true)
    expect(result.output).toContain("path is required")
  })

  test("returns error when line is missing", async () => {
    const result = await getTypeInfoTool.execute({ path: "test.ts" }, context)
    expect(result.isError).toBe(true)
    expect(result.output).toContain("line is required")
  })

  test("returns error for unsupported file types", async () => {
    const testFile = join(testDir, "test.xyz")
    await writeFile(testFile, "content")

    const result = await getTypeInfoTool.execute(
      { path: testFile, line: 1 },
      context
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("Unsupported file type")
  })

  test("accepts symbol parameter for column detection", async () => {
    const testFile = join(testDir, "test.ts")
    await writeFile(testFile, "const myVar: string = 'hello'")

    const result = await getTypeInfoTool.execute(
      { path: testFile, line: 1, symbol: "myVar" },
      context
    )

    // Will either work or show install instructions
    expect(result.output).toBeTruthy()
  })
})

describe("LSP Tool Specs", () => {
  test("GoToDefinition has correct spec", () => {
    const spec = goToDefinitionTool.spec
    expect(spec.name).toBe("GoToDefinition")
    expect(spec.description).toContain("definition")
    expect(spec.inputSchema.required).toContain("path")
    expect(spec.inputSchema.required).toContain("line")
    expect(spec.inputSchema.properties).toHaveProperty("column")
    expect(spec.inputSchema.properties).toHaveProperty("symbol")
  })

  test("FindReferences has correct spec", () => {
    const spec = findReferencesTool.spec
    expect(spec.name).toBe("FindReferences")
    expect(spec.description).toContain("usages")
    expect(spec.inputSchema.required).toContain("path")
    expect(spec.inputSchema.required).toContain("line")
    expect(spec.inputSchema.properties).toHaveProperty("max_results")
  })

  test("GetTypeInfo has correct spec", () => {
    const spec = getTypeInfoTool.spec
    expect(spec.name).toBe("GetTypeInfo")
    expect(spec.description).toContain("type")
    expect(spec.inputSchema.required).toContain("path")
    expect(spec.inputSchema.required).toContain("line")
  })
})

describe("LSP Tool Execution Profiles", () => {
  test("GoToDefinition has read-only resource profile", () => {
    const profile = goToDefinitionTool.executionProfile
    expect(profile).toBeDefined()

    const keys = profile!.resourceKeys({ path: "/test/file.ts" }, "/test")
    expect(keys.length).toBe(1)
    expect(keys[0].mode).toBe("read")
    expect(keys[0].key).toBe("/test/file.ts")
  })

  test("FindReferences has read-only resource profile", () => {
    const profile = findReferencesTool.executionProfile
    expect(profile).toBeDefined()

    const keys = profile!.resourceKeys({ path: "/test/file.ts" }, "/test")
    expect(keys.length).toBe(1)
    expect(keys[0].mode).toBe("read")
  })

  test("GetTypeInfo has read-only resource profile", () => {
    const profile = getTypeInfoTool.executionProfile
    expect(profile).toBeDefined()

    const keys = profile!.resourceKeys({ path: "/test/file.ts" }, "/test")
    expect(keys.length).toBe(1)
    expect(keys[0].mode).toBe("read")
  })
})
