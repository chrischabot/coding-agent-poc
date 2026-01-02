import { spawn } from "node:child_process"
import type { Tool, ToolResult } from "../core/types"

function runGhCommand(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("gh", args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 })
    })

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 })
    })
  })
}

export const readGitHubFileTool: Tool = {
  spec: {
    name: "ReadGitHubFile",
    description: `Read a file from a GitHub repository.

Use this to examine files in remote GitHub repositories without cloning.

Example: Read "src/index.ts" from "owner/repo" at branch "main"`,
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in owner/repo format",
        },
        path: {
          type: "string",
          description: "Path to the file within the repository",
        },
        ref: {
          type: "string",
          description: "Branch, tag, or commit SHA (default: default branch)",
        },
      },
      required: ["repo", "path"],
    },
  },
  async execute(input): Promise<ToolResult> {
    const repo = input.repo as string
    const path = input.path as string
    const ref = input.ref as string | undefined

    const args = ["api", `repos/${repo}/contents/${path}`]
    if (ref) {
      args.push("-f", `ref=${ref}`)
    }

    const result = await runGhCommand(args)

    if (result.code !== 0) {
      return { output: `Failed to read file: ${result.stderr}`, isError: true }
    }

    try {
      const data = JSON.parse(result.stdout)
      if (data.type !== "file") {
        return { output: `Path is not a file: ${data.type}`, isError: true }
      }

      const content = Buffer.from(data.content, "base64").toString("utf-8")
      return {
        output: `File: ${repo}/${path}${ref ? ` (${ref})` : ""}\n\n${content}`,
        isError: false,
      }
    } catch (err) {
      return { output: `Failed to parse response: ${result.stdout}`, isError: true }
    }
  },
}

export const searchGitHubCodeTool: Tool = {
  spec: {
    name: "SearchGitHubCode",
    description: `Search for code patterns across GitHub repositories.

Use this to find code examples, implementations, or patterns in public repositories.

Note: Requires GitHub authentication and is subject to rate limits.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (supports GitHub code search syntax)",
        },
        repo: {
          type: "string",
          description: "Optional: limit search to specific repo (owner/repo format)",
        },
        language: {
          type: "string",
          description: "Optional: filter by programming language",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default: 10)",
        },
      },
      required: ["query"],
    },
  },
  async execute(input): Promise<ToolResult> {
    const query = input.query as string
    const repo = input.repo as string | undefined
    const language = input.language as string | undefined
    const limit = (input.limit as number) ?? 10

    let searchQuery = query
    if (repo) {
      searchQuery += ` repo:${repo}`
    }
    if (language) {
      searchQuery += ` language:${language}`
    }

    const args = ["search", "code", searchQuery, "--limit", String(limit), "--json", "repository,path,textMatches"]

    const result = await runGhCommand(args)

    if (result.code !== 0) {
      return { output: `Search failed: ${result.stderr}`, isError: true }
    }

    try {
      const results = JSON.parse(result.stdout)
      if (results.length === 0) {
        return { output: "No results found", isError: false }
      }

      const formatted = results.map((r: { repository: { fullName: string }; path: string; textMatches: Array<{ fragment: string }> }) => {
        const matches = r.textMatches?.map((m: { fragment: string }) => `  ${m.fragment}`).join("\n") ?? ""
        return `${r.repository.fullName}/${r.path}\n${matches}`
      }).join("\n\n")

      return { output: `Found ${results.length} results:\n\n${formatted}`, isError: false }
    } catch {
      return { output: result.stdout, isError: false }
    }
  },
}

export const searchGitHubCommitsTool: Tool = {
  spec: {
    name: "SearchGitHubCommits",
    description: `Search commit history in GitHub repositories.

Use this to find commits related to specific changes, features, or bug fixes.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for commit messages",
        },
        repo: {
          type: "string",
          description: "Optional: limit to specific repo (owner/repo format)",
        },
        author: {
          type: "string",
          description: "Optional: filter by author",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 10)",
        },
      },
      required: ["query"],
    },
  },
  async execute(input): Promise<ToolResult> {
    const query = input.query as string
    const repo = input.repo as string | undefined
    const author = input.author as string | undefined
    const limit = (input.limit as number) ?? 10

    let searchQuery = query
    if (repo) {
      searchQuery += ` repo:${repo}`
    }
    if (author) {
      searchQuery += ` author:${author}`
    }

    const args = ["search", "commits", searchQuery, "--limit", String(limit), "--json", "repository,sha,commit"]

    const result = await runGhCommand(args)

    if (result.code !== 0) {
      return { output: `Search failed: ${result.stderr}`, isError: true }
    }

    try {
      const results = JSON.parse(result.stdout)
      if (results.length === 0) {
        return { output: "No commits found", isError: false }
      }

      const formatted = results.map((r: { repository: { fullName: string }; sha: string; commit: { message: string; author: { name: string; date: string } } }) => {
        const date = new Date(r.commit.author.date).toISOString().split("T")[0]
        const message = r.commit.message.split("\n")[0]
        return `${r.repository.fullName} ${r.sha.slice(0, 7)} (${date})\n  ${r.commit.author.name}: ${message}`
      }).join("\n\n")

      return { output: `Found ${results.length} commits:\n\n${formatted}`, isError: false }
    } catch {
      return { output: result.stdout, isError: false }
    }
  },
}

