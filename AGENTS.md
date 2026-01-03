# AGENTS.md - Coding Agent

A coding agent CLI to study how AI coding assistants work. Built with Bun, TypeScript, and the Anthropic SDK.

## Commands

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Build
bun run build

# Run in debug mode (plain text output, good for agent testing)
bun run src/index.ts --prompt "your task" --debug

# Run interactively (readline)
bun run src/index.ts --interactive

# Run with TUI (OpenTUI interface)
bun run src/index.ts --tui
```

## Top-Level Layout

- `bin/` - Bun entrypoint (`coding-agent` shim)
- `dist/` - build output (generated)
- `scripts/` - local dev/TUI test scripts
- `src/` - main application source
- `tests/` - bun:test suite
- `opencode/`, `opentui/` - vendored upstream repos used for local reference; not imported by `src/`
- `node_modules/` - dependencies (generated)

## Project Structure

```
src/
├── index.ts              # CLI entry point (yargs-based)
├── core/
│   ├── index.ts          # Core type exports
│   └── types.ts          # All type definitions (Thread, Message, Tool, etc.)
├── tools/
│   ├── registry.ts       # Tool registration and lookup
│   ├── read.ts           # Read files with line numbers
│   ├── edit.ts           # String replacement editing
│   ├── write.ts          # Create new files
│   ├── delete.ts         # Delete files/directories
│   ├── bash.ts           # Shell command execution
│   ├── grep.ts           # Ripgrep-based content search
│   ├── glob.ts           # File pattern matching
│   ├── subagent.ts       # Task, Finder, Oracle, Painter, Librarian, Kraken
│   ├── todo.ts           # TodoWrite, TodoRead for task tracking
│   ├── plan.ts           # ReadPlan, EditPlan, ReadArtifact, EditArtifact
│   ├── webfetch.ts       # Fetch and read web pages
│   ├── websearch.ts      # Web search (Tavily/Serper/DuckDuckGo)
│   ├── github.ts         # GitHub API tools
│   ├── look-at.ts        # Image/PDF analysis tool
│   ├── mermaid.ts        # Diagram rendering tool
│   ├── thread.ts         # ReadThread for conversation history
│   └── index.ts          # Tool registration and re-exports
├── subagent/
│   ├── types.ts          # Subagent type definitions
│   ├── runner.ts         # SubagentRunner class (nested agent loop)
│   ├── configs.ts        # System prompts and tool configs
│   └── index.ts          # Subagent exports
├── skill/
│   ├── types.ts          # Skill type definitions
│   ├── discovery.ts      # Skill discovery from .agents/skills/
│   └── index.ts          # Skill exports
├── context/
│   ├── index.ts          # Context exports
│   ├── tokens.ts         # Token estimation
│   └── file-state.ts     # File modification tracking
├── permission/
│   ├── types.ts          # Permission types
│   ├── rules.ts          # Built-in permission rules
│   ├── checker.ts        # Permission evaluation
│   └── index.ts          # Permission exports
├── provider/
│   ├── anthropic.ts      # Claude API with streaming
│   └── index.ts          # Provider exports
├── agent/
│   ├── loop.ts           # THINK-ACT-OBSERVE cycle, parallel execution
│   ├── correction.ts     # Course correction detection
│   └── index.ts          # Agent exports
├── prompt/
│   ├── system.ts         # Dynamic system prompt builder
│   ├── guidance.ts       # AGENTS.md discovery
│   └── index.ts          # Prompt exports
├── session/
│   ├── persistence.ts    # Thread save/load
│   └── index.ts          # Session exports
├── cli/
│   ├── run.ts            # Run modes (prompt, interactive, tui)
│   └── index.ts          # CLI exports
└── ui/
    ├── App.tsx           # OpenTUI React TUI component
    └── index.ts          # UI exports

