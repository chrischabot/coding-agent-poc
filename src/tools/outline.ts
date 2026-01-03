import { readFile, stat } from "node:fs/promises"
import { resolve, isAbsolute, extname } from "node:path"
import type { Tool, ToolContext, ExecutionProfile } from "../core/types"

interface OutlineItem {
  type: "import" | "export" | "function" | "class" | "interface" | "type" | "const" | "method" | "struct" | "trait" | "impl"
  name: string
  line: number
  signature?: string
  exported?: boolean
  async?: boolean
  visibility?: string
  indent?: number
}

interface FileOutline {
  path: string
  language: string
  totalLines: number
  imports: string[]
  exports: string[]
  items: OutlineItem[]
}

type LanguageType = "typescript" | "javascript" | "python" | "go" | "rust" | "unknown"

function detectLanguage(filePath: string): LanguageType {
  const ext = extname(filePath).toLowerCase()
  const langMap: Record<string, LanguageType> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".pyw": "python",
    ".go": "go",
    ".rs": "rust",
  }
  return langMap[ext] || "unknown"
}

function extractTypeScriptOutline(content: string, lines: string[]): FileOutline {
  const imports: string[] = []
  const exports: string[] = []
  const items: OutlineItem[] = []

  // Extract imports
  const importRegex = /^import\s+(?:type\s+)?(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*\{[^}]+\})?\s*from\s+['"]([^'"]+)['"]/gm
  let match
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1])
  }

  // Process line by line for structure
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const indent = line.length - line.trimStart().length

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue
    }

    // Export statements
    const exportMatch = trimmed.match(/^export\s+\{([^}]+)\}/)
    if (exportMatch) {
      exports.push(...exportMatch[1].split(",").map((e) => e.trim().split(/\s+as\s+/)[0]))
      continue
    }

    // Functions
    const funcMatch = trimmed.match(/^(export\s+)?(async\s+)?function\s+(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/)
    if (funcMatch) {
      const name = funcMatch[3]
      const params = funcMatch[5] || ""
      const returnType = funcMatch[6]?.trim() || ""
      items.push({
        type: "function",
        name,
        line: i + 1,
        signature: `function ${name}(${params})${returnType ? `: ${returnType}` : ""}`,
        exported: !!funcMatch[1],
        async: !!funcMatch[2],
      })
      if (funcMatch[1]) exports.push(name)
      continue
    }

    // Arrow functions as const
    const arrowMatch = trimmed.match(/^(export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\(/)
    if (arrowMatch) {
      const name = arrowMatch[2]
      items.push({
        type: "const",
        name,
        line: i + 1,
        signature: `const ${name} = ${arrowMatch[3] ? "async " : ""}(...) => ...`,
        exported: !!arrowMatch[1],
        async: !!arrowMatch[3],
      })
      if (arrowMatch[1]) exports.push(name)
      continue
    }

    // Classes
    const classMatch = trimmed.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/)
    if (classMatch) {
      const name = classMatch[3]
      const ext = classMatch[4]
      items.push({
        type: "class",
        name,
        line: i + 1,
        signature: `class ${name}${ext ? ` extends ${ext}` : ""}`,
        exported: !!classMatch[1],
      })
      if (classMatch[1]) exports.push(name)
      continue
    }

    // Interfaces
    const ifaceMatch = trimmed.match(/^(export\s+)?interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+([^{]+))?/)
    if (ifaceMatch) {
      const name = ifaceMatch[2]
      items.push({
        type: "interface",
        name,
        line: i + 1,
        signature: `interface ${name}`,
        exported: !!ifaceMatch[1],
      })
      if (ifaceMatch[1]) exports.push(name)
      continue
    }

    // Type aliases
    const typeMatch = trimmed.match(/^(export\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=/)
    if (typeMatch) {
      const name = typeMatch[2]
      items.push({
        type: "type",
        name,
        line: i + 1,
        signature: `type ${name} = ...`,
        exported: !!typeMatch[1],
      })
      if (typeMatch[1]) exports.push(name)
      continue
    }

    // Class methods (indented)
    if (indent > 0) {
      const methodMatch = trimmed.match(/^(public|private|protected)?\s*(async\s+)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/)
      if (methodMatch && !trimmed.startsWith("if") && !trimmed.startsWith("for") && !trimmed.startsWith("while")) {
        const name = methodMatch[3]
        if (name !== "constructor" || true) { // Include constructor
          items.push({
            type: "method",
            name,
            line: i + 1,
            signature: `${methodMatch[1] || ""}${methodMatch[2] || ""}${name}(${methodMatch[4]})`,
            visibility: methodMatch[1],
            async: !!methodMatch[2],
            indent,
          })
        }
      }
    }
  }

  return {
    path: "",
    language: "typescript",
    totalLines: lines.length,
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    items,
  }
}

function extractPythonOutline(content: string, lines: string[]): FileOutline {
  const imports: string[] = []
  const items: OutlineItem[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const indent = line.length - line.trimStart().length

    // Imports
    const importMatch = trimmed.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)$/)
    if (importMatch) {
      imports.push(importMatch[1] || importMatch[2].split(",")[0].trim())
      continue
    }

    // Functions
    const funcMatch = trimmed.match(/^(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/)
    if (funcMatch) {
      items.push({
        type: "function",
        name: funcMatch[2],
        line: i + 1,
        signature: `def ${funcMatch[2]}(${funcMatch[3]})${funcMatch[4] ? ` -> ${funcMatch[4]}` : ""}`,
        async: !!funcMatch[1],
        indent,
      })
      continue
    }

    // Classes
    const classMatch = trimmed.match(/^class\s+(\w+)(?:\(([^)]*)\))?:/)
    if (classMatch) {
      items.push({
        type: "class",
        name: classMatch[1],
        line: i + 1,
        signature: `class ${classMatch[1]}${classMatch[2] ? `(${classMatch[2]})` : ""}`,
        indent,
      })
      continue
    }
  }

  return {
    path: "",
    language: "python",
    totalLines: lines.length,
    imports: [...new Set(imports)],
    exports: [],
    items,
  }
}