export const getGitHubDiffTool: Tool = {
  spec: {
    name: "GetGitHubDiff",
    description: `Get the diff between two refs (branches, tags, or commits) in a GitHub repository.

Use this to compare changes between versions or branches.`,
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in owner/repo format",
        },
        base: {
          type: "string",
          description: "Base ref (branch, tag, or commit)",
        },
        head: {
          type: "string",
          description: "Head ref to compare",
        },
      },
      required: ["repo", "base", "head"],
    },
  },
  async execute(input): Promise<ToolResult> {
    const repo = input.repo as string
    const base = input.base as string
    const head = input.head as string

    const args = ["api", `repos/${repo}/compare/${base}...${head}`, "--jq", ".files[] | {filename, status, additions, deletions, patch}"]

    const result = await runGhCommand(args)

    if (result.code !== 0) {
      return { output: `Failed to get diff: ${result.stderr}`, isError: true }
    }

    if (!result.stdout.trim()) {
      return { output: "No differences found", isError: false }
    }

    return {
      output: `Diff ${base}...${head} in ${repo}:\n\n${result.stdout}`,
      isError: false,
    }
  },
}

export const findGitHubFilesTool: Tool = {
  spec: {
    name: "FindGitHubFiles",
    description: `Find files in a GitHub repository by pattern.

Use this to discover what files exist in a remote repository.`,
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in owner/repo format",
        },
        pattern: {
          type: "string",
          description: "File pattern to search for (e.g., '*.ts', 'src/**/*.js')",
        },
        ref: {
          type: "string",
          description: "Branch, tag, or commit (default: default branch)",
        },
      },
      required: ["repo", "pattern"],
    },
  },
  async execute(input): Promise<ToolResult> {
    const repo = input.repo as string
    const pattern = input.pattern as string
    const ref = input.ref as string | undefined

    const args = [
      "api",
      `repos/${repo}/git/trees/${ref ?? "HEAD"}`,
      "-f",
      "recursive=1",
      "-q",
      ".tree[].path",
    ]

    const result = await runGhCommand(args)

    if (result.code !== 0) {
      const treeArgs = [
        "api",
        "repos/" + repo + "/git/trees/main",
        "-f",
        "recursive=1",
        "-q",
        ".tree[].path",
        "--paginate",
      ]
      const fallbackResult = await runGhCommand(treeArgs)

      if (fallbackResult.code !== 0) {
        return { output: `Failed to list files: ${fallbackResult.stderr}`, isError: true }
      }

      const allFiles = fallbackResult.stdout.trim().split("\n")
      const matched = filterByPattern(allFiles, pattern)

      return {
        output: `Files matching "${pattern}" in ${repo}:\n${matched.join("\n")}`,
        isError: false,
      }
    }

    const allFiles = result.stdout.trim().split("\n")
    const matched = filterByPattern(allFiles, pattern)

    if (matched.length === 0) {
      return { output: `No files matching "${pattern}" found in ${repo}`, isError: false }
    }

    return {
      output: `Files matching "${pattern}" in ${repo}:\n${matched.join("\n")}`,
      isError: false,
    }
  },
}

function filterByPattern(files: string[], pattern: string): string[] {
  const doubleStarToken = "__DOUBLE_STAR__"
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, doubleStarToken)
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(new RegExp(doubleStarToken, "g"), ".*")

  const regex = new RegExp("^" + escaped + "$")

  return files.filter((f) => regex.test(f))
}
