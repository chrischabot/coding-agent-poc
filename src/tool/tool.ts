import { z } from "zod";

/**
 * Execution context passed to every tool
 */
export interface ToolContext {
  sessionId: string;
  messageId: string;
  workingDirectory: string;
  yoloMode: boolean;
}

/**
 * Result returned by tool execution
 */
export interface ToolResult {
  /** Short title for display */
  title: string;
  /** Main output content */
  output: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Whether the tool execution failed */
  error?: boolean;
}

/**
 * Base tool interface for registry storage (type-erased parameters)
 */
export interface BaseTool {
  /** Unique tool name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Zod schema for parameters */
  parameters: z.ZodTypeAny;
  /** Execute the tool with any parameters */
  execute: (params: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

/**
 * Typed tool definition interface
 */
export interface Tool<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Unique tool name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Zod schema for parameters */
  parameters: TParams;
  /** Execute the tool */
  execute: (
    params: z.infer<TParams>,
    ctx: ToolContext
  ) => Promise<ToolResult>;
}

/**
 * Helper to define a tool with proper typing
 */
export function defineTool<TParams extends z.ZodTypeAny>(
  name: string,
  config: {
    description: string;
    parameters: TParams;
    execute: (params: z.infer<TParams>, ctx: ToolContext) => Promise<ToolResult>;
  }
): BaseTool {
  return {
    name,
    description: config.description,
    parameters: config.parameters,
    execute: config.execute as (params: unknown, ctx: ToolContext) => Promise<ToolResult>,
  };
}

/**
 * Format a tool result for display
 */
export function formatToolResult(result: ToolResult): string {
  const status = result.error ? "✗" : "✓";
  let output = `${status} ${result.title}\n`;

  if (result.output) {
    // Indent the output
    const lines = result.output.split("\n");
    const truncated = lines.slice(0, 50);
    output += truncated.map((l) => `  ${l}`).join("\n");
    if (lines.length > 50) {
      output += `\n  ... (${lines.length - 50} more lines)`;
    }
  }

  return output;
}
