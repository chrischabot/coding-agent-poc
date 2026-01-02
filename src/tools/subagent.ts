import type { Tool, ToolContext, ToolResult } from "../core/types"
import {
  SubagentRunner,
  createTaskConfig,
  createFinderConfig,
  createOracleConfig,
  createPainterConfig,
  createLibrarianConfig,
  createKrakenScopeConfig,
  createKrakenExecutorConfig,
} from "../subagent"
import type { SubagentContext } from "../subagent"

const DEFAULT_MODEL = "claude-opus-4-5-20251101"

export const taskTool: Tool = {
  spec: {
    name: "Task",
    description: `Fire-and-forget executor for multi-step implementations.

WHEN TO USE:
- Multi-step feature implementations
- Creating new files or components
- Running tests or builds
- Code refactoring across files
- When you know EXACTLY what needs to be done

WHEN NOT TO USE:
- Exploring or researching code
- Making architectural decisions
- Tasks requiring back-and-forth with user
- Simple single-file edits

Write detailed, specific prompts with context and acceptance criteria.`,
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed task instructions with context and acceptance criteria",
        },
        description: {
          type: "string",
          description: "3-5 word summary of the task",
        },
      },
      required: ["prompt", "description"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const prompt = input.prompt as string
    const description = input.description as string
    const model = context.model ?? DEFAULT_MODEL

    const config = createTaskConfig(model)
    const subagentContext: SubagentContext = {
      workingDirectory: context.workingDirectory,
      threadId: context.threadId,
      parentThreadId: context.threadId,
      signal: context.signal,
      model: context.model,
      permissionCheck: context.permissionCheck,
    }

    const runner = new SubagentRunner(config, subagentContext)

    try {
      const result = await runner.run(prompt)
      return {
        output: `[Task: ${description}]\n\n${result.output}\n\n(${result.turns} turns, ${result.toolCalls} tool calls)`,
        isError: result.isError,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Task failed: ${message}`, isError: true }
    }
  },
}

export const finderTool: Tool = {
  spec: {
    name: "Finder",
    description: `Fast, parallel code search agent for conceptual queries.

Use this to find code that matches conceptual descriptions - it searches across languages and layers using grep and glob in parallel.

WHEN TO USE:
- Mapping features across the codebase
- Finding implementations of specific functionality
- Tracking capabilities and side-effects
- Understanding where something is used

WHEN NOT TO USE:
- Making code changes (use Task instead)
- Design advice (use Oracle instead)
- Simple text searches (use Grep directly)`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Conceptual description of what to find",
        },
      },
      required: ["query"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const query = input.query as string
    const model = context.model ?? DEFAULT_MODEL

    const config = createFinderConfig(model)
    const subagentContext: SubagentContext = {
      workingDirectory: context.workingDirectory,
      threadId: context.threadId,
      parentThreadId: context.threadId,
      signal: context.signal,
      model: context.model,
      permissionCheck: context.permissionCheck,
    }

    const runner = new SubagentRunner(config, subagentContext)

    try {
      const result = await runner.run(`Find code that: ${query}`)
      return {
        output: result.output,
        isError: result.isError,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Finder failed: ${message}`, isError: true }
    }
  },
}

export const oracleTool: Tool = {
  spec: {
    name: "Oracle",
    description: `Expert technical advisor for architecture, reviews, and complex debugging.

Use this for high-quality technical guidance when you need deeper analysis or a second opinion.

WHEN TO USE:
- Code reviews and architecture decisions
- Complex debugging after failed attempts
- Planning implementations and refactoring
- Understanding unfamiliar code patterns
- Security or performance analysis

WHEN NOT TO USE:
- Simple file searches (use Grep/Finder)
- Bulk code execution (use Task)
- First attempt at any fix (try yourself first)`,
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Question or task requiring expert guidance",
        },
        context: {
          type: "string",
          description: "Optional background context",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Optional file paths to consider",
        },
      },
      required: ["task"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const task = input.task as string
    const additionalContext = input.context as string | undefined
    const files = input.files as string[] | undefined
    const model = context.model ?? DEFAULT_MODEL

    let prompt = task
    if (additionalContext) {
      prompt = `${task}\n\nContext: ${additionalContext}`
    }
    if (files && files.length > 0) {
      prompt = `${prompt}\n\nRelevant files to examine: ${files.join(", ")}`
    }

    const config = createOracleConfig(model)
    const subagentContext: SubagentContext = {
      workingDirectory: context.workingDirectory,
      threadId: context.threadId,
      parentThreadId: context.threadId,
      signal: context.signal,
      model: context.model,
      permissionCheck: context.permissionCheck,
    }

    const runner = new SubagentRunner(config, subagentContext)

    try {
      const result = await runner.run(prompt)
      return {
        output: result.output,
        isError: result.isError,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Oracle failed: ${message}`, isError: true }
    }
  },
}

export const painterTool: Tool = {
  spec: {
    name: "Painter",
    description: `Frontend development specialist for UI/UX implementation.

Use this for frontend-specific tasks that require knowledge of modern web technologies, UI patterns, and responsive design.

WHEN TO USE:
- Implementing or modifying React/Vue/Svelte components
- CSS/styling work (Tailwind, CSS-in-JS, etc.)
- Responsive design implementation
- Accessibility improvements
- Frontend performance optimization

WHEN NOT TO USE:
- Backend logic or API work (use Task)
- Architecture decisions (use Oracle)
- Code search only (use Finder)`,
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed frontend task instructions with design context",
        },
        description: {
          type: "string",
          description: "3-5 word summary of the task",
        },
      },
      required: ["prompt", "description"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const prompt = input.prompt as string
    const description = input.description as string
    const model = context.model ?? DEFAULT_MODEL

    const config = createPainterConfig(model)
    const subagentContext: SubagentContext = {
      workingDirectory: context.workingDirectory,
      threadId: context.threadId,
      parentThreadId: context.threadId,
      signal: context.signal,
      model: context.model,
      permissionCheck: context.permissionCheck,
    }

    const runner = new SubagentRunner(config, subagentContext)

    try {
      const result = await runner.run(prompt)
      return {
        output: `[Painter: ${description}]\n\n${result.output}\n\n(${result.turns} turns, ${result.toolCalls} tool calls)`,
        isError: result.isError,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Painter failed: ${message}`, isError: true }
    }
  },
}

