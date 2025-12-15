import { z } from "zod";
import { createPatch } from "diff";
import path from "path";
import { defineTool } from "./tool.js";
import { isWithinProjectRoot } from "../util/path.js";
import { requestApproval, ApprovalType } from "../permission/index.js";

export const writeFileTool = defineTool("write_file", {
  description:
    "Write content to a file. Shows a diff and requires user approval unless YOLO mode is enabled.",
  parameters: z.object({
    path: z.string().describe("Absolute or relative path to the file"),
    content: z.string().describe("Content to write to the file"),
  }),
  async execute(params, ctx) {
    // Resolve path relative to working directory
    const absolutePath = path.isAbsolute(params.path)
      ? params.path
      : path.join(ctx.workingDirectory, params.path);

    // Security check: ensure within project root
    if (!isWithinProjectRoot(absolutePath, ctx.workingDirectory)) {
      return {
        title: params.path,
        output: "Error: Cannot write files outside the project root",
        error: true,
      };
    }

    try {
      const file = Bun.file(absolutePath);
      const exists = await file.exists();
      const oldContent = exists ? await file.text() : "";

      // Generate diff
      const diff = createPatch(
        params.path,
        oldContent,
        params.content,
        "original",
        "modified"
      );

      // Request approval if not in YOLO mode
      if (!ctx.yoloMode) {
        const approved = await requestApproval({
          type: ApprovalType.WRITE_FILE,
          sessionId: ctx.sessionId,
          title: exists ? `Overwrite: ${params.path}` : `Create: ${params.path}`,
          details: diff,
          metadata: {
            path: absolutePath,
            isNew: !exists,
            oldSize: oldContent.length,
            newSize: params.content.length,
          },
        });

        if (!approved) {
          return {
            title: params.path,
            output: "Write cancelled by user",
            error: true,
          };
        }
      }

      // Ensure parent directory exists
      const parentDir = path.dirname(absolutePath);
      await Bun.write(path.join(parentDir, ".keep"), ""); // Ensures dir exists
      await Bun.file(path.join(parentDir, ".keep")).delete?.();

      // Write the file
      await Bun.write(absolutePath, params.content);

      return {
        title: params.path,
        output: exists
          ? `Updated ${params.path} (${params.content.length} bytes)`
          : `Created ${params.path} (${params.content.length} bytes)`,
        metadata: {
          path: absolutePath,
          isNew: !exists,
          size: params.content.length,
          diff,
        },
      };
    } catch (error) {
      return {
        title: params.path,
        output: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
        error: true,
      };
    }
  },
});
