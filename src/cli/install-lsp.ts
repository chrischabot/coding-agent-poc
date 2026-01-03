import { LSP_SERVER_CONFIGS, type SupportedLanguage } from "../lsp/types"
import * as readline from "node:readline"

interface LSPServerStatus {
  language: SupportedLanguage
  command: string
  available: boolean
  installInstructions: string
}

/**
 * Check if a command is available on the system
 */
async function isCommandAvailable(command: string): Promise<boolean> {
  const path = Bun.which(command)
  return path !== null
}

/**
 * Get the unique LSP servers (some languages share the same server)
 */
function getUniqueLSPServers(): Map<string, { languages: SupportedLanguage[]; config: typeof LSP_SERVER_CONFIGS[SupportedLanguage] }> {
  const serverMap = new Map<string, { languages: SupportedLanguage[]; config: typeof LSP_SERVER_CONFIGS[SupportedLanguage] }>()

  for (const [language, config] of Object.entries(LSP_SERVER_CONFIGS) as [SupportedLanguage, typeof LSP_SERVER_CONFIGS[SupportedLanguage]][]) {
    const existing = serverMap.get(config.command)
    if (existing) {
      existing.languages.push(language)
    } else {
      serverMap.set(config.command, { languages: [language], config })
    }
  }

  return serverMap
}

/**
 * Check the availability status of all LSP servers
 */
async function checkAllLSPServers(): Promise<LSPServerStatus[]> {
  const statuses: LSPServerStatus[] = []
  const uniqueServers = getUniqueLSPServers()

  for (const [command, { languages, config }] of uniqueServers) {
    const available = await isCommandAvailable(command)
    statuses.push({
      language: languages[0],  // Primary language
      command,
      available,
      installInstructions: config.installInstructions,
    })
  }

  return statuses
}

/**
 * Format language names for display
 */
function formatLanguages(command: string): string {
  const uniqueServers = getUniqueLSPServers()
  const server = uniqueServers.get(command)
  if (!server) return ""

  const languageNames: Record<SupportedLanguage, string> = {
    typescript: "TypeScript",
    javascript: "JavaScript",
    python: "Python",
    go: "Go",
    rust: "Rust",
    java: "Java",
    c: "C",
    cpp: "C++",
    csharp: "C#",
    ruby: "Ruby",
    php: "PHP",
  }

  return server.languages.map(l => languageNames[l]).join(", ")
}

/**
 * Prompt the user for confirmation
 */
async function promptConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close()
      const normalized = answer.toLowerCase().trim()
      resolve(normalized === "" || normalized === "y" || normalized === "yes")
    })
  })
}

/**
 * Execute an installation command
 */
async function executeInstall(instructions: string): Promise<{ success: boolean; output: string }> {
  // Extract the actual command from instructions
  // Some instructions are just commands, others are descriptive
  let command = instructions

  // Handle "Install X: URL" style instructions (skip these - manual)
  if (instructions.includes("https://")) {
    return { success: false, output: "Manual installation required" }
  }

  // Handle "Install clangd via your package manager" style
  if (instructions.includes("via your package manager")) {
    // Try common package managers
    const platform = process.platform
    if (platform === "darwin") {
      command = "brew install llvm"
    } else if (platform === "linux") {
      // Check for apt
      if (await isCommandAvailable("apt")) {
        command = "sudo apt install -y clangd"
      } else if (await isCommandAvailable("dnf")) {
        command = "sudo dnf install -y clang-tools-extra"
      } else {
        return { success: false, output: "Could not detect package manager. Please install clangd manually." }
      }
    } else {
      return { success: false, output: "Manual installation required for this platform" }
    }
  }

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()

    if (exitCode === 0) {
      return { success: true, output: stdout || "Installed successfully" }
    } else {
      return { success: false, output: stderr || `Exit code: ${exitCode}` }
    }
  } catch (error) {
    return { success: false, output: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Main LSP installer function
 */
export async function installLSPServers(): Promise<void> {
  console.log("")
  console.log("LSP Server Installer")
  console.log("═".repeat(50))
  console.log("")
  console.log("Checking installed language servers...")
  console.log("")

  const statuses = await checkAllLSPServers()

  const available = statuses.filter(s => s.available)
  const toInstall = statuses.filter(s => !s.available)

  // Show already available
  if (available.length > 0) {
    console.log("\x1b[32m✓ Already available:\x1b[0m")
    console.log("")
    for (const server of available) {
      const languages = formatLanguages(server.command)
      console.log(`  \x1b[32m✓\x1b[0m ${server.command}`)
      console.log(`    Languages: ${languages}`)
    }
    console.log("")
  }

  // Filter to only show auto-installable servers (exclude manual-only like jdtls, omnisharp)
  const autoInstallableToShow = toInstall.filter(s =>
    !s.installInstructions.includes("https://") ||
    s.installInstructions.includes("via your package manager")
  )

  // Show to install
  if (autoInstallableToShow.length > 0) {
    console.log("\x1b[33m○ To install:\x1b[0m")
    console.log("")
    for (const server of autoInstallableToShow) {
      const languages = formatLanguages(server.command)
      console.log(`  \x1b[33m○\x1b[0m ${server.command}`)
      console.log(`    Languages: ${languages}`)
      console.log(`    Command: ${server.installInstructions}`)
      console.log("")
    }
  } else {
    console.log("\x1b[32mAll supported LSP servers are already installed!\x1b[0m")
    printOptionalServersNote()
    return
  }

  // Filter out servers that require manual installation (optional advanced servers)
  const autoInstallable = toInstall.filter(s =>
    !s.installInstructions.includes("https://") ||
    s.installInstructions.includes("via your package manager")
  )

  if (autoInstallable.length === 0) {
    console.log("No servers to auto-install.")
    printOptionalServersNote()
    return
  }

  console.log("─".repeat(50))
  console.log(`Will install ${autoInstallable.length} server(s)`)
  console.log("")

  const confirmed = await promptConfirmation("Proceed with installation? [Y/n]: ")

  if (!confirmed) {
    console.log("")
    console.log("Installation cancelled.")
    return
  }

  console.log("")
  console.log("Installing...")
  console.log("")

  for (const server of autoInstallable) {
    process.stdout.write(`  Installing ${server.command}... `)
    const result = await executeInstall(server.installInstructions)

    if (result.success) {
      console.log("\x1b[32m✓\x1b[0m")
    } else {
      console.log("\x1b[31m✗\x1b[0m")
      console.log(`    ${result.output}`)
    }
  }

  console.log("")
  console.log("\x1b[32m✓ Done!\x1b[0m Run 'coding-agent install-lsp' again to verify.")

  printOptionalServersNote()
}

/**
 * Print note about optional servers that require manual installation
 */
function printOptionalServersNote(): void {
  console.log("")
  console.log("─".repeat(50))
  console.log("\x1b[36mOptional LSP servers (manual installation):\x1b[0m")
  console.log("")
  console.log("  \x1b[1mJava\x1b[0m - Eclipse JDT Language Server")
  console.log("    https://github.com/eclipse-jdtls/eclipse.jdt.ls")
  console.log("")
  console.log("  \x1b[1mC#\x1b[0m - OmniSharp")
  console.log("    https://github.com/OmniSharp/omnisharp-roslyn/releases")
  console.log("")
}
