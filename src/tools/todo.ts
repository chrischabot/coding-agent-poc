import type { Tool, ToolContext, ToolResult, TodoItem } from "../core/types"

const todoStore = new Map<string, TodoItem[]>()

function getTodos(threadId: string): TodoItem[] {
  return todoStore.get(threadId) ?? []
}

function setTodos(threadId: string, todos: TodoItem[]): void {
  todoStore.set(threadId, todos)
}

function formatTodos(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return "No todos."
  }

  const lines = todos.map((t) => {
    const statusIcon =
      t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]"
    return `${statusIcon} ${t.id}: ${t.content}`
  })

  return lines.join("\n")
}

export const todoWriteTool: Tool = {
  spec: {
    name: "TodoWrite",
    description: `Update the todo list to track progress on tasks.

Use this to:
- Create new todos when starting a multi-step task
- Mark todos as in_progress when you start working on them
- Mark todos as completed when done

Status values: "pending", "in_progress", "completed"

Guidelines:
- Create todos BEFORE starting work
- Only have ONE todo in_progress at a time
- Mark completed IMMEDIATELY after finishing (don't batch)`,
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The complete updated todo list",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique identifier" },
              content: { type: "string", description: "Task description" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Current status",
              },
            },
            required: ["id", "content", "status"],
          },
        },
      },
      required: ["todos"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const todos = input.todos as TodoItem[]

    if (!Array.isArray(todos)) {
      return { output: "Error: todos must be an array", isError: true }
    }

    for (const todo of todos) {
      if (!todo.id || !todo.content || !todo.status) {
        return { output: "Error: each todo must have id, content, and status", isError: true }
      }
      if (!["pending", "in_progress", "completed"].includes(todo.status)) {
        return { output: `Error: invalid status "${todo.status}"`, isError: true }
      }
    }

    setTodos(context.threadId, todos)

    return { output: `Updated ${todos.length} todo(s):\n${formatTodos(todos)}` }
  },
}

export const todoReadTool: Tool = {
  spec: {
    name: "TodoRead",
    description: "Read the current todo list to see task progress.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  async execute(_input, context): Promise<ToolResult> {
    const todos = getTodos(context.threadId)
    return { output: formatTodos(todos) }
  },
}

export function clearTodos(threadId: string): void {
  todoStore.delete(threadId)
}

export function getTodosForThread(threadId: string): TodoItem[] {
  return getTodos(threadId)
}
