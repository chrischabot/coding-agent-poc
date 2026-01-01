import { readFile, readdir, stat } from "node:fs/promises"
import { join, basename } from "node:path"
import { homedir } from "node:os"
import type { Skill, SkillFrontmatter } from "./types"

const SKILL_DIRS = [
  ".agents/skills",
  ".claude/skills",
]

const GLOBAL_SKILL_DIRS = [
  join(homedir(), ".claude", "skills"),
  join(homedir(), ".claude", "plugins", "cache"),
]

export async function discoverSkills(workspaceRoot: string): Promise<Skill[]> {
  const skills: Skill[] = []
  const seenNames = new Set<string>()

  const localDirs = SKILL_DIRS.map((d) => join(workspaceRoot, d))
  const allDirs = [...localDirs, ...GLOBAL_SKILL_DIRS]

  for (const dir of allDirs) {
    try {
      const dirSkills = await discoverSkillsInDir(dir)
      for (const skill of dirSkills) {
        if (!seenNames.has(skill.name) && !skill.frontmatter.isolatedContext) {
          skills.push(skill)
          seenNames.add(skill.name)
        }
      }
    } catch {
      continue
    }
  }

  return skills
}

async function discoverSkillsInDir(dir: string): Promise<Skill[]> {
  const skills: Skill[] = []

  try {
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isFile() && entry.name.endsWith(".md")) {
        const skill = await parseSkillFile(fullPath)
        if (skill) {
          skills.push(skill)
        }
      } else if (entry.isDirectory()) {
        const subSkills = await discoverSkillsInDir(fullPath)
        skills.push(...subSkills)
      }
    }
  } catch {
    return []
  }

  return skills
}

async function parseSkillFile(filePath: string): Promise<Skill | null> {
  try {
    const content = await readFile(filePath, "utf-8")
    const { frontmatter, body } = parseFrontmatter(content)

    if (!frontmatter.name) {
      frontmatter.name = basename(filePath, ".md")
    }

    if (!frontmatter.description) {
      frontmatter.description = `Skill from ${filePath}`
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      content: body,
      path: filePath,
      frontmatter,
    }
  } catch {
    return null
  }
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return {
      frontmatter: { name: "", description: "" },
      body: content,
    }
  }

  const [, yamlContent, body] = match
  const frontmatter = parseYaml(yamlContent)

  return { frontmatter, body: body.trim() }
}

function parseYaml(yaml: string): SkillFrontmatter {
  const result: SkillFrontmatter = { name: "", description: "" }

  const lines = yaml.split("\n")
  for (const line of lines) {
    const colonIndex = line.indexOf(":")
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    let value = line.slice(colonIndex + 1).trim()

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    switch (key) {
      case "name":
        result.name = value
        break
      case "description":
        result.description = value
        break
      case "isolatedContext":
        result.isolatedContext = value === "true"
        break
      case "tags":
        if (value.startsWith("[") && value.endsWith("]")) {
          result.tags = value
            .slice(1, -1)
            .split(",")
            .map((t) => t.trim().replace(/['"]/g, ""))
        }
        break
    }
  }

  return result
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return ""

  const sections = skills.map((skill) => {
    return `<skill name="${skill.name}" description="${skill.description}">
${skill.content}
</skill>`
  })

  return `<discovered_skills>
${sections.join("\n\n")}
</discovered_skills>`
}
