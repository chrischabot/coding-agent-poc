import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ToolContext } from "../src/core/types"

// Import modules to test
import { createContextBudget } from "../src/context/budget"
import {
  detectFileCategory,
  smartTruncate,
  formatTruncatedOutput,
} from "../src/context/truncation"
import { outlineTool } from "../src/tools/outline"
import { astGrepTool } from "../src/tools/astgrep"
import { readSymbolTool } from "../src/tools/read-symbol"

describe("Context Budget Manager", () => {
  test("creates budget with default config", () => {
    const budget = createContextBudget()
    const status = budget.getStatus()

    expect(status.total).toBe(150000)
    expect(status.used).toBe(0)
    expect(status.percentUsed).toBe(0)
  })

  test("creates budget with custom config", () => {
    const budget = createContextBudget({
      contextLimit: 100000,
      compressionThreshold: 0.8,
    })
    const status = budget.getStatus()

    expect(status.total).toBe(100000)
  })

  test("tracks token usage", () => {
    const budget = createContextBudget({ contextLimit: 10000 })
    budget.setCurrentThreadTokens(5000)

    const status = budget.getStatus()
    expect(status.used).toBe(5000)
    expect(status.percentUsed).toBe(50)
  })

  test("calculates available tokens correctly", () => {
    const budget = createContextBudget({
      contextLimit: 10000,
      compressionThreshold: 0.9, // Compression at 9000
      reserveTokens: 1000,
    })

    // Available = compressionPoint (9000) - used (0) - reserve (1000) = 8000
    expect(budget.available()).toBe(8000)

    budget.setCurrentThreadTokens(4000)
    // Available = 9000 - 4000 - 1000 = 4000
    expect(budget.available()).toBe(4000)
  })

  test("canAccommodate returns correct values", () => {
    const budget = createContextBudget({
      contextLimit: 10000,
      compressionThreshold: 0.9,
      reserveTokens: 1000,
    })

    expect(budget.canAccommodate(8000)).toBe(true)
    expect(budget.canAccommodate(8001)).toBe(false)
  })

  test("wouldTriggerCompression returns correct values", () => {
    const budget = createContextBudget({
      contextLimit: 10000,
      compressionThreshold: 0.9, // Compression at 9000
    })

    budget.setCurrentThreadTokens(8000)

    expect(budget.wouldTriggerCompression(500)).toBe(false)
    expect(budget.wouldTriggerCompression(1000)).toBe(true)
  })

  test("estimateContentTokens calculates correctly", () => {
    const budget = createContextBudget()
    // 4 chars per token
    expect(budget.estimateContentTokens("12345678")).toBe(2)
    expect(budget.estimateContentTokens("123")).toBe(1)
  })

  test("compressionImminent flag set correctly", () => {
    const budget = createContextBudget({
      contextLimit: 10000,
      compressionThreshold: 0.9, // 9000
    })

    // 95% of 9000 = 8550
    budget.setCurrentThreadTokens(8000)
    expect(budget.getStatus().compressionImminent).toBe(false)

    budget.setCurrentThreadTokens(8600)
    expect(budget.getStatus().compressionImminent).toBe(true)
  })

  test("configure updates settings", () => {
    const budget = createContextBudget({ contextLimit: 10000 })
    expect(budget.getStatus().total).toBe(10000)

    budget.configure({ contextLimit: 20000 })
    expect(budget.getStatus().total).toBe(20000)
  })
})

