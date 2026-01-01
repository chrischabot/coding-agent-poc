import type { Tool, ToolResult } from "../core/types"
import { loadThread, saveThread } from "../session/persistence"

const DEFAULT_PLAN = `# Plan

## Objective
[What are we trying to accomplish?]

## Tasks
- [ ] Task 1
- [ ] Task 2

## Notes
[Any important context or decisions]
`

export const readPlanTool: Tool = {
  spec: {
    name: "ReadPlan",
    description: `Read the current plan artifact for this thread.

The plan is a markdown document that tracks:
- The overall objective
- Task breakdown
- Important notes and decisions

Use this to review the current plan before making changes.`,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  async execute(_input, context): Promise<ToolResult> {
    try {
      const thread = await loadThread(context.threadId)
      if (!thread) {
        return { output: DEFAULT_PLAN, isError: false }
      }
      const plan = thread.artifacts?.plan ?? DEFAULT_PLAN

      return {
        output: plan,
        isError: false,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Failed to read plan: ${message}`, isError: true }
    }
  },
}

export const editPlanTool: Tool = {
  spec: {
    name: "EditPlan",
    description: `Edit the plan artifact for this thread.

Use this to update the plan with:
- New tasks or completed tasks
- Revised objectives
- Important notes or decisions

You can either replace the entire plan or make targeted edits.`,
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The new plan content (replaces entire plan)",
        },
        old_str: {
          type: "string",
          description: "Text to find in the existing plan (for targeted edits)",
        },
        new_str: {
          type: "string",
          description: "Text to replace old_str with",
        },
      },
      required: [],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const content = input.content as string | undefined
    const oldStr = input.old_str as string | undefined
    const newStr = input.new_str as string | undefined

    try {
      const thread = await loadThread(context.threadId)
      if (!thread) {
        return { output: "Thread not found", isError: true }
      }

      let plan = thread.artifacts?.plan ?? DEFAULT_PLAN

      if (content) {
        plan = content
      } else if (oldStr !== undefined && newStr !== undefined) {
        if (!plan.includes(oldStr)) {
          return {
            output: `Edit failed: could not find "${oldStr.slice(0, 50)}..." in plan`,
            isError: true,
          }
        }
        const matches = plan.split(oldStr).length - 1
        if (matches > 1) {
          return {
            output: `Edit failed: found ${matches} occurrences of the text. Please provide more context for a unique match.`,
            isError: true,
          }
        }
        plan = plan.replace(oldStr, newStr)
      } else {
        return {
          output: "Edit failed: provide either 'content' (full replacement) or both 'old_str' and 'new_str' (targeted edit)",
          isError: true,
        }
      }

      thread.artifacts = thread.artifacts ?? {}
      thread.artifacts.plan = plan
      thread.updatedAt = Date.now()

      await saveThread(thread)

      return {
        output: `Plan updated successfully.\n\n${plan}`,
        isError: false,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Failed to edit plan: ${message}`, isError: true }
    }
  },
}

export const readArtifactTool: Tool = {
  spec: {
    name: "ReadArtifact",
    description: `Read a custom artifact by name.

Artifacts are named documents stored with the thread that persist across turns.`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the artifact to read",
        },
      },
      required: ["name"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const name = input.name as string

    try {
      const thread = await loadThread(context.threadId)
      if (!thread) {
        return { output: `Artifact "${name}" not found`, isError: true }
      }

      const artifact = thread.artifacts?.custom?.[name]

      if (!artifact) {
        return {
          output: `Artifact "${name}" not found`,
          isError: true,
        }
      }

      return {
        output: artifact,
        isError: false,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Failed to read artifact: ${message}`, isError: true }
    }
  },
}

export const editArtifactTool: Tool = {
  spec: {
    name: "EditArtifact",
    description: `Create or update a custom artifact.

Artifacts are named documents stored with the thread that persist across turns.`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the artifact",
        },
        content: {
          type: "string",
          description: "Content to store",
        },
      },
      required: ["name", "content"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const name = input.name as string
    const content = input.content as string

    try {
      const thread = await loadThread(context.threadId)
      if (!thread) {
        return { output: "Thread not found", isError: true }
      }

      thread.artifacts = thread.artifacts ?? {}
      thread.artifacts.custom = thread.artifacts.custom ?? {}
      thread.artifacts.custom[name] = content
      thread.updatedAt = Date.now()

      await saveThread(thread)

      return {
        output: `Artifact "${name}" saved (${content.length} chars)`,
        isError: false,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Failed to edit artifact: ${message}`, isError: true }
    }
  },
}
