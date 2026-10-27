// Checks a draft before a person sees it. The re-check catches rule breaks,
// not changed meaning, so code also compares the draft with the original:
// facts kept, every change has a reason, dismissed words untouched.
// Deterministic: same draft, same flags.

import { checkCopy, type Override } from "../engine";
import type { Context, RulesFile } from "../schema";
import { changedRegions, diffWords, type Region } from "./diff";
import { extractFacts, factLabel, missingFacts, type Fact } from "./facts";
import type { AcceptedItem, DismissedItem, Draft, Flag, NeedsInput, RevisionChange } from "./types";

export const MAX_DRAFT_LENGTH = 1500;

export interface VerifyInput {
  original: string;
  text: string;
  changes: RevisionChange[];
  needsInput: NeedsInput[];
  accepted: AcceptedItem[];
  dismissed: DismissedItem[];
  rulesFile: RulesFile;
  context?: Context;
  overrides?: Override[];
  model?: string;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const short = (text: string, length = 60) => {
  const s = squash(text);
  return s.length > length ? `${s.slice(0, length - 1)}…` : s;
};

/** Every place `needle` occurs in `haystack`, ignoring differences in spacing. */
export function occurrences(haystack: string, needle: string): { start: number; end: number }[] {
  const words = squash(needle).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
  return [...haystack.matchAll(pattern)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

const overlaps = (a: { start: number; end: number }, start: number, end: number) =>
  // A pure insertion has start === end; count a span that touches it.
  start === end ? a.start <= start && a.end >= end : a.start < end && start < a.end;

/** Product names from the rules file's `names` checks. */
export function productNames(rulesFile: RulesFile): string[] {
  return rulesFile.rules.flatMap((rule) => (rule.check.type === "names" ? rule.check.names : []));
}

/** A change is real if its words were in the original and are in the draft. */
function isReal(change: RevisionChange, original: string, text: string): boolean {
  // A reviewer's change is relative to the draft they edited, so only its new words are checked.
  if (change.by === "reviewer") return !change.after.trim() || occurrences(text, change.after).length > 0;
  const beforeOk = !change.before.trim() || occurrences(original, change.before).length > 0;
  const afterOk = !change.after.trim() || occurrences(text, change.after).length > 0;
  return beforeOk && afterOk && (Boolean(change.before.trim()) || Boolean(change.after.trim()));
}

function explains(change: RevisionChange, region: Region, original: string, text: string): boolean {
  if (change.after.trim()) {
    return occurrences(text, change.after).some((o) => overlaps(o, region.draftStart, region.draftEnd));
  }
  return occurrences(original, change.before).some((o) => overlaps(o, region.origStart, region.origEnd));
}

const regionHas = (region: Region, side: "orig" | "draft", position: number) =>
  side === "orig"
    ? position >= region.origStart && position < Math.max(region.origEnd, region.origStart + 1)
    : position >= region.draftStart && position < Math.max(region.draftEnd, region.draftStart + 1);

export function verifyDraft(input: VerifyInput): Draft {
  const { original, text, accepted, dismissed, rulesFile } = input;
  const refs = new Set(accepted.map((item) => item.ref));
  // Only changes that name an accepted finding (or the reviewer) and whose words are really there count.
  const changes = input.changes.filter(
    (change) => (change.by === "reviewer" || refs.has(change.ref)) && isReal(change, original, text),
  );
  const diff = diffWords(original, text);
  const regions = changedRegions(diff).filter(
    (region) => squash(original.slice(region.origStart, region.origEnd)) !== squash(text.slice(region.draftStart, region.draftEnd)),
  );
  const flags: Flag[] = [];

  // 1. Every change accounted for.
  const reviewerRegions: Region[] = [];
  for (const region of regions) {
    const reasons = changes.filter((change) => explains(change, region, original, text));
    if (reasons.some((change) => change.by === "reviewer")) reviewerRegions.push(region);
    if (reasons.length > 0) continue;
    const before = original.slice(region.origStart, region.origEnd);
    const after = text.slice(region.draftStart, region.draftEnd);
    flags.push({
      id: `unrequested:${squash(before)}=>${squash(after)}`,
      kind: "unrequested-change",
      message: before.trim()
        ? after.trim()
          ? `Changed “${short(before)}” to “${short(after)}”, but no accepted finding asked for it.`
          : `Removed “${short(before)}”, but no accepted finding asked for it.`
        : `Added “${short(after)}”, but no accepted finding asked for it.`,
      before,
      after,
      region,
      resolution: "keep-or-undo",
    });
  }

  // 2. Facts kept. Changes the reviewer made themselves (answers, edits) are theirs to make.
  const names = productNames(rulesFile);
  const byReviewer = (fact: Fact, side: "orig" | "draft") => reviewerRegions.some((r) => regionHas(r, side, fact.start));
  const before = extractFacts(original, names).filter((fact) => !byReviewer(fact, "orig"));
  const after = extractFacts(text, names).filter((fact) => !byReviewer(fact, "draft"));
  const seen = new Map<string, number>();
  const nth = (key: string) => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n;
  };
  for (const fact of missingFacts(before, after)) {
    const region = regions.find((r) => regionHas(r, "orig", fact.start));
    flags.push({
      id: `fact-missing:${fact.kind}:${fact.value}#${nth(`m:${fact.kind}:${fact.value}`)}`,
      kind: "changed-fact",
      message: `The ${factLabel(fact)} “${fact.text}” is missing or different in the draft.`,
      before: fact.text,
      region,
      resolution: "keep-or-undo",
    });
  }
  for (const fact of missingFacts(after, before)) {
    const region = regions.find((r) => regionHas(r, "draft", fact.start));
    // A repeat isn't a new fact, but it can be a new claim ("3.5% bonus"), so it's still flagged.
    const repeated = before.some((b) => b.kind === fact.kind && b.value === fact.value);
    flags.push({
      id: `fact-new:${fact.kind}:${fact.value}#${nth(`n:${fact.kind}:${fact.value}`)}`,
      kind: "changed-fact",
      message: repeated
        ? `The draft mentions the ${factLabel(fact)} “${fact.text}” more often than the original. Check it doesn't add a claim.`
        : `The draft adds the ${factLabel(fact)} “${fact.text}”, which isn't in the original.`,
      after: fact.text,
      region,
      resolution: "keep-or-undo",
    });
  }

  // 3. Dismissed words untouched, except where an accepted finding overlaps them. Dismissing
  // "long sentence" keeps the sentence; it doesn't block an accepted "login" → "log in" inside it.
  for (const item of dismissed) {
    const match = item.finding.match;
    if (!match || occurrences(text, match.text).length > 0) continue;
    const covered = accepted
      .map((a) => a.finding.match)
      .filter((m): m is NonNullable<typeof m> => Boolean(m) && m!.start < match.end && match.start < m!.end)
      .sort((a, b) => a.start - b.start);
    // The dismissed words that no accepted finding covers, in pieces, without edge punctuation.
    const pieces: { start: number; text: string }[] = [];
    let cursor = match.start;
    for (const m of [...covered, { start: match.end, end: match.end }]) {
      if (m.start > cursor) {
        const raw = original.slice(cursor, m.start);
        const lead = raw.length - raw.replace(/^[\s\p{P}]+/u, "").length;
        const piece = raw.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");
        if (/[\p{L}\p{N}]/u.test(piece)) pieces.push({ start: cursor + lead, text: piece });
      }
      cursor = Math.max(cursor, m.end);
    }
    const changed = pieces.filter((piece) => occurrences(text, piece.text).length === 0);
    if (changed.length === 0) continue;

    // Name the exact words that changed inside the protected piece, and point Undo at them,
    // not at the whole piece (which mostly reads the same) or at another change nearby.
    const piece = changed[0];
    const pieceEnd = piece.start + piece.text.length;
    const inside = regions.filter((r) =>
      r.origStart === r.origEnd ? r.origStart > piece.start && r.origStart < pieceEnd : r.origStart < pieceEnd && piece.start < r.origEnd,
    );
    const edge = (value: string) => value.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");
    const describe = (r: Region) => {
      const removed = edge(original.slice(Math.max(r.origStart, piece.start), Math.min(r.origEnd, pieceEnd)));
      const added = edge(text.slice(r.draftStart, r.draftEnd));
      if (!removed) return `added “${short(added, 40)}” to the text below`;
      if (occurrences(text, removed).length > 0) return `moved “${short(removed, 40)}” out of the text below`;
      const whollyInside = r.origStart >= piece.start && r.origEnd <= pieceEnd;
      return whollyInside && added ? `changed “${short(removed, 40)}” to “${short(added, 40)}”` : `removed “${short(removed, 40)}”`;
    };
    const what = inside.length ? inside.slice(0, 2).map(describe).join(" and ") : `changed “${short(piece.text, 60)}”`;
    const region = inside[0];
    const rule = `${item.finding.ruleId} ${item.finding.ruleName}`;
    // The whole dismissed text is shown with the flag, with the changed words marked, so no quote is cut off.
    const marks = (inside.length ? inside : [{ origStart: piece.start, origEnd: pieceEnd }])
      // Only the protected words, not the parts an accepted finding changed.
      .map((r) => ({ start: Math.max(r.origStart, piece.start) - match.start, end: Math.min(r.origEnd, pieceEnd) - match.start }))
      .filter((m) => m.end > m.start);
    flags.push({
      id: `dismissed:${item.finding.ruleId}:${squash(match.text)}:${squash(piece.text)}`,
      kind: "dismissed-changed",
      message: `The draft ${what}. You dismissed ${rule} for this text${covered.length ? ", and no finding you accepted covers those words" : ""}.`,
      before: piece.text,
      region,
      quote: { text: match.text, marks },
      resolution: "keep-or-undo",
    });
  }

  // 4. Length.
  if (text.length > MAX_DRAFT_LENGTH) {
    flags.push({
      id: "too-long",
      kind: "too-long",
      message: `The draft is ${text.length.toLocaleString("en-SG")} characters; the limit is ${MAX_DRAFT_LENGTH.toLocaleString("en-SG")}. Edit it down before approving.`,
      resolution: "edit-only",
    });
  }

  // 5. Full re-check with the code rules. New personal data blocks approval.
  const recheck = checkCopy(text, rulesFile, { context: input.context, overrides: input.overrides });
  if (recheck.guard.open > 0) {
    const found = recheck.findings.filter((f) => f.layer === "guard" && !f.override);
    flags.push({
      id: `personal-data:${found.map((f) => squash(f.match?.text ?? "")).join("|")}`,
      kind: "personal-data",
      message: `The draft contains personal data (${found.map((f) => `“${f.match?.text}”`).join(", ")}). Remove it before approving.`,
      resolution: "edit-only",
    });
  }

  // 6. Accepted findings the draft didn't deal with: no change or question names them, and
  // they're still there (the rule still fires on the same words, or the AI's words remain).
  const handled = new Set([
    ...changes.flatMap((change) => (change.by === "ai" ? [change.ref, ...(change.also ?? [])] : [])),
    ...input.needsInput.map((question) => question.ref),
  ]);
  const unfixed = accepted
    .filter((item) => {
      if (handled.has(item.ref)) return false;
      const { finding } = item;
      if (finding.layer === "ai") return !finding.match || occurrences(text, finding.match.text).length > 0;
      return recheck.findings.some(
        (f) => f.ruleId === finding.ruleId && squash(f.match?.text ?? "") === squash(finding.match?.text ?? ""),
      );
    })
    .map((item) => item.ref);

  return {
    original,
    text,
    changes,
    needsInput: input.needsInput,
    flags,
    diff,
    recheck,
    model: input.model,
    accepted,
    dismissed,
    unfixed,
  };
}

/** Approve is allowed once nothing needs fixing, every flag is kept or undone, and every question is answered. */
export function approvalBlockers(draft: Draft, kept: string[]): string[] {
  const reasons: string[] = [];
  const open = draft.flags.filter((flag) => flag.resolution === "edit-only" || !kept.includes(flag.id));
  if (open.length) reasons.push(`${open.length} ${open.length === 1 ? "flag" : "flags"} to resolve`);
  if (draft.needsInput.length) {
    reasons.push(`${draft.needsInput.length} ${draft.needsInput.length === 1 ? "question" : "questions"} to answer`);
  }
  return reasons;
}
