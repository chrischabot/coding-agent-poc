#!/usr/bin/env bun
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { act } from "react"
import { App } from "../src/ui/App"

async function main() {
  console.log("Testing TUI App component rendering...")

  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
    width: 80,
    height: 24,
  })

  console.log(`✓ Test renderer created: ${renderer.width}x${renderer.height}`)

  const root = createRoot(renderer)

  let submitCalled = false
  const onSubmit = (input: string) => {
    submitCalled = true
    console.log(`  onSubmit called with: "${input}"`)
  }

  act(() => {
    root.render(
      <App
        onSubmit={onSubmit}
        workingDirectory="/test/dir"
        model="claude-sonnet-4-20250514"
        yoloMode={false}
      />
    )
  })

  console.log("✓ App component rendered without errors")

  await renderOnce()
  console.log("✓ First render completed")

  const frame = captureCharFrame()
  console.log("\n--- Rendered Frame (first 10 lines) ---")
  const lines = frame.split("\n").slice(0, 10)
  for (const line of lines) {
    console.log(`| ${line}`)
  }
  console.log("--- End Frame ---\n")

  renderer.destroy()
  console.log("✓ Renderer destroyed")

  console.log("\n✅ TUI App component test PASSED")
}

main().catch((err) => {
  console.error("❌ Test FAILED:", err)
  process.exit(1)
})
