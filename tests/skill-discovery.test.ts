import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { discoverSkills, formatSkillsForPrompt } from "../src/skill/discovery"
import { buildSystemPrompt } from "../src/prompt/system"
import { registerBuiltinTools } from "../src/tools"
import type { Skill, SkillFrontmatter } from "../src/skill/types"

describe("Skill Discovery", () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = join(tmpdir(), `coding-agent-skills-${Date.now()}`)
    await mkdir(workspaceRoot, { recursive: true })
    registerBuiltinTools()
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  describe("discoverSkills", () => {
    test("discovers skills in .agents/skills directory", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "test-skill.md"),
        `---
name: Test Skill
description: A test skill
---
This is the skill content.`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "Test Skill")

      expect(skill).toBeDefined()
      expect(skill?.description).toBe("A test skill")
      expect(skill?.content).toBe("This is the skill content.")
    })

    test("discovers skills recursively in nested directories", async () => {
      const nestedDir = join(workspaceRoot, ".agents", "skills", "nested", "deep")
      await mkdir(nestedDir, { recursive: true })

      await writeFile(
        join(nestedDir, "nested-skill.md"),
        `---
name: Nested Skill
description: Found in nested dir
---
Nested content.`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "Nested Skill")

      expect(skill).toBeDefined()
      expect(skill?.description).toBe("Found in nested dir")
    })

    test("discovers skills in .claude/skills directory", async () => {
      const claudeDir = join(workspaceRoot, ".claude", "skills")
      await mkdir(claudeDir, { recursive: true })

      await writeFile(
        join(claudeDir, "claude-skill.md"),
        `---
name: Claude Skill
description: In claude dir
---
Claude content.`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "Claude Skill")

      expect(skill).toBeDefined()
    })

    test("parses tags from frontmatter", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "tagged.md"),
        `---
name: Tagged Skill
description: Has tags
tags: [alpha, beta, gamma]
---
Content`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "Tagged Skill")

      expect(skill?.frontmatter.tags).toEqual(["alpha", "beta", "gamma"])
    })

    test("uses filename as name when frontmatter name is missing", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "auto-named.md"),
        `---
description: No name in frontmatter
---
Content`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "auto-named")

      expect(skill).toBeDefined()
      expect(skill?.description).toBe("No name in frontmatter")
    })

    test("uses default description when frontmatter description is missing", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "no-desc.md"),
        `---
name: No Desc Skill
---
Content`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "No Desc Skill")

      expect(skill).toBeDefined()
      expect(skill?.description).toContain("Skill from")
    })

    test("excludes skills with isolatedContext: true", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "isolated.md"),
        `---
name: Isolated Skill
description: Should not appear
isolatedContext: true
---
Secret content`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "Isolated Skill")

      expect(skill).toBeUndefined()
    })

    test("dedupes by name, preferring .agents/skills over .claude/skills", async () => {
      const agentsDir = join(workspaceRoot, ".agents", "skills")
      const claudeDir = join(workspaceRoot, ".claude", "skills")
      await mkdir(agentsDir, { recursive: true })
      await mkdir(claudeDir, { recursive: true })

      const skillName = `Duplicate-${Date.now()}`

      await writeFile(
        join(agentsDir, "dup.md"),
        `---
name: ${skillName}
description: from agents
---
Agents content`,
        "utf-8"
      )

      await writeFile(
        join(claudeDir, "dup.md"),
        `---
name: ${skillName}
description: from claude
---
Claude content`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const matches = skills.filter((s) => s.name === skillName)

      expect(matches.length).toBe(1)
      expect(matches[0].description).toBe("from agents")
      expect(matches[0].content).toBe("Agents content")
    })

    test("ignores non-.md files", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(join(skillDir, "not-a-skill.txt"), "text content", "utf-8")
      await writeFile(join(skillDir, "data.json"), '{"key": "value"}', "utf-8")

      const skills = await discoverSkills(workspaceRoot)
      expect(skills.every((s) => s.path.endsWith(".md"))).toBe(true)
    })

    test("handles empty skill directories (may include global skills)", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      const skills = await discoverSkills(workspaceRoot)
      const localSkills = skills.filter((s) => s.path.startsWith(workspaceRoot))
      expect(localSkills).toEqual([])
    })

    test("handles missing skill directories gracefully (may include global skills)", async () => {
      const skills = await discoverSkills(workspaceRoot)
      const localSkills = skills.filter((s) => s.path.startsWith(workspaceRoot))
      expect(localSkills).toEqual([])
    })

    test("parses skill without frontmatter", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "plain.md"),
        "Just plain markdown content without frontmatter.",
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "plain")

      expect(skill).toBeDefined()
      expect(skill?.content).toBe("Just plain markdown content without frontmatter.")
    })
  })

  describe("formatSkillsForPrompt", () => {
    test("returns empty string when no skills", () => {
      const result = formatSkillsForPrompt([])
      expect(result).toBe("")
    })

    test("formats single skill with XML tags", () => {
      const skills: Skill[] = [
        {
          name: "My Skill",
          description: "Does things",
          content: "Skill instructions here.",
          path: "/path/to/skill.md",
          frontmatter: { name: "My Skill", description: "Does things" },
        },
      ]

      const result = formatSkillsForPrompt(skills)

      expect(result).toContain("<discovered_skills>")
      expect(result).toContain("</discovered_skills>")
      expect(result).toContain('<skill name="My Skill" description="Does things">')
      expect(result).toContain("Skill instructions here.")
      expect(result).toContain("</skill>")
    })

    test("formats multiple skills", () => {
      const skills: Skill[] = [
        {
          name: "Skill One",
          description: "First",
          content: "Content 1",
          path: "/a.md",
          frontmatter: { name: "Skill One", description: "First" },
        },
        {
          name: "Skill Two",
          description: "Second",
          content: "Content 2",
          path: "/b.md",
          frontmatter: { name: "Skill Two", description: "Second" },
        },
      ]

      const result = formatSkillsForPrompt(skills)

      expect(result).toContain("Skill One")
      expect(result).toContain("Skill Two")
      expect(result).toContain("Content 1")
      expect(result).toContain("Content 2")
    })
  })

  describe("buildSystemPrompt integration", () => {
    test("includes discovered skills in system prompt", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "prompt-skill.md"),
        `---
name: PromptSkill
description: Injected into prompt
---
Use Read then Edit for file operations.`,
        "utf-8"
      )

      const prompt = await buildSystemPrompt({ workingDirectory: workspaceRoot })

      expect(prompt).toContain("<discovered_skills>")
      expect(prompt).toContain('name="PromptSkill"')
      expect(prompt).toContain("Use Read then Edit for file operations.")
    })

    test("system prompt includes core sections", async () => {
      const prompt = await buildSystemPrompt({ workingDirectory: workspaceRoot })

      expect(prompt).toContain("Working directory:")
      expect(prompt).toContain("Available tools:")
      expect(prompt).toContain("# Core Rules")
    })

    test("system prompt excludes isolated skills", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "visible.md"),
        `---
name: Visible
description: Should appear
---
Visible content`,
        "utf-8"
      )

      await writeFile(
        join(skillDir, "hidden.md"),
        `---
name: Hidden
description: Should not appear
isolatedContext: true
---
Hidden content`,
        "utf-8"
      )

      const prompt = await buildSystemPrompt({ workingDirectory: workspaceRoot })

      expect(prompt).toContain("Visible")
      expect(prompt).not.toContain("Hidden content")
    })
  })

  describe("Edge Cases", () => {
    test("handles malformed frontmatter gracefully", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "malformed.md"),
        `---
name: "unclosed quote
description: broken
---
Content`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      expect(Array.isArray(skills)).toBe(true)
    })

    test("handles tags with quotes and spaces", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "quoted-tags.md"),
        `---
name: Quoted Tags
description: Has quoted tags
tags: ["tag one", 'tag two', tag-three]
---
Content`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "Quoted Tags")

      expect(skill?.frontmatter.tags).toBeDefined()
      expect(skill?.frontmatter.tags?.length).toBeGreaterThan(0)
    })

    test("handles skill files with only frontmatter (empty body)", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      await writeFile(
        join(skillDir, "empty-body.md"),
        `---
name: Empty Body
description: No content after frontmatter
---`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "Empty Body")

      expect(skill).toBeDefined()
      expect(skill?.content).toBe("")
    })

    test("handles very long skill content", async () => {
      const skillDir = join(workspaceRoot, ".agents", "skills")
      await mkdir(skillDir, { recursive: true })

      const longContent = "x".repeat(100000)
      await writeFile(
        join(skillDir, "long.md"),
        `---
name: Long Skill
description: Has long content
---
${longContent}`,
        "utf-8"
      )

      const skills = await discoverSkills(workspaceRoot)
      const skill = skills.find((s) => s.name === "Long Skill")

      expect(skill).toBeDefined()
      expect(skill?.content.length).toBe(100000)
    })
  })
})
