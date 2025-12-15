import { generateText } from "ai";
import { getFastModel } from "../model/provider.js";
import {
  type WorkingMemoryState,
  addObservation,
  pruneCompletedItems,
} from "../layer/working.js";
import { buildCompactionPrompt } from "./prompt.js";

/**
 * Options for updating memory after a tool execution
 */
export interface MemoryUpdateOptions {
  /** Tool name that was executed */
  toolName: string;
  /** Tool result output */
  toolOutput: string;
  /** Whether the tool failed */
  toolError: boolean;
  /** Model's thinking/explanation before the tool call */
  modelThinking?: string;
}

/**
 * Update working memory after a tool execution
 * Implements the memory discipline from mini-SWE-agent:
 * 1. Remove completed steps
 * 2. Summarize results into 1-3 bullet points
 * 3. Update the plan
 * 4. Validate the plan
 */
export async function updateMemory(
  state: WorkingMemoryState,
  options: MemoryUpdateOptions
): Promise<WorkingMemoryState> {
  let newState = { ...state };

  // 1. Create observation from tool output
  const observation = createObservation(options);
  newState = addObservation(newState, observation);

  // 2. Prune completed items from plan
  newState = pruneCompletedItems(newState);

  // 3. If observations are getting long, compact them
  if (newState.observations.length >= 8) {
    newState = await compactObservations(newState);
  }

  return newState;
}

/**
 * Create an observation string from tool output
 */
function createObservation(options: MemoryUpdateOptions): string {
  const status = options.toolError ? "✗" : "✓";
  const prefix = `[${status} ${options.toolName}]`;

  // Truncate long outputs
  const maxLength = 500;
  let output = options.toolOutput;
  if (output.length > maxLength) {
    output = output.slice(0, maxLength) + "...";
  }

  return `${prefix} ${output.split("\n").slice(0, 5).join(" | ")}`;
}

/**
 * Compact observations by summarizing older ones
 */
async function compactObservations(
  state: WorkingMemoryState
): Promise<WorkingMemoryState> {
  // Keep the last 3 observations as-is, summarize the rest
  const toSummarize = state.observations.slice(0, -3);
  const toKeep = state.observations.slice(-3);

  if (toSummarize.length === 0) {
    return state;
  }

  try {
    // Use the fast model to generate a summary
    const result = await generateText({
      model: getFastModel(),
      prompt: buildCompactionPrompt(toSummarize, 3),
      maxTokens: 200,
    });

    const summary = `[Summary of ${toSummarize.length} actions]\n${result.text}`;

    return {
      ...state,
      observations: [summary, ...toKeep],
    };
  } catch (error) {
    // If summarization fails, just keep recent observations
    console.error("Memory compaction failed:", error);
    return {
      ...state,
      observations: toKeep,
    };
  }
}

/**
 * Extract plan updates from model output
 * Models might output structured plan updates
 */
export function extractPlanFromOutput(
  output: string
): { description: string; status: "pending" | "in_progress" | "completed" }[] {
  const planItems: {
    description: string;
    status: "pending" | "in_progress" | "completed";
  }[] = [];

  // Look for plan section
  const planMatch = output.match(
    /(?:Plan|TODO|Steps):\s*\n((?:[-\[\]x>\s].*\n?)+)/i
  );
  if (!planMatch) return planItems;

  const lines = planMatch[1].split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.match(/^\[x\]/i)) {
      planItems.push({
        description: trimmed.replace(/^\[x\]\s*/i, ""),
        status: "completed",
      });
    } else if (trimmed.match(/^\[>\]/)) {
      planItems.push({
        description: trimmed.replace(/^\[>\]\s*/, ""),
        status: "in_progress",
      });
    } else if (trimmed.match(/^\[\s*\]/)) {
      planItems.push({
        description: trimmed.replace(/^\[\s*\]\s*/, ""),
        status: "pending",
      });
    } else if (trimmed.match(/^[-*]/)) {
      planItems.push({
        description: trimmed.replace(/^[-*]\s*/, ""),
        status: "pending",
      });
    }
  }

  return planItems;
}

/**
 * Validate that the plan makes sense
 * Returns warnings if issues are detected
 */
export function validatePlan(state: WorkingMemoryState): string[] {
  const warnings: string[] = [];

  // Check for multiple in-progress items
  const inProgress = state.plan.filter((p) => p.status === "in_progress");
  if (inProgress.length > 1) {
    warnings.push(
      `Multiple items marked as in-progress (${inProgress.length}). Focus on one at a time.`
    );
  }

  // Check for empty plan with a task
  if (state.currentTask && state.plan.length === 0) {
    warnings.push("Task set but no plan items. Consider breaking down the task.");
  }

  // Check for very long plans
  if (state.plan.length > 10) {
    warnings.push(
      `Plan is getting long (${state.plan.length} items). Consider completing some items first.`
    );
  }

  return warnings;
}
