---
name: audit
description: "Comprehensive code audit for implementation completeness, integration, performance, and quality issues"
tags: ["analysis", "performance", "quality"]
---

# Code Audit Skill

When the user runs `/audit` or `/audit <feature>`, perform a comprehensive analysis of the codebase or specified feature.

## Audit Scope

### 1. Implementation Completeness
- Check if the feature has all necessary components:
  - Types/interfaces defined
  - Core logic implemented
  - Error handling in place
  - Edge cases covered

### 2. Integration Analysis
Check if the feature is properly connected across all layers:
- **Types** (`src/core/types.ts`) - Are interfaces exported and used?
- **Tools** (`src/tools/`) - Is there a tool exposing this feature?
- **Agent Loop** (`src/agent/loop.ts`) - Is it wired into the agent?
- **CLI** (`src/cli/`, `src/index.ts`) - Are there CLI commands/flags?
- **UI** (`src/ui/`) - Is there UI representation if applicable?
- **Tests** (`tests/`) - Are there tests covering the feature?

Report gaps like:
```
Integration Gaps:
  ✗ Not connected to AgentLoop
  ✗ No CLI command
  ✗ Missing from ToolContext
```

### 3. Performance Analysis

#### Big O Complexity Issues
Look for these anti-patterns:

**O(n²) or worse:**
```typescript
// BAD: Nested loops over same/related data
for (const item of items) {
  for (const other of items) { ... }
}

// BAD: Array.includes/indexOf inside loop
for (const item of items) {
  if (otherItems.includes(item)) { ... }  // O(n) inside O(n) = O(n²)
}

// BAD: filter/find inside loop
items.forEach(item => {
  const match = others.find(o => o.id === item.id)  // O(n²)
})
```

**Suggest fixes:**
```typescript
// GOOD: Use Set for O(1) lookups
const otherSet = new Set(otherItems)
for (const item of items) {
  if (otherSet.has(item)) { ... }  // O(n) total
}

// GOOD: Use Map for keyed lookups
const othersById = new Map(others.map(o => [o.id, o]))
items.forEach(item => {
  const match = othersById.get(item.id)  // O(n) total
})
```

#### Sub-optimal Data Structures
Flag these patterns:

| Pattern | Issue | Better Alternative |
|---------|-------|-------------------|
| `array.includes()` in hot path | O(n) lookup | `Set.has()` - O(1) |
| `array.find(x => x.id === id)` | O(n) lookup | `Map.get(id)` - O(1) |
| Repeated `Object.keys()` | Creates new array | Cache keys or use Map |
| `array.filter().map()` | Two iterations | Single `reduce()` or loop |
| String concatenation in loop | O(n²) memory | `Array.join()` or template |
| `delete obj[key]` in hot path | Deoptimizes object | Use Map or set to undefined |

#### Memory Issues
- Large arrays being copied unnecessarily
- Closures capturing large scopes
- Missing cleanup/disposal of resources
- Event listeners not removed

### 4. Code Quality Issues

#### Error Handling
- Catch blocks that swallow errors silently
- Missing error propagation
- Inconsistent error types
- No error recovery strategy

#### Type Safety
- `any` types that could be narrowed
- Missing null checks
- Unsafe type assertions (`as`)
- Missing return types on public functions

#### Code Smells
- Functions over 50 lines
- Files over 500 lines
- Deep nesting (> 4 levels)
- Magic numbers/strings without constants
- Duplicated logic across files
- Dead code / unused exports
- Console.log left in production code
- TODO/FIXME/HACK comments

#### Security
- SQL/command injection risks
- Unsanitized user input
- Hardcoded secrets/credentials
- Unsafe deserialization

### 5. Lifecycle & Resource Management
- Resources opened but not closed
- Missing cleanup in error paths
- No shutdown/dispose methods
- Event listeners without cleanup
- Timers/intervals not cleared

## Output Format

Structure the audit report as:

```
═══════════════════════════════════════════════════════════════
                     AUDIT REPORT: <feature/scope>
═══════════════════════════════════════════════════════════════

SUMMARY
───────────────────────────────────────────────────────────────
Overall Health: <GOOD | NEEDS ATTENTION | CRITICAL>
Issues Found: <count>
  - Critical: <count>
  - Performance: <count>
  - Quality: <count>
  - Integration: <count>

IMPLEMENTATION STATUS
───────────────────────────────────────────────────────────────
✓ Types defined (src/path/types.ts)
✓ Core logic implemented (src/path/impl.ts)
✗ Missing error handling in X
✗ Edge case Y not covered

INTEGRATION STATUS
───────────────────────────────────────────────────────────────
✓ Connected to AgentLoop
✓ Tool created (ToolName)
✗ Not exposed in CLI
✗ No UI representation
✗ Missing tests

PERFORMANCE ISSUES
───────────────────────────────────────────────────────────────
[P1] O(n²) loop in src/file.ts:123
     for (x of items) { if (others.includes(x)) }
     → Use Set for O(1) lookups

[P2] Suboptimal data structure in src/file.ts:456
     Repeated array.find() lookups
     → Convert to Map for O(1) access

CODE QUALITY
───────────────────────────────────────────────────────────────
[Q1] Swallowed error in src/file.ts:789
     catch (e) { /* silent */ }
     → Log or rethrow error

[Q2] Missing null check in src/file.ts:234
     user.profile.name (profile may be undefined)
     → Add optional chaining: user.profile?.name

RECOMMENDATIONS
───────────────────────────────────────────────────────────────
1. [High Priority] Fix O(n²) loop - impacts performance at scale
2. [Medium] Add CLI command for feature accessibility
3. [Low] Add tests for edge cases
```

## Execution Steps

1. **If feature specified**: Focus audit on that feature's files
2. **If no feature**: Audit recently modified files or core modules
3. **Read relevant files** using Read tool
4. **Analyze** against all criteria above
5. **Generate report** in the structured format
6. **Prioritize issues** by impact (Critical > Performance > Quality > Style)

## Examples

```
User: /audit lsp
→ Audit the LSP integration (src/lsp/*, related tools, agent connection)

User: /audit
→ Audit core modules or recently changed files

User: /audit src/tools/read.ts
→ Audit specific file
```