export const librarianTool: Tool = {
  spec: {
    name: "Librarian",
    description: `Codebase understanding agent for exploring repositories and documentation.

Use this for thorough analysis of code, finding implementations, and understanding architectural patterns.

WHEN TO USE:
- Exploring unfamiliar repositories
- Understanding how features work end-to-end
- Finding documentation or code examples
- Tracing code flow across modules
- Comparing implementations across repos

WHEN NOT TO USE:
- Making code changes (use Task/Painter)
- Simple searches (use Grep/Finder)
- Architecture decisions (use Oracle)`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Question about code or documentation to explore",
        },
        context: {
          type: "string",
          description: "Optional background context",
        },
      },
      required: ["query"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const query = input.query as string
    const additionalContext = input.context as string | undefined
    const model = context.model ?? DEFAULT_MODEL

    let prompt = query
    if (additionalContext) {
      prompt = `${query}\n\nContext: ${additionalContext}`
    }

    const config = createLibrarianConfig(model)
    const subagentContext: SubagentContext = {
      workingDirectory: context.workingDirectory,
      threadId: context.threadId,
      parentThreadId: context.threadId,
      signal: context.signal,
      model: context.model,
      permissionCheck: context.permissionCheck,
    }

    const runner = new SubagentRunner(config, subagentContext)

    try {
      const result = await runner.run(prompt)
      return {
        output: result.output,
        isError: result.isError,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Librarian failed: ${message}`, isError: true }
    }
  },
}

export const krakenTool: Tool = {
  spec: {
    name: "Kraken",
    description: `Bulk code transformation agent for large-scale changes across many files.

Use this for mass migrations, renames, or pattern-wide changes that affect multiple files.

WHEN TO USE:
- Renaming a function/class across the entire codebase
- Migrating from one API to another
- Applying a pattern change to many files
- Bulk refactoring operations

WHEN NOT TO USE:
- Changes to a single file (use Task)
- Exploratory work (use Finder)
- Frontend-specific changes (use Painter)

The Kraken operates in two phases:
1. Scope: Identifies all files that need modification
2. Execute: Applies changes to each file`,
    inputSchema: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description: "What transformation to apply (e.g., 'rename function foo to bar')",
        },
        scope: {
          type: "string",
          description: "Optional scope hint (e.g., 'src/**/*.ts', 'only test files')",
        },
      },
      required: ["objective"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const objective = input.objective as string
    const scope = input.scope as string | undefined
    const model = context.model ?? DEFAULT_MODEL

    const scopeConfig = createKrakenScopeConfig(model)
    const subagentContext: SubagentContext = {
      workingDirectory: context.workingDirectory,
      threadId: context.threadId,
      parentThreadId: context.threadId,
      signal: context.signal,
      model: context.model,
      permissionCheck: context.permissionCheck,
    }

    const scopeRunner = new SubagentRunner(scopeConfig, subagentContext)

    let scopePrompt = `Find all files that need modification for this objective: ${objective}`
    if (scope) {
      scopePrompt += `\n\nScope hint: ${scope}`
    }

    try {
      const scopeResult = await scopeRunner.run(scopePrompt)

      if (scopeResult.isError) {
        return {
          output: `Kraken scope phase failed: ${scopeResult.output}`,
          isError: true,
        }
      }

      const filePaths = Array.from(
        new Set(
          scopeResult.output
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => line.replace(/^[-*]\s+/, "").trim())
            .map((line) => line.split(" - ")[0].trim())
            .filter((path) => {
              if (!path) return false
              return (
                path.startsWith("/") ||
                path.startsWith(".") ||
                /^[a-zA-Z]:\\/.test(path) ||
                path.includes("/") ||
                path.includes("\\") ||
                /^[^\s]+\.[^\s]+$/.test(path)
              )
            })
        )
      )

      if (filePaths.length === 0) {
        return {
          output: `Kraken found no files to modify.\n\nScope output:\n${scopeResult.output}`,
          isError: false,
        }
      }

      const execConfig = createKrakenExecutorConfig(model)
      const execRunner = new SubagentRunner(execConfig, subagentContext)

      const execPrompt = `Apply this transformation: ${objective}

Files to modify:
${filePaths.join("\n")}

Read each file, apply the necessary changes, and report what was modified.`

      const execResult = await execRunner.run(execPrompt)

      return {
        output: `[Kraken: ${objective}]

Phase 1 - Scope (found ${filePaths.length} files):
${filePaths.map((f) => `  - ${f}`).join("\n")}

Phase 2 - Execute:
${execResult.output}

(Scope: ${scopeResult.turns} turns, Exec: ${execResult.turns} turns)`,
        isError: execResult.isError,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Kraken failed: ${message}`, isError: true }
    }
  },
}
