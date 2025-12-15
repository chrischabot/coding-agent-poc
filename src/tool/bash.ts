import { z } from "zod";
import { defineTool } from "./tool.js";
import { requestApproval, ApprovalType } from "../permission/index.js";

/**
 * Patterns for commands that are ALWAYS blocked (never executed)
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+(-[rf]+\s+)*\/($|\s)/i, // rm -rf /
  /rm\s+(-[rf]+\s+)*~($|\s)/i, // rm -rf ~
  /mkfs/i, // Format filesystem
  /dd\s+if=.*of=\/dev/i, // dd to device
  /:()\s*{\s*:\|:&\s*};:/i, // Fork bomb
  />\s*\/dev\/sd[a-z]/i, // Write to disk device
  /chmod\s+(-R\s+)?777\s+\//i, // chmod 777 /
  /curl.*\|\s*sudo\s+bash/i, // Piping curl to sudo bash
  /wget.*\|\s*sudo\s+bash/i, // Piping wget to sudo bash
];

/**
 * Patterns for commands that require user approval
 */
const APPROVAL_PATTERNS: RegExp[] = [
  /\bsudo\b/i, // Any sudo command
  /\bnpm\s+install\b/i, // npm install
  /\byarn\s+add\b/i, // yarn add
  /\bpip\s+install\b/i, // pip install
  /\bcurl\b.*\|\s*(ba)?sh/i, // curl | sh
  /\bwget\b.*\|\s*(ba)?sh/i, // wget | sh
  /\bgit\s+push\b/i, // git push
  /\bgit\s+push\s+-f\b/i, // git push --force
  /\brm\s+-rf\b/i, // rm -rf (even if not /)
  /\bchmod\b/i, // chmod
  /\bchown\b/i, // chown
  /\bkill\b/i, // kill
  /\bpkill\b/i, // pkill
  /\bsystemctl\b/i, // systemctl
  /\blaunchctl\b/i, // launchctl (macOS)
];

export const bashTool = defineTool("bash", {
  description:
    "Execute a shell command. Dangerous commands are blocked. Some commands require user approval.",
  parameters: z.object({
    command: z.string().describe("The shell command to execute"),
    description: z
      .string()
      .describe("Brief description of what this command does"),
  }),
  async execute(params, ctx) {
    // Check for blocked commands
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(params.command)) {
        return {
          title: params.description,
          output: `BLOCKED: This command matches a dangerous pattern and cannot be executed.\nCommand: ${params.command}`,
          error: true,
        };
      }
    }

    // Check for commands requiring approval
    let needsApproval = false;
    for (const pattern of APPROVAL_PATTERNS) {
      if (pattern.test(params.command)) {
        needsApproval = true;
        break;
      }
    }

    // Request approval if needed and not in YOLO mode
    if (needsApproval && !ctx.yoloMode) {
      const approved = await requestApproval({
        type: ApprovalType.BASH_COMMAND,
        sessionId: ctx.sessionId,
        title: `Execute: ${params.description}`,
        details: `Command: ${params.command}\n\nThis command matches a pattern that requires approval.`,
        metadata: { command: params.command },
      });

      if (!approved) {
        return {
          title: params.description,
          output: "Command cancelled by user",
          error: true,
        };
      }
    }

    try {
      const timeout = 120000; // 2 minutes

      // Execute the command
      const proc = Bun.spawn(["bash", "-c", params.command], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ctx.workingDirectory,
        env: { ...process.env },
      });

      // Handle timeout
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), timeout)
      );

      const resultPromise = (async () => {
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;
        return { stdout, stderr, exitCode };
      })();

      const result = await Promise.race([resultPromise, timeoutPromise]);

      if (result === "timeout") {
        proc.kill();
        return {
          title: params.description,
          output: `Command timed out after ${timeout}ms`,
          error: true,
        };
      }

      // Format output
      let output = "";
      if (result.stdout) {
        output += result.stdout;
      }
      if (result.stderr) {
        if (output) output += "\n--- stderr ---\n";
        output += result.stderr;
      }
      if (!output) {
        output = "(no output)";
      }

      // Truncate if too long
      const MAX_OUTPUT = 30000;
      if (output.length > MAX_OUTPUT) {
        output =
          output.slice(0, MAX_OUTPUT) +
          `\n... (output truncated, ${output.length - MAX_OUTPUT} chars omitted)`;
      }

      return {
        title: params.description,
        output,
        metadata: {
          exitCode: result.exitCode,
          command: params.command,
        },
        error: result.exitCode !== 0,
      };
    } catch (error) {
      return {
        title: params.description,
        output: `Error executing command: ${error instanceof Error ? error.message : String(error)}`,
        error: true,
      };
    }
  },
});
