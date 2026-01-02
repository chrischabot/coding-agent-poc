#!/usr/bin/env bun
import { testRender } from "@opentui/react/test-utils"
import { App } from "../src/ui/App"

async function visualTest() {
  console.log("=== TUI Visual Test ===\n")

  const { renderOnce, captureCharFrame } = await testRender(
    <App
      onSubmit={() => {}}
      onExit={() => {}}
      workingDirectory="/Users/chris/Projects/coding-agent"
      model="Claude Sonnet 4"
      yoloMode={false}
    />,
    { width: 100, height: 30 }
  )

  await renderOnce()
  console.log("Welcome Screen (100x30):")
  console.log("-".repeat(100))
  console.log(captureCharFrame())
  console.log("-".repeat(100))

  process.exit(0)
}

visualTest().catch((err) => {
  console.error("[ERROR]", err)
  process.exit(1)
})
