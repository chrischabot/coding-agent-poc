/**
 * Compaction Testing Script
 *
 * Tests the incremental compaction system by:
 * 1. Running conversations that trigger compression
 * 2. Capturing debug output (prompts, summaries, states)
 * 3. Outputting files for evaluation with Claude CLI
 *
 * Usage:
 *   npx tsx tests/compaction-test.ts
 *
 * To evaluate with Claude CLI:
 *   cat output/compaction-debug.json | claude --print "Evaluate this compaction summary..."
 */

import { writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { AgentLoop, CompactionDebugInfo } from "../src/agent/loop"
import { createThread, saveThread, loadThread } from "../src/session/persistence"
import { registerBuiltinTools } from "../src/tools"
import { buildSystemPrompt } from "../src/prompt/system"
import { setUseApiKeyMode } from "../src/provider"
import { estimateThreadTokens } from "../src/context/tokens"

// Use API key for testing (requires ANTHROPIC_API_KEY env var)
setUseApiKeyMode(true)

const OUTPUT_DIR = join(process.cwd(), "tests", "output")

interface TestResult {
  testName: string
  compactionEvents: CompactionDebugInfo[]
  threadId: string
  success: boolean
  error?: string
}

/**
 * Generate a conversation that will trigger compaction
 * by making many tool calls
 */
async function runCompactionTest(
  testName: string,
  prompts: string[],
  options: {
    contextLimit?: number
    workingDirectory?: string
  } = {}
): Promise<TestResult> {
  const compactionEvents: CompactionDebugInfo[] = []
  const workingDirectory = options.workingDirectory ?? process.cwd()
  const contextLimit = options.contextLimit ?? 20000 // Low threshold for testing

  registerBuiltinTools()
  const systemPrompt = await buildSystemPrompt({ workingDirectory })
  const thread = createThread(workingDirectory)

  console.log(`\n=== Test: ${testName} ===`)
  console.log(`Thread ID: ${thread.id}`)
  console.log(`Context limit: ${contextLimit} tokens`)

  const agent = new AgentLoop(
    thread,
    {
      model: "claude-sonnet-4-20250514", // Faster for testing
      systemPrompt,
      contextLimit,
    },
    {
      onText: (text) => {
        // Minimal output during test
      },
      onToolStart: (_id, name) => {
        process.stdout.write(`.`)
      },
      onToolEnd: () => {},
      onCompactionDebug: (info) => {
        compactionEvents.push(info)
        if (info.phase === "start") {
          console.log(`\n[COMPACTION] Starting ${info.isIncremental ? "incremental" : "full"} compression`)
          console.log(`  Messages to summarize: ${info.messageCount}`)
          console.log(`  Tokens before: ${info.tokensBeforeCompaction}`)
        }
        if (info.phase === "summarizing") {
          console.log(`  Summary tokens: ${info.newSummaryTokens}`)
        }
        if (info.phase === "complete") {
          console.log(`  Tokens after: ${info.tokensAfterCompaction}`)
          console.log(`[COMPACTION] Complete`)
        }
      },
      onUsage: (usage) => {
        // Track usage
      },
      onTurnComplete: () => {
        console.log(" done")
      },
      onPermissionRequest: async () => true, // Auto-approve for testing
    }
  )

  try {
    for (const prompt of prompts) {
      console.log(`\nPrompt: "${prompt.slice(0, 50)}..."`)
      await agent.run(prompt)
      const tokens = estimateThreadTokens(thread.messages)
      const threshold = contextLimit * 0.9
      console.log(`  [Tokens: ${tokens} / threshold: ${threshold}]`)
    }

    await saveThread(thread)

    return {
      testName,
      compactionEvents,
      threadId: thread.id,
      success: true,
    }
  } catch (err) {
    return {
      testName,
      compactionEvents,
      threadId: thread.id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Test 1: First compression (full summarization)
 */
async function testFirstCompression(): Promise<TestResult> {
  const prompts = [
    "List the files in the current directory using the Glob tool",
    "Read the package.json file",
    "Read the tsconfig.json file",
    "List all TypeScript files in the src directory",
    "Read the src/index.ts file",
    "Read the src/cli/run.ts file",
    "Read the src/agent/loop.ts file",
    "Read the src/provider/anthropic.ts file",
    // One more prompt to trigger compression check after large content
    "What is the name of this project based on package.json?",
  ]

  return runCompactionTest("First Compression (Full)", prompts, {
    // Lower to ensure compaction triggers
    // POST_COMPRESSION_TARGET is 30000, with 18000 suffix budget
    // We need context > 18000 for compaction to have effect
    contextLimit: 20000,
  })
}

/**
 * Test 2: Second compression (incremental)
 * Continues from a previous session
 */
async function testIncrementalCompression(): Promise<TestResult> {
  // First, do a full compression
  const firstResult = await runCompactionTest(
    "Setup for Incremental",
    [
      "Read the package.json file",
      "Read the tsconfig.json file",
      "List TypeScript files in src/",
    ],
    { contextLimit: 10000 }
  )

  if (!firstResult.success) {
    return { ...firstResult, testName: "Incremental Compression - Setup Failed" }
  }

  // Now continue the conversation to trigger incremental compression
  const thread = await loadThread(firstResult.threadId)
  if (!thread) {
    return {
      testName: "Incremental Compression",
      compactionEvents: [],
      threadId: firstResult.threadId,
      success: false,
      error: "Could not load thread for incremental test",
    }
  }

  const compactionEvents: CompactionDebugInfo[] = []
  const systemPrompt = await buildSystemPrompt({ workingDirectory: thread.workingDirectory })

  const agent = new AgentLoop(
    thread,
    {
      model: "claude-sonnet-4-20250514",
      systemPrompt,
      contextLimit: 10000,
    },
    {
      onText: () => {},
      onToolStart: () => process.stdout.write("."),
      onToolEnd: () => {},
      onCompactionDebug: (info) => {
        compactionEvents.push(info)
        if (info.phase === "start" && info.isIncremental) {
          console.log(`\n[INCREMENTAL COMPACTION] Triggered!`)
          console.log(`  Previous summary tokens: ${info.previousSummaryTokens}`)
        }
      },
      onPermissionRequest: async () => true,
    }
  )

  try {
    // Add more content to trigger incremental compression
    await agent.run("Read the src/tools/index.ts file")
    await agent.run("Read the README.md if it exists, otherwise list root files")
    await saveThread(thread)

    const hasIncremental = compactionEvents.some(e => e.isIncremental)

    return {
      testName: "Incremental Compression",
      compactionEvents: [...firstResult.compactionEvents, ...compactionEvents],
      threadId: thread.id,
      success: hasIncremental,
      error: hasIncremental ? undefined : "No incremental compression detected",
    }
  } catch (err) {
    return {
      testName: "Incremental Compression",
      compactionEvents,
      threadId: thread.id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Test 3: Scratchpad persistence
 */
async function testScratchpadPersistence(): Promise<TestResult> {
  const prompts = [
    "Use the EditScratchpad tool to create a scratchpad with a goal of 'Test scratchpad persistence' and a task '- [ ] Verify persistence'",
    "Read some files to add context: package.json and tsconfig.json",
    "Use ReadScratchpad to verify the scratchpad content is still there",
  ]

  return runCompactionTest("Scratchpad Persistence", prompts, {
    contextLimit: 12000,
  })
}

/**
 * Write test results to files for evaluation
 */
async function writeResults(results: TestResult[]): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true })

  // Write full debug output
  const debugOutput = {
    timestamp: new Date().toISOString(),
    results,
  }
  await writeFile(
    join(OUTPUT_DIR, "compaction-debug.json"),
    JSON.stringify(debugOutput, null, 2)
  )

  // Write summary prompts for each compaction
  for (const result of results) {
    for (const event of result.compactionEvents) {
      if (event.phase === "summarizing" && event.summaryPrompt) {
        const filename = `${result.testName.replace(/\s+/g, "-").toLowerCase()}-prompt.txt`
        await writeFile(join(OUTPUT_DIR, filename), event.summaryPrompt)
      }
      if (event.phase === "summarizing" && event.rawSummary) {
        const filename = `${result.testName.replace(/\s+/g, "-").toLowerCase()}-summary.txt`
        await writeFile(join(OUTPUT_DIR, filename), event.rawSummary)
      }
    }
  }

  // Write evaluation prompt for Claude CLI
  const evalPrompt = `You are evaluating the quality of conversation summaries generated by a coding agent's compaction system.

For each summary, evaluate:
1. **Completeness** (1-5): Does it capture all significant actions and decisions?
2. **Structure** (1-5): Does it follow the 10-section format properly?
3. **Coherence** (1-5): Is it easy to understand and well-organized?
4. **Technical Accuracy** (1-5): Are file paths, tool names, and technical details correct?
5. **Incremental Quality** (1-5): For incremental summaries, does it properly incorporate the previous summary?

Provide your evaluation as JSON:
{
  "completeness": N,
  "structure": N,
  "coherence": N,
  "technical_accuracy": N,
  "incremental_quality": N,
  "overall": N,
  "issues": ["list of specific issues"],
  "suggestions": ["list of improvements"]
}

Here are the test results to evaluate:
${JSON.stringify(results, null, 2)}
`
  await writeFile(join(OUTPUT_DIR, "evaluation-prompt.txt"), evalPrompt)

  console.log(`\n\nResults written to ${OUTPUT_DIR}/`)
  console.log("Files:")
  console.log("  - compaction-debug.json (full debug output)")
  console.log("  - *-prompt.txt (summarization prompts)")
  console.log("  - *-summary.txt (generated summaries)")
  console.log("  - evaluation-prompt.txt (prompt for Claude CLI evaluation)")
  console.log("\nTo evaluate with Claude CLI:")
  console.log(`  cat ${OUTPUT_DIR}/evaluation-prompt.txt | claude --print`)
}

/**
 * Main test runner
 */
async function main(): Promise<void> {
  console.log("=================================")
  console.log("Compaction System Test Suite")
  console.log("=================================")

  const results: TestResult[] = []

  // Run tests
  results.push(await testFirstCompression())
  // results.push(await testIncrementalCompression()) // Uncomment to test incremental
  // results.push(await testScratchpadPersistence()) // Uncomment to test scratchpad

  // Summary
  console.log("\n\n=== Test Summary ===")
  for (const result of results) {
    const status = result.success ? "✓ PASS" : "✗ FAIL"
    console.log(`${status}: ${result.testName}`)
    console.log(`   Compaction events: ${result.compactionEvents.length}`)
    if (result.error) {
      console.log(`   Error: ${result.error}`)
    }
  }

  // Write results
  await writeResults(results)
}

main().catch(console.error)
