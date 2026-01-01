#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process"

async function testOpenTUISmoke() {
  console.log("=== Testing OpenTUI smoke (direct) ===")
  
  const result = spawnSync("bun", ["run", "scripts/opentui-smoke.tsx"], {
    cwd: process.cwd(),
    stdio: "inherit",
    timeout: 5000,
    env: {
      ...process.env,
      TERM: "xterm-256color",
    },
  })

  console.log("Exit code:", result.status)
  if (result.error) {
    console.error("Error:", result.error)
  }
}

async function testTUIWithPty() {
  console.log("\n=== Testing TUI (requires TTY) ===")
  
  const proc = spawn("bun", ["run", "src/index.ts", "-t"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLUMNS: "80",
      LINES: "24",
    },
  })

  let stderr = ""

  proc.stderr.on("data", (data) => {
    stderr += data.toString()
  })

  proc.on("exit", (code) => {
    console.log("Exit code:", code)
    if (stderr) {
      console.log("Stderr (first 500 chars):", stderr.slice(0, 500))
    }
  })

  await new Promise((resolve) => setTimeout(resolve, 2000))
  proc.kill("SIGKILL")
}

async function main() {
  await testOpenTUISmoke()
  await testTUIWithPty()
}

main().catch(console.error)
