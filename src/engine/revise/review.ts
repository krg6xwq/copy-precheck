// Review rules shared by the engine and the page. Type-only imports, so the
// browser can use these without downloading the engine.

import type { Finding, Report } from "../engine";
import type { Draft, ReviewDecision, RevisionChange } from "./types";

export const MAX_ROUNDS = 3;

const keyOf = (finding: Finding) => `${finding.ruleId}:${finding.match?.start ?? "-"}:${finding.match?.end ?? "-"}`;
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** Findings the reviewer must decide on: everything open except personal data, which is fixed or overridden instead. */
export const decidable = (report: Report) => report.findings.filter((f) => !f.override && f.layer !== "guard");

/** Who a change came from, for the draft screen and the audit trail: the finding(s) it fixes, or the reviewer. */
export function changeSource(draft: Pick<Draft, "accepted">, change: RevisionChange, reviewer = "Your"): string {
  if (change.by === "reviewer") return `${reviewer} ${change.note?.startsWith("Your answer") ? "answer" : "edit"}`;
  const name = (ref: string) => {
    const item = draft.accepted.find((a) => a.ref === ref);
    return item ? `${item.finding.ruleId} ${item.finding.ruleName}` : ref;
  };
  return [change.ref, ...(change.also ?? [])].map(name).join(" + ");
}

/** Accepted findings the draft left alone, named for people. */
export const unfixedLabels = (draft: Pick<Draft, "accepted" | "unfixed">) =>
  draft.unfixed.map((ref) => {
    const item = draft.accepted.find((a) => a.ref === ref);
    if (!item) return ref;
    const words = item.finding.match?.text.replace(/\s+/g, " ").trim();
    return `${item.finding.ruleId} ${item.finding.ruleName}${words ? ` “${words.length > 60 ? `${words.slice(0, 59)}…` : words}”` : ""}`;
  });

/** A dismissal of a serious finding needs a reason (spec: decisions and comments). */
export const needsReason = (finding: Finding) => finding.severity === "blocker" || finding.severity === "needs-fix";

export interface CarriedDecision {
  decision?: "dismissed";
  comment?: string;
  /** "dismissed-before": carried over. "still-found": accepted last round, but the words are still there. */
  note: "dismissed-before" | "still-found";
  round: number;
}

/**
 * Next round: a finding dismissed before (same rule, same words) comes back
 * already dismissed with its reason; one accepted before that's still there
 * comes back undecided, marked "still found".
 */
export function carryDecisions(
  previous: { finding: Finding; decision: ReviewDecision["decision"]; comment?: string; round: number }[],
  report: Report,
): Record<string, CarriedDecision> {
  const same = (a: Finding, b: Finding) => a.ruleId === b.ruleId && squash(a.match?.text ?? "") === squash(b.match?.text ?? "");
  const carried: Record<string, CarriedDecision> = {};
  for (const finding of decidable(report)) {
    // The most recent decision on the same words wins.
    const prior = [...previous].reverse().find((p) => same(p.finding, finding));
    if (!prior) continue;
    carried[keyOf(finding)] =
      prior.decision === "dismissed"
        ? { decision: "dismissed", comment: prior.comment, note: "dismissed-before", round: prior.round }
        : { note: "still-found", round: prior.round };
  }
  return carried;
}
