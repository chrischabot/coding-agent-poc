#!/usr/bin/env bun
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { runAgent, runInteractive, runTUI } from "./cli/run"

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("coding-agent")
    .usage("$0 [options]")
    .option("prompt", {
      alias: "p",
      type: "string",
      description: "Prompt to execute (non-interactive mode)",
    })
    .option("model", {
      alias: "m",
      type: "string",
      default: "claude-sonnet-4-20250514",
      description: "Model to use",
    })
    .option("workdir", {
      alias: "w",
      type: "string",
      description: "Working directory",
    })
    .option("debug", {
      alias: "d",
      type: "boolean",
      default: false,
      description: "Debug mode (plain text output)",
    })
    .option("interactive", {
      alias: "i",
      type: "boolean",
      default: false,
      description: "Interactive mode (readline)",
    })
    .option("tui", {
      alias: "t",
      type: "boolean",
      default: false,
      description: "TUI mode (OpenTUI interface)",
    })
    .option("yolo", {
      alias: "y",
      type: "boolean",
      default: false,
      description: "YOLO mode (auto-approve all permission requests)",
    })
    .help()
    .parse()

  if (argv.prompt) {
    await runAgent({
      prompt: argv.prompt,
      model: argv.model,
      workdir: argv.workdir,
      debug: argv.debug,
      yolo: argv.yolo,
    })
  } else if (argv.tui) {
    await runTUI({
      model: argv.model,
      workdir: argv.workdir,
    })
  } else if (argv.interactive) {
    await runInteractive({
      model: argv.model,
      workdir: argv.workdir,
    })
  } else {
    console.log("Usage: coding-agent --prompt 'your task' [--debug]")
    console.log("       coding-agent --interactive")
    console.log("       coding-agent --tui")
    console.log("")
    console.log("Options:")
    console.log("  --prompt, -p       Task to execute (non-interactive)")
    console.log("  --interactive, -i  Start interactive mode (readline)")
    console.log("  --tui, -t          Start TUI mode (OpenTUI interface)")
    console.log("  --debug, -d        Debug mode (verbose output)")
    console.log("  --model, -m        Model to use (default: claude-sonnet-4-20250514)")
    console.log("  --workdir, -w      Working directory")
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
