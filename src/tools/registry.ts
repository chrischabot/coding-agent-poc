import type { Tool, ToolSpec } from "../core/types"

class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

  register(tool: Tool): void {
    this.tools.set(tool.spec.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values())
  }

  getAllSpecs(): ToolSpec[] {
    return this.getAll().map((t) => t.spec)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }
}

export const registry = new ToolRegistry()

export function registerTool(tool: Tool): void {
  registry.register(tool)
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name)
}

export function getAllTools(): Tool[] {
  return registry.getAll()
}

export function getAllToolSpecs(): ToolSpec[] {
  return registry.getAllSpecs()
}
