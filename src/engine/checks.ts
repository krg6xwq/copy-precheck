// One function per check type. Each returns the places a rule matched, or
// says the rule didn't apply. They never decide severity or layer: that is
// the engine's job.

import type { Check } from "./schema";
import {
  countWords,
  normaliseForPhrases,
  passesLuhn,
  splitSentences,
  wholePhrasePattern,
  type Span,
} from "./text";

export interface Hit {
  span: Span | null;
  /** Extra detail for this hit, e.g. the preferred wording. */
  detail?: string;
}

export type CheckResult =
  | { applies: true; hits: Hit[] }
  | { applies: false; reason: string };

const spanOf = (text: string, start: number, end: number): Span => ({
  start,
  end,
  text: text.slice(start, end),
});

function matchAll(text: string, source: string, flags = ""): Span[] {
  const regex = new RegExp(source, `g${flags}u`);
  return [...text.matchAll(regex)]
    .filter((match) => match[0].length > 0)
    .map((match) => spanOf(text, match.index, match.index + match[0].length));
}

type CheckOf<T extends Check["type"]> = Extract<Check, { type: T }>;

function pattern(check: CheckOf<"pattern">, text: string): CheckResult {
  const allowed = new Set((check.allow ?? []).map((value) => value.trim()));
  const hits = matchAll(text, check.pattern, check.flags)
    .filter((span) => !allowed.has(span.text.trim()))
    .filter((span) => check.validator !== "luhn" || passesLuhn(span.text))
    .map((span) => ({ span }));
  return { applies: true, hits };
}

function phrases(check: CheckOf<"phrases">, text: string): CheckResult {
  // Normalising keeps the text's length, so spans point at the original copy.
  const normalised = normaliseForPhrases(text);
  const hits: Hit[] = [];
  for (const phrase of check.phrases) {
    const regex = wholePhrasePattern(normaliseForPhrases(phrase));
    for (const match of normalised.matchAll(regex)) {
      hits.push({ span: spanOf(text, match.index, match.index + match[0].length) });
    }
  }
  return { applies: true, hits };
}

function replace(check: CheckOf<"replace">, text: string): CheckResult {
  const hits: Hit[] = [];
  for (const [wrong, preferred] of Object.entries(check.replace)) {
    for (const match of text.matchAll(wholePhrasePattern(wrong, "giu"))) {
      hits.push({
        span: spanOf(text, match.index, match.index + match[0].length),
        detail: `Write "${preferred}"`,
      });
    }
  }
  return { applies: true, hits };
}

function names(check: CheckOf<"names">, text: string): CheckResult {
  const hits: Hit[] = [];
  for (const name of check.names) {
    for (const match of text.matchAll(wholePhrasePattern(name, "giu"))) {
      if (match[0].replace(/\s+/g, " ") !== name) {
        hits.push({
          span: spanOf(text, match.index, match.index + match[0].length),
          detail: `Write "${name}"`,
        });
      }
    }
  }
  return { applies: true, hits };
}

function conditional(check: CheckOf<"conditional">, text: string): CheckResult {
  const triggers = matchAll(text, check.when, check.flags);
  if (triggers.length === 0) {
    return { applies: false, reason: "Trigger wording not found" };
  }
  const missing = check.require.filter((source) => matchAll(text, source, check.flags).length === 0);
  if (missing.length === 0) return { applies: true, hits: [] };
  return {
    applies: true,
    hits: [{ span: triggers[0] }],
  };
}

function maxWords(check: CheckOf<"max-words">, text: string): CheckResult {
  const hits = splitSentences(text)
    .map((sentence) => ({ sentence, words: countWords(sentence.text) }))
    .filter(({ words }) => words > check.limit)
    .map(({ sentence, words }) => ({ span: sentence, detail: `${words} words (limit ${check.limit})` }));
  return { applies: true, hits };
}

/** Runs a code check. AI checks are handled by the engine, not here. */
export function runCheck(check: Check, text: string): CheckResult {
  switch (check.type) {
    case "pattern":
      return pattern(check, text);
    case "phrases":
      return phrases(check, text);
    case "replace":
      return replace(check, text);
    case "names":
      return names(check, text);
    case "conditional":
      return conditional(check, text);
    case "max-words":
      return maxWords(check, text);
    case "ai":
      throw new Error("AI checks are run by the AI layer, not runCheck");
  }
}
