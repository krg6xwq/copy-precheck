// Plain-language labels for the page and the exported report. Kept free of
// engine code so the browser bundle stays small: types only from the engine.

import type { Context, Finding, Layer, Severity } from "@/engine";

export const CONTEXT_LABELS: Record<Context, string> = {
  button: "Button",
  error: "Error message",
  confirmation: "Confirmation",
  "promo-banner": "Promo banner",
  "rate-card": "Rate card",
  "help-text": "Help text",
  notification: "Notification",
  "email-snippet": "Email",
};

export const SEVERITY_LABELS: Record<Severity, { one: string; many: string }> = {
  blocker: { one: "Blocker", many: "Blockers" },
  "needs-fix": { one: "Needs fix", many: "Needs fix" },
  suggestion: { one: "Suggestion", many: "Suggestions" },
};

export const SEVERITY_HINTS: Record<Severity, string> = {
  blocker: "Must be fixed before compliance review.",
  "needs-fix": "Fix before review unless there's a good reason not to.",
  suggestion: "The reviewer decides.",
};

export const SOURCE_LABELS: Record<Layer, string> = {
  guard: "Personal data",
  rule: "Rule check",
  ai: "AI suggestion",
};

export const SEVERITIES: Severity[] = ["blocker", "needs-fix", "suggestion"];

/** A stable key for a finding: same rule, same place in the same copy. */
export const findingKey = (finding: Finding) =>
  `${finding.ruleId}:${finding.match?.start ?? "-"}:${finding.match?.end ?? "-"}`;

export type Decision = "accepted" | "dismissed";