tests/
├── tools.test.ts              # Core tool tests
├── agent.test.ts              # Thread management and prompt tests
├── subagent.test.ts           # Subagent system tests
├── permission.test.ts         # Permission system tests
├── execution-profiles.test.ts # Resource batching tests
├── file-state.test.ts         # File state tracking tests
├── skill-discovery.test.ts    # Skill discovery tests
└── e2e.test.ts                # End-to-end tests
```

## Architecture

### Core Concepts

- **Thread**: A conversation with versioned messages, persisted to disk
- **Message**: User or assistant message containing content blocks
- **ContentBlock**: Text, ToolUse, ToolResult, or Summary
- **Tool**: Definition (spec) + execution function + optional execution profile

### Agent Loop

```
1. User message added to thread
2. Stream response from Claude
3. Handle content blocks:
   - Text -> emit via callback
   - ToolUse -> queue for execution
4. Batch tools by resource conflicts
5. Execute batches (parallel within, sequential between)
6. Add tool results to thread
7. If stop_reason === "tool_use", loop back to step 2
8. If stop_reason === "end_turn", done
```

### System Prompt Assembly

- `buildSystemPrompt` injects environment info, tool list, and core rules
- `AGENTS.md` or `CLAUDE.md` (prefers `AGENTS.md`) is embedded as `<guidance_file>`
- Discovered skills are embedded as `<discovered_skills>` blocks (see Skill System)

### Tool Execution Profiles

Tools can declare resource locks for safe parallel execution:

```typescript
executionProfile: {
  resourceKeys: (input) => [{ key: input.path, mode: "write" }]
}
```

- Multiple **read** locks on the same resource can run in parallel
- **Write** locks serialize access (no concurrent writes to same file)
- Resource keys use the raw `path` input (not normalized), so mixing absolute and relative paths can bypass conflict detection

### File State Tracking

The system tracks file mtimes to detect external modifications:

- `recordFileRead(path, threadId)` - Records when a file was read
- `checkFileConflict(path, threadId)` - Detects if file changed since read
- Edit tool blocks writes if file was modified externally

## Code Style

- **TypeScript strict mode** - No `as any`, no `@ts-ignore`
- **Functional style** - Pure functions where possible
- **Explicit error handling** - Return error results, don't throw
- **Bun runtime** - Use `bun:test`, Bun APIs
- **ESModule format** - `"type": "module"` in package.json

### Naming Conventions

- Files: `kebab-case.ts`
- Types/Interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Tool names: `PascalCase` (Read, Edit, Bash, Grep, Glob)

## Tools

### Core Tools

| Tool | Description | Resource Mode |
|------|-------------|---------------|
| Read | Read file with line numbers | read |
| Edit | String replacement editing | write |
| Write | Create new files | write |
| Delete | Delete files/directories | write |
| Bash | Execute shell commands | - |
| Grep | Search file contents (ripgrep) | - |
| Glob | Find files by pattern | - |

### Subagent Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| Task | Fire-and-forget executor | Multi-step implementations, refactors |
| Finder | Fast code search | Find code matching conceptual descriptions |
| Oracle | Expert advisor | Architecture decisions, code review, debugging |
| Painter | Frontend specialist | UI/UX implementation |
| Librarian | Repository explorer | GitHub exploration, documentation |
| Kraken | Bulk transformer | Large-scale code modifications |

### Planning Tools

| Tool | Description |
|------|-------------|
| TodoWrite | Update task list |
| TodoRead | Read current tasks |
| ReadPlan | Read plan artifact |
| EditPlan | Edit plan artifact |
| ReadArtifact | Read named artifact |
| EditArtifact | Edit named artifact |

### Utility Tools

| Tool | Description |
|------|-------------|
| WebFetch | Fetch and read web pages |
| WebSearch | Search the web (Tavily/Serper/DuckDuckGo) |
| LookAt | Analyze images or PDFs |
| Mermaid | Render diagrams to SVG/PNG |
| ReadThread | Read conversation history |

### GitHub Tools

| Tool | Description |
|------|-------------|
| ReadGitHubFile | Read file from GitHub repository |
| SearchGitHubCode | Search for code patterns |
| SearchGitHubCommits | Search commit history |
| GetGitHubDiff | Get diff between refs |
| FindGitHubFiles | Find files by pattern |

Note: `registerBuiltinTools()` must run before building the system prompt or starting an agent loop so tool specs are available.

### Tool Behavior Notes

- `Read`: `offset` is 0-based, output line numbers are 1-based; default limit 2000 lines
- `Edit`: exact, unique match required; `create_if_missing` only works with `old_str=""`
- `Write`: overwrites existing files; creates parent directories
- `Delete`: requires `recursive: true` for directories
- `Grep`/`Glob`: rely on `rg`; results capped (default 100); `Glob` order is not guaranteed
- `Bash`: non-interactive shell, 120s default timeout, output truncated to last 100k chars; use `cwd`
- `WebFetch`: 30s timeout; HTML stripped unless `raw`; output truncated to 10k chars
- `WebSearch`: uses `TAVILY_API_KEY` or `SERPER_API_KEY`, falls back to DuckDuckGo
- GitHub tools: use `gh` CLI and require GitHub auth
- `TodoWrite`/`TodoRead`: in-memory per process (cleared on exit)
- `LookAt`: returns base64 for images/PDFs (no vision model analysis)
- `Mermaid`: requires `mmdc` from `@mermaid-js/mermaid-cli`

## Subagent System

Subagents run in isolated loops with limited tool access:

### Task
- **Purpose**: Execute multi-step implementations autonomously
- **Tools**: Read, Edit, Write, Bash, Grep, Glob, TodoWrite, TodoRead
- **Max turns**: 20

### Finder
- **Purpose**: Fast parallel code search
- **Tools**: Read, Grep, Glob
- **Max turns**: 10

### Oracle
- **Purpose**: Expert technical guidance
- **Tools**: Read, Grep, Glob
- **Max turns**: 5

### Painter
- **Purpose**: Frontend development
- **Tools**: Read, Edit, Write, Bash, Grep, Glob, TodoWrite, TodoRead
- **Max turns**: 20

### Librarian
- **Purpose**: Repository exploration and documentation
- **Tools**: Read, Grep, Glob, Bash, GitHub tools, Mermaid
- **Max turns**: 15

### Kraken
Two-phase bulk transformation:

**Scope Phase** (identifies files):
- **Tools**: Read, Grep, Glob
- **Max turns**: 10

**Executor Phase** (applies changes):
- **Tools**: Read, Edit, Write, Grep, Glob
- **Max turns**: 15

## Skill System

Skills are markdown files discovered from:

1. `.agents/skills/` (project-local)
2. `.claude/skills/` (project-local)
3. `~/.claude/skills/` (global)
4. `~/.claude/plugins/cache/` (global plugins)

Parsing notes:
- Frontmatter parsing is minimal (simple `key: value` lines only)
- Supported keys: `name`, `description`, `tags`, `isolatedContext`
- Skills are deduped by name, preferring local dirs before global ones

### Skill Format

```markdown
---
name: my-skill
description: What this skill does
tags: [tag1, tag2]
isolatedContext: false
---

