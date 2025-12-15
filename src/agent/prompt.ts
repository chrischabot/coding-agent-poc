import { getCoreRules } from "../layer/core.js";
import { getSafetyRules } from "../layer/safety.js";
import {
  formatWorkingMemory,
  type WorkingMemoryState,
} from "../layer/working.js";
import { toolRegistry } from "../tool/registry.js";

/**
 * Assemble the complete system prompt from all three layers
 */
export function assembleSystemPrompt(
  workingMemory: WorkingMemoryState
): string {
  // Layer 1: Core Rules (immutable)
  const coreRules = getCoreRules(toolRegistry.getToolDescriptions());

  // Layer 2: Safety Rules (immutable)
  const safetyRules = getSafetyRules();

  // Layer 3: Working Memory (mutable)
  const workingMemorySection = formatWorkingMemory(workingMemory);

  // Combine all layers
  return `${coreRules}

---

${safetyRules}

---

${workingMemorySection}
`;
}

/**
 * Format a user message with context
 */
export function formatUserMessage(
  message: string,
  context?: { workingDirectory: string }
): string {
  let formatted = message;

  if (context?.workingDirectory) {
    formatted = `[Working Directory: ${context.workingDirectory}]\n\n${formatted}`;
  }

  return formatted;
}

/**
 * Format tool result for inclusion in conversation
 */
export function formatToolResultMessage(
  toolName: string,
  result: { title: string; output: string; error?: boolean }
): string {
  const status = result.error ? "ERROR" : "SUCCESS";
  return `Tool: ${toolName}
Status: ${status}
Title: ${result.title}

${result.output}`;
}

/**
 * Build a summary prompt for memory compaction
 */
export function buildCompactionPrompt(
  observations: string[],
  maxBullets: number = 3
): string {
  return `Summarize the following observations into ${maxBullets} concise bullet points that capture the most important information:

${observations.join("\n\n")}

Output only the bullet points, nothing else.`;
}
