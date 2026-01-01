import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { registerBuiltinTools, getTool } from "../src/tools"
import type { ResourceKey } from "../src/core/types"

describe("Execution Profiles", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `coding-agent-exec-profile-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    registerBuiltinTools()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe("Tool Resource Declarations", () => {
    test("Read tool declares read lock on path", () => {
      const tool = getTool("Read")
      expect(tool?.executionProfile).toBeDefined()

      const keys = tool?.executionProfile?.resourceKeys({ path: "test.txt" })
      expect(keys).toEqual([{ key: "test.txt", mode: "read" }])
    })

    test("Edit tool declares write lock on path", () => {
      const tool = getTool("Edit")
      expect(tool?.executionProfile).toBeDefined()

      const keys = tool?.executionProfile?.resourceKeys({ path: "test.txt" })
      expect(keys).toEqual([{ key: "test.txt", mode: "write" }])
    })

    test("Write tool declares write lock on path", () => {
      const tool = getTool("Write")
      expect(tool?.executionProfile).toBeDefined()

      const keys = tool?.executionProfile?.resourceKeys({ path: "test.txt" })
      expect(keys).toEqual([{ key: "test.txt", mode: "write" }])
    })

    test("Delete tool declares write lock on path", () => {
      const tool = getTool("Delete")
      expect(tool?.executionProfile).toBeDefined()

      const keys = tool?.executionProfile?.resourceKeys({ path: "test.txt" })
      expect(keys).toEqual([{ key: "test.txt", mode: "write" }])
    })

    test("tools without executionProfile return empty keys", () => {
      const tool = getTool("Grep")
      const keys = tool?.executionProfile?.resourceKeys({ pattern: "test" }) ?? []
      expect(keys).toEqual([])
    })

    test("tools return empty keys when path is missing", () => {
      const tool = getTool("Read")
      const keys = tool?.executionProfile?.resourceKeys({})
      expect(keys).toEqual([])
    })
  })

  describe("Resource Conflict Detection", () => {
    function hasConflict(keys1: ResourceKey[], keys2: ResourceKey[]): boolean {
      for (const k1 of keys1) {
        for (const k2 of keys2) {
          if (k1.key === k2.key && (k1.mode === "write" || k2.mode === "write")) {
            return true
          }
        }
      }
      return false
    }

    test("two reads on same file do not conflict", () => {
      const keys1: ResourceKey[] = [{ key: "file.txt", mode: "read" }]
      const keys2: ResourceKey[] = [{ key: "file.txt", mode: "read" }]
      expect(hasConflict(keys1, keys2)).toBe(false)
    })

    test("read and write on same file conflict", () => {
      const keys1: ResourceKey[] = [{ key: "file.txt", mode: "read" }]
      const keys2: ResourceKey[] = [{ key: "file.txt", mode: "write" }]
      expect(hasConflict(keys1, keys2)).toBe(true)
    })

    test("two writes on same file conflict", () => {
      const keys1: ResourceKey[] = [{ key: "file.txt", mode: "write" }]
      const keys2: ResourceKey[] = [{ key: "file.txt", mode: "write" }]
      expect(hasConflict(keys1, keys2)).toBe(true)
    })

    test("operations on different files do not conflict", () => {
      const keys1: ResourceKey[] = [{ key: "file1.txt", mode: "write" }]
      const keys2: ResourceKey[] = [{ key: "file2.txt", mode: "write" }]
      expect(hasConflict(keys1, keys2)).toBe(false)
    })

    test("read on one file, write on another do not conflict", () => {
      const keys1: ResourceKey[] = [{ key: "file1.txt", mode: "read" }]
      const keys2: ResourceKey[] = [{ key: "file2.txt", mode: "write" }]
      expect(hasConflict(keys1, keys2)).toBe(false)
    })
  })

  describe("Batching Logic", () => {
    function batchByResources(
      toolCalls: { name: string; input: Record<string, unknown> }[]
    ): { name: string; input: Record<string, unknown> }[][] {
      if (toolCalls.length <= 1) {
        return [toolCalls]
      }

      const toolsWithResources = toolCalls.map((tc) => {
        const tool = getTool(tc.name)
        const resourceKeys = tool?.executionProfile?.resourceKeys(tc.input) ?? []
        return { ...tc, resourceKeys }
      })

      const batches: { name: string; input: Record<string, unknown> }[][] = []
      const assigned = new Set<number>()

      while (assigned.size < toolsWithResources.length) {
        const batch: { name: string; input: Record<string, unknown> }[] = []
        const batchResources: ResourceKey[] = []

        for (let i = 0; i < toolsWithResources.length; i++) {
          if (assigned.has(i)) continue

          const tc = toolsWithResources[i]
          let canAdd = true

          for (const newKey of tc.resourceKeys) {
            for (const existing of batchResources) {
              if (newKey.key === existing.key && (newKey.mode === "write" || existing.mode === "write")) {
                canAdd = false
                break
              }
            }
            if (!canAdd) break
          }

          if (canAdd) {
            batch.push({ name: tc.name, input: tc.input })
            batchResources.push(...tc.resourceKeys)
            assigned.add(i)
          }
        }

        if (batch.length > 0) {
          batches.push(batch)
        }
      }

      return batches
    }

    test("multiple reads on same file batch together", () => {
      const calls = [
        { name: "Read", input: { path: "file.txt" } },
        { name: "Read", input: { path: "file.txt" } },
      ]
      const batches = batchByResources(calls)
      expect(batches.length).toBe(1)
      expect(batches[0].length).toBe(2)
    })

    test("read and write on same file go to different batches", () => {
      const calls = [
        { name: "Read", input: { path: "file.txt" } },
        { name: "Edit", input: { path: "file.txt", old_str: "", new_str: "" } },
      ]
      const batches = batchByResources(calls)
      expect(batches.length).toBe(2)
    })

    test("operations on different files batch together", () => {
      const calls = [
        { name: "Read", input: { path: "file1.txt" } },
        { name: "Edit", input: { path: "file2.txt", old_str: "", new_str: "" } },
        { name: "Write", input: { path: "file3.txt", content: "" } },
      ]
      const batches = batchByResources(calls)
      expect(batches.length).toBe(1)
      expect(batches[0].length).toBe(3)
    })

    test("complex scenario: read(A), read(A), write(A), write(B)", () => {
      const calls = [
        { name: "Read", input: { path: "A.txt" } },
        { name: "Read", input: { path: "A.txt" } },
        { name: "Edit", input: { path: "A.txt", old_str: "", new_str: "" } },
        { name: "Write", input: { path: "B.txt", content: "" } },
      ]
      const batches = batchByResources(calls)

      expect(batches.length).toBe(2)

      const batch1Names = batches[0].map((t) => `${t.name}(${(t.input as { path: string }).path})`)
      const batch2Names = batches[1].map((t) => `${t.name}(${(t.input as { path: string }).path})`)

      expect(batch1Names).toContain("Read(A.txt)")
      expect(batch1Names).toContain("Write(B.txt)")
      expect(batch2Names).toContain("Edit(A.txt)")
    })

    test("tools without profiles batch freely", () => {
      const calls = [
        { name: "Grep", input: { pattern: "test" } },
        { name: "Glob", input: { pattern: "*.ts" } },
        { name: "Read", input: { path: "file.txt" } },
      ]
      const batches = batchByResources(calls)
      expect(batches.length).toBe(1)
      expect(batches[0].length).toBe(3)
    })
  })

  describe("Tool Contract Tests", () => {
    const filesystemWriteTools = ["Edit", "Write", "Delete"]

    test.each(filesystemWriteTools)("%s tool has executionProfile with write mode", (toolName) => {
      const tool = getTool(toolName)
      expect(tool).toBeDefined()
      expect(tool?.executionProfile).toBeDefined()

      const keys = tool?.executionProfile?.resourceKeys({ path: "test.txt" })
      expect(keys?.length).toBeGreaterThan(0)
      expect(keys?.[0].mode).toBe("write")
    })

    test("Read tool has executionProfile with read mode", () => {
      const tool = getTool("Read")
      expect(tool).toBeDefined()
      expect(tool?.executionProfile).toBeDefined()

      const keys = tool?.executionProfile?.resourceKeys({ path: "test.txt" })
      expect(keys?.length).toBeGreaterThan(0)
      expect(keys?.[0].mode).toBe("read")
    })
  })
})
