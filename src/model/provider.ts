import { openai } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

/**
 * Model configuration
 */
export interface ModelConfig {
  fastModel: string;
  deepModel: string;
}

/**
 * Default model configuration
 */
const defaultConfig: ModelConfig = {
  fastModel: "gpt-5-mini",
  deepModel: "gpt-5.1-codex-max",
};

/**
 * Current model configuration (can be overridden at runtime)
 */
let currentConfig: ModelConfig = { ...defaultConfig };

/**
 * Configure the models to use
 */
export function configureModels(config: Partial<ModelConfig>): void {
  currentConfig = {
    ...currentConfig,
    ...config,
  };
}

/**
 * Get the fast model for the agent loop
 * This model is used for routine operations: tool selection, memory updates, etc.
 */
export function getFastModel(): LanguageModelV1 {
  return openai(currentConfig.fastModel);
}

/**
 * Get the deep model for complex tasks
 * This model is used for: planning, refactoring, complex debugging, etc.
 */
export function getDeepModel(): LanguageModelV1 {
  return openai(currentConfig.deepModel);
}

/**
 * Get the current model configuration
 */
export function getModelConfig(): ModelConfig {
  return { ...currentConfig };
}

/**
 * Get model names for display
 */
export function getModelNames(): { fast: string; deep: string } {
  return {
    fast: currentConfig.fastModel,
    deep: currentConfig.deepModel,
  };
}
