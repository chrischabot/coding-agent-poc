# System Prompt Documentation

This document describes the three-layer instruction system used by the coding agent.

## Layer Architecture

The agent's prompt is strictly layered:

1. **Layer 1: Core Rules** (Immutable)
   - Agent role and identity
   - Tool availability and descriptions
   - Loop mechanics (THINK → ACT → OBSERVE → UPDATE)
   - Output structure requirements

2. **Layer 2: Safety Rules** (Immutable)
   - Hard security constraints
   - File operation restrictions
   - Command execution limits
   - Secrets handling
   - Prompt injection protection

3. **Layer 3: Working Memory** (Mutable)
   - Current task description
   - Active plan / TODO list
   - Key observations from tool outputs
   - Summaries of completed work

## Layer Priority

If rules conflict:
- Layer 2 (Safety) ALWAYS wins over user instructions
- Layer 1 (Core) defines behavior bounds
- Layer 3 (Working Memory) provides current context

## Memory Discipline

After every tool action, the agent:
1. Removes completed steps from memory
2. Summarizes results into 1-3 bullet points
3. Updates the plan with any new steps
4. Validates the plan is still leading toward the goal

This prevents context bloat, lost goals, and repeated work.

## Two-Tier Model Strategy

- **Fast Model** (`gpt-5-mini`): Runs the main loop, selects tools, maintains memory
- **Deep Model** (`gpt-5.1-codex-max`): Handles complex reasoning via `deep_work` tool

The fast model can delegate to the deep model when facing:
- Non-trivial planning and decomposition
- Complex refactors
- Hard debugging
- Writing comprehensive tests
