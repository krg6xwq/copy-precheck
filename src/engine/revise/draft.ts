// One round of the loop on the engine side: check the reviewer's decisions,
// ask the AI for a draft, verify it, and apply the reviewer's answers, undos
// and edits. Pure apart from the model call, so it's tested with a fake model.

import type { Finding, Override, Report } from "../engine";
import type { AiModel } from "../ai/model";
import { askWithTimeout, failureReason } from "../ai/run";
import type { Context, RulesFile } from "../schema";
import { changedRegions, diffWords } from "./diff";
import { buildRevisionPrompt, RevisionAnswer } from "./prompt";
import type { AcceptedItem, DismissedItem, Draft, DraftResult, NeedsInput, ReviewDecision, RevisionChange } from "./types";
import { occurrences, verifyDraft } from "./verify";

export const MAX_ROUNDS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

/** The decisions can't be used: not every finding decided, a missing reason, personal data open. */
export class RevisionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevisionInputError";
  }
}

const keyOf = (finding: Finding) => `${finding.ruleId}:${finding.match?.start ?? "-"}:${finding.match?.end ?? "-"}`;
const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Findings the reviewer must decide on: everything open except personal data, which is fixed or overridden instead. */
export const decidable = (report: Report) => report.findings.filter((f) => !f.override && f.layer !== "guard");

/** A dismissal of a serious finding needs a reason (spec: decisions and comments). */
export const needsReason = (finding: Finding) => finding.severity === "blocker" || finding.severity === "needs-fix";

/** Turns decisions into the AI's instructions, or explains what's still missing. */
export function planRevision(report: Report, decisions: ReviewDecision[]): { accepted: AcceptedItem[]; dismissed: DismissedItem[] } {
  if (report.guard.open > 0) {
    throw new RevisionInputError("Replace the personal data with a placeholder, or override the match, before drafting.");
  }
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  const findings = decidable(report);
  const undecided = findings.filter((f) => !byKey.has(keyOf(f)));
  if (undecided.length) {
    throw new RevisionInputError(`Decide on every finding first: ${undecided.length} ${undecided.length === 1 ? "is" : "are"} left.`);
  }
  const missingReason = findings.filter((f) => {
    const d = byKey.get(keyOf(f))!;
    return d.decision === "dismissed" && needsReason(f) && !d.comment?.trim();
  });
  if (missingReason.length) {
    throw new RevisionInputError(`Give a reason for dismissing ${plural(missingReason.length, "a blocker or needs-fix finding", "blocker or needs-fix findings")}.`);
  }
  const accepted: AcceptedItem[] = [];
  const dismissed: DismissedItem[] = [];
  for (const finding of findings) {
    const d = byKey.get(keyOf(finding))!;
    const comment = d.comment?.trim() || undefined;
    if (d.decision === "accepted") accepted.push({ ref: `F${accepted.length + 1}`, finding, comment });
    else dismissed.push({ finding, comment });
  }
  if (accepted.length === 0) throw new RevisionInputError("Nothing to revise: every finding was dismissed.");
  return { accepted, dismissed };
}

export interface DraftOptions {
  context?: Context;
  overrides?: Override[];
  timeoutMs?: number;
}

