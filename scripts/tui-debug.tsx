#!/usr/bin/env bun
// TUI Debug Script - Usage: bun run scripts/tui-debug.tsx
// Uses @opentui/react/test-utils for headless TUI testing with explicit dimensions

import { testRender } from "@opentui/react/test-utils"
import { App } from "../src/ui/App"

async function debugTUI() {
  console.log("=== TUI Debug Script ===\n")
  console.log("Creating test renderer with 80x24 dimensions...\n")

  const { renderer, mockInput, renderOnce, captureCharFrame, resize } = await testRender(
    <App
      onSubmit={(input) => {
        console.log(`[SUBMIT] User submitted: "${input}"`)
      }}
      onExit={() => {
        console.log("[EXIT] User requested exit")
      }}
    />,
    {
      width: 80,
      height: 24,
    }
  )

  console.log(`Renderer created: ${renderer.width}x${renderer.height}`)

  await renderOnce()
  
  console.log("\n--- Initial Frame ---")
  const initialFrame = captureCharFrame()
  console.log(initialFrame)
  console.log("--- End Frame ---\n")

  console.log("Simulating keyboard input: 'hello'")
  await mockInput.typeText("hello")
  
  await renderOnce()
  
  console.log("\n--- After Typing ---")
  console.log(captureCharFrame())
  console.log("--- End Frame ---\n")

  console.log("Simulating Enter key...")
  mockInput.pressKey("return")
  
  await renderOnce()
  await new Promise(resolve => setTimeout(resolve, 100))
  
  console.log("\n--- After Enter ---")
  console.log(captureCharFrame())
  console.log("--- End Frame ---\n")

  console.log("Testing resize to 100x30...")
  resize(100, 30)
  await renderOnce()
  
  console.log(`New size: ${renderer.width}x${renderer.height}`)

  console.log("\n=== Debug Complete ===")
  process.exit(0)
}

debugTUI().catch((err) => {
  console.error("[ERROR]", err)
  console.error("\nStack:", err.stack)
  process.exit(1)
})
