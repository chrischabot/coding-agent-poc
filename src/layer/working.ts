/**
 * Layer 3: Working Memory (Mutable)
 *
 * Contains the current state of the agent's work:
 * - Current task
 * - Active plan / TODO list
 * - Key observations from tool outputs
 * - Summaries of completed work
 *
 * This layer is actively pruned and rewritten after every step.
 */

/**
 * A single plan item
 */
export interface PlanItem {
  description: string;
  status: "pending" | "in_progress" | "completed";
}

/**
 * Working memory state
 */
export interface WorkingMemoryState {
  currentTask: string;
  plan: PlanItem[];
  observations: string[];
  completedSummary: string;
}

/**
 * Create empty working memory
 */
export function createEmptyWorkingMemory(): WorkingMemoryState {
  return {
    currentTask: "",
    plan: [],
    observations: [],
    completedSummary: "",
  };
}

/**
 * Format working memory for inclusion in the prompt
 */
export function formatWorkingMemory(state: WorkingMemoryState): string {
  const sections: string[] = [];

  // Current task
  if (state.currentTask) {
    sections.push(`## Current Task\n${state.currentTask}`);
  }

  // Plan
  if (state.plan.length > 0) {
    const planLines = state.plan.map((item) => {
      const marker =
        item.status === "completed"
          ? "[x]"
          : item.status === "in_progress"
            ? "[>]"
            : "[ ]";
      return `${marker} ${item.description}`;
    });
    sections.push(`## Plan\n${planLines.join("\n")}`);
  }

  // Recent observations
  if (state.observations.length > 0) {
    sections.push(`## Recent Observations\n${state.observations.join("\n")}`);
  }

  // Completed work summary
  if (state.completedSummary) {
    sections.push(`## Completed Work\n${state.completedSummary}`);
  }

  if (sections.length === 0) {
    return "# Working Memory\n(Empty - awaiting first task)";
  }

  return `# Working Memory\n\n${sections.join("\n\n")}`;
}

/**
 * Update working memory with a new observation
 */
export function addObservation(
  state: WorkingMemoryState,
  observation: string
): WorkingMemoryState {
  const MAX_OBSERVATIONS = 10;

  const newObservations = [...state.observations, observation];

  // Keep only the most recent observations
  if (newObservations.length > MAX_OBSERVATIONS) {
    return {
      ...state,
      observations: newObservations.slice(-MAX_OBSERVATIONS),
    };
  }

  return {
    ...state,
    observations: newObservations,
  };
}

/**
 * Update plan item status
 */
export function updatePlanItem(
  state: WorkingMemoryState,
  index: number,
  status: PlanItem["status"]
): WorkingMemoryState {
  const newPlan = [...state.plan];
  if (index >= 0 && index < newPlan.length) {
    newPlan[index] = { ...newPlan[index], status };
  }
  return { ...state, plan: newPlan };
}

/**
 * Add a new plan item
 */
export function addPlanItem(
  state: WorkingMemoryState,
  description: string
): WorkingMemoryState {
  return {
    ...state,
    plan: [...state.plan, { description, status: "pending" }],
  };
}

/**
 * Remove completed plan items
 */
export function pruneCompletedItems(
  state: WorkingMemoryState
): WorkingMemoryState {
  const completed = state.plan.filter((item) => item.status === "completed");
  const remaining = state.plan.filter((item) => item.status !== "completed");

  // Add completed items to summary
  let newSummary = state.completedSummary;
  if (completed.length > 0) {
    const completedText = completed
      .map((item) => `- ${item.description}`)
      .join("\n");
    newSummary = newSummary
      ? `${newSummary}\n${completedText}`
      : completedText;
  }

  return {
    ...state,
    plan: remaining,
    completedSummary: newSummary,
  };
}

/**
 * Set the current task
 */
export function setCurrentTask(
  state: WorkingMemoryState,
  task: string
): WorkingMemoryState {
  return {
    ...state,
    currentTask: task,
  };
}

/**
 * Parse plan updates from model output
 * The model might output plan updates in a specific format
 */
export function parsePlanUpdates(
  modelOutput: string,
  currentState: WorkingMemoryState
): WorkingMemoryState {
  // Look for plan markers in the output
  const planMatch = modelOutput.match(/## Plan\n([\s\S]*?)(?=\n##|$)/);
  if (!planMatch) {
    return currentState;
  }

  const planText = planMatch[1];
  const lines = planText.split("\n").filter((line) => line.trim());

  const newPlan: PlanItem[] = lines.map((line) => {
    if (line.startsWith("[x]")) {
      return { description: line.slice(3).trim(), status: "completed" as const };
    } else if (line.startsWith("[>]")) {
      return { description: line.slice(3).trim(), status: "in_progress" as const };
    } else if (line.startsWith("[ ]")) {
      return { description: line.slice(3).trim(), status: "pending" as const };
    } else if (line.startsWith("-")) {
      return { description: line.slice(1).trim(), status: "pending" as const };
    } else {
      return { description: line.trim(), status: "pending" as const };
    }
  });

  return {
    ...currentState,
    plan: newPlan,
  };
}
