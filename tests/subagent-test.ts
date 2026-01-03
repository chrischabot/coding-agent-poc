/**
 * Sub-Agent Testing Script
 *
 * Tests the sub-agent system by:
 * 1. Running tasks that should invoke specific sub-agents
 * 2. Capturing debug output (system prompts, user prompts, tool calls)
 * 3. Outputting files for evaluation with Claude CLI
 *
 * Usage:
 *   npx tsx tests/subagent-test.ts
 *
 * To evaluate with Claude CLI:
 *   cat tests/output/subagent-evaluation.txt | claude --print
 */

import { writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { AgentLoop } from "../src/agent/loop"
import { createThread, saveThread } from "../src/session/persistence"
import { registerBuiltinTools } from "../src/tools"
import { buildSystemPrompt } from "../src/prompt/system"
import { setUseApiKeyMode } from "../src/provider"
import { setGlobalSubagentDebug } from "../src/subagent"
import type { SubagentDebugInfo } from "../src/subagent"

// Use API key for testing (requires ANTHROPIC_API_KEY env var)
setUseApiKeyMode(true)

const OUTPUT_DIR = join(process.cwd(), "tests", "output")

interface SubagentTestCase {
  name: string
  prompt: string
  expectedAgentType: string | string[]
  description: string
}

interface SubagentTestResult {
  testName: string
  prompt: string
  expectedAgentType: string | string[]
  actualAgentType: string | null
  invokedCorrectly: boolean
  debugEvents: SubagentDebugInfo[]
  mainAgentToolCalls: string[]
  success: boolean
  error?: string
}

// Global debug event collector
let currentTestDebugEvents: SubagentDebugInfo[] = []
let currentTestToolCalls: string[] = []

// Set up global debug callback
function setupDebugCallback(): void {
  setGlobalSubagentDebug((info: SubagentDebugInfo) => {
    currentTestDebugEvents.push(info)
    if (info.phase === "start") {
      currentTestToolCalls.push(info.agentType)
    }
  })
}

function clearDebugCallback(): void {
  setGlobalSubagentDebug(null)
}

/**
 * Run a single sub-agent test
 */
async function runSubagentTest(testCase: SubagentTestCase): Promise<SubagentTestResult> {
  const workingDirectory = process.cwd()

  // Reset collectors
  currentTestDebugEvents = []
  currentTestToolCalls = []

  registerBuiltinTools()
  const systemPrompt = await buildSystemPrompt({ workingDirectory })
  const thread = createThread(workingDirectory)

  console.log(`\n=== Test: ${testCase.name} ===`)
  console.log(`Expected agent: ${Array.isArray(testCase.expectedAgentType) ? testCase.expectedAgentType.join(" or ") : testCase.expectedAgentType}`)

  const agent = new AgentLoop(
    thread,
    {
      model: "claude-sonnet-4-20250514",
      systemPrompt,
      contextLimit: 50000,
    },
    {
      onText: () => {},
      onToolStart: (_id, name) => {
        process.stdout.write(`.`)
        if (["Task", "Finder", "Oracle", "Painter", "Librarian", "Kraken"].includes(name)) {
          console.log(`\n  [Main agent invoked: ${name}]`)
        }
      },
      onToolEnd: () => {},
      onTurnComplete: () => {
        console.log(" done")
      },
      onPermissionRequest: async () => true,
    }
  )

  try {
    console.log(`Prompt: "${testCase.prompt.slice(0, 80)}..."`)
    await agent.run(testCase.prompt)
    await saveThread(thread)

    // Check which agent was invoked
    const expectedTypes = Array.isArray(testCase.expectedAgentType)
      ? testCase.expectedAgentType
      : [testCase.expectedAgentType]

    const actualType = currentTestDebugEvents.find(e => e.phase === "start")?.agentType ?? null
    const invokedCorrectly = actualType !== null && expectedTypes.includes(actualType)

    return {
      testName: testCase.name,
      prompt: testCase.prompt,
      expectedAgentType: testCase.expectedAgentType,
      actualAgentType: actualType,
      invokedCorrectly,
      debugEvents: [...currentTestDebugEvents],
      mainAgentToolCalls: [...currentTestToolCalls],
      success: true,
    }
  } catch (err) {
    return {
      testName: testCase.name,
      prompt: testCase.prompt,
      expectedAgentType: testCase.expectedAgentType,
      actualAgentType: null,
      invokedCorrectly: false,
      debugEvents: [...currentTestDebugEvents],
      mainAgentToolCalls: [...currentTestToolCalls],
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Test cases that should invoke specific sub-agents
 */
const testCases: SubagentTestCase[] = [
  {
    name: "Code Search - Should use Finder",
    prompt: "Find all places in this codebase where authentication tokens are validated",
    expectedAgentType: "finder",
    description: "Conceptual code search should use Finder agent for parallel grep/glob",
  },
  {
    name: "Architecture Question - Should use Oracle",
    prompt: "Analyze the architecture of the permission system in this codebase and recommend improvements for security",
    expectedAgentType: "oracle",
    description: "Architecture analysis and recommendations should use Oracle agent",
  },
  {
    name: "Multi-file Implementation - Should use Task",
    prompt: "Create a new tool called 'calculator' that can perform basic math operations. Add it to the tools directory with proper exports.",
    expectedAgentType: "task",
    description: "Multi-step implementation tasks should use Task agent",
  },
  {
    name: "Codebase Exploration - Should use Librarian",
    prompt: "Explore how the agent loop works end-to-end from receiving a user message to generating a response",
    expectedAgentType: "librarian",
    description: "Repository exploration and understanding should use Librarian agent",
  },
  {
    name: "Simple Direct Task - Should NOT use sub-agent",
    prompt: "Read the package.json file and tell me what the project name is",
    expectedAgentType: "none",
    description: "Simple single-file reads should be done directly without sub-agents",
  },
]

/**
 * Write test results to files for evaluation
 */
async function writeResults(results: SubagentTestResult[]): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true })

  // Write full debug output
  const debugOutput = {
    timestamp: new Date().toISOString(),
    results,
  }
  await writeFile(
    join(OUTPUT_DIR, "subagent-debug.json"),
    JSON.stringify(debugOutput, null, 2)
  )

  // Write individual prompt files for each test
  for (const result of results) {
    const startEvent = result.debugEvents.find(e => e.phase === "start")
    if (startEvent?.systemPrompt) {
      const filename = `${result.testName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-system-prompt.txt`
      await writeFile(join(OUTPUT_DIR, filename), startEvent.systemPrompt)
    }
    if (startEvent?.userPrompt) {
      const filename = `${result.testName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-user-prompt.txt`
      await writeFile(join(OUTPUT_DIR, filename), startEvent.userPrompt)
    }
  }

  // Write evaluation prompt for Claude CLI
  const evalPrompt = `You are evaluating the quality of sub-agent routing and prompt construction in a coding agent system.

## Background
The coding agent has several specialized sub-agents:
- **Task**: Fire-and-forget executor for multi-step implementations
- **Finder**: Fast parallel code search for conceptual queries
- **Oracle**: Expert technical advisor for architecture and reviews
- **Painter**: Frontend development specialist
- **Librarian**: Codebase exploration and understanding
- **Kraken**: Bulk code transformations

## Evaluation Criteria

For each test case, evaluate:

1. **Routing Correctness (1-5)**: Did the main agent select the right sub-agent for the task?
   - 5: Perfect match
   - 4: Good choice, minor alternative could work
   - 3: Acceptable but not optimal
   - 2: Wrong sub-agent chosen
   - 1: Critical mismatch or no sub-agent when needed

2. **System Prompt Quality (1-5)**: Is the sub-agent's system prompt effective?
   - Clear role definition
   - Appropriate constraints
   - Helpful instructions

3. **User Prompt Construction (1-5)**: Was the prompt passed to the sub-agent well-formed?
   - Contains necessary context
   - Clear objective
   - Appropriate level of detail

4. **Tool Access Appropriateness (1-5)**: Does the sub-agent have the right tools?
   - Read-only agents shouldn't have write tools
   - Execution agents need appropriate permissions

Provide your evaluation as JSON:
{
  "test_name": "...",
  "routing_correctness": N,
  "system_prompt_quality": N,
  "user_prompt_quality": N,
  "tool_access": N,
  "overall": N,
  "issues": ["..."],
  "suggestions": ["..."]
}

## Test Results to Evaluate

${JSON.stringify(results.map(r => ({
  name: r.testName,
  prompt: r.prompt,
  expected: r.expectedAgentType,
  actual: r.actualAgentType,
  invoked_correctly: r.invokedCorrectly,
  system_prompt: r.debugEvents.find(e => e.phase === "start")?.systemPrompt?.slice(0, 500) + "...",
  user_prompt: r.debugEvents.find(e => e.phase === "start")?.userPrompt,
  tool_calls: r.debugEvents.filter(e => e.phase === "turn").flatMap(e => e.toolCalls?.map(t => t.name) ?? []),
})), null, 2)}
`
  await writeFile(join(OUTPUT_DIR, "subagent-evaluation.txt"), evalPrompt)

  console.log(`\n\nResults written to ${OUTPUT_DIR}/`)
  console.log("Files:")
  console.log("  - subagent-debug.json (full debug output)")
  console.log("  - *-system-prompt.txt (sub-agent system prompts)")
  console.log("  - *-user-prompt.txt (prompts sent to sub-agents)")
  console.log("  - subagent-evaluation.txt (prompt for Claude CLI evaluation)")
  console.log("\nTo evaluate with Claude CLI:")
  console.log(`  cat ${OUTPUT_DIR}/subagent-evaluation.txt | claude --print`)
}

/**
 * Main test runner
 */
async function main(): Promise<void> {
  console.log("=================================")
  console.log("Sub-Agent Routing Test Suite")
  console.log("=================================")

  // Set up global debug callback
  setupDebugCallback()

  const results: SubagentTestResult[] = []

  // Run tests
  for (const testCase of testCases) {
    const result = await runSubagentTest(testCase)
    results.push(result)
  }

  // Summary
  console.log("\n\n=== Test Summary ===")
  let passed = 0
  let failed = 0

  for (const result of results) {
    const expected = Array.isArray(result.expectedAgentType)
      ? result.expectedAgentType.join("/")
      : result.expectedAgentType

    if (result.expectedAgentType === "none") {
      // For "none" expected, success if no sub-agent was invoked
      const success = result.actualAgentType === null
      const status = success ? "✓ PASS" : "✗ FAIL"
      console.log(`${status}: ${result.testName}`)
      console.log(`   Expected: no sub-agent | Actual: ${result.actualAgentType ?? "none"}`)
      if (success) passed++; else failed++
    } else {
      const status = result.invokedCorrectly ? "✓ PASS" : "✗ FAIL"
      console.log(`${status}: ${result.testName}`)
      console.log(`   Expected: ${expected} | Actual: ${result.actualAgentType ?? "none"}`)
      if (result.invokedCorrectly) passed++; else failed++
    }

    if (result.error) {
      console.log(`   Error: ${result.error}`)
    }
  }

  console.log(`\nTotal: ${passed}/${results.length} passed`)

  // Write results
  await writeResults(results)
}

main().catch(console.error)
