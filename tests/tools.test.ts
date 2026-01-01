import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readTool } from "../src/tools/read"
import { editTool } from "../src/tools/edit"
import { bashTool } from "../src/tools/bash"
import { grepTool } from "../src/tools/grep"
import { globTool } from "../src/tools/glob"
import type { ToolContext } from "../src/core/types"

describe("Tool Tests", () => {
  let testDir: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = join(tmpdir(), `coding-agent-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    context = {
      workingDirectory: testDir,
      threadId: "test-thread",
    }
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe("Read Tool", () => {
    test("reads a file with line numbers", async () => {
      const testFile = join(testDir, "test.txt")
      await writeFile(testFile, "line 1\nline 2\nline 3")

      const result = await readTool.execute({ path: testFile }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("1\tline 1")
      expect(result.output).toContain("2\tline 2")
      expect(result.output).toContain("3\tline 3")
    })

    test("reads file with offset", async () => {
      const testFile = join(testDir, "test.txt")
      await writeFile(testFile, "line 1\nline 2\nline 3\nline 4\nline 5")

      const result = await readTool.execute({ path: testFile, offset: 2, limit: 2 }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("line 3")
      expect(result.output).toContain("line 4")
      expect(result.output).not.toContain("line 1")
      expect(result.output).not.toContain("line 5")
    })

    test("returns error for non-existent file", async () => {
      const result = await readTool.execute({ path: "/nonexistent/file.txt" }, context)
      expect(result.isError).toBe(true)
      expect(result.output).toContain("Error")
    })

    test("reads relative path", async () => {
      const testFile = join(testDir, "relative.txt")
      await writeFile(testFile, "content")

      const result = await readTool.execute({ path: "relative.txt" }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("content")
    })
  })

  describe("Edit Tool", () => {
    test("edits file by replacing text", async () => {
      const testFile = join(testDir, "edit.txt")
      await writeFile(testFile, "Hello World")

      const result = await editTool.execute(
        { path: testFile, old_str: "World", new_str: "Universe" },
        context
      )

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("edited successfully")

      const content = await readFile(testFile, "utf-8")
      expect(content).toBe("Hello Universe")
    })

    test("returns error if old_str not found", async () => {
      const testFile = join(testDir, "edit.txt")
      await writeFile(testFile, "Hello World")

      const result = await editTool.execute(
        { path: testFile, old_str: "NotFound", new_str: "Replacement" },
        context
      )

      expect(result.isError).toBe(true)
      expect(result.output).toContain("not found")
    })

    test("returns error if old_str found multiple times", async () => {
      const testFile = join(testDir, "edit.txt")
      await writeFile(testFile, "Hello Hello Hello")

      const result = await editTool.execute(
        { path: testFile, old_str: "Hello", new_str: "Hi" },
        context
      )

      expect(result.isError).toBe(true)
      expect(result.output).toContain("found")
      expect(result.output).toContain("times")
    })

    test("creates file if create_if_missing is true", async () => {
      const testFile = join(testDir, "new-file.txt")

      const result = await editTool.execute(
        { path: testFile, old_str: "", new_str: "New content", create_if_missing: true },
        context
      )

      expect(result.isError).toBeFalsy()
      const content = await readFile(testFile, "utf-8")
      expect(content).toBe("New content")
    })
  })

  describe("Bash Tool", () => {
    test("executes simple command", async () => {
      const result = await bashTool.execute({ command: "echo 'hello'" }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output.trim()).toBe("hello")
    })

    test("returns exit code on failure", async () => {
      const result = await bashTool.execute({ command: "exit 1" }, context)

      expect(result.isError).toBe(true)
      expect(result.output).toContain("exited with code 1")
    })

    test("uses specified cwd", async () => {
      const subDir = join(testDir, "subdir")
      await mkdir(subDir)

      const result = await bashTool.execute({ command: "pwd", cwd: subDir }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output.trim()).toContain("subdir")
    })

    test("captures stderr", async () => {
      const result = await bashTool.execute(
        { command: "echo 'error message' >&2" },
        context
      )

      expect(result.output).toContain("error message")
    })
  })

  describe("Grep Tool", () => {
    test("finds pattern in files", async () => {
      await writeFile(join(testDir, "file1.txt"), "hello world\nfoo bar")
      await writeFile(join(testDir, "file2.txt"), "goodbye world")

      const result = await grepTool.execute({ pattern: "world" }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("file1.txt")
      expect(result.output).toContain("file2.txt")
      expect(result.output).toContain("world")
    })

    test("returns no results message when pattern not found", async () => {
      await writeFile(join(testDir, "file1.txt"), "hello")

      const result = await grepTool.execute({ pattern: "notfound" }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("No results")
    })

    test("respects path parameter", async () => {
      await mkdir(join(testDir, "subdir"))
      await writeFile(join(testDir, "root.txt"), "findme")
      await writeFile(join(testDir, "subdir", "nested.txt"), "findme")

      const result = await grepTool.execute(
        { pattern: "findme", path: join(testDir, "subdir") },
        context
      )

      expect(result.output).toContain("nested.txt")
      expect(result.output).not.toContain("root.txt")
    })
  })

  describe("Glob Tool", () => {
    test("finds files by pattern", async () => {
      await writeFile(join(testDir, "file1.ts"), "")
      await writeFile(join(testDir, "file2.ts"), "")
      await writeFile(join(testDir, "file.js"), "")

      const result = await globTool.execute({ pattern: "*.ts" }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("file1.ts")
      expect(result.output).toContain("file2.ts")
      expect(result.output).not.toContain("file.js")
    })

    test("finds nested files", async () => {
      await mkdir(join(testDir, "src"))
      await writeFile(join(testDir, "src", "index.ts"), "")
      await writeFile(join(testDir, "root.ts"), "")

      const result = await globTool.execute({ pattern: "**/*.ts" }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("index.ts")
      expect(result.output).toContain("root.ts")
    })

    test("returns no files message when no matches", async () => {
      const result = await globTool.execute({ pattern: "*.xyz" }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("No files")
    })
  })

  describe("Todo Tools", () => {
    const { todoWriteTool, todoReadTool, clearTodos } = require("../src/tools/todo")

    afterEach(() => {
      clearTodos(context.threadId)
    })

    test("writes and reads todos", async () => {
      const todos = [
        { id: "1", content: "First task", status: "pending" },
        { id: "2", content: "Second task", status: "in_progress" },
      ]

      const writeResult = await todoWriteTool.execute({ todos }, context)
      expect(writeResult.isError).toBeFalsy()
      expect(writeResult.output).toContain("2 todo(s)")

      const readResult = await todoReadTool.execute({}, context)
      expect(readResult.output).toContain("First task")
      expect(readResult.output).toContain("Second task")
      expect(readResult.output).toContain("[ ]")
      expect(readResult.output).toContain("[~]")
    })

    test("marks todos as completed", async () => {
      const todos = [
        { id: "1", content: "Task to complete", status: "completed" },
      ]

      await todoWriteTool.execute({ todos }, context)
      const result = await todoReadTool.execute({}, context)

      expect(result.output).toContain("[x]")
      expect(result.output).toContain("Task to complete")
    })

    test("returns empty message when no todos", async () => {
      const result = await todoReadTool.execute({}, context)
      expect(result.output).toBe("No todos.")
    })

    test("validates todo structure", async () => {
      const invalidTodos = [{ id: "1" }]
      const result = await todoWriteTool.execute({ todos: invalidTodos }, context)

      expect(result.isError).toBe(true)
      expect(result.output).toContain("Error")
    })

    test("validates status values", async () => {
      const invalidStatus = [
        { id: "1", content: "Test", status: "invalid_status" },
      ]
      const result = await todoWriteTool.execute({ todos: invalidStatus }, context)

      expect(result.isError).toBe(true)
      expect(result.output).toContain("invalid status")
    })

    test("updates existing todos", async () => {
      await todoWriteTool.execute({
        todos: [{ id: "1", content: "Initial", status: "pending" }],
      }, context)

      await todoWriteTool.execute({
        todos: [{ id: "1", content: "Updated", status: "completed" }],
      }, context)

      const result = await todoReadTool.execute({}, context)
      expect(result.output).toContain("Updated")
      expect(result.output).toContain("[x]")
      expect(result.output).not.toContain("Initial")
    })
  })

  describe("Write Tool", () => {
    const { writeTool } = require("../src/tools/write")

    test("creates a new file", async () => {
      const testFile = join(testDir, "new-file.txt")
      const result = await writeTool.execute(
        { path: testFile, content: "Hello, World!" },
        context
      )

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("Created file")

      const content = await readFile(testFile, "utf-8")
      expect(content).toBe("Hello, World!")
    })

    test("creates parent directories", async () => {
      const testFile = join(testDir, "nested", "deep", "file.txt")
      const result = await writeTool.execute(
        { path: testFile, content: "Nested content" },
        context
      )

      expect(result.isError).toBeFalsy()
      const content = await readFile(testFile, "utf-8")
      expect(content).toBe("Nested content")
    })

    test("creates file with relative path", async () => {
      const result = await writeTool.execute(
        { path: "relative-write.txt", content: "Relative content" },
        context
      )

      expect(result.isError).toBeFalsy()
      const content = await readFile(join(testDir, "relative-write.txt"), "utf-8")
      expect(content).toBe("Relative content")
    })

    test("overwrites existing file", async () => {
      const testFile = join(testDir, "overwrite.txt")
      await writeFile(testFile, "Original")

      await writeTool.execute({ path: testFile, content: "New content" }, context)

      const content = await readFile(testFile, "utf-8")
      expect(content).toBe("New content")
    })
  })

  describe("Delete Tool", () => {
    const { deleteTool } = require("../src/tools/delete")

    test("deletes a file", async () => {
      const testFile = join(testDir, "to-delete.txt")
      await writeFile(testFile, "Delete me")

      const result = await deleteTool.execute({ path: testFile }, context)

      expect(result.isError).toBeFalsy()
      expect(result.output).toContain("Deleted")

      await expect(readFile(testFile)).rejects.toThrow()
    })

    test("deletes file with relative path", async () => {
      await writeFile(join(testDir, "relative-delete.txt"), "Delete me")

      const result = await deleteTool.execute({ path: "relative-delete.txt" }, context)

      expect(result.isError).toBeFalsy()
    })

    test("returns error for non-existent file", async () => {
      const result = await deleteTool.execute({ path: "/nonexistent/file.txt" }, context)

      expect(result.isError).toBe(true)
      expect(result.output).toContain("not found")
    })

    test("requires recursive for directories", async () => {
      const testSubDir = join(testDir, "subdir-to-delete")
      await mkdir(testSubDir, { recursive: true })
      await writeFile(join(testSubDir, "file.txt"), "content")

      const result = await deleteTool.execute({ path: testSubDir }, context)

      expect(result.isError).toBe(true)
      expect(result.output).toContain("recursive")
    })

    test("deletes directory recursively", async () => {
      const testSubDir = join(testDir, "recursive-delete")
      await mkdir(testSubDir, { recursive: true })
      await writeFile(join(testSubDir, "file.txt"), "content")

      const result = await deleteTool.execute(
        { path: testSubDir, recursive: true },
        context
      )

      expect(result.isError).toBeFalsy()
    })
  })

  describe("WebFetch Tool", () => {
    const { webFetchTool } = require("../src/tools/webfetch")

    test("returns error for invalid URL", async () => {
      const result = await webFetchTool.execute({ url: "not-a-url" }, context)

      expect(result.isError).toBe(true)
      expect(result.output).toContain("Invalid URL")
    })

    test("fetches a valid URL", async () => {
      const result = await webFetchTool.execute(
        { url: "https://httpbin.org/html" },
        context
      )

      expect(result.isError).toBeFalsy()
      expect(result.output.length).toBeGreaterThan(0)
    })

    test("returns error for 404", async () => {
      const result = await webFetchTool.execute(
        { url: "https://httpbin.org/status/404" },
        context
      )

      expect(result.isError).toBe(true)
      expect(result.output).toContain("404")
    })

    test("strips HTML tags by default", async () => {
      const result = await webFetchTool.execute(
        { url: "https://httpbin.org/html" },
        context
      )

      expect(result.isError).toBeFalsy()
      expect(result.output).not.toContain("<html")
      expect(result.output).not.toContain("<body")
    })
  })
})
