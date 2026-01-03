import { AgentLoop, CompactionDebugInfo } from "../agent/loop"
import { registerBuiltinTools } from "../tools"
import { buildSystemPrompt } from "../prompt/system"
import { discoverGuidanceFiles, formatGuidanceFiles } from "../prompt/guidance"
import { createThread, saveThread } from "../session/persistence"
import { estimateThreadTokens } from "../context/tokens"
import { loadPermissions, savePermissions } from "../permission"
import { startTUI, getTUIController } from "../ui"
import type { PermissionRule } from "../permission"

const DEFAULT_CONTEXT_LIMIT = 150000

export interface RunOptions {
  prompt?: string
  model?: string
  workdir?: string
  debug?: boolean
  tui?: boolean
  yolo?: boolean
  debugCompaction?: boolean
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
  const model = options.model ?? "claude-opus-4-5-20251101"
  const debugMode = options.debug ?? false
  const debugCompaction = options.debugCompaction ?? false

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
      onCompactionDebug: debugCompaction
        ? (info: CompactionDebugInfo) => {
            console.log(`\n${"=".repeat(60)}`)
            console.log(`[COMPACTION DEBUG] Phase: ${info.phase}`)
            console.log(`${"=".repeat(60)}`)

            if (info.phase === "start") {
              console.log(`Type: ${info.isIncremental ? "INCREMENTAL" : "FULL"}`)
              console.log(`Messages to summarize: ${info.messageCount}`)
              console.log(`Tokens before: ${info.tokensBeforeCompaction}`)
              if (info.previousSummaryTokens) {
                console.log(`Previous summary tokens: ${info.previousSummaryTokens}`)
              }
              if (info.todoState) {
                console.log(`\nTODO State:\n${info.todoState}`)
              }
            }

            if (info.phase === "summarizing") {
              console.log(`New summary tokens: ${info.newSummaryTokens}`)
              console.log(`\n--- SUMMARIZATION PROMPT ---\n${info.summaryPrompt}\n--- END PROMPT ---`)
              console.log(`\n--- RAW SUMMARY ---\n${info.rawSummary}\n--- END SUMMARY ---`)
            }

            if (info.phase === "complete") {
              console.log(`Tokens after: ${info.tokensAfterCompaction}`)
              console.log(`Incremental: ${info.isIncremental}`)
              if (info.compactionState) {
                console.log(`\n--- COMPACTION STATE ---`)
                console.log(JSON.stringify(info.compactionState, null, 2))
                console.log(`--- END STATE ---`)
              }
            }

            console.log(`${"=".repeat(60)}\n`)
          }
        : undefined,
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
  const model = options.model ?? "claude-opus-4-5-20251101"

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
  const model = options.model ?? "claude-opus-4-5-20251101"

  registerBuiltinTools()

  const guidanceFiles = await discoverGuidanceFiles(workingDirectory)
  const guidanceContent = formatGuidanceFiles(guidanceFiles)
  const systemPrompt = await buildSystemPrompt({ workingDirectory, guidanceContent })
  const thread = createThread(workingDirectory)

  let agent: AgentLoop | null = null
  let totalInputTokens = 0
  let totalOutputTokens = 0

  const updateTokenDisplay = (controller: ReturnType<typeof getTUIController>) => {
    if (!controller) return
    const contextUsed = estimateThreadTokens(thread.messages)
    controller.setTokenUsage(totalInputTokens, totalOutputTokens, contextUsed, DEFAULT_CONTEXT_LIMIT)
  }

  const updateLSPDisplay = (controller: ReturnType<typeof getTUIController>) => {
    if (!controller || !agent) return
    const servers = agent.getActiveLSPServers()
    controller.setLSPServers(servers)
  }

  const storedPermissions = await loadPermissions(workingDirectory)
  const grantedPermissions = new Set<string>(storedPermissions)

  const getPermissionKey = (toolName: string, input: Record<string, unknown>): string => {
    if (toolName === "Bash") {
      const cmd = String(input.command ?? "").split(" ")[0]
      return `${toolName}:${cmd}`
    }
    return toolName
  }

  const formatPermissionDetail = (toolName: string, input: Record<string, unknown>): string => {
    switch (toolName) {
      case "Bash":
        const cmd = String(input.command ?? "")
        return cmd.length > 100 ? cmd.slice(0, 100) + "..." : cmd
      case "Delete":
        return `Delete ${input.path}`
      case "Write":
        return `Write to ${input.path}`
      default:
        return JSON.stringify(input).slice(0, 100)
    }
  }

  const handleSubmit = async (input: string) => {
    const controller = getTUIController()
    if (!controller) return

    controller.setProcessing(true)

    if (!agent) {
      agent = new AgentLoop(
        thread,
        { model, systemPrompt, contextLimit: DEFAULT_CONTEXT_LIMIT },
        {
          onText: (text) => {
            controller.addText(text)
          },
          onToolStart: (_id, name, input) => {
            controller.addToolStart(name, input)
          },
          onToolEnd: (_id, result, isError) => {
            controller.addToolEnd(result, isError)
            updateLSPDisplay(controller)
          },
          onPermissionRequest: async (toolName, input, _rule) => {
            if (options.yolo) {
              return true
            }
            const permKey = getPermissionKey(toolName, input)
            if (grantedPermissions.has(permKey)) {
              return true
            }
            const detail = formatPermissionDetail(toolName, input)
            const approved = await controller.requestPermission(toolName, detail)
            if (approved) {
              grantedPermissions.add(permKey)
              await savePermissions(workingDirectory, grantedPermissions)
            }
            return approved
          },
          onPermissionDenied: (toolName, reason) => {
            controller.addText(`\n[PERMISSION] ${toolName} denied: ${reason}\n`)
          },
          onUsage: (usage) => {
            totalInputTokens += usage.inputTokens
            totalOutputTokens += usage.outputTokens
            updateTokenDisplay(controller)
          },
          onTurnComplete: () => {
            updateTokenDisplay(controller)
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

  try {
    await startTUI(handleSubmit, {
      workingDirectory,
      model,
      yoloMode: options.yolo,
    })
  } catch {
    console.log("\x1b[33m⚠ TUI mode unavailable (OpenTUI rendering error)\x1b[0m")
    console.log("\x1b[33m  Falling back to interactive mode...\x1b[0m")
    console.log("")
    await runInteractive(options)
  }
}
