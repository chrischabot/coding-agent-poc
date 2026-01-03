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
    description: `General-purpose autonomous executor for implementation work.

Use Task for any coding work that touches 1-10 files: new features, bug fixes, refactoring, tests, build scripts, API endpoints, database changes, etc.

Examples:
- "Add JWT authentication to the login endpoint"
- "Create unit tests for the UserService class"
- "Refactor the payment module to use async/await"
- "Fix the race condition in the cache invalidation"

For frontend/UI work, prefer Painter. For 10+ files, prefer Kraken.

Provide detailed instructions with file paths, acceptance criteria, and context.`,
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
    description: `Fast code search agent for locating implementations in the local codebase.

Use Finder to answer "where is X?" questions - it runs parallel grep/glob searches and returns file paths with brief context.

Examples:
- "Find where user authentication is handled"
- "Locate all API endpoint definitions"
- "Find usages of the deprecated Logger class"
- "Where is the database connection configured?"

Returns: File paths and code snippets. Does not modify code or provide analysis.`,
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
    description: `Technical advisor for explicit analysis requests and architecture decisions.

Use Oracle ONLY when the user explicitly asks for review, comparison, or trade-off analysis. Oracle reads code and provides recommendations but does NOT write or modify code.

Trigger phrases: "should I use", "review this", "what are the trade-offs", "compare", "analyze", "which approach"

Examples:
- "Should I use Redis or Memcached for this caching layer?"
- "Review this auth implementation for security issues"
- "Compare these two database schemas"
- "What are the trade-offs of microservices vs monolith here?"

Do NOT use Oracle to validate your own decisions - just implement with Task.`,
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
    description: `Frontend and design specialist for UI/UX implementation.

Use Painter for any work involving visual interfaces, components, styling, or user experience. Painter understands React, Vue, Svelte, CSS, Tailwind, accessibility, and responsive design.

Examples:
- "Build a settings page with dark mode toggle"
- "Add form validation with inline error messages"
- "Make the dashboard responsive for mobile"
- "Create a reusable Modal component with animations"
- "Fix the accessibility issues in the navigation menu"

For backend/API work, use Task instead.`,
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
    description: `External repository explorer for GitHub/GitLab URLs.

Use Librarian ONLY when the user provides a GitHub or GitLab URL to explore. Librarian can clone, read, and analyze external repositories.

Examples:
- "Explore https://github.com/anthropics/anthropic-sdk-python and explain the streaming API"
- "How does https://github.com/vercel/next.js handle routing?"
- "Find authentication examples in https://gitlab.com/org/project"

For local codebase work, use Finder (search) or Task (implementation) instead.`,
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
    description: `Bulk transformation agent for large-scale changes across 10+ files.

Use Kraken when you need to apply the SAME type of change to many files: renames, API migrations, pattern replacements, or codebase-wide refactors.

Examples:
- "Rename getUserById to fetchUser across the entire codebase"
- "Migrate all fetch() calls to use the new HttpClient"
- "Replace console.log with the Logger utility everywhere"
- "Update all React class components to functional components"

Kraken works in two phases: first scoping affected files, then applying changes.

For changes to fewer than 10 files, use Task instead.`,
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