Skill instructions go here...
```

Skills with `isolatedContext: true` are excluded from prompt injection.

## Permission System

Permissions are evaluated in order (first match wins):

```typescript
// Examples of built-in rules
{ tool: "Bash", action: "ask", matches: { command: "*git*push*" } }
{ tool: "Bash", action: "ask", matches: { command: "*rm*-rf*" } }
{ tool: "Bash", action: "allow", matches: { command: "npm run *" } }
{ tool: "Read", action: "allow" }
{ tool: "Edit", action: "allow" }
{ tool: "Delete", action: "ask" }
```

Actions:
- `allow` - Execute without asking
- `ask` - Prompt user for approval
- `reject` - Block execution

## Runtime Modes & Permissions

- `--prompt` (non-interactive): `ask` rules auto-deny unless `--yolo` is set
- `--interactive`: `ask` rules prompt via readline
- `--tui`: `ask` rules auto-reject (TUI does not prompt)
- Rule matching is glob-based and case-insensitive; custom rules are evaluated before built-ins

## Context Management

### Token Tracking

Estimates tokens from text length (chars / 4) to manage context window.

### Auto-Summarization

When context exceeds limit:
1. Keep last 10 messages (default)
2. Summarize older messages via the Anthropic provider
3. Replace with a single `summary` content block

Defaults:
- Context limit: ~150k estimated tokens

### Course Correction

Detects repeated failures or loops and injects correction messages.
Triggered every 3 turns, including:
- Repeated failures of the same tool
- Consecutive failures across tools
- Repeating tool-call patterns

## Session Persistence

Threads persist to `~/.coding-agent/sessions/{thread-id}.json`.
Active threads are cached in-memory so tools like `ReadPlan`/`EditPlan` and `ReadArtifact`/`EditArtifact` can access the current thread before it is saved to disk.

```typescript
createThread(workingDirectory: string): Thread
saveThread(thread: Thread): Promise<void>
loadThread(threadId: string): Promise<Thread | null>
listThreads(): Promise<{ id: string; title?: string; updatedAt: number }[]>
getLatestThread(): Promise<Thread | null>
```

Runtime behavior:
- `--prompt`: saves the thread after the run completes
- `--interactive`: saves the thread on exit
- `--tui`: saves after each submitted prompt

## Adding a New Tool

1. Create `src/tools/{name}.ts`:

```typescript
import type { Tool, ToolContext, ToolResult, ExecutionProfile } from "../core/types"

