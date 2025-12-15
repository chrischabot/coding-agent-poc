import path from "path";

/**
 * Check if a path is within the project root directory
 * Prevents directory traversal attacks
 */
export function isWithinProjectRoot(
  targetPath: string,
  projectRoot: string
): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(projectRoot);

  // The target must start with the project root path
  return resolvedTarget.startsWith(resolvedRoot + path.sep) ||
    resolvedTarget === resolvedRoot;
}

/**
 * Get a relative path from project root
 */
export function relativePath(absolutePath: string, projectRoot: string): string {
  return path.relative(projectRoot, absolutePath);
}

/**
 * Resolve a path relative to project root
 */
export function resolvePath(inputPath: string, projectRoot: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.join(projectRoot, inputPath);
}
