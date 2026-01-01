import { AgentLoop } from "../agent/loop"
import { registerBuiltinTools } from "../tools"
import { buildSystemPrompt } from "../prompt/system"
import { discoverGuidanceFiles, formatGuidanceFiles } from "../prompt/guidance"
import { createThread, saveThread } from "../session/persistence"
import { startTUI, getTUIController } from "../ui"
import type { PermissionRule } from "../permission"

export interface RunOptions {
  prompt?: string
  model?: string
  workdir?: string
  debug?: boolean
  tui?: boolean
  continue?: string
  yolo?: boolean
}

async function promptForPermission(
  toolName: string,
  input: Record<string, unknown>,
  rl: { question: (q: string, cb: (answer: string) => void) => void }
): Promise<boolean> {
  const inputStr = JSON.stringify(input, null, 2)
  return new Promise((resolve) => {
    console.log(`\n[PERMISSION] Tool "${toolName}" requires approval:`)
    console.log(inputStr.slice(0, 500))
    rl.question("Allow? (y/n): ", (answer) => {
      resolve(answer.toLowerCase().startsWith("y"))
    })
  })
}

export async function runAgent(options: RunOptions): Promise<void> {
  const workingDirectory = options.workdir ?? process.cwd()
  const model = options.model ?? "claude-sonnet-4-20250514"
  const debugMode = options.debug ?? false

  registerBuiltinTools()

  const guidanceFiles = await discoverGuidanceFiles(workingDirectory)
  const guidanceContent = formatGuidanceFiles(guidanceFiles)
  const systemPrompt = await buildSystemPrompt({ workingDirectory, guidanceContent })
  const thread = createThread(workingDirectory)

  const log = debugMode
    ? (msg: string) => console.log(msg)
    : () => {}

  log(`[DEBUG] Starting agent with model: ${model}`)
  log(`[DEBUG] Working directory: ${workingDirectory}`)

  const yoloMode = options.yolo ?? false

  const agent = new AgentLoop(
    thread,
    { model, systemPrompt },
    {
      onText: (text) => {
        if (debugMode) {
          process.stdout.write(text)
        }
      },
      onToolStart: (id, name, input) => {
        log(`\n[TOOL] ${name}`)
        if (debugMode) {
          log(`  Input: ${JSON.stringify(input).slice(0, 200)}...`)
        }
      },
      onToolEnd: (id, result, isError) => {
        if (debugMode) {
          const preview = result.slice(0, 500)
          log(`  ${isError ? "Error" : "Result"}: ${preview}${result.length > 500 ? "..." : ""}`)
        }
      },
      onPermissionRequest: async (toolName, input, _rule) => {
        if (yoloMode) {
          log(`[PERMISSION] Auto-approving ${toolName} (yolo mode)`)
          return true
        }
        log(`[PERMISSION] Denied ${toolName} (non-interactive mode)`)
        return false
      },
      onPermissionDenied: (toolName, reason) => {
        log(`[PERMISSION] ${toolName} denied: ${reason}`)
      },
      onUsage: (usage) => {
        log(`\n[USAGE] In: ${usage.inputTokens}, Out: ${usage.outputTokens}`)
      },
      onTurnComplete: () => {
        log(`\n[DEBUG] Agent completed`)
      },
    }
  )

  if (options.prompt) {
    await agent.run(options.prompt)
    await saveThread(thread)
    
    if (!debugMode) {
      const lastMessage = thread.messages[thread.messages.length - 1]
      if (lastMessage?.role === "assistant") {
        for (const block of lastMessage.content) {
          if (block.type === "text") {
            console.log(block.text)
          }
        }
      }
    }
  } else {
    console.log("No prompt provided. Use --prompt to specify a task.")
  }
}

export async function runInteractive(options: RunOptions): Promise<void> {
  const readline = await import("node:readline")
  const workingDirectory = options.workdir ?? process.cwd()
  const model = options.model ?? "claude-sonnet-4-20250514"

  registerBuiltinTools()

  const guidanceFiles = await discoverGuidanceFiles(workingDirectory)
  const guidanceContent = formatGuidanceFiles(guidanceFiles)
  const systemPrompt = await buildSystemPrompt({ workingDirectory, guidanceContent })
  const thread = createThread(workingDirectory)

  console.log("Coding Agent (type 'exit' to quit)")
  console.log(`Working directory: ${workingDirectory}`)
  console.log("")

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const agent = new AgentLoop(
    thread,
    { model, systemPrompt },
    {
      onText: (text) => {
        process.stdout.write(text)
      },
      onToolStart: (id, name) => {
        console.log(`\n[${name}]`)
      },
      onToolEnd: (id, result, isError) => {
        if (isError) {
          console.log(`  Error: ${result.slice(0, 200)}`)
        }
      },
      onPermissionRequest: (toolName, input, _rule) =>
        promptForPermission(toolName, input, rl),
      onPermissionDenied: (toolName, reason) => {
        console.log(`[PERMISSION] ${toolName} denied: ${reason}`)
      },
      onTurnComplete: () => {
        console.log("\n")
      },
    }
  )

  const prompt = (): void => {
    rl.question("> ", async (input) => {
      const trimmed = input.trim()

      if (trimmed === "exit" || trimmed === "quit") {
        await saveThread(thread)
        rl.close()
        return
      }

      if (!trimmed) {
        prompt()
        return
      }

      try {
        await agent.run(trimmed)
      } catch (err) {
        console.error("Error:", err instanceof Error ? err.message : String(err))
      }

      prompt()
    })
  }

  prompt()
}

export async function runTUI(options: RunOptions): Promise<void> {
  const workingDirectory = options.workdir ?? process.cwd()
  const model = options.model ?? "claude-sonnet-4-20250514"

  registerBuiltinTools()

  const guidanceFiles = await discoverGuidanceFiles(workingDirectory)
  const guidanceContent = formatGuidanceFiles(guidanceFiles)
  const systemPrompt = await buildSystemPrompt({ workingDirectory, guidanceContent })
  const thread = createThread(workingDirectory)

  let agent: AgentLoop | null = null

  const handleSubmit = async (input: string) => {
    const controller = getTUIController()
    if (!controller) return

    controller.setProcessing(true)

    if (!agent) {
      agent = new AgentLoop(
        thread,
        { model, systemPrompt },
        {
          onText: (text) => {
            controller.addText(text)
          },
          onToolStart: (_id, name) => {
            controller.addToolStart(name)
          },
          onToolEnd: (_id, result, isError) => {
            controller.addToolEnd(result, isError)
          },
          onPermissionRequest: async (toolName, _input, _rule) => {
            controller.addText(`\n[PERMISSION] ${toolName} requires approval - auto-rejecting in TUI mode\n`)
            return false
          },
          onPermissionDenied: (toolName, reason) => {
            controller.addText(`\n[PERMISSION] ${toolName} denied: ${reason}\n`)
          },
          onTurnComplete: () => {
            controller.setProcessing(false)
          },
        }
      )
    }

    try {
      await agent.run(input)
      await saveThread(thread)
    } catch (err) {
      controller.addError(err instanceof Error ? err.message : String(err))
      controller.setProcessing(false)
    }
  }

  await startTUI(handleSubmit)
}
