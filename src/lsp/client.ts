import { spawn, ChildProcess } from "node:child_process"
import { readFile } from "node:fs/promises"
import type {
  LSPServerConfig,
  LSPClient,
  SymbolInfo,
  SymbolLocation,
  LSPMessage,
  LSPDocumentSymbol,
  LSPSymbolInformation,
  LSPLocation,
  SYMBOL_KIND_MAP,
} from "./types"

const SYMBOL_KINDS: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enumMember",
  23: "struct",
  24: "event",
  25: "operator",
  26: "typeParameter",
}

export class SimpleLSPClient implements LSPClient {
  private process: ChildProcess | null = null
  private config: LSPServerConfig
  private requestId = 0
  private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = new Map()
  private buffer = ""
  private initialized = false
  private rootPath = ""

  constructor(config: LSPServerConfig) {
    this.config = config
  }

  async initialize(rootPath: string): Promise<void> {
    this.rootPath = rootPath

    this.process = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: rootPath,
    })

    // Set up message handling
    this.process.stdout?.on("data", (data: Buffer) => {
      this.handleData(data)
    })

    this.process.stderr?.on("data", (data: Buffer) => {
      // Log stderr but don't fail
      console.error(`[LSP ${this.config.language}] stderr:`, data.toString())
    })

    this.process.on("error", (err) => {
      console.error(`[LSP ${this.config.language}] process error:`, err)
      this.initialized = false
    })

    this.process.on("close", (code) => {
      console.log(`[LSP ${this.config.language}] process exited with code ${code}`)
      this.initialized = false
      // Reject all pending requests
      for (const [id, { reject }] of this.pendingRequests) {
        reject(new Error(`LSP server exited with code ${code}`))
      }
      this.pendingRequests.clear()
    })

    // Send initialize request
    const initResult = await this.request("initialize", {
      processId: process.pid,
      rootUri: `file://${rootPath}`,
      rootPath,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          completion: { dynamicRegistration: false },
          hover: { dynamicRegistration: false },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          documentSymbol: {
            dynamicRegistration: false,
            hierarchicalDocumentSymbolSupport: true,
          },
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: [{ uri: `file://${rootPath}`, name: "workspace" }],
    })

    // Send initialized notification
    this.notify("initialized", {})

    this.initialized = true
  }

  async shutdown(): Promise<void> {
    if (!this.process || !this.initialized) {
      return
    }

    try {
      await this.request("shutdown", null)
      this.notify("exit", null)
    } catch {
      // Ignore errors during shutdown
    }

    this.process.kill()
    this.process = null
    this.initialized = false
  }

  isInitialized(): boolean {
    return this.initialized
  }

  async getDocumentSymbols(filePath: string): Promise<SymbolInfo[]> {
    if (!this.initialized) {
      throw new Error("LSP client not initialized")
    }

    // Open the document first
    const content = await readFile(filePath, "utf-8")
    await this.openDocument(filePath, content)

    const result = await this.request("textDocument/documentSymbol", {
      textDocument: { uri: `file://${filePath}` },
    })

    // Close the document
    this.closeDocument(filePath)

    return this.parseSymbols(result as (LSPDocumentSymbol | LSPSymbolInformation)[] | null)
  }

  async getDefinition(filePath: string, line: number, column: number): Promise<SymbolLocation[]> {
    if (!this.initialized) {
      throw new Error("LSP client not initialized")
    }

    const content = await readFile(filePath, "utf-8")
    await this.openDocument(filePath, content)

    const result = await this.request("textDocument/definition", {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character: column - 1 },
    })

    this.closeDocument(filePath)

    return this.parseLocations(result as LSPLocation | LSPLocation[] | null)
  }

  async getReferences(filePath: string, line: number, column: number): Promise<SymbolLocation[]> {
    if (!this.initialized) {
      throw new Error("LSP client not initialized")
    }

    const content = await readFile(filePath, "utf-8")
    await this.openDocument(filePath, content)

    const result = await this.request("textDocument/references", {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character: column - 1 },
      context: { includeDeclaration: true },
    })

    this.closeDocument(filePath)

    return this.parseLocations(result as LSPLocation[] | null)
  }

  async getHover(filePath: string, line: number, column: number): Promise<string | null> {
    if (!this.initialized) {
      throw new Error("LSP client not initialized")
    }

    const content = await readFile(filePath, "utf-8")
    await this.openDocument(filePath, content)

    const result = await this.request("textDocument/hover", {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line - 1, character: column - 1 },
    }) as { contents: string | { value: string } | Array<string | { value: string }> } | null

    this.closeDocument(filePath)

    if (!result || !result.contents) {
      return null
    }

    // Handle various content formats
    const contents = result.contents
    if (typeof contents === "string") {
      return contents
    }
    if (Array.isArray(contents)) {
      return contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n\n")
    }
    if (typeof contents === "object" && "value" in contents) {
      return contents.value
    }

    return null
  }

  private async openDocument(filePath: string, content: string): Promise<void> {
    const languageId = this.getLanguageId(filePath)
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri: `file://${filePath}`,
        languageId,
        version: 1,
        text: content,
      },
    })
    // Small delay to let server process
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  private closeDocument(filePath: string): void {
    this.notify("textDocument/didClose", {
      textDocument: { uri: `file://${filePath}` },
    })
  }

  private getLanguageId(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      jsx: "javascriptreact",
      py: "python",
      go: "go",
      rs: "rust",
    }
    return langMap[ext || ""] || "plaintext"
  }

  private parseSymbols(result: (LSPDocumentSymbol | LSPSymbolInformation)[] | null): SymbolInfo[] {
    if (!result || !Array.isArray(result)) {
      return []
    }

    const symbols: SymbolInfo[] = []

    const processSymbol = (sym: LSPDocumentSymbol | LSPSymbolInformation, containerName?: string) => {
      // Check if it's a DocumentSymbol (has range) or SymbolInformation (has location)
      if ("range" in sym) {
        // DocumentSymbol
        symbols.push({
          name: sym.name,
          kind: SYMBOL_KINDS[sym.kind] || "unknown",
          line: sym.range.start.line + 1,
          endLine: sym.range.end.line + 1,
          containerName,
        })

        // Process children
        if (sym.children) {
          for (const child of sym.children) {
            processSymbol(child, sym.name)
          }
        }
      } else if ("location" in sym) {
        // SymbolInformation
        symbols.push({
          name: sym.name,
          kind: SYMBOL_KINDS[sym.kind] || "unknown",
          line: sym.location.range.start.line + 1,
          endLine: sym.location.range.end.line + 1,
          containerName: sym.containerName,
        })
      }
    }

    for (const sym of result) {
      processSymbol(sym)
    }

    return symbols
  }

  private parseLocations(result: LSPLocation | LSPLocation[] | null): SymbolLocation[] {
    if (!result) {
      return []
    }

    const locations = Array.isArray(result) ? result : [result]

    return locations.map((loc) => ({
      file: loc.uri.replace("file://", ""),
      line: loc.range.start.line + 1,
      column: loc.range.start.character + 1,
      endLine: loc.range.end.line + 1,
      endColumn: loc.range.end.character + 1,
    }))
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString()

    while (true) {
      // Look for Content-Length header
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) {
        break
      }

      const header = this.buffer.slice(0, headerEnd)
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!contentLengthMatch) {
        // Invalid header, skip
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(contentLengthMatch[1], 10)
      const messageStart = headerEnd + 4
      const messageEnd = messageStart + contentLength

      if (this.buffer.length < messageEnd) {
        // Not enough data yet
        break
      }

      const messageJson = this.buffer.slice(messageStart, messageEnd)
      this.buffer = this.buffer.slice(messageEnd)

      try {
        const message: LSPMessage = JSON.parse(messageJson)
        this.handleMessage(message)
      } catch (err) {
        console.error("[LSP] Failed to parse message:", err)
      }
    }
  }

  private handleMessage(message: LSPMessage): void {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id)!
      this.pendingRequests.delete(message.id)

      if (message.error) {
        reject(new Error(message.error.message))
      } else {
        resolve(message.result)
      }
    }
    // Ignore notifications and other messages
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (!this.process?.stdin) {
      throw new Error("LSP process not running")
    }

    const id = ++this.requestId
    const message: LSPMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    }

    const json = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })

      // Set timeout
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`LSP request timeout: ${method}`))
        }
      }, 30000)

      // Clear timeout on resolution
      const originalResolve = this.pendingRequests.get(id)!.resolve
      this.pendingRequests.get(id)!.resolve = (value) => {
        clearTimeout(timeout)
        originalResolve(value)
      }

      this.process!.stdin!.write(header + json)
    })
  }

  private notify(method: string, params: unknown): void {
    if (!this.process?.stdin) {
      return
    }

    const message: LSPMessage = {
      jsonrpc: "2.0",
      method,
      params,
    }

    const json = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`

    this.process.stdin.write(header + json)
  }
}
