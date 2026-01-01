# Coding Agent

A coding agent CLI to study how AI coding assistants work. Built with Bun, TypeScript, and the Anthropic SDK.

## Features

- **Multi-tool agent loop** with parallel execution and resource-based batching
- **6 specialized subagents** for delegation (Task, Finder, Oracle, Painter, Librarian, Kraken)
- **Permission system** with allow/ask/reject rules and glob pattern matching
- **Session persistence** with automatic context summarization
- **Skill system** for loading custom instructions from `.agents/skills/`
- **File state tracking** to detect external modifications
- **Course correction** to detect and recover from repeated failures

## Quick Start

```bash
# Install dependencies
bun install

# Run with a prompt (debug mode)
bun run src/index.ts --prompt "List all TypeScript files" --debug

# Interactive mode (readline)
bun run src/index.ts --interactive

# TUI mode (OpenTUI interface)
bun run src/index.ts --tui
```

## Architecture

### Agent Loop

The agent runs a single THINK-ACT-OBSERVE loop:

```
1. User message added to thread
2. Stream response from Claude
3. Handle content blocks:
   - Text -> display to user
   - ToolUse -> queue for execution
4. Execute tools (parallel with resource batching)
5. Add tool results to thread
6. Loop until stop_reason === "end_turn"
```

### Tool Execution

Tools declare **execution profiles** with resource keys for safe parallel execution:

- **Read mode**: Multiple reads can run in parallel
- **Write mode**: Write conflicts are serialized

Example: `Read(A) + Read(A) + Write(B)` run in parallel, but `Write(A)` waits.

### Subagent Delegation

The main agent can delegate to specialized subagents:

| Subagent | Purpose | Tools |
|----------|---------|-------|
| **Task** | Fire-and-forget multi-step execution | Read, Edit, Write, Bash, Grep, Glob, Todo |
| **Finder** | Fast parallel code search | Read, Grep, Glob |
| **Oracle** | Expert technical advisor | Read, Grep, Glob |
| **Painter** | Frontend/UI specialist | Read, Edit, Write, Bash, Grep, Glob, Todo |
| **Librarian** | GitHub exploration, documentation | Read, Grep, Glob, Bash, GitHub tools, Mermaid |
| **Kraken** | Bulk code transformations (2-phase) | Scope: Read, Grep, Glob / Executor: Read, Edit, Write |

## Tools

### Core Tools

| Tool | Description |
|------|-------------|
| **Read** | Read file with line numbers |
| **Edit** | String replacement editing |
| **Write** | Create new files |
| **Delete** | Delete files/directories |
| **Bash** | Execute shell commands |
| **Grep** | Search file contents (ripgrep) |
| **Glob** | Find files by pattern |

### Subagent Tools

| Tool | Description |
|------|-------------|
| **Task** | Delegate multi-step implementation |
| **Finder** | Conceptual code search |
| **Oracle** | Architecture advice, code review |
| **Painter** | Frontend development |
| **Librarian** | Repository exploration |
| **Kraken** | Bulk transformations |

### Planning Tools

| Tool | Description |
|------|-------------|
| **TodoWrite/TodoRead** | Task tracking |
| **ReadPlan/EditPlan** | Plan artifact management |
| **ReadArtifact/EditArtifact** | Custom artifact storage |

### Utility Tools

| Tool | Description |
|------|-------------|
| **WebFetch** | Fetch web pages |
| **WebSearch** | Web search (Tavily/Serper/DuckDuckGo) |
| **LookAt** | Analyze images/PDFs |
| **Mermaid** | Render diagrams |
| **ReadThread** | Read conversation history |

### GitHub Tools

| Tool | Description |
|------|-------------|
| **ReadGitHubFile** | Read file from GitHub |
| **SearchGitHubCode** | Search code patterns |
| **SearchGitHubCommits** | Search commit history |
| **GetGitHubDiff** | Compare branches/commits |
| **FindGitHubFiles** | Find files by pattern |

## Skills

Skills are markdown files with instructions loaded from:

- `.agents/skills/` (project-local)
- `.claude/skills/` (project-local)
- `~/.claude/skills/` (global)
- `~/.claude/plugins/cache/` (global plugins)

Skills with `isolatedContext: true` in frontmatter are excluded from injection.

## Permission System

Permissions are evaluated in order (first match wins):

```typescript
// Built-in rules
{ tool: "Bash", action: "ask", matches: { command: "*git*push*" } }
{ tool: "Bash", action: "allow", matches: { command: "npm run *" } }
{ tool: "Read", action: "allow" }
{ tool: "Delete", action: "ask" }
```

Actions: `allow`, `ask` (prompt user), `reject`

## Development

```bash
# Run tests (153 tests)
bun test

# Type check
bun run typecheck

# Build
bun run build
```

### Project Structure

```
src/
  agent/       # Agent loop, course correction
  cli/         # CLI entry and run modes
  context/     # Token tracking, file state
  core/        # Type definitions
  permission/  # Permission rules and checker
  prompt/      # System prompt builder
  provider/    # Anthropic API client
  session/     # Thread persistence
  skill/       # Skill discovery
  subagent/    # Subagent configs and runner
  tools/       # All tool implementations
  ui/          # OpenTUI React components
```

## Environment

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Model**: Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- **API**: Anthropic SDK with streaming

## License

MIT
