import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useState, useCallback, useRef, useEffect } from "react"

export interface OutputLine {
  id: string
  type: "text" | "tool_start" | "tool_end" | "error" | "system"
  content: string
}

export interface AppProps {
  onSubmit: (input: string) => void
  onExit?: () => void
}

export function App({ onSubmit, onExit }: AppProps) {
  const [lines, setLines] = useState<OutputLine[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const lineIdRef = useRef(0)

  const addLine = useCallback((type: OutputLine["type"], content: string) => {
    const id = `line-${lineIdRef.current++}`
    setLines((prev) => [...prev, { id, type, content }])
  }, [])

  useEffect(() => {
    const controller = {
      addText: (text: string) => addLine("text", text),
      addToolStart: (name: string) => addLine("tool_start", `[Tool: ${name}] Starting...`),
      addToolEnd: (result: string, isError: boolean) => {
        const prefix = isError ? "[Error]" : "[Result]"
        const truncated = result.length > 200 ? result.slice(0, 200) + "..." : result
        addLine("tool_end", `${prefix} ${truncated}`)
      },
      addError: (error: string) => addLine("error", error),
      addSystem: (message: string) => addLine("system", message),
      setProcessing: (processing: boolean) => setIsProcessing(processing),
      clear: () => setLines([]),
    }
    ;(globalThis as Record<string, unknown>).__tuiController = controller
    return () => {
      delete (globalThis as Record<string, unknown>).__tuiController
    }
  }, [addLine])

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      onExit?.()
      process.exit(0)
    }
  })

  const handleSubmit = useCallback(
    (value: string) => {
      if (!value.trim() || isProcessing) return
      addLine("system", `> ${value}`)
      onSubmit(value)
    },
    [onSubmit, isProcessing, addLine]
  )

  const getColor = (type: OutputLine["type"]) => {
    switch (type) {
      case "error": return "#f7768e"
      case "tool_start": return "#7aa2f7"
      case "tool_end": return "#9ece6a"
      case "system": return "#bb9af7"
      default: return "#c0caf5"
    }
  }

  return (
    <box flexDirection="column" style={{ width: "100%", height: "100%" }}>
      <box style={{ flexGrow: 1, backgroundColor: "#1a1b26" }}>
        {lines.length === 0 ? (
          <text fg="#565f89">Welcome to Coding Agent. Type a message and press Enter.</text>
        ) : (
          <box flexDirection="column">
            {lines.map((line) => (
              <text key={line.id} fg={getColor(line.type)} content={line.content} />
            ))}
          </box>
        )}
      </box>

      <box
        title={isProcessing ? "Processing..." : "Input"}
        border
        borderColor={isProcessing ? "#f7768e" : "#7aa2f7"}
        style={{ height: 3 }}
      >
        <input
          placeholder={isProcessing ? "Please wait..." : "Type your message..."}
          focused={!isProcessing}
          onInput={() => {}}
          onSubmit={handleSubmit}
        />
      </box>
    </box>
  )
}

export interface TUIController {
  addText: (text: string) => void
  addToolStart: (name: string) => void
  addToolEnd: (result: string, isError: boolean) => void
  addError: (error: string) => void
  addSystem: (message: string) => void
  setProcessing: (processing: boolean) => void
  clear: () => void
}

export function getTUIController(): TUIController | undefined {
  return (globalThis as Record<string, unknown>).__tuiController as TUIController | undefined
}

export async function startTUI(onSubmit: (input: string) => void): Promise<void> {
  if (!process.stdout.isTTY) {
    console.error("Error: TUI mode requires a terminal (TTY).")
    console.error("Run this command directly in a terminal, not piped or in a non-interactive environment.")
    console.error("Use --interactive or --prompt mode instead.")
    process.exit(1)
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  })

  const root = createRoot(renderer as unknown as Parameters<typeof createRoot>[0])
  root.render(
    <App
      onSubmit={onSubmit}
      onExit={() => {
        process.exit(0)
      }}
    />
  )
}