const executionProfile: ExecutionProfile = {
  resourceKeys: (input) => {
    const path = input.path as string | undefined
    if (path) {
      return [{ key: path, mode: "write" }]
    }
    return []
  },
}

export const myTool: Tool = {
  spec: {
    name: "MyTool",
    description: "What it does",
    inputSchema: {
      type: "object",
      properties: {
        arg1: { type: "string", description: "..." }
      },
      required: ["arg1"]
    }
  },
  executionProfile,
  async execute(input, context): Promise<ToolResult> {
    return { output: "result" }
  }
}
```

2. Register in `src/tools/index.ts`:

```typescript
import { myTool } from "./my-tool"
registerTool(myTool)
```

3. Add permission rule in `src/permission/rules.ts`:

```typescript
{ tool: "MyTool", action: "allow" }
```

4. Add tests in `tests/tools.test.ts`

## Running the Agent

```bash
# One-shot execution
bun run src/index.ts --prompt "List files in src/" --debug

# Interactive REPL
bun run src/index.ts --interactive

# TUI mode
bun run src/index.ts --tui

# With custom model
bun run src/index.ts --prompt "task" --model claude-opus-4-5-20251101

# YOLO mode (auto-approve all permissions)
bun run src/index.ts --prompt "task" --yolo
```

Notes:
- `--debug` streams text and tool previews; without it, only the final assistant text is printed
- `--yolo` only affects non-interactive runs; TUI still auto-rejects permission prompts

## Environment

- **Runtime**: Bun
- **Language**: TypeScript (strict)
- **Model**: Claude Opus 4.5 (claude-opus-4-5-20251101)
- **API**: Anthropic SDK with streaming
- **Testing**: bun:test

## Environment Variables

- `ANTHROPIC_API_KEY` - required to run the agent
- `TAVILY_API_KEY` / `SERPER_API_KEY` - optional, improves `WebSearch`

## Dependencies

- `@anthropic-ai/sdk` - Claude API
- `yargs` - CLI argument parsing
- `zod` - Schema validation
- `ulid` - Thread ID generation
- `react` - TUI component model
- `@opentui/react` - Terminal UI
- `@opentui/core` - Terminal UI core
