// Types for the review and rewrite loop (spec: "Copy pre-check: review and
// rewrite loop"). A round: findings → decisions → AI draft → code checks →
// the reviewer approves → the draft becomes the copy.

import type { Finding, Report } from "../engine";
import type { DiffPart, Region } from "./diff";

/** The reviewer's call on one finding, keyed like the UI (rule:start:end). */
export interface ReviewDecision {
  key: string;
  decision: "accepted" | "dismissed";
  comment?: string;
}

/** An accepted finding as the AI sees it, numbered F1, F2… */
export interface AcceptedItem {
  ref: string;
  finding: Finding;
  comment?: string;
}

export interface DismissedItem {
  finding: Finding;
  comment?: string;
}

export interface RevisionChange {
  /** F1, F2… for the AI's changes; "reviewer" for answers and manual edits. */
  ref: string;
  ruleId?: string;
  before: string;
  after: string;
  note?: string;
  by: "ai" | "reviewer";
}

/** A fix the AI wouldn't guess, such as which month "05/11" means. */
export interface NeedsInput {
  id: string;
  ref: string;
  ruleId?: string;
  quote: string;
  question: string;
  options: string[];
}

export type FlagKind = "changed-fact" | "unrequested-change" | "dismissed-changed" | "too-long" | "personal-data";

export interface Flag {
  /** Built from content, not position, so a kept flag stays kept after other edits. */
  id: string;
  kind: FlagKind;
  message: string;
  before?: string;
  after?: string;
  /** Where Undo puts the original words back, when it can. */
  region?: Region;
  /** "keep-or-undo": the reviewer may keep the change. "edit-only": must be fixed by editing. */
  resolution: "keep-or-undo" | "edit-only";
}

export interface Draft {
  original: string;
  text: string;
  changes: RevisionChange[];
  needsInput: NeedsInput[];
  flags: Flag[];
  diff: DiffPart[];
  /** The code checks run on the draft. The AI checks run when it's approved. */
  recheck: Report;
  model?: string;
  accepted: AcceptedItem[];
  dismissed: DismissedItem[];
}

export type DraftResult = { status: "ready"; draft: Draft } | { status: "unavailable"; reason: string };
