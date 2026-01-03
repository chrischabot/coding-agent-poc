import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"

const CONFIG_DIR = ".coding-agent"
const PERMISSIONS_FILE = "permissions.json"

export interface StoredPermissions {
  granted: string[]
  updatedAt: number
}

function getPermissionsPath(workingDirectory: string): string {
  return join(workingDirectory, CONFIG_DIR, PERMISSIONS_FILE)
}

export async function loadPermissions(workingDirectory: string): Promise<Set<string>> {
  const path = getPermissionsPath(workingDirectory)
  try {
    const content = await readFile(path, "utf-8")
    const data: StoredPermissions = JSON.parse(content)
    return new Set(data.granted)
  } catch {
    return new Set()
  }
}

export async function savePermissions(workingDirectory: string, permissions: Set<string>): Promise<void> {
  const path = getPermissionsPath(workingDirectory)
  const data: StoredPermissions = {
    granted: Array.from(permissions),
    updatedAt: Date.now(),
  }
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(data, null, 2))
  } catch (err) {
    console.error("Failed to save permissions:", err)
  }
}

export async function addPermission(workingDirectory: string, permission: string): Promise<void> {
  const permissions = await loadPermissions(workingDirectory)
  permissions.add(permission)
  await savePermissions(workingDirectory, permissions)
}
