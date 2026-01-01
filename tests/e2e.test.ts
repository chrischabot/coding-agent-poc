import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"
import Anthropic from "@anthropic-ai/sdk"
import { AgentLoop } from "../src/agent/loop"
import { registerBuiltinTools } from "../src/tools"
import { buildSystemPrompt } from "../src/prompt/system"
import { createThread } from "../src/session/persistence"

const MODEL = "claude-sonnet-4-20250514"
const TEST_TIMEOUT = 120000

interface CodeVerificationResult {
  isCorrect: boolean
  issues: string[]
  explanation: string
}

interface ExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function verifyCodeWithClaude(
  code: string,
  language: string,
  expectedBehavior: string
): Promise<CodeVerificationResult> {
  const client = new Anthropic()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Analyze this ${language} code and verify if it correctly implements: "${expectedBehavior}"

Code:
\`\`\`${language}
${code}
\`\`\`

Respond in JSON format only:
{
  "isCorrect": true/false,
  "issues": ["list of issues if any"],
  "explanation": "brief explanation"
}`,
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    return { isCorrect: false, issues: ["No response from Claude"], explanation: "" }
  }

  try {
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { isCorrect: false, issues: ["Could not parse JSON response"], explanation: textBlock.text }
    }
    return JSON.parse(jsonMatch[0]) as CodeVerificationResult
  } catch {
    return { isCorrect: false, issues: ["Failed to parse response"], explanation: textBlock.text }
  }
}

async function executeCode(
  filePath: string,
  language: string,
  workingDirectory: string
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    let command: string
    let args: string[]

    switch (language) {
      case "typescript":
        command = "bun"
        args = ["run", filePath]
        break
      case "python":
        command = "python3"
        args = [filePath]
        break
      case "rust":
        command = "sh"
        args = ["-c", `cd "${workingDirectory}" && rustc "${filePath}" -o "${filePath}.out" && "${filePath}.out"`]
        break
      default:
        resolve({ stdout: "", stderr: `Unknown language: ${language}`, exitCode: 1 })
        return
    }

    const proc = spawn(command, args, {
      cwd: workingDirectory,
      env: { ...process.env },
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 })
    })

    proc.on("error", (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 })
    })
  })
}

