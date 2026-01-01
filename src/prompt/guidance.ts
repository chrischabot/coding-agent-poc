import { readFile, access } from "node:fs/promises"
import { join } from "node:path"

export interface GuidanceFile {
  path: string
  content: string
}

const GUIDANCE_FILENAMES = ["AGENTS.md", "CLAUDE.md"]

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function discoverGuidanceFiles(
  workingDirectory: string
): Promise<GuidanceFile[]> {
  for (const filename of GUIDANCE_FILENAMES) {
    const filePath = join(workingDirectory, filename)
    if (await fileExists(filePath)) {
      try {
        const content = await readFile(filePath, "utf-8")
        return [{ path: filePath, content }]
      } catch {}
    }
  }
  return []
}

/**
 * Format discovered guidance files for injection into system prompt.
 * Returns empty string if no files found.
 */
export function formatGuidanceFiles(files: GuidanceFile[]): string {
  if (files.length === 0) {
    return ""
  }
  
  const formatted = files
    .map(
      (f) => `<guidance_file path="${f.path}">
${f.content}
</guidance_file>`
    )
    .join("\n\n")
  
  return `
# Project Guidance

The following guidance files were discovered in the project:

${formatted}`
}
