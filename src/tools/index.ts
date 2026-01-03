import { registerTool } from "./registry"
import { readTool } from "./read"
import { editTool } from "./edit"
import { writeTool } from "./write"
import { deleteTool } from "./delete"
import { bashTool } from "./bash"
import { grepTool } from "./grep"
import { globTool } from "./glob"
import { taskTool, finderTool, oracleTool, painterTool, librarianTool, krakenTool } from "./subagent"
import { todoWriteTool, todoReadTool } from "./todo"
import { webFetchTool } from "./webfetch"
import { webSearchTool } from "./websearch"
import { readPlanTool, editPlanTool, readArtifactTool, editArtifactTool } from "./plan"
import { scratchpadTool, readScratchpadTool } from "./scratchpad"
import { lookAtTool } from "./look-at"
import { mermaidTool } from "./mermaid"
import { readThreadTool } from "./thread"
import {
  readGitHubFileTool,
  searchGitHubCodeTool,
  searchGitHubCommitsTool,
  getGitHubDiffTool,
  findGitHubFilesTool,
} from "./github"
import { outlineTool } from "./outline"
import { astGrepTool } from "./astgrep"
import { readSymbolTool, shutdownAllLSP } from "./read-symbol"
import {
  goToDefinitionTool,
  findReferencesTool,
  getTypeInfoTool,
  cleanupSharedLSPManager,
} from "./lsp-tools"
import { calculatorTool } from "./calculator"

export function registerBuiltinTools(): void {
  registerTool(readTool)
  registerTool(editTool)
  registerTool(writeTool)
  registerTool(deleteTool)
  registerTool(bashTool)
  registerTool(grepTool)
  registerTool(globTool)
  registerTool(taskTool)
  registerTool(finderTool)
  registerTool(oracleTool)
  registerTool(painterTool)
  registerTool(librarianTool)
  registerTool(krakenTool)
  registerTool(todoWriteTool)
  registerTool(todoReadTool)
  registerTool(webFetchTool)
  registerTool(readPlanTool)
  registerTool(editPlanTool)
  registerTool(readArtifactTool)
  registerTool(editArtifactTool)
  registerTool(scratchpadTool)
  registerTool(readScratchpadTool)
  registerTool(lookAtTool)
  registerTool(mermaidTool)
  registerTool(readGitHubFileTool)
  registerTool(searchGitHubCodeTool)
  registerTool(searchGitHubCommitsTool)
  registerTool(getGitHubDiffTool)
  registerTool(findGitHubFilesTool)
  registerTool(webSearchTool)
  registerTool(readThreadTool)
  registerTool(outlineTool)
  registerTool(astGrepTool)
  registerTool(readSymbolTool)
  registerTool(goToDefinitionTool)
  registerTool(findReferencesTool)
  registerTool(getTypeInfoTool)
  registerTool(calculatorTool)
}

export * from "./registry"
export { readTool } from "./read"
export { editTool } from "./edit"
export { writeTool } from "./write"
export { deleteTool } from "./delete"
export { bashTool } from "./bash"
export { grepTool } from "./grep"
export { globTool } from "./glob"
export { taskTool, finderTool, oracleTool, painterTool, librarianTool, krakenTool } from "./subagent"
export { todoWriteTool, todoReadTool, clearTodos, getTodosForThread } from "./todo"
export { webFetchTool } from "./webfetch"
export { webSearchTool } from "./websearch"
export { readPlanTool, editPlanTool, readArtifactTool, editArtifactTool } from "./plan"
export { scratchpadTool, readScratchpadTool } from "./scratchpad"
export { lookAtTool } from "./look-at"
export { mermaidTool } from "./mermaid"
export {
  readGitHubFileTool,
  searchGitHubCodeTool,
  searchGitHubCommitsTool,
  getGitHubDiffTool,
  findGitHubFilesTool,
} from "./github"
export { readThreadTool } from "./thread"
export { outlineTool } from "./outline"
export { astGrepTool } from "./astgrep"
export { readSymbolTool, shutdownAllLSP } from "./read-symbol"
export {
  goToDefinitionTool,
  findReferencesTool,
  getTypeInfoTool,
  cleanupSharedLSPManager,
} from "./lsp-tools"
export { calculatorTool } from "./calculator"
