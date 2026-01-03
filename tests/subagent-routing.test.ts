/**
 * Sub-Agent Routing Tests
 *
 * Tests that tool descriptions properly guide agent selection.
 */

import { describe, test, expect } from "bun:test"
import { writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import {
  taskTool,
  finderTool,
  oracleTool,
  painterTool,
  librarianTool,
  krakenTool,
} from "../src/tools/subagent"

const OUTPUT_DIR = join(process.cwd(), "tests", "output")

const tools = [
  { name: "Task", tool: taskTool },
  { name: "Finder", tool: finderTool },
  { name: "Oracle", tool: oracleTool },
  { name: "Painter", tool: painterTool },
  { name: "Librarian", tool: librarianTool },
  { name: "Kraken", tool: krakenTool },
]

describe("Tool Descriptions Have Examples", () => {
  for (const { name, tool } of tools) {
    test(`${name} has examples`, () => {
      const desc = tool.spec.description.toLowerCase()
      expect(desc).toContain("examples:")
    })
  }
})

describe("Task Agent", () => {
  const desc = taskTool.spec.description.toLowerCase()

  test("is general purpose", () => {
    expect(desc).toContain("general-purpose")
  })

  test("specifies file count (1-10)", () => {
    expect(desc).toContain("1-10 files")
  })

  test("mentions Painter for frontend", () => {
    expect(desc).toContain("painter")
  })

  test("mentions Kraken for large changes", () => {
    expect(desc).toContain("kraken")
  })
})

describe("Finder Agent", () => {
  const desc = finderTool.spec.description.toLowerCase()

  test("is for local codebase", () => {
    expect(desc).toContain("local codebase")
  })

  test("answers 'where' questions", () => {
    expect(desc).toContain("where")
  })

  test("does not modify code", () => {
    expect(desc).toContain("does not modify")
  })
})

describe("Oracle Agent", () => {
  const desc = oracleTool.spec.description.toLowerCase()

  test("is for explicit analysis requests", () => {
    expect(desc).toContain("explicit")
  })

  test("has trigger phrases", () => {
    expect(desc).toContain("trigger phrases")
  })

  test("does NOT write code", () => {
    expect(desc).toContain("does not write")
  })

  test("warns against self-validation", () => {
    expect(desc).toContain("do not use oracle to validate")
  })
})

describe("Painter Agent", () => {
  const desc = painterTool.spec.description.toLowerCase()

  test("is for frontend/UI", () => {
    expect(desc).toMatch(/frontend|ui|ux/)
  })

  test("mentions React/CSS/etc", () => {
    expect(desc).toMatch(/react|css|tailwind/)
  })

  test("mentions Task for backend", () => {
    expect(desc).toContain("task")
  })
})

describe("Librarian Agent", () => {
  const desc = librarianTool.spec.description.toLowerCase()

  test("is ONLY for external repos", () => {
    expect(desc).toContain("only")
    expect(desc).toMatch(/github|gitlab/)
  })

  test("requires URL", () => {
    expect(desc).toContain("url")
  })

  test("mentions Finder for local work", () => {
    expect(desc).toContain("finder")
  })
})

describe("Kraken Agent", () => {
  const desc = krakenTool.spec.description.toLowerCase()

  test("is for bulk/large changes", () => {
    expect(desc).toMatch(/bulk|large-scale/)
  })

  test("specifies file count (10+)", () => {
    expect(desc).toContain("10+")
  })

  test("mentions Task for smaller changes", () => {
    expect(desc).toContain("task")
  })
})

describe("Clear Disambiguation", () => {
  test("Task vs Kraken: file count boundary", () => {
    const taskDesc = taskTool.spec.description.toLowerCase()
    const krakenDesc = krakenTool.spec.description.toLowerCase()

    expect(taskDesc).toContain("1-10")
    expect(krakenDesc).toContain("10+")
  })

  test("Finder vs Librarian: local vs external", () => {
    const finderDesc = finderTool.spec.description.toLowerCase()
    const librarianDesc = librarianTool.spec.description.toLowerCase()

    expect(finderDesc).toContain("local")
    expect(librarianDesc).toMatch(/github|gitlab|external/)
  })

  test("Task vs Painter: backend vs frontend", () => {
    const painterDesc = painterTool.spec.description.toLowerCase()

    expect(painterDesc).toContain("frontend")
    expect(painterDesc).toContain("backend")
  })

  test("Oracle vs Task: explicit requests only", () => {
    const oracleDesc = oracleTool.spec.description.toLowerCase()

    expect(oracleDesc).toContain("explicit")
    expect(oracleDesc).toContain("do not use oracle to validate")
  })
})

describe("Generate Evaluation", () => {
  test("write evaluation prompt", async () => {
    await mkdir(OUTPUT_DIR, { recursive: true })

    const evalPrompt = `Evaluate these sub-agent tool descriptions for routing clarity.

Rate each 1-5:
1. **Clarity**: Is the purpose immediately obvious?
2. **Disambiguation**: Are boundaries with similar agents clear?
3. **Examples**: Do examples make usage obvious?
4. **Actionability**: Would Claude select correctly?

Return JSON array with scores and suggestions.

---

${tools.map(t => `## ${t.name}
\`\`\`
${t.tool.spec.description}
\`\`\`
`).join("\n")}
`

    await writeFile(join(OUTPUT_DIR, "routing-eval.txt"), evalPrompt)
    console.log("\nWrote routing-eval.txt")

    expect(true).toBe(true)
  })
})
