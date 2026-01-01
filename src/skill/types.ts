export interface SkillFrontmatter {
  name: string
  description: string
  isolatedContext?: boolean
  tags?: string[]
}

export interface Skill {
  name: string
  description: string
  content: string
  path: string
  frontmatter: SkillFrontmatter
}
