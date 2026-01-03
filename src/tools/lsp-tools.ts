import { readFile, stat } from "node:fs/promises"
import { resolve, isAbsolute, relative } from "node:path"
import type { Tool, ToolContext, ExecutionProfile } from "../core/types"
import { createLSPManager, detectLanguageFromFile } from "../lsp"
import type { LSPManager, SymbolLocation, SupportedLanguage } from "../lsp"
import { LSP_SERVER_CONFIGS } from "../lsp"

// Shared LSP manager cache (will be replaced by context-provided manager when available)
let sharedLSPManager: LSPManager | null = null

function getLSPManager(context: ToolContext): LSPManager {
  // Prefer context-provided manager for proper lifecycle management
  if (context.lspManager) {
    return context.lspManager as LSPManager
  }
  // Fallback to shared manager
  if (!sharedLSPManager) {
    sharedLSPManager = createLSPManager(context.workingDirectory)
  }
  return sharedLSPManager
}

async function findSymbolAtPosition(
  content: string,
  line: number,
  column: number
): Promise<{ symbol: string; start: number; end: number } | null> {
  const lines = content.split("\n")
  if (line < 1 || line > lines.length) return null

  const lineContent = lines[line - 1]
  if (column < 1 || column > lineContent.length + 1) return null

  // Find word boundaries around the cursor position
  const col = column - 1 // 0-indexed
  const wordRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g
  let match

  while ((match = wordRegex.exec(lineContent)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (col >= start && col <= end) {
      return { symbol: match[0], start: start + 1, end: end + 1 }
    }
  }

  return null
}

function formatLocations(
  locations: SymbolLocation[],
  workingDirectory: string,
  maxResults: number = 20
): string {
  if (locations.length === 0) {
    return "No locations found."
  }

  const lines: string[] = []
  const shown = locations.slice(0, maxResults)

  for (const loc of shown) {
    const relPath = isAbsolute(loc.file)
      ? relative(workingDirectory, loc.file)
      : loc.file
    const range = loc.endLine && loc.endLine !== loc.line
      ? `${loc.line}-${loc.endLine}`
      : `${loc.line}`
    lines.push(`  ${relPath}:${range}:${loc.column}`)
  }

  if (locations.length > maxResults) {
    lines.push(`  ... and ${locations.length - maxResults} more`)
  }

  return lines.join("\n")
}

async function readLineContext(
  filePath: string,
  line: number,
  contextLines: number = 3
): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8")
    const lines = content.split("\n")
    const startLine = Math.max(0, line - 1 - contextLines)
    const endLine = Math.min(lines.length, line + contextLines)
    const snippet = lines.slice(startLine, endLine)

    const padding = String(endLine).length
    return snippet
      .map((l, i) => {
        const lineNum = startLine + i + 1
        const marker = lineNum === line ? ">" : " "
        return `${marker}${String(lineNum).padStart(padding)}\t${l}`
      })
      .join("\n")
  } catch {
    return ""
  }
}

function getInstallInstructions(language: SupportedLanguage): string {
  const config = LSP_SERVER_CONFIGS[language]
  return config?.installInstructions || "No installation instructions available"
}

// ============================================================================
// GoToDefinition Tool
// ============================================================================

