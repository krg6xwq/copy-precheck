// Runs the rules in order: personal-data guard, then code rules. AI rules are
// listed but not run yet (Day 3). Pure function: no file system, no network,
// so the CLI, the tests and the web page all use exactly the same logic.

import { runCheck } from "./checks";
import type { Category, Context, Layer, Rule, RulesFile, Severity } from "./schema";
import type { Span } from "./text";

export interface Finding {
  ruleId: string;
  ruleName: string;
  category: Category;
  layer: Layer;
  severity: Severity;
  /** The words that triggered the finding, if it points at specific text. */
  match: Span | null;
  detail?: string;
  why: string;
  fix: string;
  /** Set when a reviewer released a guard finding (guard rules only). */
  override?: { reason: string };
}

/**
 * What happened to each rule. "passed" means the rule ran and found nothing;
 * "not-applicable" means it didn't run. Keeping them apart stops a test from
 * passing by accident (decisions.md D16).
 */
export type RuleStatus = "flagged" | "passed" | "not-applicable" | "ai-pending" | "ai-blocked";

export interface RuleRun {
  ruleId: string;
  layer: Layer;
  status: RuleStatus;
  reason?: string;
}

export interface CheckOptions {
  /** Where the copy appears. If missing, every rule runs. */
  context?: Context;
  /** Guard rule ID → the reviewer's reason for releasing its findings. */
  overrides?: Record<string, string>;
}

export interface Report {
  text: string;
  context?: Context;
  rulesVersion: string;
  findings: Finding[];
  runs: RuleRun[];
  guard: {
    /** Guard findings that have not been overridden. */
    open: number;
    overridden: number;
  };
  /** Whether the copy may be sent to the AI layer. */
  aiAllowed: boolean;
  warnings: string[];
}

export class OverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverrideError";
  }
}

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, "needs-fix": 1, suggestion: 2 };

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

function validateOverrides(rules: Rule[], overrides: Record<string, string>): void {
  for (const [ruleId, reason] of Object.entries(overrides)) {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) throw new OverrideError(`Unknown rule ${ruleId}`);
    if (rule.layer !== "guard") {
      throw new OverrideError(`${ruleId} is not a guard rule. Only personal-data findings can be overridden.`);
    }
    if (!reason.trim()) throw new OverrideError(`An override of ${ruleId} needs a reason`);
  }
}

export function checkCopy(text: string, rulesFile: RulesFile, options: CheckOptions = {}): Report {
  const { context, overrides = {} } = options;
  validateOverrides(rulesFile.rules, overrides);

  const findings: Finding[] = [];
  const runs: RuleRun[] = [];
  const seen = new Set<string>();

  const codeRules = rulesFile.rules.filter((rule) => rule.layer !== "ai");
  const ordered = [
    ...codeRules.filter((rule) => rule.layer === "guard"),
    ...codeRules.filter((rule) => rule.layer === "rule"),
  ];

  for (const rule of ordered) {
    if (context && rule.contexts && !rule.contexts.includes(context)) {
      runs.push({ ruleId: rule.id, layer: rule.layer, status: "not-applicable", reason: `Not checked in ${context}` });
      continue;
    }
    const result = runCheck(rule.check, text);
    if (!result.applies) {
      runs.push({ ruleId: rule.id, layer: rule.layer, status: "not-applicable", reason: result.reason });
      continue;
    }
    let added = 0;
    for (const hit of result.hits) {
      // One finding per rule per place in the text (decisions.md D10).
      const key = `${rule.id}:${hit.span?.start ?? "-"}:${hit.span?.end ?? "-"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      added++;
      const reason = rule.layer === "guard" ? overrides[rule.id] : undefined;
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        layer: rule.layer,
        severity: rule.severity,
        match: hit.span,
        detail: hit.detail,
        why: clean(rule.why),
        fix: clean(rule.fix),
        ...(reason ? { override: { reason: reason.trim() } } : {}),
      });
    }
    runs.push({ ruleId: rule.id, layer: rule.layer, status: added ? "flagged" : "passed" });
  }

  const guardFindings = findings.filter((finding) => finding.layer === "guard");
  const open = guardFindings.filter((finding) => !finding.override).length;
  const aiAllowed = open === 0;

  for (const rule of rulesFile.rules.filter((r) => r.layer === "ai")) {
    runs.push(
      aiAllowed
        ? { ruleId: rule.id, layer: "ai", status: "ai-pending", reason: "AI layer not built yet" }
        : { ruleId: rule.id, layer: "ai", status: "ai-blocked", reason: "Personal data must be replaced first" },
    );
  }

  const warnings = Object.keys(overrides)
    .filter((ruleId) => !guardFindings.some((finding) => finding.ruleId === ruleId))
    .map((ruleId) => `Override for ${ruleId} was not needed: it found nothing`);

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.match?.start ?? -1) - (b.match?.start ?? -1),
  );

  return {
    text,
    context,
    rulesVersion: rulesFile.version,
    findings,
    runs,
    guard: { open, overridden: guardFindings.length - open },
    aiAllowed,
    warnings,
  };
}

/** Rule IDs with at least one finding that is still open. */
export function flaggedRuleIds(report: Report): string[] {
  return [...new Set(report.findings.filter((f) => !f.override).map((f) => f.ruleId))].sort();
}
