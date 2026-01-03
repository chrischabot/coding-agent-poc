/**
 * Sub-Agent Prompt Quality Tests
 *
 * Tests that sub-agent system prompts and configurations are solid.
 * Outputs prompts for Claude CLI evaluation.
 */

import { describe, test, expect } from "bun:test"
import { writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import {
  createTaskConfig,
  createFinderConfig,
  createOracleConfig,
  createPainterConfig,
  createLibrarianConfig,
  createKrakenScopeConfig,
  createKrakenExecutorConfig,
} from "../src/subagent/configs"

const OUTPUT_DIR = join(process.cwd(), "tests", "output")
const MODEL = "claude-sonnet-4-20250514"

interface PromptAnalysis {
  agentType: string
  systemPrompt: string
  toolCount: number
  toolNames: string[]
  maxTurns: number
  maxTokens: number
  hasRoleDefinition: boolean
  hasConstraints: boolean
  hasOutputFormat: boolean
}

function analyzeConfig(config: ReturnType<typeof createTaskConfig>): PromptAnalysis {
  const prompt = config.systemPrompt
  return {
    agentType: config.type,
    systemPrompt: prompt,
    toolCount: config.tools.length,
    toolNames: config.tools.map(t => t.spec.name),
    maxTurns: config.maxTurns,
    maxTokens: config.maxTokens,
    hasRoleDefinition: /you are|your role|your job/i.test(prompt),
    hasConstraints: /do not|don't|never|only|must/i.test(prompt),
    hasOutputFormat: /return|output|format|respond/i.test(prompt),
  }
}

describe("Sub-Agent Configurations", () => {
  const configs = [
    { name: "Task", create: () => createTaskConfig(MODEL) },
    { name: "Finder", create: () => createFinderConfig(MODEL) },
    { name: "Oracle", create: () => createOracleConfig(MODEL) },
    { name: "Painter", create: () => createPainterConfig(MODEL) },
    { name: "Librarian", create: () => createLibrarianConfig(MODEL) },
    { name: "KrakenScope", create: () => createKrakenScopeConfig(MODEL) },
    { name: "KrakenExecutor", create: () => createKrakenExecutorConfig(MODEL) },
  ]

  for (const { name, create } of configs) {
    describe(name, () => {
      const config = create()
      const analysis = analyzeConfig(config)

      test("has system prompt", () => {
        expect(config.systemPrompt.length).toBeGreaterThan(100)
      })

      test("has appropriate tools", () => {
        expect(config.tools.length).toBeGreaterThan(0)
      })

      test("has role definition", () => {
        expect(analysis.hasRoleDefinition).toBe(true)
      })

      test("has constraints", () => {
        expect(analysis.hasConstraints).toBe(true)
      })

      test("read-only agents don't have write tools", () => {
        const readOnlyAgents = ["finder", "oracle", "kraken-scope"]
        if (readOnlyAgents.includes(config.type)) {
          const writeTools = ["Edit", "Write", "Bash"]
          const hasWriteTools = config.tools.some(t => writeTools.includes(t.spec.name))
          expect(hasWriteTools).toBe(false)
        }
      })

      test("execution agents have write tools", () => {
        const execAgents = ["task", "painter", "kraken-executor"]
        if (execAgents.includes(config.type)) {
          const hasEdit = config.tools.some(t => t.spec.name === "Edit")
          expect(hasEdit).toBe(true)
        }
      })
    })
  }
})

describe("Generate Evaluation Output", () => {
  test("write prompts for Claude CLI evaluation", async () => {
    await mkdir(OUTPUT_DIR, { recursive: true })

    const analyses: PromptAnalysis[] = [
      analyzeConfig(createTaskConfig(MODEL)),
      analyzeConfig(createFinderConfig(MODEL)),
      analyzeConfig(createOracleConfig(MODEL)),
      analyzeConfig(createPainterConfig(MODEL)),
      analyzeConfig(createLibrarianConfig(MODEL)),
      analyzeConfig(createKrakenScopeConfig(MODEL)),
      analyzeConfig(createKrakenExecutorConfig(MODEL)),
    ]

    // Write individual prompts
    for (const analysis of analyses) {
      await writeFile(
        join(OUTPUT_DIR, `${analysis.agentType}-system-prompt.txt`),
        analysis.systemPrompt
      )
    }

    // Write evaluation prompt
    const evalPrompt = `Evaluate these sub-agent system prompts for a coding assistant.

For each agent, rate 1-5:
1. **Clarity**: Is the role clearly defined?
2. **Constraints**: Are boundaries well-established?
3. **Actionability**: Can the agent act on these instructions?
4. **Safety**: Are there appropriate guardrails?
5. **Completeness**: Does it cover edge cases?

Return JSON array:
[{"agent": "...", "clarity": N, "constraints": N, "actionability": N, "safety": N, "completeness": N, "issues": [], "suggestions": []}]

---

${analyses.map(a => `## ${a.agentType.toUpperCase()}
Tools: ${a.toolNames.join(", ")}
Max turns: ${a.maxTurns}

\`\`\`
${a.systemPrompt}
\`\`\`
`).join("\n---\n\n")}`

    await writeFile(join(OUTPUT_DIR, "subagent-prompt-eval.txt"), evalPrompt)

    console.log(`\nWrote evaluation files to ${OUTPUT_DIR}/`)
    console.log("Run: cat tests/output/subagent-prompt-eval.txt | claude --print")

    expect(analyses.length).toBe(7)
  })
})