async function executeGoToDefinition(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const filePath = input.path as string
  const line = input.line as number
  const column = input.column as number | undefined
  const symbol = input.symbol as string | undefined

  if (!filePath) {
    return { output: "Error: path is required", isError: true }
  }
  if (!line) {
    return { output: "Error: line is required", isError: true }
  }

  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(context.workingDirectory, filePath)

  try {
    const stats = await stat(resolvedPath)
    if (!stats.isFile()) {
      return { output: `Error: ${filePath} is not a file`, isError: true }
    }

    const content = await readFile(resolvedPath, "utf-8")
    const language = detectLanguageFromFile(resolvedPath)

    if (!language) {
      return {
        output: `Error: Unsupported file type. Supported: TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, C#, Ruby, PHP`,
        isError: true,
      }
    }

    // Determine column position
    let col = column
    if (!col && symbol) {
      // Find symbol on the line
      const lines = content.split("\n")
      const lineContent = lines[line - 1] || ""
      const idx = lineContent.indexOf(symbol)
      if (idx >= 0) {
        col = idx + 1
      }
    }
    if (!col) {
      // Default to first non-whitespace character
      const lines = content.split("\n")
      const lineContent = lines[line - 1] || ""
      const match = lineContent.match(/\S/)
      col = match ? match.index! + 1 : 1
    }

    const manager = getLSPManager(context)
    const client = await manager.getClientForFile(resolvedPath)

    if (!client) {
      return {
        output: `LSP server for ${language} not available.\n\nInstall: ${getInstallInstructions(language)}`,
        isError: true,
      }
    }

    const locations = await client.getDefinition(resolvedPath, line, col)

    if (locations.length === 0) {
      // Try to find what symbol we're looking at for better error message
      const symbolInfo = await findSymbolAtPosition(content, line, col)
      const symbolName = symbolInfo?.symbol || symbol || "symbol"
      return {
        output: `No definition found for "${symbolName}" at ${filePath}:${line}:${col}`,
        isError: false,
      }
    }

    // Build response
    const parts: string[] = []
    const symbolInfo = await findSymbolAtPosition(content, line, col)
    const symbolName = symbolInfo?.symbol || symbol || "symbol"

    parts.push(`Definition of "${symbolName}":`)
    parts.push("")

    // Show the first (primary) definition with context
    const primary = locations[0]
    const relPath = relative(context.workingDirectory, primary.file)
    parts.push(`Location: ${relPath}:${primary.line}:${primary.column}`)
    parts.push("")

    // Read and show the definition context
    const snippet = await readLineContext(primary.file, primary.line, 5)
    if (snippet) {
      parts.push("```")
      parts.push(snippet)
      parts.push("```")
    }

    // If there are additional definitions (e.g., overloads), list them
    if (locations.length > 1) {
      parts.push("")
      parts.push(`Additional definitions (${locations.length - 1}):`)
      parts.push(formatLocations(locations.slice(1), context.workingDirectory, 10))
    }

    return { output: parts.join("\n") }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { output: `Error: ${message}`, isError: true }
  }
}

const goToDefinitionProfile: ExecutionProfile = {
  resourceKeys: (input, workingDirectory) => {
    const pathInput = input.path as string | undefined
    if (pathInput) {
      const resolvedPath = isAbsolute(pathInput)
        ? pathInput
        : resolve(workingDirectory ?? process.cwd(), pathInput)
      return [{ key: resolvedPath, mode: "read" }]
    }
    return []
  },
}

export const goToDefinitionTool: Tool = {
  spec: {
    name: "GoToDefinition",
    description: `Jump to where a symbol is defined using LSP.

Finds the source definition of functions, classes, variables, types, etc.
Works across files and even into dependencies.

Use this to:
- Find where a function is implemented
- Navigate to class/type definitions
- Understand code by finding original declarations

Returns the file location and source code context.`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file containing the symbol",
        },
        line: {
          type: "number",
          description: "Line number where the symbol is used (1-indexed)",
        },
        column: {
          type: "number",
          description: "Column position of the symbol (1-indexed, optional)",
        },
        symbol: {
          type: "string",
          description: "The symbol name to find (helps locate column if not provided)",
        },
      },
      required: ["path", "line"],
    },
  },
  execute: executeGoToDefinition,
  executionProfile: goToDefinitionProfile,
}

// ============================================================================
// FindReferences Tool
// ============================================================================

