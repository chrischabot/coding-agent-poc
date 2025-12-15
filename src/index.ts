#!/usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const cli = yargs(hideBin(process.argv))
  .scriptName("coding-agent")
  .usage("$0 [command] [options]")
  .command(
    "$0 [task]",
    "Start interactive coding agent session",
    (yargs) =>
      yargs
        .positional("task", {
          describe: "Initial task to perform",
          type: "string",
        })
        .option("session", {
          alias: "s",
          describe: "Resume existing session by ID",
          type: "string",
        })
        .option("yolo", {
          describe: "Skip approval prompts (dangerous)",
          type: "boolean",
          default: false,
        })
        .option("model", {
          alias: "m",
          describe: "Override the fast model",
          type: "string",
          default: "gpt-5-mini",
        })
        .option("deep-model", {
          describe: "Override the deep work model",
          type: "string",
          default: "gpt-5.1-codex-max",
        }),
    async (argv) => {
      const { runAgent } = await import("./cli/commands/run.js");
      await runAgent({
        task: argv.task,
        sessionId: argv.session,
        yoloMode: argv.yolo,
        fastModel: argv.model,
        deepModel: argv["deep-model"],
      });
    }
  )
  .command(
    "sessions <action>",
    "Manage sessions",
    (yargs) =>
      yargs
        .positional("action", {
          describe: "Action to perform",
          choices: ["list", "delete", "show"] as const,
          demandOption: true,
        })
        .option("id", {
          describe: "Session ID (for delete/show)",
          type: "string",
        }),
    async (argv) => {
      const { manageSessions } = await import("./cli/commands/session.js");
      await manageSessions({
        action: argv.action as "list" | "delete" | "show",
        sessionId: argv.id,
      });
    }
  )
  .help()
  .version()
  .strict();

cli.parse();
