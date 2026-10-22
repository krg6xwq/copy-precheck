// Public entry point for the engine. Safe to import anywhere (CLI, tests,
// web page): nothing here reads files or calls the network.

export { checkCopy, flaggedRuleIds, OverrideError } from "./engine";
export type { CheckOptions, Finding, Override, Report, RuleRun, RuleStatus } from "./engine";
export * from "./schema";
