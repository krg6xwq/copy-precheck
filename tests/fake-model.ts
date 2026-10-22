// A stand-in for a real model, so the AI layer can be tested without an API
// key, without cost, and with answers chosen to break things on purpose.

import type { AiModel, AiPrompt } from "../src/engine";

type Behaviour = unknown | ((prompt: AiPrompt, signal: AbortSignal) => unknown);

export interface FakeModel extends AiModel {
  /** Every prompt the model received, to check what was (or wasn't) sent. */
  calls: AiPrompt[];
}

/** Answers with `behaviour`: a fixed answer, or a function of the prompt. */
export function fakeModel(behaviour: Behaviour): FakeModel {
  const calls: AiPrompt[] = [];
  return {
    name: "fake",
    calls,
    async respond(prompt, signal) {
      calls.push(prompt);
      return typeof behaviour === "function" ? behaviour(prompt, signal) : structuredClone(behaviour);
    },
  };
}

/** Shorthand for an answer with these findings. */
export const answer = (...findings: { ruleId: string; quote: string; explanation?: string; suggestion?: string }[]) => ({
  findings: findings.map((finding) => ({ explanation: "A customer might be misled.", ...finding })),
});

/** A model that never answers, unless the request is cancelled. */
export const hangingModel = (): FakeModel =>
  fakeModel(
    (_prompt: AiPrompt, signal: AbortSignal) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
  );
