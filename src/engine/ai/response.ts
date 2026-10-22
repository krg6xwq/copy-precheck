// Checks the model's answer before anything from it reaches a report. The
// model may name a rule that doesn't exist, misquote the copy, or invent
// words that aren't there. Each finding is checked on its own, so one bad
// finding doesn't throw away the good ones.

import { z } from "zod";
import type { RejectedAiFinding } from "../engine";
import type { Rule } from "../schema";
import { normaliseForPhrases, type Span } from "../text";

export interface AcceptedAiFinding {
  rule: Rule;
  span: Span;
  explanation: string;
  suggestion?: string;
}

/** The answer as a whole couldn't be used. The AI checks count as failed. */
export class AiAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiAnswerError";
  }
}

const Envelope = z.object({ findings: z.array(z.unknown()) });

const Item = z.object({
  ruleId: z.string(),
  quote: z.string(),
  explanation: z.string(),
  suggestion: z.string().nullish(),
});

const MAX_TEXT = 500;
const tidy = (text: string) => {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_TEXT ? `${cleaned.slice(0, MAX_TEXT - 1)}…` : cleaned;
};

/** Quote marks a model may wrap around a quote. */
const WRAPPING_QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g;

/**
 * Finds the quoted words in the copy. Ignores differences in case, spacing,
 * curly or straight quotes and hyphens; everything else must match. Returns
 * the span in the original copy, or null if the words aren't there.
 */
export function locateQuote(text: string, quote: string): Span | null {
  const words = normaliseForPhrases(quote.trim().replace(WRAPPING_QUOTES, "")).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const pattern = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "u");
  const match = pattern.exec(normaliseForPhrases(text));
  if (!match) return null;
  // Normalising keeps the length, so the position is the same in the original.
  return { start: match.index, end: match.index + match[0].length, text: text.slice(match.index, match.index + match[0].length) };
}

export function validateAnswer(
  raw: unknown,
  text: string,
  applicableRules: Rule[],
): { accepted: AcceptedAiFinding[]; rejected: RejectedAiFinding[] } {
  const envelope = Envelope.safeParse(raw);
  if (!envelope.success) {
    throw new AiAnswerError("The AI's answer wasn't in the expected format");
  }

  const rulesById = new Map(applicableRules.map((rule) => [rule.id, rule]));
  const accepted: AcceptedAiFinding[] = [];
  const rejected: RejectedAiFinding[] = [];
  const seen = new Set<string>();

  for (const item of envelope.data.findings) {
    const parsed = Item.safeParse(item);
    if (!parsed.success) {
      rejected.push({ ruleId: "?", quote: "", reason: "Finding wasn't in the expected format" });
      continue;
    }
    const { ruleId, quote, explanation, suggestion } = parsed.data;
    const reject = (reason: string) => rejected.push({ ruleId, quote: tidy(quote), reason });

    const rule = rulesById.get(ruleId);
    if (!rule) {
      reject("Not one of the AI rules for this copy");
      continue;
    }
    if (!explanation.trim()) {
      reject("No explanation given");
      continue;
    }
    const span = locateQuote(text, quote);
    if (!span) {
      reject("Quoted words aren't in the copy");
      continue;
    }
    const key = `${ruleId}:${span.start}:${span.end}`;
    if (seen.has(key)) {
      reject("Same finding reported twice");
      continue;
    }
    seen.add(key);
    accepted.push({
      rule,
      span,
      explanation: tidy(explanation),
      ...(suggestion?.trim() ? { suggestion: tidy(suggestion) } : {}),
    });
  }

  return { accepted, rejected };
}