function extractGoOutline(content: string, lines: string[]): FileOutline {
  const imports: string[] = []
  const items: OutlineItem[] = []
  let inImportBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Import block
    if (trimmed === "import (") {
      inImportBlock = true
      continue
    }
    if (inImportBlock) {
      if (trimmed === ")") {
        inImportBlock = false
      } else if (trimmed) {
        const pkg = trimmed.replace(/^[\w.]+\s+/, "").replace(/['"]/g, "")
        if (pkg) imports.push(pkg)
      }
      continue
    }

    // Single import
    const singleImport = trimmed.match(/^import\s+(?:[\w.]+\s+)?["']([^"']+)["']/)
    if (singleImport) {
      imports.push(singleImport[1])
      continue
    }

    // Functions
    const funcMatch = trimmed.match(/^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*\(([^)]*)\)|\s*(\w+))?/)
    if (funcMatch) {
      const receiver = funcMatch[2]
      const name = funcMatch[3]
      const params = funcMatch[4]
      const returns = funcMatch[5] || funcMatch[6] || ""
      items.push({
        type: receiver ? "method" : "function",
        name: receiver ? `${receiver}.${name}` : name,
        line: i + 1,
        signature: `func ${receiver ? `(${funcMatch[1]} *${receiver}) ` : ""}${name}(${params})${returns ? ` ${returns}` : ""}`,
      })
      continue
    }

    // Types/Structs/Interfaces
    const typeMatch = trimmed.match(/^type\s+(\w+)\s+(struct|interface)/)
    if (typeMatch) {
      items.push({
        type: typeMatch[2] === "struct" ? "struct" : "interface",
        name: typeMatch[1],
        line: i + 1,
        signature: `type ${typeMatch[1]} ${typeMatch[2]}`,
      })
      continue
    }
  }

  return {
    path: "",
    language: "go",
    totalLines: lines.length,
    imports: [...new Set(imports)],
    exports: [],
    items,
  }
}

