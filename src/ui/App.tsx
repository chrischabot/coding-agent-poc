import { createCliRenderer, type TextareaRenderable, type KeyEvent, type KeyBinding, type PasteEvent, type ScrollBoxRenderable, SyntaxStyle, parseColor } from "@opentui/core"
import { createRoot, useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/react"
import { useState, useCallback, useRef, useEffect } from "react"
import { copyToClipboard } from "./clipboard"

interface AttachedImage {
  id: number
  imageNum: number
  filepath: string
  filename: string
  mime: string
  data: string
}

const colors = {
  bg: "#000000",
  bgElement: "#1a1a1a",
  bgPanel: "#0d0d0d",
  bgSubagent: "#0a1a1a",
  primary: "#3A76FF",
  secondary: "#3995DB",
  accent: "#60D5D5",
  subagent: "#20B2AA",
  success: "#15C50C",
  error: "#E64559",
  warning: "#C49B00",
  text: "#FFFFFF",
  textDim: "#C7C7C7",
  textMuted: "#7F7F7F",
  border: "#333333",
}

const SUBAGENT_TOOLS = new Set(["Task", "Finder", "Oracle", "Painter", "Librarian", "Kraken"])

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const MAX_HISTORY = 50

const textareaKeybindings: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", meta: true, action: "newline" },
  { name: "return", shift: true, action: "newline" },
  { name: "return", ctrl: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
  { name: "-", ctrl: true, action: "undo" },
  { name: "z", super: true, action: "undo" },
  { name: ".", ctrl: true, action: "redo" },
  { name: "z", super: true, shift: true, action: "redo" },
]

const syntaxStyle = SyntaxStyle.fromStyles({
  // Extmark styles
  "extmark.image": {
    fg: parseColor("#000000"),
    bg: parseColor("#F5A623"),
  },
  
  // Default text
  default: { fg: parseColor(colors.text) },
  
  // Markdown headings
  "markup.heading": { fg: parseColor(colors.primary), bold: true },
  "markup.heading.1": { fg: parseColor(colors.primary), bold: true },
  "markup.heading.2": { fg: parseColor(colors.primary), bold: true },
  "markup.heading.3": { fg: parseColor(colors.secondary), bold: true },
  "markup.heading.4": { fg: parseColor(colors.secondary), bold: true },
  "markup.heading.5": { fg: parseColor(colors.accent), bold: true },
  "markup.heading.6": { fg: parseColor(colors.accent), bold: true },
  
  // Code blocks
  "markup.raw": { fg: parseColor(colors.accent) },
  "markup.raw.block": { fg: parseColor(colors.text) },
  
  // Links
  "markup.link": { fg: parseColor(colors.secondary), underline: true },
  "markup.link.url": { fg: parseColor(colors.textMuted), underline: true },
  "markup.link.label": { fg: parseColor(colors.secondary) },
  
  // Lists
  "markup.list": { fg: parseColor(colors.accent) },
  "markup.list.checked": { fg: parseColor(colors.success) },
  "markup.list.unchecked": { fg: parseColor(colors.textMuted) },
  
  // Quotes
  "markup.quote": { fg: parseColor(colors.textDim), italic: true },
  
  // Emphasis
  "markup.strong": { bold: true },
  "markup.italic": { italic: true },
  "markup.strikethrough": { dim: true },
  
  // Code syntax highlighting (using our color scheme)
  keyword: { fg: parseColor(colors.primary) },
  "keyword.function": { fg: parseColor(colors.primary) },
  "keyword.control": { fg: parseColor(colors.primary) },
  "keyword.operator": { fg: parseColor(colors.accent) },
  
  string: { fg: parseColor(colors.success) },
  "string.special": { fg: parseColor(colors.warning) },
  
  number: { fg: parseColor(colors.warning) },
  boolean: { fg: parseColor(colors.error) },
  
  comment: { fg: parseColor(colors.textMuted), italic: true },
  
  function: { fg: parseColor(colors.secondary) },
  "function.method": { fg: parseColor(colors.secondary) },
  "function.builtin": { fg: parseColor(colors.secondary) },
  
  variable: { fg: parseColor(colors.text) },
  "variable.builtin": { fg: parseColor(colors.warning) },
  "variable.parameter": { fg: parseColor(colors.textDim) },
  
  type: { fg: parseColor(colors.accent) },
  "type.builtin": { fg: parseColor(colors.accent) },
  
  property: { fg: parseColor(colors.textDim) },
  
  operator: { fg: parseColor(colors.accent) },
  punctuation: { fg: parseColor(colors.textMuted) },
  "punctuation.bracket": { fg: parseColor(colors.textMuted) },
  "punctuation.delimiter": { fg: parseColor(colors.textMuted) },
  "punctuation.special": { fg: parseColor(colors.accent) },
  
  constant: { fg: parseColor(colors.warning) },
  "constant.builtin": { fg: parseColor(colors.warning) },
  
  label: { fg: parseColor(colors.textMuted) },
  
  // Diff
  "diff.plus": { fg: parseColor(colors.success) },
  "diff.minus": { fg: parseColor(colors.error) },
  "diff.delta": { fg: parseColor(colors.warning) },
})

export interface OutputLine {
  id: string
  type: "text" | "tool_start" | "tool_end" | "error" | "system" | "subagent_start" | "subagent_end"
  content: string
  dimmed?: boolean
  meta?: {
    agentName?: string
    prompt?: string
    toolName?: string
    isError?: boolean
  }
}

export interface AppProps {
  onSubmit: (input: string) => void
  onExit?: () => void
  workingDirectory?: string
  model?: string
  yoloMode?: boolean
}

export function App({
  onSubmit,
  onExit,
  workingDirectory,
  model,
  yoloMode,
}: AppProps) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  
  const [lines, setLines] = useState<OutputLine[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0, contextUsed: 0, contextLimit: 150000 })
  const [activeLSPServers, setActiveLSPServers] = useState<string[]>([])
  const lineIdRef = useRef(0)
  const textareaRef = useRef<TextareaRenderable | null>(null)
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)

  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [savedInput, setSavedInput] = useState("")
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const attachedImagesRef = useRef<AttachedImage[]>([])
  const activeToolsRef = useRef<string[]>([])
  const imageIdRef = useRef(0)
  const imageTypeIdRef = useRef<number | null>(null)
  const imageStyleIdRef = useRef<number | null>(null)

  const [permissionPrompt, setPermissionPrompt] = useState<{
    toolName: string
    detail: string
  } | null>(null)
  const permissionResolveRef = useRef<((value: boolean) => void) | null>(null)

  useEffect(() => {
    attachedImagesRef.current = attachedImages
  }, [attachedImages])

  useEffect(() => {
    activeToolsRef.current = activeTools
  }, [activeTools])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    
    if (imageTypeIdRef.current === null) {
      imageTypeIdRef.current = textarea.extmarks.registerType("image")
    }
    if (imageStyleIdRef.current === null) {
      imageStyleIdRef.current = syntaxStyle.getStyleId("extmark.image")
    }
  }, [])

  const displayModel = model ? model.replace("claude-", "").replace(/-\d{8}$/, "") : "opus-4-5"
  const displayDir = workingDirectory
    ? workingDirectory.replace(/^\/Users\/[^/]+/, "~")
    : "~"

  const addLine = useCallback((type: OutputLine["type"], content: string, meta?: OutputLine["meta"], dimmed?: boolean) => {
    const id = `line-${lineIdRef.current++}`
    setLines((prev) => [...prev, { id, type, content, meta, dimmed }])
  }, [])

  const formatToolDetail = (name: string, input?: Record<string, unknown>): string => {
    if (!input) return ""
    switch (name) {
      case "Read":
        return input.path ? String(input.path) : ""
      case "Edit":
        return input.path ? String(input.path) : ""
      case "Write":
        return input.path ? String(input.path) : ""
      case "Delete":
        return input.path ? String(input.path) : ""
      case "Glob":
        return input.pattern ? String(input.pattern) : ""
      case "Grep":
        return input.pattern ? `"${input.pattern}"` : ""
      case "Bash":
        const cmd = input.command ? String(input.command) : ""
        return cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd
      case "WebFetch":
        return input.url ? String(input.url) : ""
      default:
        return ""
    }
  }

  useEffect(() => {
    if (!isProcessing) return
    const interval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(interval)
  }, [isProcessing])

  useEffect(() => {
    const controller = {
      addText: (text: string) => {
        setLines((prev) => {
          const hasActiveTools = activeToolsRef.current.length > 0
          const lastLine = prev[prev.length - 1]
          if (lastLine && lastLine.type === "text" && lastLine.dimmed === hasActiveTools) {
            return [
              ...prev.slice(0, -1),
              { ...lastLine, content: lastLine.content + text },
            ]
          }
          const id = `line-${lineIdRef.current++}`
          return [...prev, { id, type: "text", content: text, dimmed: hasActiveTools }]
        })
      },
      addToolStart: (name: string, input?: Record<string, unknown>) => {
        setActiveTools((prev) => [...prev, name])
        
        if (SUBAGENT_TOOLS.has(name)) {
          let displayText = ""
          
          switch (name) {
            case "Task":
            case "Painter":
              displayText = input?.description ? String(input.description) : ""
              break
            case "Finder":
            case "Librarian":
              displayText = input?.query ? String(input.query) : ""
              break
            case "Oracle":
              displayText = input?.task ? String(input.task) : ""
              break
            case "Kraken":
              displayText = input?.objective ? String(input.objective) : ""
              break
          }
          
          const displayPreview = displayText.length > 150 ? displayText.slice(0, 150) + "..." : displayText
          addLine("subagent_start", name, {
            agentName: name,
            prompt: displayPreview,
          })
        } else {
          const detail = formatToolDetail(name, input)
          addLine("tool_start", detail, { toolName: name })
        }
      },
      addToolEnd: (result: string, isError: boolean) => {
        const lastTool = activeToolsRef.current[activeToolsRef.current.length - 1]
        setActiveTools((prev) => prev.slice(0, -1))
        
        if (lastTool && SUBAGENT_TOOLS.has(lastTool)) {
          const truncated = result.length > 300 ? result.slice(0, 300) + "..." : result
          addLine("subagent_end", truncated, { isError })
        } else {
          const truncated = result.length > 200 ? result.slice(0, 200) + "..." : result
          addLine("tool_end", truncated, { toolName: lastTool, isError })
        }
      },
      addError: (error: string) => addLine("error", error),
      addSystem: (message: string) => addLine("system", message),
      setProcessing: (processing: boolean) => {
        setIsProcessing(processing)
        if (!processing) setActiveTools([])
      },
      clear: () => {
        setLines([])
        lineIdRef.current = 0
      },
      setTokenUsage: (input: number, output: number, contextUsed: number, contextLimit: number) => {
        setTokenUsage({ input, output, contextUsed, contextLimit })
      },
      setLSPServers: (servers: string[]) => {
        setActiveLSPServers(servers)
      },
      requestPermission: (toolName: string, detail: string): Promise<boolean> => {
        return new Promise((resolve) => {
          permissionResolveRef.current = resolve
          setPermissionPrompt({ toolName, detail })
          addLine("system", " ")
          addLine("system", `⚠ PERMISSION: ${toolName}`)
          addLine("system", `  ${detail}`)
          addLine("system", `  Press Y to allow, N to deny`)
          addLine("system", " ")
        })
      },
    }
    ;(globalThis as Record<string, unknown>).__tuiController = controller
    return () => {
      delete (globalThis as Record<string, unknown>).__tuiController
    }
  }, [addLine])

  useKeyboard((key) => {
    const textarea = textareaRef.current
    const scrollbox = scrollboxRef.current
    
    if (permissionPrompt) {
      if (key.name === "y" || key.name === "Y") {
        addLine("system", `◆ ${permissionPrompt.toolName}: Approved`)
        setPermissionPrompt(null)
        permissionResolveRef.current?.(true)
        permissionResolveRef.current = null
        return
      }
      if (key.name === "n" || key.name === "N" || key.name === "escape") {
        addLine("system", `◆ ${permissionPrompt.toolName}: Denied`)
        setPermissionPrompt(null)
        permissionResolveRef.current?.(false)
        permissionResolveRef.current = null
        return
      }
      return
    }
    
    if ((key.super || key.meta) && key.name === "c") {
      const selection = renderer.getSelection()
      if (selection) {
        const selectedText = selection.getSelectedText()
        if (selectedText) {
          copyToClipboard(selectedText).catch(() => {})
          addLine("system", `Copied ${selectedText.length} characters`)
          return
        }
      }
    }
    
    if (key.ctrl && key.name === "c") {
      if (textarea && textarea.plainText.length > 0) {
        textarea.clear()
        setAttachedImages([])
        return
      }
      onExit?.()
      process.exit(0)
    }
    
    if (key.ctrl && key.name === "d") {
      onExit?.()
      process.exit(0)
    }
    
    if (key.name === "escape" && isProcessing) {
      addLine("system", "Interrupt requested...")
    }
    
    if (scrollbox) {
      if (key.name === "pageup") {
        scrollbox.scrollBy(-0.8, "viewport")
      }
      if (key.name === "pagedown") {
        scrollbox.scrollBy(0.8, "viewport")
      }
      if (key.name === "home" && !key.shift && key.ctrl) {
        scrollbox.scrollTo(0)
      }
      if (key.name === "end" && !key.shift && key.ctrl) {
        scrollbox.scrollTo(scrollbox.scrollHeight)
      }
    }
  })

  const showHelp = useCallback(() => {
    addLine("system", " ")
    addLine("system", "Commands:")
    addLine("system", "  /help          Show this help")
    addLine("system", "  /clear         Clear messages")
    addLine("system", " ")
    addLine("system", "App:")
    addLine("system", "  Cmd/Ctrl+C     Copy selection")
    addLine("system", "  Ctrl+C         Clear input (or exit if empty)")
    addLine("system", "  Ctrl+D         Exit")
    addLine("system", "  Escape         Interrupt (while processing)")
    addLine("system", " ")
    addLine("system", "Navigation:")
    addLine("system", "  Up/Down        Input history")
    addLine("system", "  PageUp/Down    Scroll messages")
    addLine("system", "  Ctrl+Home/End  Jump to first/last message")
    addLine("system", " ")
    addLine("system", "Editing:")
    addLine("system", "  Ctrl+W         Delete word backward")
    addLine("system", "  Ctrl+U         Delete to line start")
    addLine("system", "  Ctrl+K         Delete to line end")
    addLine("system", "  Ctrl+A/E       Jump to line start/end")
    addLine("system", "  Ctrl+Z         Undo")
    addLine("system", "  Ctrl+.         Redo")
    addLine("system", " ")
  }, [addLine])

  const handleSubmit = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const value = textarea.plainText
    if (!value.trim() || isProcessing) return

    const displayText = value.trim()
    
    const currentImages = attachedImagesRef.current
    let submitText = displayText
    for (const img of currentImages) {
      submitText = submitText.replace(`[Image ${img.imageNum}]`, img.filepath)
    }
    
    setHistory((prev) => {
      const newHistory = [...prev, displayText]
      if (newHistory.length > MAX_HISTORY) {
        return newHistory.slice(-MAX_HISTORY)
      }
      return newHistory
    })
    setHistoryIndex(0)
    setSavedInput("")
    setAttachedImages([])
    attachedImagesRef.current = []
    
    textarea.clear()
    
    if (displayText === "/help") {
      addLine("system", " ")
      addLine("system", `> ${displayText}`)
      addLine("system", " ")
      showHelp()
      return
    }
    
    if (displayText === "/clear") {
      setLines([])
      lineIdRef.current = 0
      return
    }

    addLine("system", " ")
    addLine("system", `> ${displayText}`)
    addLine("system", " ")
    onSubmit(submitText)
  }, [onSubmit, isProcessing, addLine, showHelp])

  const handlePaste = useCallback(async (e: PasteEvent) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const pastedText = e.text.trim()
    if (!pastedText) return

    const filepath = pastedText.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
    
    if (/^(https?):\/\//.test(filepath)) return

    try {
      const file = Bun.file(filepath)
      const fileType = file.type
      
      if (fileType.startsWith("image/")) {
        e.preventDefault()
        
        const content = await file
          .arrayBuffer()
          .then((buffer) => Buffer.from(buffer).toString("base64"))
          .catch(() => null)
        
        if (content) {
          const imageNum = attachedImages.length + 1
          const imageId = imageIdRef.current++
          const virtualText = `[Image ${imageNum}]`
          
          const cursorOffset = textarea.cursorOffset
          const extmarkStart = cursorOffset
          const extmarkEnd = extmarkStart + virtualText.length
          
          textarea.insertText(virtualText + " ")
          
          if (imageTypeIdRef.current !== null && imageStyleIdRef.current !== null) {
            textarea.extmarks.create({
              start: extmarkStart,
              end: extmarkEnd,
              virtual: true,
              styleId: imageStyleIdRef.current,
              typeId: imageTypeIdRef.current,
            })
          }
          
          setAttachedImages((prev) => [...prev, {
            id: imageId,
            imageNum,
            filepath,
            filename: file.name ?? filepath,
            mime: fileType,
            data: content,
          }])
        }
      }
    } catch {}
  }, [attachedImages.length])

  const handleKeyDown = useCallback((e: KeyEvent) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const currentText = textarea.plainText
    const cursorOffset = textarea.cursorOffset

    if (e.name === "up" && cursorOffset === 0 && history.length > 0) {
      e.preventDefault?.()
      
      if (historyIndex === 0) {
        setSavedInput(currentText)
      }
      
      const newIndex = Math.min(historyIndex + 1, history.length)
      if (newIndex !== historyIndex) {
        setHistoryIndex(newIndex)
        const historyItem = history[history.length - newIndex]
        if (historyItem !== undefined) {
          textarea.setText(historyItem)
          textarea.cursorOffset = 0
        }
      }
      return
    }

    if (e.name === "down" && cursorOffset === currentText.length) {
      e.preventDefault?.()
      
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        
        if (newIndex === 0) {
          textarea.setText(savedInput)
          textarea.cursorOffset = savedInput.length
        } else {
          const historyItem = history[history.length - newIndex]
          if (historyItem !== undefined) {
            textarea.setText(historyItem)
            textarea.cursorOffset = historyItem.length
          }
        }
      }
      return
    }
  }, [history, historyIndex, savedInput])

  const getColor = (type: OutputLine["type"]) => {
    switch (type) {
      case "error": return colors.error
      case "tool_start": return colors.secondary
      case "tool_end": return colors.success
      case "system": return colors.primary
      default: return colors.text
    }
  }

  const showWelcome = lines.length === 0
  const modeText = yoloMode ? "yolo" : "safe"
  const modeColor = yoloMode ? colors.warning : colors.textDim
  const spinner = isProcessing ? SPINNER_FRAMES[spinnerFrame] : "●"
  const spinnerColor = isProcessing ? colors.warning : colors.success
  const toolInfo = activeTools.length > 0 ? ` [${activeTools[activeTools.length - 1]}]` : ""

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
    return String(tokens)
  }
  
  const contextPercent = tokenUsage.contextLimit > 0 
    ? Math.round((tokenUsage.contextUsed / tokenUsage.contextLimit) * 100) 
    : 0

  return (
    <box
      width={dimensions.width}
      height={dimensions.height}
      backgroundColor={colors.bg}
      flexDirection="column"
    >
      <box flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1}>
        {showWelcome ? (
          <box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
            <box flexDirection="column">
              {/* Foundry Logo - Hot top (bright red) */}
              <text fg="#FF5555" content="███████╗ ██████╗ ██╗   ██╗███╗   ██╗██████╗ ██████╗ ██╗   ██╗" />
              <text fg="#FF5555" content="██╔════╝██╔═══██╗██║   ██║████╗  ██║██╔══██╗██╔══██╗╚██╗ ██╔╝" />
              {/* Molten middle (gold/yellow) */}
              <text fg="#FFAA00" content="█████╗  ██║   ██║██║   ██║██╔██╗ ██║██║  ██║██████╔╝ ╚████╔╝ " />
              <text fg="#FFAA00" content="██╔══╝  ██║   ██║██║   ██║██║╚██╗██║██║  ██║██╔══██╗  ╚██╔╝  " />
              {/* Cooling base (bright yellow) */}
              <text fg="#FFFF55" content="██║     ╚██████╔╝╚██████╔╝██║ ╚████║██████╔╝██║  ██║   ██║   " />
              <text fg="#FFFF55" content="╚═╝      ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═════╝ ╚═╝  ╚═╝   ╚═╝   " />
              {/* Subtitle */}
              <box marginTop={1} flexDirection="row">
                <text fg={colors.textMuted} content="   >> " />
                <text fg={colors.text} content="AGENTIC WORKFLOW ENGINE" />
                <text fg={colors.textMuted} content=" v0.1.0" />
              </box>
              <text content=" " />
              <text fg={colors.textDim} content={`   ${displayDir}`} />
              <text content=" " />
              <text fg={colors.textMuted} content="   Type a message to begin or /help for commands." />
            </box>
          </box>
        ) : (
          <scrollbox
            ref={(r: ScrollBoxRenderable) => { scrollboxRef.current = r }}
            flexGrow={1}
            stickyScroll={true}
            stickyStart="bottom"
          >
            <box flexDirection="column" paddingBottom={2}>
              {lines.map((line) => {
                if (line.type === "text") {
                  if (line.dimmed) {
                    return <text key={line.id} fg={colors.textMuted} content={line.content} />
                  }
                  return (
                    <code
                      key={line.id}
                      content={line.content}
                      filetype="markdown"
                      syntaxStyle={syntaxStyle}
                      streaming={true}
                      conceal={true}
                      drawUnstyledText={false}
                    />
                  )
                }
                
                if (line.type === "tool_start") {
                  return (
                    <box
                      key={line.id}
                      border={["left"]}
                      borderColor={colors.secondary}
                      paddingLeft={2}
                      marginTop={1}
                      flexDirection="column"
                    >
                      <text fg={colors.textDim} content={line.meta?.toolName ?? "Tool"} />
                      {line.content && (
                        <text fg={colors.textMuted} content={line.content} />
                      )}
                    </box>
                  )
                }
                
                if (line.type === "tool_end") {
                  const isSuccess = !line.meta?.isError
                  const prefix = isSuccess ? "✓" : "✗"
                  return (
                    <box
                      key={line.id}
                      border={["left"]}
                      borderColor={isSuccess ? colors.success : colors.error}
                      paddingLeft={2}
                      marginBottom={1}
                      flexDirection="column"
                    >
                      <text fg={isSuccess ? colors.textMuted : colors.error} content={`${prefix} ${line.content}`} />
                    </box>
                  )
                }
                
                if (line.type === "subagent_start") {
                  return (
                    <box
                      key={line.id}
                      border={["left"]}
                      borderColor={colors.subagent}
                      backgroundColor={colors.bgSubagent}
                      paddingLeft={2}
                      paddingRight={2}
                      paddingTop={1}
                      paddingBottom={1}
                      marginTop={1}
                      flexDirection="column"
                      gap={0}
                    >
                      <text fg={colors.text} content={line.meta?.agentName ?? line.content} />
                      {line.meta?.prompt && (
                        <text fg={colors.textDim} content={line.meta.prompt} />
                      )}
                    </box>
                  )
                }
                
                if (line.type === "subagent_end") {
                  const isSuccess = !line.meta?.isError
                  const prefix = isSuccess ? "✓" : "✗"
                  return (
                    <box
                      key={line.id}
                      border={["left"]}
                      borderColor={isSuccess ? colors.success : colors.error}
                      backgroundColor={colors.bgSubagent}
                      paddingLeft={2}
                      paddingRight={2}
                      paddingTop={1}
                      paddingBottom={1}
                      marginBottom={1}
                      flexDirection="column"
                    >
                      <text fg={isSuccess ? colors.success : colors.error} content={`${prefix} ${line.content}`} />
                    </box>
                  )
                }
                
                return <text key={line.id} fg={getColor(line.type)} content={line.content} />
              })}
            </box>
          </scrollbox>
        )}
      </box>

      <box
        flexShrink={0}
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={1}
        flexDirection="column"
      >
        <box
          border={["left"]}
          borderColor={isProcessing ? colors.warning : colors.primary}
          flexDirection="column"
        >
          <box
            paddingLeft={2}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={colors.bgElement}
            flexDirection="column"
          >
            <textarea
              ref={(r: TextareaRenderable) => { textareaRef.current = r }}
              placeholder={isProcessing ? "Working..." : "Ask anything..."}
              focused={!isProcessing}
              minHeight={1}
              maxHeight={10}
              keyBindings={textareaKeybindings}
              syntaxStyle={syntaxStyle}
              onSubmit={handleSubmit}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              style={{
                textColor: colors.text,
                focusedTextColor: colors.text,
                cursorColor: colors.text,
              }}
            />
          </box>
        </box>

        <box flexDirection="row" gap={1} paddingTop={1}>
          <text fg={spinnerColor} content={spinner} />
          <text fg={colors.text} content={displayModel} />
          <text fg={colors.textMuted} content=" · " />
          <text fg={modeColor} content={modeText} />
          {toolInfo && <text fg={colors.accent} content={toolInfo} />}
          {activeLSPServers.length > 0 && (
            <>
              <text fg={colors.textMuted} content=" · " />
              <text fg={colors.success} content={`LSP: ${activeLSPServers.join(", ")}`} />
            </>
          )}
          <box flexGrow={1} />
          <text fg={colors.textMuted} content={`${formatTokens(tokenUsage.input + tokenUsage.output)} Tokens`} />
          <text fg={colors.textMuted} content=" · " />
          <text
            fg={contextPercent >= 90 ? colors.error : contextPercent >= 70 ? colors.warning : colors.textMuted}
            content={`${contextPercent}% Context Used`}
          />
        </box>
      </box>
    </box>
  )
}

export interface TUIController {
  addText: (text: string) => void
  addToolStart: (name: string, input?: Record<string, unknown>) => void
  addToolEnd: (result: string, isError: boolean) => void
  addError: (error: string) => void
  addSystem: (message: string) => void
  setProcessing: (processing: boolean) => void
  setTokenUsage: (input: number, output: number, contextUsed: number, contextLimit: number) => void
  setLSPServers: (servers: string[]) => void
  requestPermission: (toolName: string, detail: string) => Promise<boolean>
  clear: () => void
}

export function getTUIController(): TUIController | undefined {
  return (globalThis as Record<string, unknown>).__tuiController as TUIController | undefined
}

export async function startTUI(
  onSubmit: (input: string) => void,
  options?: { workingDirectory?: string; model?: string; yoloMode?: boolean }
): Promise<void> {
  if (!process.stdout.isTTY) {
    throw new Error("TUI mode requires a terminal (TTY)")
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  })

  const root = createRoot(renderer)
  root.render(
    <App
      onSubmit={onSubmit}
      onExit={() => process.exit(0)}
      workingDirectory={options?.workingDirectory}
      model={options?.model}
      yoloMode={options?.yoloMode}
    />
  )
}
