import { z } from "zod";
import { defineTool } from "./tool.js";
import { isWithinProjectRoot } from "../util/path.js";

export const readFileTool = defineTool("read_file", {
  description: "Read the contents of a file from the filesystem",
  parameters: z.object({
    path: z.string().describe("Absolute or relative path to the file"),
  }),
  async execute(params, ctx) {
    // Resolve path relative to working directory
    const path = await import("path");
    const absolutePath = path.isAbsolute(params.path)
      ? params.path
      : path.join(ctx.workingDirectory, params.path);

    // Security check: ensure within project root
    if (!isWithinProjectRoot(absolutePath, ctx.workingDirectory)) {
      return {
        title: params.path,
        output: "Error: Cannot read files outside the project root",
        error: true,
      };
    }

    try {
      const file = Bun.file(absolutePath);
      const exists = await file.exists();

      if (!exists) {
        return {
          title: params.path,
          output: `File not found: ${absolutePath}`,
          error: true,
        };
      }

      const content = await file.text();
      const lines = content.split("\n");

      // Format with line numbers
      const formatted = lines
        .map((line, i) => `${(i + 1).toString().padStart(5)}: ${line}`)
        .join("\n");

      return {
        title: params.path,
        output: formatted,
        metadata: {
          totalLines: lines.length,
        },
      };
    } catch (error) {
      return {
        title: params.path,
        output: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        error: true,
      };
    }
  },
});