function extractRustOutline(content: string, lines: string[]): FileOutline {
  const imports: string[] = []
  const items: OutlineItem[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Use statements
    const useMatch = trimmed.match(/^(pub\s+)?use\s+(.+);/)
    if (useMatch) {
      imports.push(useMatch[2])
      continue
    }

    // Functions
    const funcMatch = trimmed.match(/^(pub\s+)?(async\s+)?fn\s+(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)(?:\s*->\s*([^{]+))?/)
    if (funcMatch) {
      items.push({
        type: "function",
        name: funcMatch[3],
        line: i + 1,
        signature: `fn ${funcMatch[3]}(${funcMatch[5]})${funcMatch[6] ? ` -> ${funcMatch[6].trim()}` : ""}`,
        visibility: funcMatch[1] ? "pub" : undefined,
        async: !!funcMatch[2],
      })
      continue
    }

    // Structs
    const structMatch = trimmed.match(/^(pub\s+)?struct\s+(\w+)/)
    if (structMatch) {
      items.push({
        type: "struct",
        name: structMatch[2],
        line: i + 1,
        signature: `struct ${structMatch[2]}`,
        visibility: structMatch[1] ? "pub" : undefined,
      })
      continue
    }

    // Enums
    const enumMatch = trimmed.match(/^(pub\s+)?enum\s+(\w+)/)
    if (enumMatch) {
      items.push({
        type: "type",
        name: enumMatch[2],
        line: i + 1,
        signature: `enum ${enumMatch[2]}`,
        visibility: enumMatch[1] ? "pub" : undefined,
      })
      continue
    }

    // Traits
    const traitMatch = trimmed.match(/^(pub\s+)?trait\s+(\w+)/)
    if (traitMatch) {
      items.push({
        type: "trait",
        name: traitMatch[2],
        line: i + 1,
        signature: `trait ${traitMatch[2]}`,
        visibility: traitMatch[1] ? "pub" : undefined,
      })
      continue
    }

    // Impl blocks
    const implMatch = trimmed.match(/^impl\s+(?:<[^>]+>\s+)?(\w+)(?:\s+for\s+(\w+))?/)
    if (implMatch) {
      const name = implMatch[2] ? `${implMatch[1]} for ${implMatch[2]}` : implMatch[1]
      items.push({
        type: "impl",
        name,
        line: i + 1,
        signature: `impl ${name}`,
      })
      continue
    }
  }

  return {
    path: "",
    language: "rust",
    totalLines: lines.length,
    imports: [...new Set(imports)],
    exports: [],
    items,
  }
}

function extractOutline(content: string, filePath: string): FileOutline {
  const lines = content.split("\n")
  const language = detectLanguage(filePath)

  let outline: FileOutline

  switch (language) {
    case "typescript":
    case "javascript":
      outline = extractTypeScriptOutline(content, lines)
      break
    case "python":
      outline = extractPythonOutline(content, lines)
      break
    case "go":
      outline = extractGoOutline(content, lines)
      break
    case "rust":
      outline = extractRustOutline(content, lines)
      break
    default:
      // Fallback: try TypeScript patterns
      outline = extractTypeScriptOutline(content, lines)
      outline.language = "unknown"
  }

  outline.path = filePath
  return outline
}

function formatOutline(outline: FileOutline): string {
  const parts: string[] = []

  parts.push(`File: ${outline.path} (${outline.language}, ${outline.totalLines} lines)`)
  parts.push("")

  if (outline.imports.length > 0) {
    parts.push(`IMPORTS: ${outline.imports.slice(0, 10).join(", ")}${outline.imports.length > 10 ? ` (+${outline.imports.length - 10} more)` : ""}`)
    parts.push("")
  }

  if (outline.exports.length > 0) {
    parts.push(`EXPORTS: ${outline.exports.join(", ")}`)
    parts.push("")
  }

  if (outline.items.length > 0) {
    parts.push("STRUCTURE:")

    // Group by type and indent level
    let currentClass = ""
    for (const item of outline.items) {
      const prefix = item.indent && item.indent > 0 ? "    " : "  "
      const exported = item.exported ? "[export] " : ""
      const async_ = item.async ? "async " : ""
      const vis = item.visibility ? `${item.visibility} ` : ""

      if (item.type === "class" || item.type === "interface" || item.type === "struct" || item.type === "trait" || item.type === "impl") {
        currentClass = item.name
        parts.push(`  ${item.line}: ${exported}${item.signature}`)
      } else if (item.type === "method" && item.indent && item.indent > 0) {
        parts.push(`    ${item.line}: ${vis}${async_}${item.name}(...)`)
      } else {
        parts.push(`${prefix}${item.line}: ${exported}${async_}${item.signature || item.name}`)
      }
    }
  }

  return parts.join("\n")
}

async function executeOutline(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const filePath = input.path as string

  if (!filePath) {
    return { output: "Error: path is required", isError: true }
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
    const outline = extractOutline(content, filePath)
    const formatted = formatOutline(outline)

    return { output: formatted }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { output: `Error reading file: ${message}`, isError: true }
  }
}

const outlineExecutionProfile: ExecutionProfile = {
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

export const outlineTool: Tool = {
  spec: {
    name: "Outline",
    description: `Get a structural overview of a file (imports, exports, functions, classes).

Returns a compact summary showing:
- Import statements
- Exported symbols
- Functions, classes, interfaces, types with line numbers

Use this to understand file structure without reading full content.
Supports: TypeScript, JavaScript, Python, Go, Rust`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to analyze",
        },
      },
      required: ["path"],
    },
  },
  execute: executeOutline,
  executionProfile: outlineExecutionProfile,
}

// Export for use by ReadSymbol tool
export { extractOutline, type FileOutline, type OutlineItem }
