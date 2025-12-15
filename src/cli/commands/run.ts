import { ulid } from "ulid";

export interface RunOptions {
  task?: string;
  sessionId?: string;
  yoloMode: boolean;
  fastModel: string;
  deepModel: string;
}

export async function runAgent(options: RunOptions): Promise<void> {
  const sessionId = options.sessionId ?? ulid();

  console.log(`\n╭──────────────────────────────────────────────────────────╮`);
  console.log(`│ Coding Agent · ${options.fastModel.padEnd(20)} · ${process.cwd().slice(-20).padStart(20)} │`);
  console.log(`├──────────────────────────────────────────────────────────┤`);
  console.log(`│ Session: ${sessionId.padEnd(47)} │`);
  console.log(`│ Deep Model: ${options.deepModel.padEnd(44)} │`);
  if (options.yoloMode) {
    console.log(`│ ⚠️  YOLO MODE ENABLED - Approvals disabled                │`);
  }
  console.log(`╰──────────────────────────────────────────────────────────╯\n`);

  // Import the agent loop
  const { agentLoop } = await import("../../agent/loop.js");

  // Create abort controller for graceful shutdown
  const abort = new AbortController();

  process.on("SIGINT", () => {
    console.log("\n\nInterrupted. Saving session...");
    abort.abort();
  });

  process.on("SIGTERM", () => {
    abort.abort();
  });

  try {
    await agentLoop({
      sessionId,
      initialTask: options.task,
      yoloMode: options.yoloMode,
      fastModel: options.fastModel,
      deepModel: options.deepModel,
      signal: abort.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.log("Session ended.");
    } else {
      throw error;
    }
  }
}
