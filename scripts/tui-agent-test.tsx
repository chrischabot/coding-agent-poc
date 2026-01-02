#!/usr/bin/env bun
// Full TUI agent test - runs a real agent task headlessly
// Usage: bun run scripts/tui-agent-test.tsx

import { testRender } from "@opentui/react/test-utils"
import { App, getTUIController } from "../src/ui/App"
import { AgentLoop } from "../src/agent/loop"
import { registerBuiltinTools } from "../src/tools"
import { buildSystemPrompt } from "../src/prompt/system"
import { discoverGuidanceFiles, formatGuidanceFiles } from "../src/prompt/guidance"
import { createThread } from "../src/session/persistence"

const TEST_PROMPT = "write a typescript script that does fizz buzz up to 20 and run it with bun"

async function runAgentTest() {
  console.log("=== TUI Agent Test ===\n")
  console.log(`Test prompt: "${TEST_PROMPT}"\n`)

  const workingDirectory = process.cwd()
  const model = process.env.MODEL ?? "claude-sonnet-4-20250514"

  console.log(`Model: ${model}`)
  console.log(`Working directory: ${workingDirectory}\n`)

  registerBuiltinTools()

  const guidanceFiles = await discoverGuidanceFiles(workingDirectory)
  const guidanceContent = formatGuidanceFiles(guidanceFiles)
  const systemPrompt = await buildSystemPrompt({ workingDirectory, guidanceContent })
  const thread = createThread(workingDirectory)

  console.log("Setting up test renderer (120x40)...\n")

  let capturedOutput: string[] = []
  let agent: AgentLoop | null = null
  let submitCalled = false

  const handleSubmit = async (input: string) => {
    submitCalled = true
    console.log(`\n>>> handleSubmit called with: "${input.slice(0, 50)}..."`)
    
    const controller = getTUIController()
    if (!controller) {
      console.error("ERROR: No TUI controller available")
      return
    }

    controller.setProcessing(true)
    capturedOutput.push(`\n[USER INPUT] ${input}\n`)

    if (!agent) {
      agent = new AgentLoop(
        thread,
        { model, systemPrompt },
        {
          onText: (text) => {
            capturedOutput.push(text)
            controller.addText(text)
          },
          onToolStart: (_id, name, toolInput) => {
            const inputPreview = JSON.stringify(toolInput).slice(0, 100)
            capturedOutput.push(`\n[TOOL START] ${name}: ${inputPreview}...\n`)
            controller.addToolStart(name)
          },
          onToolEnd: (_id, result, isError) => {
            const preview = result.slice(0, 300)
            capturedOutput.push(`\n[TOOL ${isError ? "ERROR" : "RESULT"}] ${preview}${result.length > 300 ? "..." : ""}\n`)
            controller.addToolEnd(result, isError)
          },
          onPermissionRequest: async (toolName, _input, _rule) => {
            capturedOutput.push(`\n[PERMISSION] ${toolName} - auto-approving for test\n`)
            return true
          },
          onPermissionDenied: (toolName, reason) => {
            capturedOutput.push(`\n[PERMISSION DENIED] ${toolName}: ${reason}\n`)
            controller.addText(`\n[PERMISSION] ${toolName} denied: ${reason}\n`)
          },
          onTurnComplete: () => {
            capturedOutput.push("\n[TURN COMPLETE]\n")
            controller.setProcessing(false)
          },
        }
      )
    }

    try {
      await agent.run(input)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      capturedOutput.push(`\n[ERROR] ${errMsg}\n`)
      controller.addError(errMsg)
      controller.setProcessing(false)
    }
  }

  const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(
    <App onSubmit={handleSubmit} onExit={() => process.exit(0)} />,
    { width: 120, height: 40 }
  )

  console.log(`Renderer ready: ${renderer.width}x${renderer.height}`)

  await renderOnce()
  console.log("\n--- Initial TUI State ---")
  console.log(captureCharFrame())
  console.log("--- End Initial State ---\n")

  console.log("Submitting test prompt...\n")
  console.log("=".repeat(80))

  await mockInput.typeText(TEST_PROMPT)
  await renderOnce()
  
  console.log("\nSending Enter key...")
  mockInput.pressEnter()
  
  await new Promise(resolve => setTimeout(resolve, 100))
  await renderOnce()
  
  console.log("\n--- After Enter Key ---")
  console.log(captureCharFrame())
  console.log("--- End After Enter ---\n")
  
  console.log(`Submit called: ${submitCalled}`)
  
  if (!submitCalled) {
    console.log("\nWARNING: handleSubmit was not called!")
    console.log("The input component may not be triggering onSubmit.")
    console.log("Trying direct call...\n")
    await handleSubmit(TEST_PROMPT)
  }

  const maxWaitTime = 120000
  const startTime = Date.now()
  let lastOutputLen = 0

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 500))
    await renderOnce()

    if (capturedOutput.length > lastOutputLen) {
      const newOutput = capturedOutput.slice(lastOutputLen).join("")
      process.stdout.write(newOutput)
      lastOutputLen = capturedOutput.length
    }

    if (capturedOutput.some(o => o.includes("[TURN COMPLETE]"))) {
      console.log("\n" + "=".repeat(80))
      console.log("\nAgent completed!")
      break
    }
  }

  if (Date.now() - startTime >= maxWaitTime) {
    console.log("\n[TIMEOUT] Agent did not complete within 2 minutes")
  }

  console.log("\n--- Final TUI Frame ---")
  console.log(captureCharFrame())
  console.log("--- End Frame ---\n")

  console.log("\n=== Test Summary ===")
  console.log(`Total output chunks: ${capturedOutput.length}`)
  console.log(`Tool calls detected: ${capturedOutput.filter(o => o.includes("[TOOL START]")).length}`)
  console.log(`Errors: ${capturedOutput.filter(o => o.includes("[ERROR]") || o.includes("[TOOL ERROR]")).length}`)

  const hasThinking = capturedOutput.some(o => o.toLowerCase().includes("let me") || o.toLowerCase().includes("i'll") || o.toLowerCase().includes("i will"))
  const hasCode = capturedOutput.some(o => o.includes("```") || o.includes("function") || o.includes("const "))
  const hasToolUse = capturedOutput.some(o => o.includes("[TOOL START]"))
  const hasBashRun = capturedOutput.some(o => o.includes("Bash") || o.includes("bun run"))

  console.log(`\nExpected behaviors:`)
  console.log(`  ✓ Thinking/reasoning: ${hasThinking ? "YES" : "NO"}`)
  console.log(`  ✓ Code generation: ${hasCode ? "YES" : "NO"}`)
  console.log(`  ✓ Tool usage: ${hasToolUse ? "YES" : "NO"}`)
  console.log(`  ✓ Bash execution: ${hasBashRun ? "YES" : "NO"}`)

  process.exit(0)
}

runAgentTest().catch((err) => {
  console.error("\n[FATAL ERROR]", err)
  console.error("Stack:", err.stack)
  process.exit(1)
})
