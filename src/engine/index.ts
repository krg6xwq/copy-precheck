// Public entry point for the engine. Safe to import anywhere (CLI, tests,
// web page): nothing here reads files. The AI layer only calls the network
// through whichever AiModel it is given.

export { checkCopy, flaggedRuleIds, OverrideError } from "./engine";
export type {
  AiSummary,
  CheckOptions,
  Finding,
  Override,
  RejectedAiFinding,
  Report,
  RuleRun,
  RuleStatus,
} from "./engine";
export { checkCopyWithAi, runAiChecks } from "./ai/run";
export type { AiOptions } from "./ai/run";
export type { AiModel, AiPrompt } from "./ai/model";
export { buildPrompt } from "./ai/prompt";
export { locateQuote } from "./ai/response";
export * from "./schema";
