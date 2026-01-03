import { readFile } from "node:fs/promises"
import { join } from "node:path"

export interface FormatterInfo {
  name: string
  command: string[]
  extensions: string[]
  enabled: (workingDirectory: string) => Promise<boolean>
}

async function commandExists(command: string): Promise<boolean> {
  const path = Bun.which(command)
  return path !== null
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await Bun.file(filePath).exists()
    return true
  } catch {
    return false
  }
}

async function hasDependency(
  workingDirectory: string,
  depName: string
): Promise<boolean> {
  try {
    const pkgPath = join(workingDirectory, "package.json")
    const content = await readFile(pkgPath, "utf-8")
    const pkg = JSON.parse(content)
    return !!(
      pkg.dependencies?.[depName] ||
      pkg.devDependencies?.[depName] ||
      pkg.peerDependencies?.[depName]
    )
  } catch {
    return false
  }
}

export const formatters: FormatterInfo[] = [
  {
    name: "prettier",
    command: ["bun", "x", "prettier", "--write", "$FILE"],
    extensions: [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".json",
      ".md",
      ".css",
      ".scss",
      ".less",
      ".html",
      ".vue",
      ".svelte",
      ".yaml",
      ".yml",
    ],
    enabled: (workingDirectory) => hasDependency(workingDirectory, "prettier"),
  },
  {
    name: "biome",
    command: ["bun", "x", "@biomejs/biome", "format", "--write", "$FILE"],
    extensions: [".js", ".jsx", ".ts", ".tsx", ".json", ".jsonc"],
    enabled: async (workingDirectory) => {
      const biomeJson = join(workingDirectory, "biome.json")
      const biomeJsonc = join(workingDirectory, "biome.jsonc")
      return (await fileExists(biomeJson)) || (await fileExists(biomeJsonc))
    },
  },
  {
    name: "gofmt",
    command: ["gofmt", "-w", "$FILE"],
    extensions: [".go"],
    enabled: () => commandExists("gofmt"),
  },
  {
    name: "rustfmt",
    command: ["rustfmt", "$FILE"],
    extensions: [".rs"],
    enabled: () => commandExists("rustfmt"),
  },
  {
    name: "ruff",
    command: ["ruff", "format", "$FILE"],
    extensions: [".py", ".pyi"],
    enabled: async (workingDirectory) => {
      const ruffToml = join(workingDirectory, "ruff.toml")
      const pyprojectToml = join(workingDirectory, "pyproject.toml")

      if (await fileExists(ruffToml)) {
        return true
      }

      try {
        const content = await readFile(pyprojectToml, "utf-8")
        return content.includes("[tool.ruff]")
      } catch {
        return false
      }
    },
  },
  {
    name: "shfmt",
    command: ["shfmt", "-w", "$FILE"],
    extensions: [".sh", ".bash"],
    enabled: () => commandExists("shfmt"),
  },
]

export function getFormatterForExtension(ext: string): FormatterInfo | undefined {
  return formatters.find((f) => f.extensions.includes(ext))
}
