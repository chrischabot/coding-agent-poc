import { readFile, stat } from "node:fs/promises"
import { resolve, isAbsolute } from "node:path"
import type { Tool, ToolContext, ExecutionProfile } from "../core/types"
import { extractOutline, type OutlineItem } from "./outline"
import { createLSPManager, detectLanguageFromFile } from "../lsp"
import type { SymbolInfo, LSPManager } from "../lsp"

// Fallback LSP manager cache (used when context doesn't provide one)
const fallbackLSPManagers: Map<string, LSPManager> = new Map()

function getLSPManager(context: ToolContext): LSPManager {
  // Prefer context-provided manager for proper lifecycle management
  if (context.lspManager) {
    return context.lspManager as unknown as LSPManager
  }
  // Fallback to cached manager
  if (!fallbackLSPManagers.has(context.workingDirectory)) {
    fallbackLSPManagers.set(context.workingDirectory, createLSPManager(context.workingDirectory))
  }
  return fallbackLSPManagers.get(context.workingDirectory)!
}

interface SymbolMatch {
  name: string
  kind: string
  startLine: number
  endLine: number
  source: "lsp" | "outline"
}

async function findSymbolWithLSP(
  filePath: string,
  symbolName: string,
  context: ToolContext
): Promise<SymbolMatch | null> {
  const manager = getLSPManager(context)
  const client = await manager.getClientForFile(filePath)

  if (!client) {
    return null
  }

  try {
    const symbols = await client.getDocumentSymbols(filePath)

    // Find matching symbol
    const match = symbols.find(
      (s) => s.name === symbolName || s.name.startsWith(symbolName + "(")
    )

    if (match) {
      return {
        name: match.name,
        kind: match.kind,
        startLine: match.line,
        endLine: match.endLine || match.line,
        source: "lsp",
      }
    }

    // Try partial match
    const partialMatch = symbols.find((s) =>
      s.name.toLowerCase().includes(symbolName.toLowerCase())
    )

    if (partialMatch) {
      return {
        name: partialMatch.name,
        kind: partialMatch.kind,
        startLine: partialMatch.line,
        endLine: partialMatch.endLine || partialMatch.line,
        source: "lsp",
      }
    }

    return null
  } catch (err) {
    console.warn(`[ReadSymbol] LSP error for ${filePath}:`, err)
    return null
  }
}

async function findSymbolWithOutline(
  content: string,
  filePath: string,
  symbolName: string
): Promise<SymbolMatch | null> {
  const outline = extractOutline(content, filePath)

  // Find matching symbol
  const match = outline.items.find(
    (item) => item.name === symbolName || item.name.startsWith(symbolName + "(")
  )

  if (match) {
    return {
      name: match.name,
      kind: match.type,
      startLine: match.line,
      endLine: estimateEndLine(content.split("\n"), match),
      source: "outline",
    }
  }

  // Try partial/case-insensitive match
  const partialMatch = outline.items.find((item) =>
    item.name.toLowerCase().includes(symbolName.toLowerCase())
  )

  if (partialMatch) {
    return {
      name: partialMatch.name,
      kind: partialMatch.type,
      startLine: partialMatch.line,
      endLine: estimateEndLine(content.split("\n"), partialMatch),
      source: "outline",
    }
  }

  return null
}

function estimateEndLine(lines: string[], item: OutlineItem): number {
  // Simple heuristic: find closing brace at same or lower indent level
  const startIdx = item.line - 1
  const startLine = lines[startIdx] || ""
  const indent = startLine.length - startLine.trimStart().length

  let braceDepth = 0
  let parenDepth = 0

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]

    // Count braces/parens
    for (const char of line) {
      if (char === "{") braceDepth++
      else if (char === "}") braceDepth--
      else if (char === "(") parenDepth++
      else if (char === ")") parenDepth--
    }

    // Check for end conditions
    if (i > startIdx) {
      const currentIndent = line.length - line.trimStart().length
      const trimmed = line.trim()

      // Function/class ended
      if (braceDepth <= 0 && trimmed.endsWith("}")) {
        return i + 1
      }

      // Python-style: next non-indented line
      if (item.type !== "class" && currentIndent <= indent && trimmed && !trimmed.startsWith("#")) {
        return i
      }

      // Limit search
      if (i - startIdx > 500) {
        return i + 1
      }
    }
  }

  return Math.min(startIdx + 50, lines.length)
}

async function executeReadSymbol(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const filePath = input.path as string
  const symbolName = input.symbol as string
  const lineHint = input.line as number | undefined

  if (!filePath) {
    return { output: "Error: path is required", isError: true }
  }

  if (!symbolName) {
    return { output: "Error: symbol is required", isError: true }
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
    const lines = content.split("\n")

    // Try LSP first, fall back to outline
    let match = await findSymbolWithLSP(resolvedPath, symbolName, context)

    if (!match) {
      match = await findSymbolWithOutline(content, resolvedPath, symbolName)
    }

    if (!match) {
      // List available symbols
      const outline = extractOutline(content, filePath)
      const available = outline.items
        .slice(0, 20)
        .map((i) => `  ${i.line}: ${i.type} ${i.name}`)
        .join("\n")

      return {
        output: `Symbol "${symbolName}" not found in ${filePath}.\n\nAvailable symbols:\n${available}${outline.items.length > 20 ? `\n  ... and ${outline.items.length - 20} more` : ""}`,
        isError: true,
      }
    }

    // Apply line hint if provided
    if (lineHint !== undefined) {
      // Adjust range around hint
      match.startLine = Math.max(1, lineHint - 5)
      match.endLine = Math.min(lines.length, lineHint + 50)
    }

    // Extract the symbol's code
    const startIdx = Math.max(0, match.startLine - 1)
    const endIdx = Math.min(lines.length, match.endLine)
    const symbolLines = lines.slice(startIdx, endIdx)

    // Format with line numbers
    const padding = String(match.endLine).length
    const numberedLines = symbolLines.map((line, i) => {
      const lineNum = String(match!.startLine + i).padStart(padding)
      return `${lineNum}\t${line}`
    })

    const header = [
      `[${match.kind}] ${match.name}`,
      `File: ${filePath}:${match.startLine}-${match.endLine}`,
      `Source: ${match.source}`,
      "",
    ].join("\n")

    return { output: header + numberedLines.join("\n") }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { output: `Error reading symbol: ${message}`, isError: true }
  }
}

const readSymbolExecutionProfile: ExecutionProfile = {
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

export const readSymbolTool: Tool = {
  spec: {
    name: "ReadSymbol",
    description: `Read a specific function, class, or symbol from a file.

More precise than Read - extracts just the symbol you need.
Uses LSP when available, falls back to regex-based extraction.

Use when you need to:
- Read a specific function implementation
- View a class definition
- Extract a type or interface

Returns the symbol's code with line numbers.`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file",
        },
        symbol: {
          type: "string",
          description: "Name of the function, class, or symbol to read",
        },
        line: {
          type: "number",
          description: "Line number hint (helps disambiguate if multiple matches)",
        },
      },
      required: ["path", "symbol"],
    },
  },
  execute: executeReadSymbol,
  executionProfile: readSymbolExecutionProfile,
}

// Cleanup function for fallback LSP managers
export async function shutdownAllLSP(): Promise<void> {
  for (const manager of fallbackLSPManagers.values()) {
    await manager.shutdownAll()
  }
  fallbackLSPManagers.clear()
}
