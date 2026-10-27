// Turns a report and the reviewer's decisions into Markdown, for pasting into
// a ticket or attaching to a compliance request.

import type { Finding, Report } from "@/engine";
import {
  CONTEXT_LABELS,
  findingKey,
  SEVERITIES,
  SEVERITY_LABELS,
  SOURCE_LABELS,
  type Decision,
} from "./labels";

const DECISION_LABELS: Record<Decision, string> = { accepted: "Accepted", dismissed: "Dismissed" };

/** One approved round of the review and rewrite loop, for the audit trail. */
export interface RoundSummary {
  round: number;
  text: string;
  items: { ruleId: string; ruleName: string; words?: string; decision: Decision; comment?: string }[];
  changes: { who: string; before: string; after: string }[];
  kept: string[];
  /** Accepted findings the approved draft didn't fix. */
  unfixed?: string[];
  answers: { question: string; answer: string }[];
  model?: string;
  approvedAt: Date;
}

export interface MarkdownExtras {
  comments?: Record<string, string>;
  round?: number;
  history?: RoundSummary[];
}

const time = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** Keeps Markdown structure intact when copy contains special characters. */
const inline = (text: string) => text.replace(/\s+/g, " ").replace(/([\\`*_[\]<>|])/g, "\\$1");

function findingLines(finding: Finding, decisions: Record<string, Decision>, comments: Record<string, string> = {}): string[] {
  const decision = finding.override
    ? `Overridden: ${inline(finding.override.reason)}`
    : (decisions[findingKey(finding)] && DECISION_LABELS[decisions[findingKey(finding)]]) || "Not reviewed";
  const quote = finding.match ? ` — “${inline(finding.match.text)}”` : "";
  const lines = [
    `- **${finding.ruleId} ${inline(finding.ruleName)}** (${SOURCE_LABELS[finding.layer]})${quote}`,
    `  - Decision: ${decision}`,
  ];
  const comment = comments[findingKey(finding)]?.trim();
  if (comment && !finding.override) {
    lines.push(`  - ${decisions[findingKey(finding)] === "dismissed" ? "Reason" : "Note for the revision"}: ${inline(comment)}`);
  }
  if (finding.detail) lines.push(`  - ${finding.layer === "ai" ? "AI note" : "Detail"}: ${inline(finding.detail)}`);
  if (finding.suggestion) lines.push(`  - Suggested wording: ${inline(finding.suggestion)}`);
  for (const agreement of finding.aiAgreement ?? []) {
    lines.push(`  - ${agreement.ruleId} (AI) agrees: ${inline(agreement.explanation)}`);
  }
  lines.push(`  - Fix: ${inline(finding.fix)}`);
  return lines;
}

function aiLine(report: Report): string {
  switch (report.ai.status) {
    case "done":
      return `done (${report.ai.model})`;
    case "blocked":
      return "not run: personal data must be replaced first";
    case "unavailable":
      return `unavailable: ${report.ai.reason}`;
    default:
      return "not run";
  }
}

function roundLines(summary: RoundSummary): string[] {
  const lines = [`### Round ${summary.round} (approved ${time(summary.approvedAt)})`, "", ...summary.text.split("\n").map((l) => `> ${inline(l)}`), ""];
  lines.push("Decisions:", "");
  for (const item of summary.items) {
    const words = item.words ? ` — “${inline(item.words)}”` : "";
    const comment = item.comment?.trim() ? ` (${item.decision === "dismissed" ? "reason" : "note"}: ${inline(item.comment)})` : "";
    lines.push(`- ${item.ruleId} ${inline(item.ruleName)}${words}: ${DECISION_LABELS[item.decision]}${comment}`);
  }
  lines.push("", `Changes in the approved draft${summary.model ? ` (drafted by ${inline(summary.model)}, checked by code)` : ""}:`, "");
  for (const change of summary.changes) {
    const before = change.before.trim() ? `“${inline(change.before.trim())}”` : "(nothing)";
    const after = change.after.trim() ? `“${inline(change.after.trim())}”` : "(removed)";
    lines.push(`- ${inline(change.who)}: ${before} → ${after}`);
  }
  for (const answer of summary.answers) lines.push(`- Reviewer answered “${inline(answer.question)}”: ${inline(answer.answer)}`);
  for (const flag of summary.kept) lines.push(`- Flag kept by the reviewer: ${inline(flag)}`);
  for (const label of summary.unfixed ?? []) lines.push(`- Accepted but not fixed in this draft: ${inline(label)}`);
  lines.push("");
  return lines;
}

export function reportToMarkdown(
  report: Report,
  decisions: Record<string, Decision>,
  checkedAt: Date,
  extras: MarkdownExtras = {},
): string {
  const history = extras.history ?? [];
  const lines = [
    "# Copy pre-check report",
    "",
    `- Checked: ${time(checkedAt)}`,
    ...(history.length ? [`- Revisions approved: ${history.length}`] : []),
    `- Where it appears: ${report.context ? CONTEXT_LABELS[report.context] : "Not specified"}`,
    `- Rules: version ${report.rulesVersion}`,
    `- AI checks: ${aiLine(report)}`,
    "",
    history.length ? "## Current copy" : "## Copy",
    "",
    ...report.text.split("\n").map((line) => `> ${inline(line)}`),
    "",
  ];

  const open = report.findings.filter((finding) => !finding.override);
  if (open.length === 0) lines.push("No problems found.", "");
  for (const severity of SEVERITIES) {
    const group = open.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push(`## ${SEVERITY_LABELS[severity].many} (${group.length})`, "");
    for (const finding of group) lines.push(...findingLines(finding, decisions, extras.comments));
    lines.push("");
  }

  const overridden = report.findings.filter((finding) => finding.override);
  if (overridden.length) {
    lines.push(`## Overridden personal-data matches (${overridden.length})`, "");
    for (const finding of overridden) lines.push(...findingLines(finding, decisions, extras.comments));
    lines.push("");
  }

  if (history.length) {
    lines.push("## Earlier rounds", "", `Original copy:`, "", ...history[0].text.split("\n").map((l) => `> ${inline(l)}`), "");
    for (const summary of history) lines.push(...roundLines(summary));
  }

  lines.push(
    "---",
    "",
    "Generated by Copy pre-check. Findings are for a person to review; the tool doesn't approve copy. Tembusu Bank is fictional.",
    "",
  );
  return lines.join("\n");
}
