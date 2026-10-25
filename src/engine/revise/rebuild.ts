// Rebuilds a report on the server for the revision step. Code findings are
// recomputed from the copy; AI findings come from the browser (re-asking the
// AI would cost money and could give different answers), so each one is
// checked: a real AI rule, and words that are really in the copy.

import { checkCopy, sortFindings, type Finding, type Override, type Report } from "../engine";
import type { Context, RulesFile } from "../schema";

export interface ClientAiFinding {
  ruleId: string;
  start: number;
  end: number;
  detail?: string;
  suggestion?: string;
}

const tidy = (text: string | undefined) => text?.replace(/\s+/g, " ").trim().slice(0, 500) || undefined;

export function rebuildReport(
  text: string,
  rulesFile: RulesFile,
  options: { context?: Context; overrides?: Override[] },
  aiFindings: ClientAiFinding[],
): Report {
  const report = checkCopy(text, rulesFile, options);
  const aiRules = new Map(rulesFile.rules.filter((rule) => rule.layer === "ai").map((rule) => [rule.id, rule]));
  const seen = new Set<string>();
  const ai: Finding[] = [];
  for (const item of aiFindings) {
    const rule = aiRules.get(item.ruleId);
    const valid =
      rule &&
      Number.isInteger(item.start) &&
      Number.isInteger(item.end) &&
      item.start >= 0 &&
      item.end > item.start &&
      item.end <= text.length;
    if (!valid) continue;
    const key = `${item.ruleId}:${item.start}:${item.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const detail = tidy(item.detail);
    const suggestion = tidy(item.suggestion);
    ai.push({
      ruleId: rule.id,
      ruleName: rule.name,
      category: rule.category,
      layer: "ai",
      severity: rule.severity,
      match: { start: item.start, end: item.end, text: text.slice(item.start, item.end) },
      ...(detail ? { detail } : {}),
      ...(suggestion ? { suggestion } : {}),
      why: rule.why.replace(/\s+/g, " ").trim(),
      fix: rule.fix.replace(/\s+/g, " ").trim(),
    });
  }
  return { ...report, findings: sortFindings([...report.findings, ...ai]) };
}
