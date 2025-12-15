import { tool as aiTool, type CoreTool } from "ai";
import { z } from "zod";
import type { BaseTool, ToolContext, ToolResult } from "./tool.js";

// Import all tools
import { readFileTool } from "./read_file.js";
import { writeFileTool } from "./write_file.js";
import { searchTool } from "./search.js";
import { bashTool } from "./bash.js";
import { webfetchTool } from "./webfetch.js";
import { deepWorkTool } from "./deep_work.js";

/**
 * All available tools
 */
const ALL_TOOLS: BaseTool[] = [
  readFileTool,
  writeFileTool,
  searchTool,
  bashTool,
  webfetchTool,
  deepWorkTool,
];

/**
 * Tool registry for managing and executing tools
 */
export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  constructor() {
    for (const tool of ALL_TOOLS) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Get a tool by name
   */
  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tool names
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool by name
   */
  async execute(
    name: string,
    params: unknown,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        title: `Unknown tool: ${name}`,
        output: `Tool '${name}' is not available. Available tools: ${this.getNames().join(", ")}`,
        error: true,
      };
    }

    try {
      // Validate parameters
      const validated = tool.parameters.parse(params);
      // Execute the tool
      return await tool.execute(validated, ctx);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          title: `Invalid parameters for ${name}`,
          output: error.errors
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join("\n"),
          error: true,
        };
      }
      return {
        title: `Error in ${name}`,
        output: error instanceof Error ? error.message : String(error),
        error: true,
      };
    }
  }

  /**
   * Convert tools to AI SDK format for use with generateText/streamText
   */
  toAITools(ctx: ToolContext): Record<string, CoreTool> {
    const aiTools: Record<string, CoreTool> = {};

    for (const [name, tool] of this.tools) {
      aiTools[name] = aiTool({
        description: tool.description,
        parameters: tool.parameters,
        execute: async (params) => {
          const result = await this.execute(name, params, ctx);
          // Return as string for the model
          return JSON.stringify(result);
        },
      });
    }

    return aiTools;
  }

  /**
   * Get tool descriptions for the system prompt
   */
  getToolDescriptions(): string {
    const descriptions: string[] = [];
    for (const tool of this.tools.values()) {
      descriptions.push(`- ${tool.name}: ${tool.description}`);
    }
    return descriptions.join("\n");
  }
}

/**
 * Global tool registry instance
 */
export const toolRegistry = new ToolRegistry();
