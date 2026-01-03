import { extname } from "node:path"

const CHARS_PER_TOKEN = 4

export type FileCategory = "code" | "config" | "log" | "data" | "markdown" | "unknown"

export interface TruncationOptions {
  maxTokens: number
  preserveStart?: number
  preserveEnd?: number
  targetRange?: {
    startLine: number
    endLine: number
  }
}

export interface TruncatedContent {
  content: string
  wasTruncated: boolean
  originalLines: number
  includedLines: number
  estimatedTokens: number
  strategy: string
}

const EXTENSION_TO_CATEGORY: Record<string, FileCategory> = {
  // Code
  ".ts": "code",
  ".tsx": "code",
  ".js": "code",
  ".jsx": "code",
  ".mjs": "code",
  ".cjs": "code",
  ".py": "code",
  ".go": "code",
  ".rs": "code",
  ".java": "code",
  ".kt": "code",
  ".scala": "code",
  ".c": "code",
  ".cpp": "code",
  ".cc": "code",
  ".h": "code",
  ".hpp": "code",
  ".cs": "code",
  ".rb": "code",
  ".php": "code",
  ".swift": "code",
  ".m": "code",
  ".mm": "code",
  ".vue": "code",
  ".svelte": "code",

  // Config
  ".json": "config",
  ".jsonc": "config",
  ".yaml": "config",
  ".yml": "config",
  ".toml": "config",
  ".xml": "config",
  ".ini": "config",
  ".env": "config",
  ".conf": "config",
  ".config": "config",
  ".properties": "config",

  // Logs
  ".log": "log",

  // Data
  ".csv": "data",
  ".tsv": "data",
  ".sql": "data",
  ".ndjson": "data",
  ".jsonl": "data",

  // Markdown/Docs
  ".md": "markdown",
  ".mdx": "markdown",
  ".rst": "markdown",
  ".txt": "markdown",
}

export function detectFileCategory(filePath: string, content?: string): FileCategory {
  const ext = extname(filePath).toLowerCase()
  const categoryByExt = EXTENSION_TO_CATEGORY[ext]

  if (categoryByExt) {
    return categoryByExt
  }

  // Detect by content patterns
  if (content) {
    // Log patterns
    if (/^\[\d{4}-\d{2}-\d{2}/.test(content) || /^(DEBUG|INFO|WARN|ERROR|FATAL)\s/m.test(content)) {
      return "log"
    }
    // JSON-like
    if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
      return "config"
    }
    // CSV-like
    if (/^[^,\n]+,[^,\n]+/.test(content)) {
      return "data"
    }
  }

  return "unknown"
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN)
}

function extractImportSection(lines: string[], language: string): string[] {
  const importPatterns: Record<string, RegExp[]> = {
    typescript: [/^import\s/, /^export\s.*from/, /^require\(/],
    javascript: [/^import\s/, /^export\s.*from/, /^const\s+\w+\s*=\s*require\(/],
    python: [/^import\s/, /^from\s+\S+\s+import/],
    go: [/^import\s/],
    rust: [/^use\s/, /^mod\s/],
  }

  const patterns = importPatterns[language] || importPatterns.typescript
  const importLines: string[] = []
  let inImportBlock = false
  let braceDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Track multi-line imports
    if (inImportBlock) {
      importLines.push(line)
      braceDepth += (line.match(/\{/g) || []).length
      braceDepth -= (line.match(/\}/g) || []).length
      if (braceDepth <= 0 && (trimmed.endsWith(";") || trimmed.endsWith(")"))) {
        inImportBlock = false
        braceDepth = 0
      }
      continue
    }

    // Check for import start
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        importLines.push(line)
        // Check if multi-line
        if (trimmed.includes("{") && !trimmed.includes("}")) {
          inImportBlock = true
          braceDepth = 1
        }
        break
      }
    }

    // Stop after first non-import, non-empty line (after we've seen imports)
    if (importLines.length > 0 && trimmed && !patterns.some((p) => p.test(trimmed))) {
      // Allow some gap for comments/empty lines
      const remainingImports = lines.slice(i, i + 5).some((l) =>
        patterns.some((p) => p.test(l.trim()))
      )
      if (!remainingImports) {
        break
      }
    }
  }

  return importLines
}

