import { readFile } from "node:fs/promises"
import { extname } from "node:path"
import type { Tool, ToolResult } from "../core/types"

const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"]
const SUPPORTED_DOCUMENT_EXTENSIONS = [".pdf"]

export const lookAtTool: Tool = {
  spec: {
    name: "LookAt",
    description: `Analyze images or PDF documents.

Use this to examine visual content like screenshots, diagrams, or PDF documents.

Supported formats:
- Images: PNG, JPG, JPEG, GIF, WebP
- Documents: PDF

The tool reads the file and returns a base64-encoded representation that can be analyzed.`,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the image or PDF file",
        },
        question: {
          type: "string",
          description: "Optional question about the content (e.g., 'What does this diagram show?')",
        },
      },
      required: ["path"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const path = input.path as string
    const question = input.question as string | undefined

    const ext = extname(path).toLowerCase()
    const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext)
    const isDocument = SUPPORTED_DOCUMENT_EXTENSIONS.includes(ext)

    if (!isImage && !isDocument) {
      return {
        output: `Unsupported file type: ${ext}. Supported: ${[...SUPPORTED_IMAGE_EXTENSIONS, ...SUPPORTED_DOCUMENT_EXTENSIONS].join(", ")}`,
        isError: true,
      }
    }

    try {
      const absolutePath = path.startsWith("/") ? path : `${context.workingDirectory}/${path}`
      const content = await readFile(absolutePath)
      const base64 = content.toString("base64")

      const mediaType = getMediaType(ext)
      const size = content.length
      const sizeKB = (size / 1024).toFixed(1)

      let output = `[${isImage ? "Image" : "Document"}: ${path}]
Type: ${mediaType}
Size: ${sizeKB} KB

Base64 content (${base64.length} chars):
data:${mediaType};base64,${base64.slice(0, 100)}...

`

      if (question) {
        output += `Question: ${question}\n\nNote: To analyze this content, the base64 data would need to be processed by a vision model.`
      } else {
        output += `The file has been read successfully. To analyze the visual content, a vision model would need to process the base64 data.`
      }

      return { output, isError: false }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: `Failed to read file: ${message}`, isError: true }
    }
  },
}

function getMediaType(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".gif":
      return "image/gif"
    case ".webp":
      return "image/webp"
    case ".pdf":
      return "application/pdf"
    default:
      return "application/octet-stream"
  }
}