describe("Smart Truncation", () => {
  describe("detectFileCategory", () => {
    test("detects code files by extension", () => {
      expect(detectFileCategory("file.ts")).toBe("code")
      expect(detectFileCategory("file.tsx")).toBe("code")
      expect(detectFileCategory("file.js")).toBe("code")
      expect(detectFileCategory("file.py")).toBe("code")
      expect(detectFileCategory("file.go")).toBe("code")
      expect(detectFileCategory("file.rs")).toBe("code")
    })

    test("detects config files by extension", () => {
      expect(detectFileCategory("config.json")).toBe("config")
      expect(detectFileCategory("config.yaml")).toBe("config")
      expect(detectFileCategory("config.toml")).toBe("config")
      expect(detectFileCategory("app.env")).toBe("config")
    })

    test("detects log files by extension", () => {
      expect(detectFileCategory("app.log")).toBe("log")
    })

    test("detects data files by extension", () => {
      expect(detectFileCategory("data.csv")).toBe("data")
      expect(detectFileCategory("data.sql")).toBe("data")
    })

    test("detects markdown files by extension", () => {
      expect(detectFileCategory("README.md")).toBe("markdown")
      expect(detectFileCategory("doc.txt")).toBe("markdown")
    })

    test("returns unknown for unrecognized extensions", () => {
      expect(detectFileCategory("file.xyz")).toBe("unknown")
    })

    test("detects log by content patterns", () => {
      const logContent = "[2024-01-15 10:30:00] INFO: Starting service"
      expect(detectFileCategory("file.unknown", logContent)).toBe("log")
    })

    test("detects JSON-like content", () => {
      const jsonContent = '{ "key": "value" }'
      expect(detectFileCategory("file.unknown", jsonContent)).toBe("config")
    })
  })

  describe("smartTruncate", () => {
    test("does not truncate small files", () => {
      const content = "line 1\nline 2\nline 3"
      const result = smartTruncate(content, "file.txt", { maxTokens: 1000 })

      expect(result.wasTruncated).toBe(false)
      expect(result.content).toBe(content)
    })

    test("truncates code files preserving imports and signatures", () => {
      const content = `import { foo } from "bar"
import { baz } from "qux"

export function myFunction(a: string, b: number): void {
  // lots of implementation
  console.log(a, b)
}

function helperFunction() {
  return true
}

${"// more code\n".repeat(100)}`

      const result = smartTruncate(content, "file.ts", { maxTokens: 500 })

      expect(result.wasTruncated).toBe(true)
      expect(result.content).toContain("IMPORTS")
      expect(result.content).toContain("bar")
      expect(result.content).toContain("STRUCTURE")
      expect(result.strategy).toContain("imports")
    })

    test("truncates log files with head and tail", () => {
      const lines = Array.from({ length: 500 }, (_, i) => `[2024-01-15] Line ${i}`)
      const content = lines.join("\n")

      const result = smartTruncate(content, "app.log", { maxTokens: 5000 })

      expect(result.wasTruncated).toBe(true)
      expect(result.content).toContain("Line 0")
      expect(result.content).toContain("Line 499")
      expect(result.content).toContain("lines omitted")
    })

    test("truncates config files preserving structure", () => {
      const obj = {
        key1: "value1",
        key2: "value2",
        nested: {
          a: "a".repeat(100),
          b: "b".repeat(100),
        },
        longArray: Array.from({ length: 200 }, (_, i) => ({
          id: i,
          name: `item${i}`,
          description: `This is a longer description for item number ${i}`,
        })),
      }
      const content = JSON.stringify(obj, null, 2)

      // Use a small maxTokens to force truncation
      const result = smartTruncate(content, "config.json", { maxTokens: 200 })

      expect(result.wasTruncated).toBe(true)
      expect(result.content).toContain("key1")
      expect(result.strategy).toContain("structure")
    })

    test("truncates markdown preserving headings", () => {
      const content = `# Main Heading

This is the introduction paragraph that goes on and on.

## Section 1

${"Content of section 1. ".repeat(50)}

## Section 2

${"Content of section 2. ".repeat(50)}

## Section 3

More content here.`

      const result = smartTruncate(content, "README.md", { maxTokens: 200 })

      expect(result.wasTruncated).toBe(true)
      expect(result.content).toContain("# Main Heading")
      expect(result.content).toContain("## Section 1")
      expect(result.strategy).toContain("headings")
    })

    test("handles target range option for code", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `// Line ${i + 1}`)
      const content = lines.join("\n")

      const result = smartTruncate(content, "file.ts", {
        maxTokens: 5000,
        targetRange: { startLine: 50, endLine: 60 },
      })

      expect(result.content).toContain("REQUESTED RANGE")
      expect(result.content).toContain("Line 50")
    })
  })

  describe("formatTruncatedOutput", () => {
    test("formats output with header", () => {
      const truncated = {
        content: "truncated content",
        wasTruncated: true,
        originalLines: 1000,
        includedLines: 100,
        estimatedTokens: 500,
        strategy: "test strategy",
      }

      const output = formatTruncatedOutput(truncated, "test.ts")

      expect(output).toContain("[File: test.ts]")
      expect(output).toContain("1000 lines → 100 included")
      expect(output).toContain("~500 tokens")
      expect(output).toContain("[Strategy: test strategy]")
      expect(output).toContain("truncated content")
    })
  })
})

