import { extname } from "node:path"
import { getFormatterForExtension } from "./formatters"

export { formatters, getFormatterForExtension } from "./formatters"
export type { FormatterInfo } from "./formatters"

export async function formatFile(
  filePath: string,
  workingDirectory: string
): Promise<void> {
  const ext = extname(filePath)
  const formatter = getFormatterForExtension(ext)

  if (!formatter) {
    return
  }

  const isEnabled = await formatter.enabled(workingDirectory)
  if (!isEnabled) {
    return
  }

  const command = formatter.command.map((arg) =>
    arg === "$FILE" ? filePath : arg
  )

  const proc = Bun.spawn(command, {
    cwd: workingDirectory,
    stdout: "ignore",
    stderr: "ignore",
  })

  await proc.exited
}