async function runAgentToGenerateCode(
  prompt: string,
  workingDirectory: string
): Promise<{ success: boolean; output: string }> {
  registerBuiltinTools()

  const systemPrompt = await buildSystemPrompt({ workingDirectory })
  const thread = createThread(workingDirectory)

  let output = ""
  let toolOutput = ""

  const agent = new AgentLoop(
    thread,
    { model: MODEL, systemPrompt, maxTurns: 15 },
    {
      onText: (text) => {
        output += text
      },
      onToolEnd: (_id, result, _isError) => {
        toolOutput += result + "\n"
      },
      onPermissionRequest: async () => true,
    }
  )

  try {
    await agent.run(prompt)
    return { success: true, output: output + "\n" + toolOutput }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}

async function findGeneratedFile(dir: string, extension: string): Promise<string | null> {
  try {
    const files = await readdir(dir)
    const matching = files.filter((f) => f.endsWith(extension))
    if (matching.length > 0) {
      return join(dir, matching[0])
    }
  } catch {
    return null
  }
  return null
}

function normalizeFizzBuzzOutput(output: string): string[] {
  return output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function normalizeNumberListOutput(output: string): number[] {
  const numbers: number[] = []
  const matches = output.match(/\d+/g)
  if (matches) {
    for (const m of matches) {
      numbers.push(parseInt(m, 10))
    }
  }
  return numbers
}

const EXPECTED_FIZZBUZZ_20 = [
  "1", "2", "Fizz", "4", "Buzz",
  "Fizz", "7", "8", "Fizz", "Buzz",
  "11", "Fizz", "13", "14", "FizzBuzz",
  "16", "17", "Fizz", "19", "Buzz",
]

function isPrime(n: number): boolean {
  if (n < 2) return false
  if (n === 2) return true
  if (n % 2 === 0) return false
  for (let i = 3; i <= Math.sqrt(n); i += 2) {
    if (n % i === 0) return false
  }
  return true
}

const EXPECTED_PRIMES_50 = Array.from({ length: 50 }, (_, i) => i + 1).filter(isPrime)

describe("E2E Code Generation Tests", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `coding-agent-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe("FizzBuzz Challenge", () => {
    test(
      "generates and executes correct TypeScript FizzBuzz",
      async () => {
        const prompt = `Create a TypeScript file called fizzbuzz.ts in the current directory that prints FizzBuzz from 1 to 20.
Rules: 
- Print "Fizz" for multiples of 3
- Print "Buzz" for multiples of 5  
- Print "FizzBuzz" for multiples of both 3 and 5
- Print the number otherwise
Each output on its own line. No extra text, just the FizzBuzz output.`

        const result = await runAgentToGenerateCode(prompt, testDir)
        expect(result.success).toBe(true)

        const filePath = await findGeneratedFile(testDir, ".ts")
        expect(filePath).not.toBeNull()

        const code = await readFile(filePath!, "utf-8")
        expect(code.length).toBeGreaterThan(10)

        const verification = await verifyCodeWithClaude(
          code,
          "typescript",
          "FizzBuzz from 1 to 20"
        )
        expect(verification.isCorrect).toBe(true)

        const execution = await executeCode(filePath!, "typescript", testDir)
        expect(execution.exitCode).toBe(0)

        const output = normalizeFizzBuzzOutput(execution.stdout)
        expect(output).toEqual(EXPECTED_FIZZBUZZ_20)
      },
      TEST_TIMEOUT
    )

    test(
      "generates and executes correct Python FizzBuzz",
      async () => {
        const prompt = `Create a Python file called fizzbuzz.py in the current directory that prints FizzBuzz from 1 to 20.
Rules:
- Print "Fizz" for multiples of 3
- Print "Buzz" for multiples of 5
- Print "FizzBuzz" for multiples of both 3 and 5
- Print the number otherwise
Each output on its own line. No extra text, just the FizzBuzz output.`

        const result = await runAgentToGenerateCode(prompt, testDir)
        expect(result.success).toBe(true)

        const filePath = await findGeneratedFile(testDir, ".py")
        expect(filePath).not.toBeNull()

        const code = await readFile(filePath!, "utf-8")
        expect(code.length).toBeGreaterThan(10)

        const verification = await verifyCodeWithClaude(
          code,
          "python",
          "FizzBuzz from 1 to 20"
        )
        expect(verification.isCorrect).toBe(true)

        const execution = await executeCode(filePath!, "python", testDir)
        expect(execution.exitCode).toBe(0)

        const output = normalizeFizzBuzzOutput(execution.stdout)
        expect(output).toEqual(EXPECTED_FIZZBUZZ_20)
      },
      TEST_TIMEOUT
    )

    test(
      "generates and executes correct Rust FizzBuzz",
      async () => {
        const prompt = `Create a Rust file called fizzbuzz.rs in the current directory that prints FizzBuzz from 1 to 20.
Rules:
- Print "Fizz" for multiples of 3
- Print "Buzz" for multiples of 5
- Print "FizzBuzz" for multiples of both 3 and 5
- Print the number otherwise
Each output on its own line. No extra text, just the FizzBuzz output. Include a main function.`

        const result = await runAgentToGenerateCode(prompt, testDir)
        expect(result.success).toBe(true)

        const filePath = await findGeneratedFile(testDir, ".rs")
        expect(filePath).not.toBeNull()

        const code = await readFile(filePath!, "utf-8")
        expect(code.length).toBeGreaterThan(10)

        const verification = await verifyCodeWithClaude(
          code,
          "rust",
          "FizzBuzz from 1 to 20"
        )
        expect(verification.isCorrect).toBe(true)

        const execution = await executeCode(filePath!, "rust", testDir)
        expect(execution.exitCode).toBe(0)

        const output = normalizeFizzBuzzOutput(execution.stdout)
        expect(output).toEqual(EXPECTED_FIZZBUZZ_20)
      },
      TEST_TIMEOUT
    )
  })

  describe("Prime Numbers Challenge", () => {
    test(
      "generates and executes correct TypeScript prime numbers",
      async () => {
        const prompt = `Create a TypeScript file called primes.ts in the current directory that prints all prime numbers from 1 to 50.
Print each prime number on its own line. No extra text or labels, just the numbers.`

        const result = await runAgentToGenerateCode(prompt, testDir)
        expect(result.success).toBe(true)

        const filePath = await findGeneratedFile(testDir, ".ts")
        expect(filePath).not.toBeNull()

        const code = await readFile(filePath!, "utf-8")
        expect(code.length).toBeGreaterThan(10)

        const verification = await verifyCodeWithClaude(
          code,
          "typescript",
          "Print all prime numbers from 1 to 50"
        )
        expect(verification.isCorrect).toBe(true)

        const execution = await executeCode(filePath!, "typescript", testDir)
        expect(execution.exitCode).toBe(0)

        const output = normalizeNumberListOutput(execution.stdout)
        expect(output).toEqual(EXPECTED_PRIMES_50)
      },
      TEST_TIMEOUT
    )

    test(
      "generates and executes correct Python prime numbers",
      async () => {
        const prompt = `Create a Python file called primes.py in the current directory that prints all prime numbers from 1 to 50.
Print each prime number on its own line. No extra text or labels, just the numbers.`

        const result = await runAgentToGenerateCode(prompt, testDir)
        expect(result.success).toBe(true)

        const filePath = await findGeneratedFile(testDir, ".py")
        expect(filePath).not.toBeNull()

        const code = await readFile(filePath!, "utf-8")
        expect(code.length).toBeGreaterThan(10)

        const verification = await verifyCodeWithClaude(
          code,
          "python",
          "Print all prime numbers from 1 to 50"
        )
        expect(verification.isCorrect).toBe(true)

        const execution = await executeCode(filePath!, "python", testDir)
        expect(execution.exitCode).toBe(0)

        const output = normalizeNumberListOutput(execution.stdout)
        expect(output).toEqual(EXPECTED_PRIMES_50)
      },
      TEST_TIMEOUT
    )

    test(
      "generates and executes correct Rust prime numbers",
      async () => {
        const prompt = `Create a Rust file called primes.rs in the current directory that prints all prime numbers from 1 to 50.
Print each prime number on its own line. No extra text or labels, just the numbers. Include a main function.`

        const result = await runAgentToGenerateCode(prompt, testDir)
        expect(result.success).toBe(true)

        const filePath = await findGeneratedFile(testDir, ".rs")
        expect(filePath).not.toBeNull()

        const code = await readFile(filePath!, "utf-8")
        expect(code.length).toBeGreaterThan(10)

        const verification = await verifyCodeWithClaude(
          code,
          "rust",
          "Print all prime numbers from 1 to 50"
        )
        expect(verification.isCorrect).toBe(true)

        const execution = await executeCode(filePath!, "rust", testDir)
        expect(execution.exitCode).toBe(0)

        const output = normalizeNumberListOutput(execution.stdout)
        expect(output).toEqual(EXPECTED_PRIMES_50)
      },
      TEST_TIMEOUT
    )
  })
})
