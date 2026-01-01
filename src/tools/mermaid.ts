import { writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { spawn } from "node:child_process"
import type { Tool, ToolResult } from "../core/types"

export const mermaidTool: Tool = {
  spec: {
    name: "Mermaid",
    description: `Render a Mermaid diagram to SVG or PNG.

Use this to create visual diagrams from Mermaid syntax. Supports:
- Flowcharts
- Sequence diagrams
- Class diagrams
- State diagrams
- Entity relationship diagrams
- And more

Requires mermaid-cli (mmdc) to be installed: npm install -g @mermaid-js/mermaid-cli`,
    inputSchema: {
      type: "object",
      properties: {
        diagram: {
          type: "string",
          description: "Mermaid diagram code",
        },
        output: {
          type: "string",
          description: "Output file path (e.g., diagram.svg or diagram.png)",
        },
        format: {
          type: "string",
          enum: ["svg", "png"],
          description: "Output format (default: svg)",
        },
      },
      required: ["diagram", "output"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const diagram = input.diagram as string
    const output = input.output as string
    const format = (input.format as string) ?? "svg"

    const outputPath = output.startsWith("/") ? output : join(context.workingDirectory, output)
    const tempInputPath = join(context.workingDirectory, `.mermaid-temp-${Date.now()}.mmd`)

    try {
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(tempInputPath, diagram, "utf-8")

      const result = await runMermaidCli(tempInputPath, outputPath, format)

      const { unlink } = await import("node:fs/promises")
      await unlink(tempInputPath).catch(() => {})

      if (result.success) {
        return {
          output: `Diagram rendered successfully to: ${outputPath}\n\nDiagram source:\n\`\`\`mermaid\n${diagram}\n\`\`\``,
          isError: false,
        }
      } else {
        return {
          output: `Mermaid rendering failed: ${result.error}\n\nMake sure mermaid-cli is installed: npm install -g @mermaid-js/mermaid-cli`,
          isError: true,
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Failed to render diagram: ${message}`, isError: true }
    }
  },
}

function runMermaidCli(
  inputPath: string,
  outputPath: string,
  format: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("mmdc", ["-i", inputPath, "-o", outputPath, "-e", format], {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stderr = ""

    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message })
    })

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr || `Exit code: ${code}` })
      }
    })
  })
}