async function executeFindReferences(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const filePath = input.path as string
  const line = input.line as number
  const column = input.column as number | undefined
  const symbol = input.symbol as string | undefined
  const maxResults = (input.max_results as number) || 30

  if (!filePath) {
    return { output: "Error: path is required", isError: true }
  }
  if (!line) {
    return { output: "Error: line is required", isError: true }
  }

  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(context.workingDirectory, filePath)

  try {
    const stats = await stat(resolvedPath)
    if (!stats.isFile()) {
      return { output: `Error: ${filePath} is not a file`, isError: true }
    }

    const content = await readFile(resolvedPath, "utf-8")
    const language = detectLanguageFromFile(resolvedPath)

    if (!language) {
      return {
        output: `Error: Unsupported file type. Supported: TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, C#, Ruby, PHP`,
        isError: true,
      }
    }

    // Determine column position
    let col = column
    if (!col && symbol) {
      const lines = content.split("\n")
      const lineContent = lines[line - 1] || ""
      const idx = lineContent.indexOf(symbol)
      if (idx >= 0) {
        col = idx + 1
      }
    }
    if (!col) {
      const lines = content.split("\n")
      const lineContent = lines[line - 1] || ""
      const match = lineContent.match(/\S/)
      col = match ? match.index! + 1 : 1
    }

    const manager = getLSPManager(context)
    const client = await manager.getClientForFile(resolvedPath)

    if (!client) {
      return {
        output: `LSP server for ${language} not available.\n\nInstall: ${getInstallInstructions(language)}`,
        isError: true,
      }
    }

    const references = await client.getReferences(resolvedPath, line, col)

    const symbolInfo = await findSymbolAtPosition(content, line, col)
    const symbolName = symbolInfo?.symbol || symbol || "symbol"

    if (references.length === 0) {
      return {
        output: `No references found for "${symbolName}" at ${filePath}:${line}:${col}`,
        isError: false,
      }
    }

    // Group references by file
    const byFile: Map<string, SymbolLocation[]> = new Map()
    for (const ref of references) {
      const relPath = relative(context.workingDirectory, ref.file)
      if (!byFile.has(relPath)) {
        byFile.set(relPath, [])
      }
      byFile.get(relPath)!.push(ref)
    }

    // Build output
    const parts: string[] = []
    parts.push(`References to "${symbolName}" (${references.length} total):`)
    parts.push("")

    let count = 0
    for (const [file, refs] of byFile) {
      if (count >= maxResults) {
        parts.push(`... and ${references.length - count} more references`)
        break
      }

      parts.push(`${file} (${refs.length}):`)
      for (const ref of refs) {
        if (count >= maxResults) break
        parts.push(`  Line ${ref.line}:${ref.column}`)
        count++
      }
      parts.push("")
    }

    return { output: parts.join("\n") }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { output: `Error: ${message}`, isError: true }
  }
}

const findReferencesProfile: ExecutionProfile = {
  resourceKeys: (input, workingDirectory) => {
    const pathInput = input.path as string | undefined
    if (pathInput) {
      const resolvedPath = isAbsolute(pathInput)
        ? pathInput
        : resolve(workingDirectory ?? process.cwd(), pathInput)
      return [{ key: resolvedPath, mode: "read" }]
    }
    return []
  },
}

export const findReferencesTool: Tool = {
  spec: {
    name: "FindReferences",
    description: `Find all usages of a symbol across the codebase using LSP.

Locates every place a function, class, variable, or type is used.
Essential for understanding impact of changes and code dependencies.

Use this to:
- Find all callers of a function
- See where a class is instantiated
- Understand usage patterns before refactoring
- Find all imports of a module

Returns file locations grouped by file.`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file containing the symbol definition",
        },
        line: {
          type: "number",
          description: "Line number of the symbol (1-indexed)",
        },
        column: {
          type: "number",
          description: "Column position of the symbol (1-indexed, optional)",
        },
        symbol: {
          type: "string",
          description: "The symbol name (helps locate column if not provided)",
        },
        max_results: {
          type: "number",
          description: "Maximum number of references to return (default: 30)",
        },
      },
      required: ["path", "line"],
    },
  },
  execute: executeFindReferences,
  executionProfile: findReferencesProfile,
}

