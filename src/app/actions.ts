"use server";

// The web page's only server entry point. Anyone can call a server action
// directly, not just through the page, so every input is checked here.
// The API key is read on the server and never sent to the browser.

import { headers } from "next/headers";
import { z } from "zod";
import { checkCopyWithAi, CONTEXTS, OverrideError, type Report } from "@/engine";
import {
  answerQuestion,
  draftRevision,
  editDraft,
  MAX_ROUNDS,
  ROUND_LIMIT_MESSAGE,
  planRevision,
  RevisionInputError,
  undoFlag,
} from "@/engine/revise/draft";
import { rebuildReport } from "@/engine/revise/rebuild";
import type { DraftResult } from "@/engine/revise/types";
import { verifyDraft } from "@/engine/revise/verify";
import { claudeFromEnv } from "@/models/claude";
import { getContent } from "./content";
import { MAX_COPY_LENGTH } from "./limits";
import { allowAiCheck } from "./rate-limit";

const Copy = z.string().trim().min(1, "Paste some copy to check").max(MAX_COPY_LENGTH, `Keep copy under ${MAX_COPY_LENGTH} characters`);

const Overrides = z
  .array(
    z.object({
      ruleId: z.string().max(10),
      match: z.string().trim().min(1).max(200),
      reason: z.string().trim().min(1, "Give a reason for the override").max(300),
    }),
  )
  .max(10)
  .default([]);

const Input = z.object({
  text: Copy,
  context: z.enum(CONTEXTS).optional(),
  overrides: Overrides,
});

export type CheckInput = z.input<typeof Input>;

export type CheckResult = { ok: true; report: Report } | { ok: false; error: string };

async function visitorId(): Promise<string> {
  const list = await headers();
  return list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || "unknown";
}

export async function checkAction(input: CheckInput): Promise<CheckResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That input couldn't be checked" };
  }
  const { text, context, overrides } = parsed.data;

  // The AI checks always run when a key is set up. The personal-data guard still decides whether the copy may be sent.
  let model = claudeFromEnv();
  let note: string | undefined;
  if (model && !allowAiCheck(await visitorId())) {
    model = undefined;
    note = "AI checks are paused for a few minutes because of high use. The rule checks still ran.";
  }

  try {
    const { rules } = getContent();
    const report = await checkCopyWithAi(text, rules, model, { context, overrides });
    if (note && report.ai.status === "not-run") report.ai.reason = note;
    return { ok: true, report };
  } catch (error) {
    if (error instanceof OverrideError) return { ok: false, error: error.message };
    console.error("checkAction failed", error);
    return { ok: false, error: "Something went wrong running the check. Please try again." };
  }
}

// ---- Review and rewrite loop ----

const Short = (max: number) => z.string().max(max);

const ReviseInput = z.object({
  /** The checked copy (the original for this round). */
  text: Copy,
  context: z.enum(CONTEXTS).optional(),
  overrides: Overrides,
  // Checked against MAX_ROUNDS below, with a clear message; this bound only rejects nonsense.
  round: z.number().int().min(1).max(MAX_ROUNDS + 1),
  aiFindings: z
    .array(
      z.object({
        ruleId: Short(10),
        start: z.number().int(),
        end: z.number().int(),
        detail: Short(600).optional(),
        suggestion: Short(600).optional(),
      }),
    )
    .max(40),
  decisions: z
    .array(z.object({ key: Short(40), decision: z.enum(["accepted", "dismissed"]), comment: Short(300).optional() }))
    .max(80),
  /** The draft being worked on: needed for every step except "draft". */
  draft: z
    .object({
      text: z.string().min(1).max(MAX_COPY_LENGTH * 2),
      changes: z
        .array(
          z.object({
            ref: Short(12),
            also: z.array(Short(12)).max(10).optional(),
            ruleId: Short(10).optional(),
            before: Short(1000),
            after: Short(1000),
            note: Short(300).optional(),
            by: z.enum(["ai", "reviewer"]),
          }),
        )
        .max(60),
      needsInput: z
        .array(
          z.object({
            id: Short(8),
            ref: Short(12),
            ruleId: Short(10).optional(),
            quote: Short(300),
            question: Short(300),
            options: z.array(Short(150)).max(4),
          }),
        )
        .max(5),
      model: Short(80).optional(),
    })
    .optional(),
  step: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("draft") }),
    z.object({ kind: z.literal("answer"), questionId: Short(8), answer: z.string().trim().min(1).max(150) }),
    z.object({ kind: z.literal("undo"), flagId: Short(400) }),
    z.object({ kind: z.literal("edit"), text: z.string().trim().min(1).max(MAX_COPY_LENGTH * 2) }),
  ]),
});

export type ReviseInput = z.input<typeof ReviseInput>;

export type ReviseResult = { ok: true; result: DraftResult } | { ok: false; error: string };

/**
 * Drafts a revision from the reviewer's decisions, or applies one of their
 * steps to a draft (an answer, an Undo, a manual edit). Every result is
 * verified again on the server before it's returned.
 */
export async function reviseAction(input: ReviseInput): Promise<ReviseResult> {
  const parsed = ReviseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That request couldn't be used" };
  const { text, context, overrides, round, aiFindings, decisions, draft, step } = parsed.data;

  try {
    const { rules } = getContent();
    const report = rebuildReport(text, rules, { context, overrides }, aiFindings);

    if (step.kind === "draft") {
      // The hard stop is enforced here too, not only by the disabled button.
      if (round > MAX_ROUNDS) return { ok: false, error: ROUND_LIMIT_MESSAGE };
      const model = claudeFromEnv();
      if (!model) return { ok: true, result: { status: "unavailable", reason: "AI isn't set up on this server" } };
      if (!allowAiCheck(await visitorId())) {
        return { ok: true, result: { status: "unavailable", reason: "AI drafting is paused for a few minutes because of high use" } };
      }
      return { ok: true, result: await draftRevision(report, rules, model, decisions, { context, overrides }) };
    }

    if (!draft) return { ok: false, error: "There's no draft to change" };
    const { accepted, dismissed } = planRevision(report, decisions);
    const ctx = { rulesFile: rules, context, overrides };
    const current = verifyDraft({
      original: text,
      text: draft.text,
      changes: draft.changes,
      needsInput: draft.needsInput,
      accepted,
      dismissed,
      ...ctx,
      model: draft.model,
    });
    const next =
      step.kind === "answer"
        ? answerQuestion(current, step.questionId, step.answer, ctx)
        : step.kind === "undo"
          ? undoFlag(current, step.flagId, ctx)
          : editDraft(current, step.text, ctx);
    return { ok: true, result: { status: "ready", draft: next } };
  } catch (error) {
    if (error instanceof RevisionInputError || error instanceof OverrideError) return { ok: false, error: error.message };
    console.error("reviseAction failed", error);
    return { ok: false, error: "Something went wrong with the revision. Please try again." };
  }
}
