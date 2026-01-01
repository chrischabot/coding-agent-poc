#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

async function main() {
  console.error("[DEBUG] stdout.isTTY:", process.stdout.isTTY)
  console.error("[DEBUG] stdout.columns:", process.stdout.columns)
  console.error("[DEBUG] stdout.rows:", process.stdout.rows)

  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  console.error("[DEBUG] Renderer width:", renderer.width, "height:", renderer.height)

  const root = createRoot(renderer as unknown as Parameters<typeof createRoot>[0])
  
  root.render(
    <box border style={{ padding: 1 }}>
      <text>Hello from OpenTUI!</text>
    </box>
  )

  setTimeout(() => process.exit(0), 3000)
}

main().catch((err) => {
  console.error("[ERROR]", err)
  process.exit(1)
})
