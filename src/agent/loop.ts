import { generateText, type CoreMessage } from "ai";
import * as readline from "readline";
import { getFastModel, configureModels } from "../model/provider.js";
import { toolRegistry } from "../tool/registry.js";
import { assembleSystemPrompt, formatUserMessage } from "./prompt.js";
import { updateMemory, validatePlan } from "./memory.js";
import {
  createEmptyWorkingMemory,
  setCurrentTask,
  addPlanItem,
  type WorkingMemoryState,
} from "../layer/working.js";
import { SessionPersistence, type SessionInfo } from "../session/persistence.js";
import type { ToolContext, ToolResult } from "../tool/tool.js";
import { ulid } from "ulid";

/**
 * Options for the agent loop
 */
export interface AgentLoopOptions {
  sessionId: string;
  initialTask?: string;
  yoloMode: boolean;
  fastModel: string;
  deepModel: string;
  signal: AbortSignal;
}

/**
 * Main agent loop - THINK → ACT → OBSERVE → UPDATE
 */
export async function agentLoop(options: AgentLoopOptions): Promise<void> {
  // Configure models
  configureModels({
    fastModel: options.fastModel,
    deepModel: options.deepModel,
  });

  // Load or create session
  let session = await SessionPersistence.load(options.sessionId);
  let workingMemory: WorkingMemoryState;
  let messages: CoreMessage[] = [];

  if (session) {
    console.log(`Resuming session: ${options.sessionId}`);
    workingMemory = session.workingMemory;
    messages = session.messages;
  } else {
    console.log(`Starting new session: ${options.sessionId}`);
    workingMemory = createEmptyWorkingMemory();
    session = {
      id: options.sessionId,
      createdAt: Date.now(),
      workingDirectory: process.cwd(),
      fastModel: options.fastModel,
      deepModel: options.deepModel,
      workingMemory,
      messages: [],
      messageCount: 0,
    };
  }

  // Tool execution context
  const toolContext: ToolContext = {
    sessionId: options.sessionId,
    messageId: "",
    workingDirectory: process.cwd(),
    yoloMode: options.yoloMode,
  };

  // Handle initial task if provided
  if (options.initialTask) {
    workingMemory = setCurrentTask(workingMemory, options.initialTask);
    messages.push({
      role: "user",
      content: formatUserMessage(options.initialTask, {
        workingDirectory: process.cwd(),
      }),
    });
    await saveSession(session, workingMemory, messages);
  }

  // Main loop
  while (!options.signal.aborted) {
    // Determine if we need user input
    // We need input if: no messages, or last message was assistant text (not tool call)
    const lastMessage = messages[messages.length - 1];
    const needsUserInput = messages.length === 0 ||
      (lastMessage?.role === "assistant" && typeof lastMessage.content === "string");

    if (needsUserInput) {
      const userInput = await promptUser();
      if (!userInput) {
        console.log("\nGoodbye!");
        break;
      }
      if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
        console.log("\nSession saved. Goodbye!");
        break;
      }

      // Set as current task if no task yet
      if (!workingMemory.currentTask) {
        workingMemory = setCurrentTask(workingMemory, userInput);
      }

      messages.push({
        role: "user",
        content: formatUserMessage(userInput, {
          workingDirectory: process.cwd(),
        }),
      });
    }

    // THINK - Assemble prompt and call model
    const systemPrompt = assembleSystemPrompt(workingMemory);
    const aiTools = toolRegistry.toAITools(toolContext);

    try {
      console.log("\n🤔 Thinking...");

      const result = await generateText({
        model: getFastModel(),
        system: systemPrompt,
        messages,
        tools: aiTools,
        maxSteps: 1, // One step at a time for visibility
      });

      // Check for tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const toolCall of result.toolCalls) {
          // ACT - Execute the tool
          console.log(`\n⚡ Action: ${toolCall.toolName}`);
          console.log(`   Args: ${JSON.stringify(toolCall.args, null, 2).slice(0, 200)}`);

          // Update context with new message ID
          toolContext.messageId = ulid();

          const toolResult = await toolRegistry.execute(
            toolCall.toolName,
            toolCall.args,
            toolContext
          );

          // OBSERVE - Display result
          displayToolResult(toolCall.toolName, toolResult);

          // UPDATE - Update working memory
          workingMemory = await updateMemory(workingMemory, {
            toolName: toolCall.toolName,
            toolOutput: toolResult.output,
            toolError: toolResult.error ?? false,
            modelThinking: result.text,
          });

          // Add tool result to messages
          messages.push({
            role: "assistant",
            content: [
              { type: "text", text: result.text || "" },
              {
                type: "tool-call",
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                args: toolCall.args,
              },
            ],
          });

          messages.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                result: JSON.stringify(toolResult),
              },
            ],
          });
        }

        // Validate plan
        const warnings = validatePlan(workingMemory);
        for (const warning of warnings) {
          console.log(`⚠️  ${warning}`);
        }

        // Save session after each step
        await saveSession(session, workingMemory, messages);
      } else {
        // No tool call - this is a final response
        console.log("\n📝 Response:");
        console.log(result.text);

        // Add to messages
        messages.push({
          role: "assistant",
          content: result.text,
        });

        // Check if the response indicates completion
        if (isTaskComplete(result.text)) {
          workingMemory = {
            ...workingMemory,
            currentTask: "",
            plan: [],
          };
        }

        // Save session
        await saveSession(session, workingMemory, messages);
      }
    } catch (error) {
      if (options.signal.aborted) {
        break;
      }
      console.error("\n❌ Error:", error instanceof Error ? error.message : error);

      // Don't exit on error, let the user continue
      messages.push({
        role: "assistant",
        content: `Error occurred: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // Final save
  await saveSession(session, workingMemory, messages);
}

/**
 * Prompt the user for input
 */
async function promptUser(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("\n> ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Display a tool result
 */
function displayToolResult(toolName: string, result: ToolResult): void {
  const icon = result.error ? "❌" : "✅";
  console.log(`\n${icon} Result (${toolName}):`);

  // Truncate long output for display
  const maxLines = 20;
  const lines = result.output.split("\n");
  if (lines.length > maxLines) {
    console.log(lines.slice(0, maxLines).join("\n"));
    console.log(`... (${lines.length - maxLines} more lines)`);
  } else {
    console.log(result.output);
  }
}

/**
 * Check if the response indicates task completion
 */
function isTaskComplete(response: string): boolean {
  const completionPhrases = [
    "task is complete",
    "task completed",
    "all done",
    "finished",
    "completed successfully",
    "implementation is complete",
  ];

  const lower = response.toLowerCase();
  return completionPhrases.some((phrase) => lower.includes(phrase));
}

/**
 * Save session state
 */
async function saveSession(
  session: SessionInfo,
  workingMemory: WorkingMemoryState,
  messages: CoreMessage[]
): Promise<void> {
  session.workingMemory = workingMemory;
  session.messages = messages;
  session.messageCount = messages.length;
  await SessionPersistence.save(session);
}
