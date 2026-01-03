export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "ruby"
  | "php"

export interface LSPServerConfig {
  language: SupportedLanguage
  command: string
  args: string[]
  initializationOptions?: Record<string, unknown>
  installInstructions: string
}

export const LSP_SERVER_CONFIGS: Record<SupportedLanguage, LSPServerConfig> = {
  typescript: {
    language: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    installInstructions: "npm install -g typescript-language-server typescript",
  },
  javascript: {
    language: "javascript",
    command: "typescript-language-server",
    args: ["--stdio"],
    installInstructions: "npm install -g typescript-language-server typescript",
  },
  python: {
    language: "python",
    command: "pylsp",
    args: [],
    installInstructions: "python3 -m pip install python-lsp-server",
  },
  go: {
    language: "go",
    command: "gopls",
    args: ["serve"],
    installInstructions: "go install golang.org/x/tools/gopls@latest",
  },
  rust: {
    language: "rust",
    command: "rust-analyzer",
    args: [],
    installInstructions: "rustup component add rust-analyzer",
  },
  java: {
    language: "java",
    command: "jdtls",
    args: [],
    initializationOptions: {
      bundles: [],
      workspaceFolders: [],
    },
    installInstructions: "Install Eclipse JDT Language Server: https://github.com/eclipse-jdtls/eclipse.jdt.ls",
  },
  c: {
    language: "c",
    command: "clangd",
    args: ["--background-index"],
    installInstructions: "Install clangd via your package manager (apt install clangd, brew install llvm)",
  },
  cpp: {
    language: "cpp",
    command: "clangd",
    args: ["--background-index"],
    installInstructions: "Install clangd via your package manager (apt install clangd, brew install llvm)",
  },
  csharp: {
    language: "csharp",
    command: "omnisharp",
    args: ["-lsp"],
    installInstructions: "Install OmniSharp: https://github.com/OmniSharp/omnisharp-roslyn/releases",
  },
  ruby: {
    language: "ruby",
    command: "solargraph",
    args: ["stdio"],
    installInstructions: "gem install --user-install solargraph",
  },
  php: {
    language: "php",
    command: "intelephense",
    args: ["--stdio"],
    installInstructions: "npm install -g intelephense",
  },
}

export interface SymbolLocation {
  file: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

export interface SymbolInfo {
  name: string
  kind: string
  line: number
  endLine?: number
  signature?: string
  containerName?: string
}

export interface LSPClient {
  initialize(rootPath: string): Promise<void>
  shutdown(): Promise<void>
  isInitialized(): boolean

  getDocumentSymbols(filePath: string): Promise<SymbolInfo[]>
  getDefinition(filePath: string, line: number, column: number): Promise<SymbolLocation[]>
  getReferences(filePath: string, line: number, column: number): Promise<SymbolLocation[]>
  getHover(filePath: string, line: number, column: number): Promise<string | null>
}

export interface LSPManager {
  getClient(language: SupportedLanguage): Promise<LSPClient | null>
  getClientForFile(filePath: string): Promise<LSPClient | null>
  isAvailable(language: SupportedLanguage): Promise<boolean>
  shutdownAll(): Promise<void>
  getActiveServers(): SupportedLanguage[]
}

// LSP Protocol types (subset we use)
export interface LSPMessage {
  jsonrpc: "2.0"
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

export interface LSPPosition {
  line: number
  character: number
}

export interface LSPRange {
  start: LSPPosition
  end: LSPPosition
}

export interface LSPLocation {
  uri: string
  range: LSPRange
}

export interface LSPDocumentSymbol {
  name: string
  kind: number
  range: LSPRange
  selectionRange: LSPRange
  children?: LSPDocumentSymbol[]
}

export interface LSPSymbolInformation {
  name: string
  kind: number
  location: LSPLocation
  containerName?: string
}

// Symbol kind mapping (LSP spec)
export const SYMBOL_KIND_MAP: Record<number, string> = {
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
