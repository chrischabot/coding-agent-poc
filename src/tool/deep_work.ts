import { z } from "zod";
import { defineTool } from "./tool.js";
import { getDeepModel } from "../model/provider.js";
import { generateText } from "ai";

export const deepWorkTool = defineTool("deep_work", {
  description: `Delegate a complex task to a more powerful model (gpt-5.1-codex-max). Use this for:
- Non-trivial planning and decomposition
- Complex refactors requiring multi-file understanding
- Large code changes spanning many files
- Hard debugging and multi-file reasoning
- Writing high-quality patches and comprehensive tests

The deep model has more reasoning capacity but is slower and more expensive.`,
  parameters: z.object({
    task: z.string().describe("Clear description of the complex task to perform"),
    context: z
      .string()
      .describe(
        "Relevant context: file contents, error messages, constraints, requirements"
      ),
  }),
  async execute(params, ctx) {
    try {
      const deepModel = getDeepModel();

      // Build the prompt for the deep model
      const systemPrompt = `You are a senior software engineer assisting with a complex coding task.
You have deep expertise in software architecture, debugging, and writing high-quality code.

Your response should be:
- Thorough and well-reasoned
- Directly actionable
- Include specific code when appropriate

Think step by step about the problem before providing your solution.`;

      const userPrompt = `## Task
${params.task}

## Context
${params.context}

Please provide a detailed solution or analysis.`;

      // Call the deep model
      const result = await generateText({
        model: deepModel,
        system: systemPrompt,
        prompt: userPrompt,
        maxTokens: 8000,
      });

      return {
        title: `Deep work: ${params.task.slice(0, 50)}...`,
        output: result.text,
        metadata: {
          model: "gpt-5.1-codex-max",
          inputTokens: result.usage?.promptTokens,
          outputTokens: result.usage?.completionTokens,
        },
      };
    } catch (error) {
      return {
        title: `Deep work: ${params.task.slice(0, 50)}...`,
        output: `Error during deep work: ${error instanceof Error ? error.message : String(error)}`,
        error: true,
      };
    }
  },
});