function extractSignatures(lines: string[], language: string): { line: number; signature: string }[] {
  const signaturePatterns: Record<string, RegExp[]> = {
    typescript: [
      /^(\s*)(export\s+)?(async\s+)?function\s+\w+/,
      /^(\s*)(export\s+)?(abstract\s+)?class\s+\w+/,
      /^(\s*)(export\s+)?interface\s+\w+/,
      /^(\s*)(export\s+)?type\s+\w+\s*=/,
      /^(\s*)(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/,
      /^(\s*)(public|private|protected)?\s*(async\s+)?\w+\s*\([^)]*\)\s*[:{]/,
    ],
    python: [
      /^(\s*)def\s+\w+/,
      /^(\s*)async\s+def\s+\w+/,
      /^(\s*)class\s+\w+/,
    ],
    go: [
      /^func\s+(\([^)]+\)\s+)?\w+/,
      /^type\s+\w+\s+(struct|interface)/,
    ],
    rust: [
      /^(\s*)(pub\s+)?fn\s+\w+/,
      /^(\s*)(pub\s+)?struct\s+\w+/,
      /^(\s*)(pub\s+)?enum\s+\w+/,
      /^(\s*)(pub\s+)?trait\s+\w+/,
      /^(\s*)impl\s+/,
    ],
  }

  const patterns = signaturePatterns[language] || signaturePatterns.typescript
  const signatures: { line: number; signature: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        // Get the signature (first line, possibly with continuation)
        let signature = line
        // For opening brace on same line, truncate at brace
        const braceIdx = signature.indexOf("{")
        if (braceIdx > 0) {
          signature = signature.slice(0, braceIdx).trim() + " { ... }"
        }
        signatures.push({ line: i + 1, signature: signature.trim() })
        break
      }
    }
  }

  return signatures
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
  }
  return langMap[ext] || "typescript"
}

function truncateCode(
  content: string,
  filePath: string,
  options: TruncationOptions
): TruncatedContent {
  const lines = content.split("\n")
  const language = detectLanguage(filePath)
  const maxChars = options.maxTokens * CHARS_PER_TOKEN

  // Extract imports
  const importLines = extractImportSection(lines, language)
  const importSection = importLines.join("\n")

  // Extract signatures
  const signatures = extractSignatures(lines, language)
  const signatureSection = signatures
    .map((s) => `  ${s.line}: ${s.signature}`)
    .join("\n")

  // If user requested a specific range, include it
  let targetSection = ""
  if (options.targetRange) {
    const { startLine, endLine } = options.targetRange
    const rangeLines = lines.slice(
      Math.max(0, startLine - 1),
      Math.min(lines.length, endLine)
    )
    targetSection = rangeLines.join("\n")
  }

  // Build output
  const parts: string[] = []

  if (importLines.length > 0) {
    parts.push(`// === IMPORTS (${importLines.length} lines) ===\n${importSection}`)
  }

  if (signatures.length > 0) {
    parts.push(`// === STRUCTURE (${signatures.length} symbols) ===\n${signatureSection}`)
  }

  if (targetSection) {
    const rangeLabel = `lines ${options.targetRange!.startLine}-${options.targetRange!.endLine}`
    parts.push(`// === REQUESTED RANGE (${rangeLabel}) ===\n${targetSection}`)
  }

  let result = parts.join("\n\n")

  // If still too long, truncate further
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + "\n... [truncated]"
  }

  return {
    content: result,
    wasTruncated: true,
    originalLines: lines.length,
    includedLines: importLines.length + signatures.length,
    estimatedTokens: estimateTokens(result),
    strategy: "Kept imports, signatures" + (targetSection ? ", and requested range" : ""),
  }
}

