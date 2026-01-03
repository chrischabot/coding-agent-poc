#!/usr/bin/env bun
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { runAgent, runInteractive, runTUI } from "./cli/run"
import {
  login,
  clearTokens,
  isAuthenticated,
  getCurrentAccount,
  getStoredTokens,
} from "./auth"
import { setUseApiKeyMode } from "./provider"

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("coding-agent")
    .usage("$0 <command> [options]")
    .command("login", "Authenticate with Anthropic via OAuth", {}, async () => {
      console.log("Starting OAuth authentication...\n")
      try {
        await login()
        const account = getCurrentAccount()
        console.log(`\n✓ Authenticated as: ${account?.emailAddress ?? "unknown"}`)
        if (account?.organizationName) {
          console.log(`  Organization: ${account.organizationName}`)
        }
      } catch (err) {
        console.error("Authentication failed:", err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })
    .command("logout", "Clear stored authentication tokens", {}, async () => {
      clearTokens()
      console.log("✓ Logged out successfully")
    })
    .command("status", "Show current authentication status", {}, async () => {
      if (isAuthenticated()) {
        const account = getCurrentAccount()
        const tokens = getStoredTokens()
        console.log("✓ Authenticated")
        console.log(`  Email: ${account?.emailAddress ?? "unknown"}`)
        if (account?.organizationName) {
          console.log(`  Organization: ${account.organizationName}`)
        }
        if (tokens?.expiresAt) {
          const expiresIn = Math.round((tokens.expiresAt - Date.now()) / 1000 / 60)
          if (expiresIn > 0) {
            console.log(`  Token expires in: ${expiresIn} minutes`)
          } else {
            console.log(`  Token expired (will refresh on next request)`)
          }
        }
        if (tokens?.scopes) {
          console.log(`  Scopes: ${tokens.scopes.join(", ")}`)
        }
      } else {
        console.log("✗ Not authenticated")
        console.log("  Run 'coding-agent login' to authenticate")
      }
    })
    .command(
      ["run", "$0"],
      "Run the coding agent",
      (yargs) =>
        yargs
          .option("prompt", {
            alias: "p",
            type: "string",
            description: "Prompt to execute (non-interactive mode)",
          })
          .option("model", {
            alias: "m",
            type: "string",
            default: "claude-opus-4-5-20251101",
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
          .option("use-anthropic-key", {
            type: "boolean",
            default: false,
            description: "Use ANTHROPIC_API_KEY instead of OAuth",
          }),
      async (argv) => {
        // Set auth mode
        if (argv["use-anthropic-key"]) {
          setUseApiKeyMode(true)
        } else {
          // Check if authenticated when using OAuth mode
          if (!isAuthenticated()) {
            console.error("Not authenticated. Please run 'coding-agent login' first.")
            console.error("Or use --use-anthropic-key with ANTHROPIC_API_KEY environment variable.")
            process.exit(1)
          }
        }

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
            yolo: argv.yolo,
          })
        } else if (argv.interactive) {
          await runInteractive({
            model: argv.model,
            workdir: argv.workdir,
          })
        } else {
          // Default to TUI mode
          await runTUI({
            model: argv.model,
            workdir: argv.workdir,
            yolo: argv.yolo,
          })
        }
      }
    )
    .help()
    .parse()
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
