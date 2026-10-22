"use server";

// The web page's only server entry point. Anyone can call a server action
// directly, not just through the page, so every input is checked here.
// The API key is read on the server and never sent to the browser.

import { headers } from "next/headers";
import { z } from "zod";
import { checkCopyWithAi, CONTEXTS, OverrideError, type Report } from "@/engine";
import { claudeFromEnv } from "@/models/claude";
import { getContent } from "./content";
import { MAX_COPY_LENGTH } from "./limits";
import { allowAiCheck } from "./rate-limit";

const Input = z.object({
  text: z.string().trim().min(1, "Paste some copy to check").max(MAX_COPY_LENGTH, `Keep copy under ${MAX_COPY_LENGTH} characters`),
  context: z.enum(CONTEXTS).optional(),
  overrides: z
    .array(
      z.object({
        ruleId: z.string().max(10),
        match: z.string().trim().min(1).max(200),
        reason: z.string().trim().min(1, "Give a reason for the override").max(300),
      }),
    )
    .max(10)
    .default([]),
  useAi: z.boolean().default(false),
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
  const { text, context, overrides, useAi } = parsed.data;

  let model = useAi ? claudeFromEnv() : undefined;
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