function truncateLog(content: string, options: TruncationOptions): TruncatedContent {
  const lines = content.split("\n")
  const headLines = options.preserveStart ?? 50
  const tailLines = options.preserveEnd ?? 100

  if (lines.length <= headLines + tailLines) {
    return {
      content,
      wasTruncated: false,
      originalLines: lines.length,
      includedLines: lines.length,
      estimatedTokens: estimateTokens(content),
      strategy: "Full content (small file)",
    }
  }

  const head = lines.slice(0, headLines)
  const tail = lines.slice(-tailLines)
  const skipped = lines.length - headLines - tailLines

  const result = [
    ...head,
    "",
    `... [${skipped} lines omitted] ...`,
    "",
    ...tail,
  ].join("\n")

  return {
    content: result,
    wasTruncated: true,
    originalLines: lines.length,
    includedLines: headLines + tailLines,
    estimatedTokens: estimateTokens(result),
    strategy: `Head (${headLines}) + tail (${tailLines}), skipped ${skipped} lines`,
  }
}

function truncateConfig(content: string, options: TruncationOptions): TruncatedContent {
  const maxChars = options.maxTokens * CHARS_PER_TOKEN

  if (content.length <= maxChars) {
    return {
      content,
      wasTruncated: false,
      originalLines: content.split("\n").length,
      includedLines: content.split("\n").length,
      estimatedTokens: estimateTokens(content),
      strategy: "Full content",
    }
  }

  // Try to parse as JSON and truncate intelligently
  try {
    const parsed = JSON.parse(content)
    const truncated = truncateObject(parsed, maxChars)
    const result = JSON.stringify(truncated, null, 2)

    return {
      content: result,
      wasTruncated: true,
      originalLines: content.split("\n").length,
      includedLines: result.split("\n").length,
      estimatedTokens: estimateTokens(result),
      strategy: "Kept structure, truncated arrays and long values",
    }
  } catch {
    // Fall back to line truncation
    const lines = content.split("\n")
    const keepLines = Math.floor(maxChars / 50) // Rough estimate
    const result = lines.slice(0, keepLines).join("\n") + "\n... [truncated]"

    return {
      content: result,
      wasTruncated: true,
      originalLines: lines.length,
      includedLines: keepLines,
      estimatedTokens: estimateTokens(result),
      strategy: `First ${keepLines} lines`,
    }
  }
}

function truncateObject(obj: unknown, maxChars: number, depth = 0): unknown {
  if (depth > 5) return "[nested object]"

  if (Array.isArray(obj)) {
    if (obj.length > 10) {
      return [
        ...obj.slice(0, 5).map((item) => truncateObject(item, maxChars, depth + 1)),
        `... ${obj.length - 10} more items ...`,
        ...obj.slice(-5).map((item) => truncateObject(item, maxChars, depth + 1)),
      ]
    }
    return obj.map((item) => truncateObject(item, maxChars, depth + 1))
  }

  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = truncateObject(value, maxChars, depth + 1)
    }
    return result
  }

  if (typeof obj === "string" && obj.length > 200) {
    return obj.slice(0, 100) + "..." + obj.slice(-50)
  }

  return obj
}

function truncateData(content: string, options: TruncationOptions): TruncatedContent {
  const lines = content.split("\n")
  const headLines = options.preserveStart ?? 20
  const tailLines = options.preserveEnd ?? 10

  if (lines.length <= headLines + tailLines + 10) {
    return {
      content,
      wasTruncated: false,
      originalLines: lines.length,
      includedLines: lines.length,
      estimatedTokens: estimateTokens(content),
      strategy: "Full content",
    }
  }

  const head = lines.slice(0, headLines)
  const sample = lines.slice(Math.floor(lines.length / 2), Math.floor(lines.length / 2) + 5)
  const tail = lines.slice(-tailLines)
  const skipped = lines.length - headLines - tailLines - 5

  const result = [
    ...head,
    "",
    `... [${Math.floor(lines.length / 2) - headLines} lines skipped] ...`,
    "",
    "// Sample from middle:",
    ...sample,
    "",
    `... [${lines.length - Math.floor(lines.length / 2) - 5 - tailLines} lines skipped] ...`,
    "",
    ...tail,
  ].join("\n")

  return {
    content: result,
    wasTruncated: true,
    originalLines: lines.length,
    includedLines: headLines + 5 + tailLines,
    estimatedTokens: estimateTokens(result),
    strategy: `Head (${headLines}) + middle sample (5) + tail (${tailLines})`,
  }
}

