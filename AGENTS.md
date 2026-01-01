# AGENTS.md - Coding Agent

A coding agent CLI to study how AI coding assistants work. Built with Bun, TypeScript, and the Anthropic SDK.

## Commands

```bash
# Install dependencies
bun install

# Run tests (153 unit tests)
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

## Project Structure

```
src/
├── index.ts              # CLI entry point (yargs-based)
├── core/
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
│   └── thread.ts         # ReadThread for conversation history
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
│   ├── tokens.ts         # Token estimation
│   └── file-state.ts     # File modification tracking
├── permission/
│   ├── types.ts          # Permission types
│   ├── rules.ts          # Built-in permission rules
│   └── checker.ts        # Permission evaluation
├── provider/
│   └── anthropic.ts      # Claude API with streaming
├── agent/
│   ├── loop.ts           # THINK-ACT-OBSERVE cycle, parallel execution
│   └── correction.ts     # Course correction detection
├── prompt/
│   ├── system.ts         # Dynamic system prompt builder
│   └── guidance.ts       # AGENTS.md discovery
├── session/
│   └── persistence.ts    # Thread save/load
├── cli/
│   └── run.ts            # Run modes (prompt, interactive, tui)
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

### Tool Execution Profiles

Tools can declare resource locks for safe parallel execution:

```typescript
executionProfile: {
  resourceKeys: (input) => [{ key: input.path, mode: "write" }]
}
```

- Multiple **read** locks on the same resource can run in parallel
- **Write** locks serialize access (no concurrent writes to same file)

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

## Context Management

### Token Tracking

Estimates tokens from text length (chars / 4) to manage context window.

### Auto-Summarization

When context exceeds limit:
1. Keep last N messages
2. Summarize older messages
3. Replace with summary block

### Course Correction

Detects repeated failures or loops and injects correction messages.

## Session Persistence

Threads persist to `~/.coding-agent/sessions/{thread-id}.json`.

```typescript
createThread(workingDirectory: string): Thread
saveThread(thread: Thread): Promise<void>
loadThread(threadId: string): Promise<Thread>
listSessions(): Promise<string[]>
```

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
bun run src/index.ts --prompt "task" --model claude-sonnet-4-20250514

# YOLO mode (auto-approve all permissions)
bun run src/index.ts --prompt "task" --yolo
```

## Environment

- **Runtime**: Bun
- **Language**: TypeScript (strict)
- **Model**: Claude Sonnet 4 (claude-sonnet-4-20250514)
- **API**: Anthropic SDK with streaming
- **Testing**: bun:test (153 tests)

## Dependencies

- `@anthropic-ai/sdk` - Claude API
- `yargs` - CLI argument parsing
- `zod` - Schema validation
- `ulid` - Thread ID generation
- `@opentui/react` - Terminal UI
- `@opentui/core` - Terminal UI core
