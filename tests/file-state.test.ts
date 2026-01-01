import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  recordFileRead,
  checkFileConflict,
  clearThreadFileState,
  clearFileState,
} from "../src/context/file-state"
import { readTool } from "../src/tools/read"
import { editTool } from "../src/tools/edit"
import type { ToolContext } from "../src/core/types"

describe("File State Tracking", () => {
  let testDir: string
  let filePath: string
  let context: ToolContext

  beforeEach(async () => {
    testDir = join(tmpdir(), `coding-agent-file-state-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    filePath = join(testDir, "test.txt")
    context = { workingDirectory: testDir, threadId: "thread-1" }
    clearFileState()
  })

  afterEach(async () => {
    clearFileState()
    await rm(testDir, { recursive: true, force: true })
  })

  describe("recordFileRead and checkFileConflict", () => {
    test("no conflict when file unchanged since read", async () => {
      await writeFile(filePath, "hello", "utf-8")
      await recordFileRead(filePath, context.threadId)

      const conflict = await checkFileConflict(filePath, context.threadId)
      expect(conflict.hasConflict).toBe(false)
    })

    test("detects external modification since last read (same thread)", async () => {
      await writeFile(filePath, "hello", "utf-8")
      await recordFileRead(filePath, context.threadId)

      await Bun.sleep(10)
      await writeFile(filePath, "hello changed", "utf-8")

      const conflict = await checkFileConflict(filePath, context.threadId)
      expect(conflict.hasConflict).toBe(true)
      expect(conflict.message).toContain("modified externally")
    })

    test("no conflict for different threadId (thread isolation)", async () => {
      await writeFile(filePath, "hello", "utf-8")
      await recordFileRead(filePath, "thread-a")

      await Bun.sleep(10)
      await writeFile(filePath, "changed", "utf-8")

      const conflict = await checkFileConflict(filePath, "thread-b")
      expect(conflict.hasConflict).toBe(false)
    })

    test("no conflict for untracked file", async () => {
      await writeFile(filePath, "hello", "utf-8")

      const conflict = await checkFileConflict(filePath, context.threadId)
      expect(conflict.hasConflict).toBe(false)
    })

    test("no conflict after file deleted", async () => {
      await writeFile(filePath, "hello", "utf-8")
      await recordFileRead(filePath, context.threadId)
      await rm(filePath)

      const conflict = await checkFileConflict(filePath, context.threadId)
      expect(conflict.hasConflict).toBe(false)
    })
  })

  describe("clearFileState", () => {
    test("clearFileState(path) clears specific file", async () => {
      await writeFile(filePath, "hello", "utf-8")
      await recordFileRead(filePath, context.threadId)

      await Bun.sleep(10)
      await writeFile(filePath, "changed", "utf-8")

      clearFileState(filePath)

      const conflict = await checkFileConflict(filePath, context.threadId)
      expect(conflict.hasConflict).toBe(false)
    })

    test("clearFileState() clears all files", async () => {
      const file1 = join(testDir, "file1.txt")
      const file2 = join(testDir, "file2.txt")
      await writeFile(file1, "a", "utf-8")
      await writeFile(file2, "b", "utf-8")

      await recordFileRead(file1, context.threadId)
      await recordFileRead(file2, context.threadId)

      await Bun.sleep(10)
      await writeFile(file1, "changed", "utf-8")
      await writeFile(file2, "changed", "utf-8")

      clearFileState()

      const conflict1 = await checkFileConflict(file1, context.threadId)
      const conflict2 = await checkFileConflict(file2, context.threadId)
      expect(conflict1.hasConflict).toBe(false)
      expect(conflict2.hasConflict).toBe(false)
    })

    test("clearThreadFileState removes only that thread's records", async () => {
      const file1 = join(testDir, "file1.txt")
      const file2 = join(testDir, "file2.txt")
      await writeFile(file1, "a", "utf-8")
      await writeFile(file2, "b", "utf-8")

      await recordFileRead(file1, "thread-a")
      await recordFileRead(file2, "thread-b")

      await Bun.sleep(10)
      await writeFile(file1, "changed", "utf-8")
      await writeFile(file2, "changed", "utf-8")

      clearThreadFileState("thread-a")

      const conflict1 = await checkFileConflict(file1, "thread-a")
      const conflict2 = await checkFileConflict(file2, "thread-b")

      expect(conflict1.hasConflict).toBe(false)
      expect(conflict2.hasConflict).toBe(true)
    })
  })

  describe("Read tool integration", () => {
    test("Read tool records file read for conflict detection", async () => {
      await writeFile(filePath, "Hello World", "utf-8")

      await readTool.execute({ path: filePath }, context)

      await Bun.sleep(10)
      await writeFile(filePath, "Modified externally", "utf-8")

      const conflict = await checkFileConflict(filePath, context.threadId)
      expect(conflict.hasConflict).toBe(true)
    })

    test("Read with error does not record file state", async () => {
      const nonExistent = join(testDir, "does-not-exist.txt")

      const result = await readTool.execute({ path: nonExistent }, context)
      expect(result.isError).toBe(true)

      const conflict = await checkFileConflict(nonExistent, context.threadId)
      expect(conflict.hasConflict).toBe(false)
    })
  })

  describe("Edit tool integration", () => {
    test("Edit tool blocks write if file changed after Read", async () => {
      await writeFile(filePath, "Hello World", "utf-8")

      const readRes = await readTool.execute({ path: filePath }, context)
      expect(readRes.isError).toBeFalsy()

      await Bun.sleep(10)
      await writeFile(filePath, "Hello World - modified externally", "utf-8")

      const editRes = await editTool.execute(
        { path: filePath, old_str: "World", new_str: "Universe" },
        context
      )

      expect(editRes.isError).toBe(true)
      expect(editRes.output).toContain("modified externally")

      const content = await readFile(filePath, "utf-8")
      expect(content).toBe("Hello World - modified externally")
    })

    test("Edit tool succeeds when file unchanged", async () => {
      await writeFile(filePath, "Hello World", "utf-8")

      await readTool.execute({ path: filePath }, context)

      const editRes = await editTool.execute(
        { path: filePath, old_str: "World", new_str: "Universe" },
        context
      )

      expect(editRes.isError).toBeFalsy()

      const content = await readFile(filePath, "utf-8")
      expect(content).toBe("Hello Universe")
    })

    test("Edit tool updates file state after successful edit", async () => {
      await writeFile(filePath, "Hello World", "utf-8")

      await readTool.execute({ path: filePath }, context)
      await editTool.execute(
        { path: filePath, old_str: "World", new_str: "Universe" },
        context
      )

      const secondEditRes = await editTool.execute(
        { path: filePath, old_str: "Universe", new_str: "Galaxy" },
        context
      )

      expect(secondEditRes.isError).toBeFalsy()

      const content = await readFile(filePath, "utf-8")
      expect(content).toBe("Hello Galaxy")
    })

    test("Edit without prior Read succeeds (no tracking)", async () => {
      await writeFile(filePath, "Hello World", "utf-8")

      const editRes = await editTool.execute(
        { path: filePath, old_str: "World", new_str: "Universe" },
        context
      )

      expect(editRes.isError).toBeFalsy()

      const content = await readFile(filePath, "utf-8")
      expect(content).toBe("Hello Universe")
    })
  })

  describe("Edge Cases", () => {
    test("handles rapid successive reads", async () => {
      await writeFile(filePath, "content", "utf-8")

      await recordFileRead(filePath, context.threadId)
      await recordFileRead(filePath, context.threadId)
      await recordFileRead(filePath, context.threadId)

      const conflict = await checkFileConflict(filePath, context.threadId)
      expect(conflict.hasConflict).toBe(false)
    })

    test("handles file with special characters in path", async () => {
      const specialPath = join(testDir, "file with spaces.txt")
      await writeFile(specialPath, "content", "utf-8")

      await recordFileRead(specialPath, context.threadId)

      await Bun.sleep(10)
      await writeFile(specialPath, "changed", "utf-8")

      const conflict = await checkFileConflict(specialPath, context.threadId)
      expect(conflict.hasConflict).toBe(true)
    })

    test("recordFileRead with non-existent file clears tracking", async () => {
      await writeFile(filePath, "content", "utf-8")
      await recordFileRead(filePath, context.threadId)

      await rm(filePath)
      await recordFileRead(filePath, context.threadId)

      const conflict = await checkFileConflict(filePath, context.threadId)
      expect(conflict.hasConflict).toBe(false)
    })
  })
})
