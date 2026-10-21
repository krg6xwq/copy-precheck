// Text helpers used by the checks. None of them change the length of the
// text, so a position found in normalised text is the same position in the
// original copy, and findings can always point at the writer's own words.

/** Characters treated as part of a word when deciding whole-word matches. */
const WORD = String.raw`[\p{L}\p{N}_]`;

/**
 * Normalises copy for phrase matching (decisions.md D6), keeping its length:
 * curly quotes become straight, hyphens and dashes become spaces, and letters
 * are lower-cased. Repeated spaces are handled by the phrase pattern instead,
 * so positions still line up with the original text.
 */
export function normaliseForPhrases(text: string): string {
  let out = "";
  for (const char of text) {
    let next = char;
    if ("‘’‛′".includes(char)) next = "'";
    else if ("“”‟″".includes(char)) next = '"';
    else if ("-‐‑‒–—".includes(char)) next = " ";
    else {
      const lower = char.toLowerCase();
      if (lower.length === char.length) next = lower;
    }
    out += next;
  }
  return out;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a whole-word pattern for a phrase. Words may be separated by any
 * run of whitespace, so "zero  risk" and "zero\nrisk" match "zero risk".
 */
export function wholePhrasePattern(phrase: string, flags = "gu"): RegExp {
  const words = phrase.trim().split(/\s+/).map(escapeRegex);
  return new RegExp(`(?<!${WORD})${words.join(String.raw`\s+`)}(?!${WORD})`, flags);
}

/** Card checksum. Ignores spaces and hyphens. */
export function passesLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 2) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export interface Span {
  start: number;
  end: number;
  text: string;
}

/**
 * Abbreviations whose full stop doesn't end a sentence when a lower-case word
 * follows ("2.5% p.a. interest"). Before a capital, it is treated as the end
 * of the sentence ("2.5% p.a. T&Cs apply.").
 */
const ABBREVIATIONS = ["p.a.", "e.g.", "i.e.", "etc.", "approx.", "vs.", "no.", "mr.", "mrs.", "ms.", "dr."];

/**
 * Splits copy into sentences for the long-sentence rule. A sentence ends at
 * . ! or ? followed by whitespace or the end of the text, so decimals
 * (S$1,000.00), domains (help@tembusu.example) and times (3.30pm) never split.
 */
export function splitSentences(text: string): Span[] {
  const sentences: Span[] = [];
  let start = 0;
  const end = /[.!?]+(?=\s|$)/g;
  for (const match of text.matchAll(end)) {
    const stop = match.index + match[0].length;
    const before = text.slice(start, stop).toLowerCase();
    const after = text.slice(stop).trimStart();
    const isAbbreviation = ABBREVIATIONS.some((abbr) => before.endsWith(abbr));
    if (isAbbreviation && after && !/^\p{Lu}/u.test(after)) continue;
    pushSentence(sentences, text, start, stop);
    start = stop;
  }
  pushSentence(sentences, text, start, text.length);
  return sentences;
}

function pushSentence(sentences: Span[], text: string, from: number, to: number): void {
  const raw = text.slice(from, to);
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (trimmed) sentences.push({ start: from + leading, end: from + leading + trimmed.length, text: trimmed });
}

/** Counts words: runs of characters that contain a letter or digit. */
export function countWords(sentence: string): number {
  return sentence.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}
