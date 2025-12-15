# Coding Agent

A simple coding agent CLI to study how AI coding assistants work.

## Architecture

**Two-Tier Model Strategy**:
- **Fast Model** (`gpt-5-mini`): Drives the main loop, makes quick decisions
- **Deep Model** (`gpt-5.1-codex-max`): Handles complex reasoning via `deep_work` tool

**Minimal Toolset** (reduces context bloat):
- `read_file` - Read file contents
- `write_file` - Write files with diff preview and approval
- `search` - Code search via ripgrep
- `bash` - Shell commands with safety guards
- `webfetch` - Fetch and parse web content
- `deep_work` - Delegate complex tasks to deep model

## The Loop

```
THINK → ACT → OBSERVE → UPDATE
```

1. **THINK**: Assemble 3-layer prompt (core rules + safety rules + working memory), call fast model
2. **ACT**: Execute tool if requested
3. **OBSERVE**: Capture tool output
4. **UPDATE**: Prune completed steps, summarize observations, validate plan

Memory discipline prevents context bloat: observations are summarized to 1-3 bullets, completed plan steps are removed immediately.

## Usage

```bash
# Install dependencies
bun install

# Run interactively
bun run src/index.ts run

# Run with initial task
bun run src/index.ts run "Create a hello world script"

# YOLO mode (skip approvals)
bun run src/index.ts run --yolo

# Resume session
bun run src/index.ts run --session <id>
```

## License

MIT