function truncateMarkdown(content: string, options: TruncationOptions): TruncatedContent {
  const lines = content.split("\n")
  const maxChars = options.maxTokens * CHARS_PER_TOKEN

  if (content.length <= maxChars) {
    return {
      content,
      wasTruncated: false,
      originalLines: lines.length,
      includedLines: lines.length,
      estimatedTokens: estimateTokens(content),
      strategy: "Full content",
    }
  }

  // Extract headings and first paragraph after each
  const sections: string[] = []
  let currentSection: string[] = []
  let inFirstParagraph = false
  let paragraphLines = 0

  for (const line of lines) {
    if (line.match(/^#{1,6}\s/)) {
      if (currentSection.length > 0) {
        sections.push(currentSection.join("\n"))
      }
      currentSection = [line]
      inFirstParagraph = true
      paragraphLines = 0
    } else if (inFirstParagraph) {
      if (line.trim() === "") {
        if (paragraphLines > 0) {
          inFirstParagraph = false
        }
      } else {
        currentSection.push(line)
        paragraphLines++
        if (paragraphLines >= 3) {
          currentSection.push("...")
          inFirstParagraph = false
        }
      }
    }
  }

  if (currentSection.length > 0) {
    sections.push(currentSection.join("\n"))
  }

  let result = sections.join("\n\n")
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + "\n\n... [truncated]"
  }

  return {
    content: result,
    wasTruncated: true,
    originalLines: lines.length,
    includedLines: result.split("\n").length,
    estimatedTokens: estimateTokens(result),
    strategy: "Kept headings and first paragraphs",
  }
}

function truncateDefault(content: string, options: TruncationOptions): TruncatedContent {
  const lines = content.split("\n")
  const maxChars = options.maxTokens * CHARS_PER_TOKEN

  if (content.length <= maxChars) {
    return {
      content,
      wasTruncated: false,
      originalLines: lines.length,
      includedLines: lines.length,
      estimatedTokens: estimateTokens(content),
      strategy: "Full content",
    }
  }

  // Simple head truncation
  let result = ""
  let lineCount = 0
  for (const line of lines) {
    if (result.length + line.length + 1 > maxChars - 50) {
      break
    }
    result += line + "\n"
    lineCount++
  }

  result += `\n... [${lines.length - lineCount} more lines truncated]`

  return {
    content: result,
    wasTruncated: true,
    originalLines: lines.length,
    includedLines: lineCount,
    estimatedTokens: estimateTokens(result),
    strategy: `First ${lineCount} lines`,
  }
}

export function smartTruncate(
  content: string,
  filePath: string,
  options: TruncationOptions
): TruncatedContent {
  const category = detectFileCategory(filePath, content)

  switch (category) {
    case "code":
      return truncateCode(content, filePath, options)
    case "log":
      return truncateLog(content, options)
    case "config":
      return truncateConfig(content, options)
    case "data":
      return truncateData(content, options)
    case "markdown":
      return truncateMarkdown(content, options)
    default:
      return truncateDefault(content, options)
  }
}

export function formatTruncatedOutput(truncated: TruncatedContent, filePath: string): string {
  const header = [
    `[File: ${filePath}]`,
    `[${truncated.originalLines} lines → ${truncated.includedLines} included | ~${truncated.estimatedTokens} tokens]`,
    `[Strategy: ${truncated.strategy}]`,
    "",
  ].join("\n")

  return header + truncated.content
}
