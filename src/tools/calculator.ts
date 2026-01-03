import type { Tool, ToolContext } from "../core/types"

async function executeCalculator(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ output: string; isError?: boolean }> {
  const expression = input.expression as string
  const operation = input.operation as string | undefined
  const a = input.a as number | undefined
  const b = input.b as number | undefined

  // If expression is provided, evaluate it
  if (expression) {
    try {
      // Sanitize expression to only allow basic math operations
      const sanitized = expression.replace(/[^0-9+\-*/.() ]/g, '')
      if (sanitized !== expression) {
        return {
          output: "Error: Expression contains invalid characters. Only numbers and basic math operators (+, -, *, /, parentheses) are allowed.",
          isError: true
        }
      }

      // Use Function constructor for safe evaluation
      const result = Function(`"use strict"; return (${sanitized})`)()
      
      if (typeof result !== 'number' || !isFinite(result)) {
        return {
          output: "Error: Invalid expression or result is not a finite number",
          isError: true
        }
      }

      return {
        output: `${expression} = ${result}`
      }
    } catch (error) {
      return {
        output: `Error evaluating expression: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      }
    }
  }

  // If operation and operands are provided, perform specific operation
  if (operation && typeof a === 'number' && typeof b === 'number') {
    try {
      let result: number
      
      switch (operation.toLowerCase()) {
        case 'add':
        case '+':
          result = a + b
          break
        case 'subtract':
        case '-':
          result = a - b
          break
        case 'multiply':
        case '*':
          result = a * b
          break
        case 'divide':
        case '/':
          if (b === 0) {
            return {
              output: "Error: Division by zero",
              isError: true
            }
          }
          result = a / b
          break
        case 'power':
        case '**':
        case '^':
          result = Math.pow(a, b)
          break
        case 'modulo':
        case '%':
          if (b === 0) {
            return {
              output: "Error: Modulo by zero",
              isError: true
            }
          }
          result = a % b
          break
        default:
          return {
            output: `Error: Unknown operation '${operation}'. Supported operations: add, subtract, multiply, divide, power, modulo`,
            isError: true
          }
      }

      if (!isFinite(result)) {
        return {
          output: "Error: Result is not a finite number",
          isError: true
        }
      }

      return {
        output: `${a} ${operation} ${b} = ${result}`
      }
    } catch (error) {
      return {
        output: `Error performing calculation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      }
    }
  }

  // If only single number operations
  if (operation && typeof a === 'number' && b === undefined) {
    try {
      let result: number
      
      switch (operation.toLowerCase()) {
        case 'sqrt':
        case 'square_root':
          if (a < 0) {
            return {
              output: "Error: Cannot calculate square root of negative number",
              isError: true
            }
          }
          result = Math.sqrt(a)
          break
        case 'abs':
        case 'absolute':
          result = Math.abs(a)
          break
        case 'sin':
          result = Math.sin(a)
          break
        case 'cos':
          result = Math.cos(a)
          break
        case 'tan':
          result = Math.tan(a)
          break
        case 'log':
        case 'ln':
          if (a <= 0) {
            return {
              output: "Error: Cannot calculate natural logarithm of non-positive number",
              isError: true
            }
          }
          result = Math.log(a)
          break
        case 'log10':
          if (a <= 0) {
            return {
              output: "Error: Cannot calculate log10 of non-positive number",
              isError: true
            }
          }
          result = Math.log10(a)
          break
        case 'exp':
          result = Math.exp(a)
          break
        case 'floor':
          result = Math.floor(a)
          break
        case 'ceil':
        case 'ceiling':
          result = Math.ceil(a)
          break
        case 'round':
          result = Math.round(a)
          break
        default:
          return {
            output: `Error: Unknown single-operand operation '${operation}'. Supported operations: sqrt, abs, sin, cos, tan, log, log10, exp, floor, ceil, round`,
            isError: true
          }
      }

      if (!isFinite(result)) {
        return {
          output: "Error: Result is not a finite number",
          isError: true
        }
      }

      return {
        output: `${operation}(${a}) = ${result}`
      }
    } catch (error) {
      return {
        output: `Error performing calculation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      }
    }
  }

  return {
    output: "Error: Please provide either an expression or an operation with appropriate operands",
    isError: true
  }
}

export const calculatorTool: Tool = {
  spec: {
    name: "Calculator",
    description: `Perform basic mathematical calculations.

You can use this tool in two ways:
1. Provide a mathematical expression to evaluate (e.g., "2 + 3 * 4")
2. Provide a specific operation with operands

Supported operations:
- Basic: add (+), subtract (-), multiply (*), divide (/), power (**), modulo (%)
- Single operand: sqrt, abs, sin, cos, tan, log (natural), log10, exp, floor, ceil, round

Examples:
- Expression: "2 + 3 * 4" evaluates to 14
- Operation: operation="add", a=5, b=3 results in 8
- Single operand: operation="sqrt", a=16 results in 4`,
    inputSchema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Mathematical expression to evaluate (e.g., '2 + 3 * 4')"
        },
        operation: {
          type: "string",
          description: "Specific operation to perform (add, subtract, multiply, divide, power, modulo, sqrt, abs, sin, cos, tan, log, log10, exp, floor, ceil, round)"
        },
        a: {
          type: "number",
          description: "First operand (or single operand for single-operand operations)"
        },
        b: {
          type: "number",
          description: "Second operand (not used for single-operand operations)"
        }
      },
      required: [],
    },
  },
  execute: executeCalculator,
}