// ============================================================================
// GetTypeInfo Tool
// ============================================================================

async function executeGetTypeInfo(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const filePath = input.path as string
  const line = input.line as number
  const column = input.column as number | undefined
  const symbol = input.symbol as string | undefined

  if (!filePath) {
    return { output: "Error: path is required", isError: true }
  }
  if (!line) {
    return { output: "Error: line is required", isError: true }
  }

  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(context.workingDirectory, filePath)

  try {
    const stats = await stat(resolvedPath)
    if (!stats.isFile()) {
      return { output: `Error: ${filePath} is not a file`, isError: true }
    }

    const content = await readFile(resolvedPath, "utf-8")
    const language = detectLanguageFromFile(resolvedPath)

    if (!language) {
      return {
        output: `Error: Unsupported file type. Supported: TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, C#, Ruby, PHP`,
        isError: true,
      }
    }

    // Determine column position
    let col = column
    if (!col && symbol) {
      const lines = content.split("\n")
      const lineContent = lines[line - 1] || ""
      const idx = lineContent.indexOf(symbol)
      if (idx >= 0) {
        col = idx + Math.floor(symbol.length / 2) + 1 // Middle of symbol
      }
    }
    if (!col) {
      const lines = content.split("\n")
      const lineContent = lines[line - 1] || ""
      const match = lineContent.match(/\S/)
      col = match ? match.index! + 1 : 1
    }

    const manager = getLSPManager(context)
    const client = await manager.getClientForFile(resolvedPath)

    if (!client) {
      return {
        output: `LSP server for ${language} not available.\n\nInstall: ${getInstallInstructions(language)}`,
        isError: true,
      }
    }

    const hoverInfo = await client.getHover(resolvedPath, line, col)

    const symbolInfo = await findSymbolAtPosition(content, line, col)
    const symbolName = symbolInfo?.symbol || symbol || "symbol"

    if (!hoverInfo) {
      return {
        output: `No type information available for "${symbolName}" at ${filePath}:${line}:${col}`,
        isError: false,
      }
    }

    // Build output
    const parts: string[] = []
    parts.push(`Type info for "${symbolName}" at ${filePath}:${line}:${col}`)
    parts.push("")
    parts.push("```")
    parts.push(hoverInfo)
    parts.push("```")

    return { output: parts.join("\n") }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { output: `Error: ${message}`, isError: true }
  }
}

const getTypeInfoProfile: ExecutionProfile = {
  resourceKeys: (input, workingDirectory) => {
    const pathInput = input.path as string | undefined
    if (pathInput) {
      const resolvedPath = isAbsolute(pathInput)
        ? pathInput
        : resolve(workingDirectory ?? process.cwd(), pathInput)
      return [{ key: resolvedPath, mode: "read" }]
    }
    return []
  },
}

export const getTypeInfoTool: Tool = {
  spec: {
    name: "GetTypeInfo",
    description: `Get type information and documentation for a symbol using LSP hover.

Returns type signatures, documentation, and other metadata about a symbol.
Works for functions, variables, classes, parameters, etc.

Use this to:
- See the full type signature of a function
- Read documentation/JSDoc comments
- Understand parameter and return types
- Check inferred types of variables

Returns formatted type information and documentation.`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file containing the symbol",
        },
        line: {
          type: "number",
          description: "Line number where the symbol appears (1-indexed)",
        },
        column: {
          type: "number",
          description: "Column position of the symbol (1-indexed, optional)",
        },
        symbol: {
          type: "string",
          description: "The symbol name (helps locate column if not provided)",
        },
      },
      required: ["path", "line"],
    },
  },
  execute: executeGetTypeInfo,
  executionProfile: getTypeInfoProfile,
}

// ============================================================================
// Cleanup function
// ============================================================================

export function cleanupSharedLSPManager(): Promise<void> {
  if (sharedLSPManager) {
    const manager = sharedLSPManager
    sharedLSPManager = null
    return manager.shutdownAll()
  }
  return Promise.resolve()
}