export async function draftRevision(
  report: Report,
  rulesFile: RulesFile,
  model: AiModel,
  decisions: ReviewDecision[],
  options: DraftOptions = {},
): Promise<DraftResult> {
  const { accepted, dismissed } = planRevision(report, decisions);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const prompt = buildRevisionPrompt({ bank: rulesFile.bank, text: report.text, context: report.context, accepted, dismissed });

  let raw: unknown;
  try {
    raw = await askWithTimeout(model, prompt, timeoutMs);
  } catch (error) {
    return { status: "unavailable", reason: failureReason(error, timeoutMs) };
  }
  const parsed = RevisionAnswer.safeParse(raw);
  if (!parsed.success || !parsed.data.revisedText.trim()) {
    return { status: "unavailable", reason: "The AI's draft wasn't in the expected format" };
  }
  const answer = parsed.data;
  const text = answer.revisedText.trim();
  const refs = new Map(accepted.map((item) => [item.ref, item]));

  const changes: RevisionChange[] = answer.changes
    .filter((c) => refs.has(c.finding.trim()))
    .map((c) => ({
      ref: c.finding.trim(),
      ruleId: refs.get(c.finding.trim())!.finding.ruleId,
      before: c.before,
      after: c.after,
      ...(c.note?.trim() ? { note: squash(c.note).slice(0, 200) } : {}),
      by: "ai" as const,
    }));

  const needsInput: NeedsInput[] = answer.needsInput
    .filter((q) => refs.has(q.finding.trim()) && q.quote.trim() && occurrences(text, q.quote).length > 0 && q.question.trim())
    .slice(0, 5)
    .map((q, i) => ({
      id: `q${i + 1}`,
      ref: q.finding.trim(),
      ruleId: refs.get(q.finding.trim())!.finding.ruleId,
      quote: q.quote,
      question: squash(q.question).slice(0, 200),
      options: q.options.map((o) => squash(o).slice(0, 120)).filter(Boolean).slice(0, 4),
    }));

  const draft = verifyDraft({
    original: report.text,
    text,
    changes,
    needsInput,
    accepted,
    dismissed,
    rulesFile,
    context: options.context ?? report.context,
    overrides: options.overrides,
    model: model.name,
  });
  return { status: "ready", draft };
}

interface RedoContext {
  rulesFile: RulesFile;
  context?: Context;
  overrides?: Override[];
}

const reverify = (draft: Draft, text: string, changes: RevisionChange[], needsInput: NeedsInput[], ctx: RedoContext) =>
  verifyDraft({
    original: draft.original,
    text,
    changes,
    needsInput,
    accepted: draft.accepted,
    dismissed: draft.dismissed,
    rulesFile: ctx.rulesFile,
    context: ctx.context,
    overrides: ctx.overrides,
    model: draft.model,
  });

/** Puts the reviewer's answer in place of the quoted words. Code does it, not the AI. */
export function answerQuestion(draft: Draft, questionId: string, answer: string, ctx: RedoContext): Draft {
  const question = draft.needsInput.find((q) => q.id === questionId);
  const value = answer.trim();
  if (!question || !value) return draft;
  const where = occurrences(draft.text, question.quote).at(0);
  if (!where) return draft;
  const text = draft.text.slice(0, where.start) + value + draft.text.slice(where.end);
  const change: RevisionChange = {
    ref: "reviewer",
    ruleId: question.ruleId,
    before: draft.text.slice(where.start, where.end),
    after: value,
    note: `Your answer: ${question.question}`,
    by: "reviewer",
  };
  return reverify(draft, text, [...draft.changes, change], draft.needsInput.filter((q) => q !== question), ctx);
}

/** Puts the original words back where a flag points. */
export function undoFlag(draft: Draft, flagId: string, ctx: RedoContext): Draft {
  const region = draft.flags.find((f) => f.id === flagId)?.region;
  if (!region) return draft;
  const text = draft.text.slice(0, region.draftStart) + draft.original.slice(region.origStart, region.origEnd) + draft.text.slice(region.draftEnd);
  const needsInput = draft.needsInput.filter((q) => occurrences(text, q.quote).length > 0);
  return reverify(draft, text, draft.changes, needsInput, ctx);
}

/** The reviewer edited the draft by hand: their changes are recorded as theirs, then everything is checked again. */
export function editDraft(draft: Draft, newText: string, ctx: RedoContext): Draft {
  const text = newText.trim();
  if (text === draft.text) return draft;
  const edits: RevisionChange[] = changedRegions(diffWords(draft.text, text)).map((region) => ({
    ref: "reviewer",
    before: draft.text.slice(region.origStart, region.origEnd),
    after: text.slice(region.draftStart, region.draftEnd),
    note: "Your edit",
    by: "reviewer",
  }));
  const needsInput = draft.needsInput.filter((q) => occurrences(text, q.quote).length > 0);
  return reverify(draft, text, [...draft.changes, ...edits], needsInput, ctx);
}

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
