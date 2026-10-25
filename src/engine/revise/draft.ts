// One round of the loop on the engine side: check the reviewer's decisions,
// ask the AI for a draft, verify it, and apply the reviewer's answers, undos
// and edits. Pure apart from the model call, so it's tested with a fake model.

import type { Finding, Override, Report } from "../engine";
import type { AiModel, AiPrompt } from "../ai/model";
import { askWithTimeout, failureReason } from "../ai/run";
import type { Context, RulesFile } from "../schema";
import { changedRegions, diffWords, type DiffPart } from "./diff";
import { buildRevisionPrompt, RevisionAnswer } from "./prompt";
import type { AcceptedItem, DismissedItem, Draft, DraftResult, NeedsInput, ReviewDecision, RevisionChange } from "./types";
import { decidable, needsReason } from "./review";
import { occurrences, verifyDraft } from "./verify";

export { carryDecisions, decidable, MAX_ROUNDS, needsReason, type CarriedDecision } from "./review";
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
  const ask = (skipped?: string[]) =>
    attempt(
      buildRevisionPrompt({ bank: rulesFile.bank, text: report.text, context: report.context, accepted, dismissed, skipped }),
      report,
      rulesFile,
      model,
      accepted,
      dismissed,
      options,
    );
  const first = await ask();
  // A draft that skips most of the accepted findings is asked for once more; the better one is kept.
  if (first.status === "ready" && first.draft.unfixed.length * 2 > accepted.length) {
    const second = await ask(first.draft.unfixed);
    if (second.status === "ready" && second.draft.unfixed.length < first.draft.unfixed.length) return second;
  }
  return first;
}

async function attempt(
  prompt: AiPrompt,
  report: Report,
  rulesFile: RulesFile,
  model: AiModel,
  accepted: AcceptedItem[],
  dismissed: DismissedItem[],
  options: DraftOptions,
): Promise<DraftResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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

  // A change may name several findings ("F3, F7"). Unknown refs and no-op changes are dropped.
  const changes: RevisionChange[] = answer.changes.flatMap((c) => {
    const named = [...new Set(c.finding.match(/F\d+/g) ?? [])].filter((r) => refs.has(r));
    if (named.length === 0 || squash(c.before) === squash(c.after)) return [];
    const [ref, ...also] = named;
    return [
      {
        ref,
        ...(also.length ? { also } : {}),
        ruleId: refs.get(ref)!.finding.ruleId,
        before: c.before,
        after: c.after,
        ...(c.note?.trim() ? { note: squash(c.note).slice(0, 200) } : {}),
        by: "ai" as const,
      },
    ];
  });

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

/** Where a position in the old draft ends up in the new one. Inside removed words, it moves to where they were. */
function mapPosition(parts: DiffPart[], position: number): number {
  let from = 0;
  let to = 0;
  for (const part of parts) {
    if (part.type === "added") {
      to += part.text.length;
      continue;
    }
    const end = from + part.text.length;
    if (position < end || (position === end && part.type === "same")) {
      return part.type === "same" ? to + (position - from) : to;
    }
    from = end;
    if (part.type === "same") to += part.text.length;
  }
  return to;
}

/**
 * Carries the reviewer's answer, edit or undo into the AI changes it touches, so a change
 * whose words now read differently ("before 05/11/2026" → "before 5 Nov 2026") is still
 * credited to its finding instead of turning into unrequested changes.
 */
export function carryThrough(oldText: string, newText: string, changes: RevisionChange[]): RevisionChange[] {
  if (oldText === newText) return changes;
  const parts = diffWords(oldText, newText);
  return changes.map((change) => {
    if (change.by !== "ai" || !change.after.trim()) return change;
    const where = occurrences(oldText, change.after).at(0);
    if (!where) return change;
    const after = newText.slice(mapPosition(parts, where.start), mapPosition(parts, where.end)).trim();
    return after === change.after.trim() ? change : { ...change, after };
  });
}

const reverify = (draft: Draft, text: string, changes: RevisionChange[], needsInput: NeedsInput[], ctx: RedoContext) =>
  verifyDraft({
    original: draft.original,
    text,
    changes: carryThrough(draft.text, text, changes),
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
