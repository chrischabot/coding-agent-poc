import { $ } from "bun"
import { platform } from "os"

type CopyMethod = (text: string) => Promise<void>

let copyMethod: CopyMethod | null = null

function getCopyMethod(): CopyMethod {
  if (copyMethod) return copyMethod

  const os = platform()

  if (os === "darwin" && Bun.which("pbcopy")) {
    copyMethod = async (text: string) => {
      const proc = Bun.spawn(["pbcopy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
      proc.stdin.write(text)
      proc.stdin.end()
      await proc.exited.catch(() => {})
    }
    return copyMethod
  }

  if (os === "linux") {
    if (process.env["WAYLAND_DISPLAY"] && Bun.which("wl-copy")) {
      copyMethod = async (text: string) => {
        const proc = Bun.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
        proc.stdin.write(text)
        proc.stdin.end()
        await proc.exited.catch(() => {})
      }
      return copyMethod
    }
    if (Bun.which("xclip")) {
      copyMethod = async (text: string) => {
        const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        })
        proc.stdin.write(text)
        proc.stdin.end()
        await proc.exited.catch(() => {})
      }
      return copyMethod
    }
    if (Bun.which("xsel")) {
      copyMethod = async (text: string) => {
        const proc = Bun.spawn(["xsel", "--clipboard", "--input"], {
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        })
        proc.stdin.write(text)
        proc.stdin.end()
        await proc.exited.catch(() => {})
      }
      return copyMethod
    }
  }

  if (os === "win32" && Bun.which("powershell")) {
    copyMethod = async (text: string) => {
      const escaped = text.replace(/"/g, '""')
      await $`powershell -command "Set-Clipboard -Value \"${escaped}\""`.nothrow().quiet()
    }
    return copyMethod
  }

  copyMethod = async (_text: string) => {
    console.error("No clipboard support available")
  }
  return copyMethod
}

export async function copyToClipboard(text: string): Promise<void> {
  const method = getCopyMethod()
  await method(text)
}
