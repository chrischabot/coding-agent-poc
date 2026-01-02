#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

async function main() {
  console.error("[DEBUG] Testing minimal TUI")
  console.error("[DEBUG] stdout.isTTY:", process.stdout.isTTY)
  console.error("[DEBUG] stdout.columns:", process.stdout.columns)
  console.error("[DEBUG] stdout.rows:", process.stdout.rows)

  try {
    const renderer = await createCliRenderer({ exitOnCtrlC: true })
    console.error("[DEBUG] Renderer created:", renderer.width, "x", renderer.height)

    const root = createRoot(renderer as unknown as Parameters<typeof createRoot>[0])
    
    root.render(
      <box>
        <text>Hello World</text>
      </box>
    )

    console.error("[DEBUG] Render called successfully")
  } catch (err) {
    console.error("[ERROR] Failed:", err)
  }
}

main()