describe("Outline Tool", () => {
  let testDir: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = join(tmpdir(), `outline-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    context = {
      workingDirectory: testDir,
      threadId: "test-thread",
    }
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("extracts TypeScript outline", async () => {
    const content = `import { foo } from "bar"
import type { Baz } from "qux"

export interface MyInterface {
  name: string
}

export type MyType = string | number

export class MyClass {
  constructor() {}

  async doSomething(): Promise<void> {
    // implementation
  }
}

export function myFunction(a: string): number {
  return 42
}

export const myArrow = async (x: number) => x * 2
`
    const testFile = join(testDir, "test.ts")
    await writeFile(testFile, content)

    const result = await outlineTool.execute({ path: testFile }, context)

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("typescript")
    expect(result.output).toContain("bar")
    expect(result.output).toContain("IMPORTS")
    expect(result.output).toContain("EXPORTS")
    expect(result.output).toContain("MyInterface")
    expect(result.output).toContain("MyClass")
    expect(result.output).toContain("myFunction")
    expect(result.output).toContain("interface")
    expect(result.output).toContain("class")
  })

  test("extracts Python outline", async () => {
    const content = `from typing import List
import os

class MyClass:
    def __init__(self):
        pass

    async def async_method(self):
        pass

def my_function(a: str) -> int:
    return 42

async def async_function():
    pass
`
    const testFile = join(testDir, "test.py")
    await writeFile(testFile, content)

    const result = await outlineTool.execute({ path: testFile }, context)

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("python")
    expect(result.output).toContain("IMPORTS")
    expect(result.output).toContain("typing")
    expect(result.output).toContain("MyClass")
    expect(result.output).toContain("my_function")
  })

  test("extracts Go outline", async () => {
    const content = `package main

import (
	"fmt"
	"os"
)

type MyStruct struct {
	Name string
}

func (m *MyStruct) Method() string {
	return m.Name
}

func myFunction(a string) int {
	return 42
}
`
    const testFile = join(testDir, "test.go")
    await writeFile(testFile, content)

    const result = await outlineTool.execute({ path: testFile }, context)

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("go")
    expect(result.output).toContain("IMPORTS")
    expect(result.output).toContain("fmt")
    expect(result.output).toContain("MyStruct")
    expect(result.output).toContain("myFunction")
  })

  test("extracts Rust outline", async () => {
    const content = `use std::io;
use std::collections::HashMap;

pub struct MyStruct {
    name: String,
}

impl MyStruct {
    pub fn new() -> Self {
        Self { name: String::new() }
    }
}

pub fn my_function(a: &str) -> i32 {
    42
}

pub trait MyTrait {
    fn method(&self);
}
`
    const testFile = join(testDir, "test.rs")
    await writeFile(testFile, content)

    const result = await outlineTool.execute({ path: testFile }, context)

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("rust")
    expect(result.output).toContain("IMPORTS")
    expect(result.output).toContain("std::io")
    expect(result.output).toContain("MyStruct")
    expect(result.output).toContain("my_function")
    expect(result.output).toContain("MyTrait")
  })

  test("returns error for non-existent file", async () => {
    const result = await outlineTool.execute({ path: "/nonexistent.ts" }, context)

    expect(result.isError).toBe(true)
    expect(result.output).toContain("Error")
  })

  test("returns error when path is missing", async () => {
    const result = await outlineTool.execute({}, context)

    expect(result.isError).toBe(true)
    expect(result.output).toContain("path is required")
  })
})

describe("ast-grep Tool", () => {
  let testDir: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = join(tmpdir(), `astgrep-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    context = {
      workingDirectory: testDir,
      threadId: "test-thread",
    }
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("returns helpful error when ast-grep is not installed", async () => {
    // This test will show the error message if sg is not installed,
    // or succeed if it is installed
    const result = await astGrepTool.execute(
      { pattern: "console.log($MSG)", path: testDir },
      context
    )

    // Either we get results (if installed) or a helpful error (if not)
    if (result.isError) {
      expect(result.output).toMatch(/ast-grep|sg|not found|install/i)
    }
  })

  test("returns error when pattern is missing", async () => {
    const result = await astGrepTool.execute({}, context)

    expect(result.isError).toBe(true)
    expect(result.output).toContain("pattern is required")
  })
})

describe("ReadSymbol Tool", () => {
  let testDir: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = join(tmpdir(), `readsymbol-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    context = {
      workingDirectory: testDir,
      threadId: "test-thread",
    }
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("reads a function from TypeScript file", async () => {
    const content = `import { foo } from "bar"

export function myFunction(a: string, b: number): string {
  const result = a + b
  return result
}

export function otherFunction(): void {
  console.log("hello")
}
`
    const testFile = join(testDir, "test.ts")
    await writeFile(testFile, content)

    const result = await readSymbolTool.execute(
      { path: testFile, symbol: "myFunction" },
      context
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("myFunction")
    expect(result.output).toContain("const result")
  })

  test("reads a class from TypeScript file", async () => {
    const content = `export class MyClass {
  private value: number

  constructor(value: number) {
    this.value = value
  }

  getValue(): number {
    return this.value
  }
}

function outsideFunction() {
  return 42
}
`
    const testFile = join(testDir, "test.ts")
    await writeFile(testFile, content)

    const result = await readSymbolTool.execute(
      { path: testFile, symbol: "MyClass" },
      context
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("MyClass")
    expect(result.output).toContain("constructor")
  })

  test("returns error when symbol not found", async () => {
    const content = `export function existingFunction(): void {
  // code
}
`
    const testFile = join(testDir, "test.ts")
    await writeFile(testFile, content)

    const result = await readSymbolTool.execute(
      { path: testFile, symbol: "nonExistentSymbol" },
      context
    )

    expect(result.isError).toBe(true)
    expect(result.output).toContain("not found")
    expect(result.output).toContain("Available symbols")
    expect(result.output).toContain("existingFunction")
  })

  test("returns error when path is missing", async () => {
    const result = await readSymbolTool.execute({ symbol: "test" }, context)

    expect(result.isError).toBe(true)
    expect(result.output).toContain("path is required")
  })

  test("returns error when symbol is missing", async () => {
    const testFile = join(testDir, "test.ts")
    await writeFile(testFile, "export const x = 1")

    const result = await readSymbolTool.execute({ path: testFile }, context)

    expect(result.isError).toBe(true)
    expect(result.output).toContain("symbol is required")
  })

  test("handles partial symbol name match", async () => {
    const content = `export function handleUserAuthentication(user: User): boolean {
  return user.isAuthenticated
}

export function validateInput(input: string): boolean {
  return input.length > 0
}
`
    const testFile = join(testDir, "test.ts")
    await writeFile(testFile, content)

    const result = await readSymbolTool.execute(
      { path: testFile, symbol: "handleUser" },
      context
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("handleUserAuthentication")
  })

  test("uses line hint to adjust range", async () => {
    const content = `// Line 1
// Line 2
// Line 3
export function targetFunction(): void { // Line 4
  console.log("target") // Line 5
} // Line 6
// Line 7
// Line 8
// Line 9
// Line 10
`
    const testFile = join(testDir, "test.ts")
    await writeFile(testFile, content)

    const result = await readSymbolTool.execute(
      { path: testFile, symbol: "targetFunction", line: 5 },
      context
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("targetFunction")
  })

  test("reads Python function", async () => {
    const content = `def my_python_function(a: str, b: int) -> str:
    result = a * b
    return result

def other_function():
    pass
`
    const testFile = join(testDir, "test.py")
    await writeFile(testFile, content)

    const result = await readSymbolTool.execute(
      { path: testFile, symbol: "my_python_function" },
      context
    )

    expect(result.isError).toBeFalsy()
    expect(result.output).toContain("my_python_function")
    expect(result.output).toContain("result")
  })
})
