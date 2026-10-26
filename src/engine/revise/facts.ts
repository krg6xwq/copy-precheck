// Facts a rewrite must not change: numbers, dates, placeholders, emails, links and
// product names. Compared by value, so "$500" → "S$500" or a casing fix to a
// product name still count as the same fact.

export interface Fact {
  kind: "number" | "date" | "placeholder" | "email" | "link" | "product";
  /** What's compared. */
  value: string;
  /** As written, for messages. */
  text: string;
  start: number;
  end: number;
}

const FACT_LABELS: Record<Fact["kind"], string> = {
  number: "number",
  date: "date",
  placeholder: "placeholder",
  email: "email address",
  link: "link",
  product: "product name",
};

export const factLabel = (fact: Fact) => FACT_LABELS[fact.kind];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function extractFacts(text: string, productNames: string[]): Fact[] {
  const facts: Fact[] = [];
  const add = (kind: Fact["kind"], regex: RegExp, value: (match: string) => string) => {
    for (const match of text.matchAll(regex)) {
      facts.push({ kind, value: value(match[0]), text: match[0], start: match.index, end: match.index + match[0].length });
    }
  };
  // Links, emails and dates first, so the digits inside them aren't also counted as numbers.
  add("link", /https?:\/\/[^\s)]+/gi, (m) => m.replace(/[.,;:]+$/, "").toLowerCase());
  add("email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => m.toLowerCase());
  add("placeholder", /\{[A-Za-z0-9_]+\}/g, (m) => m);
  // Dates count as one fact, so a repeated date gives one flag, not one per number.
  add("date", /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, (m) => m.replace(/[.-]/g, "/"));
  add("date", /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi, (m) => m.replace(/\s+/g, " ").toLowerCase());
  for (const name of productNames) {
    const words = name.trim().split(/\s+/).map(escape).join("\\s+");
    add("product", new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, "giu"), () => name.toLowerCase());
  }
  const inside = (start: number) => facts.some((fact) => fact.kind !== "product" && start >= fact.start && start < fact.end);
  for (const match of text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) {
    if (inside(match.index)) continue;
    facts.push({
      kind: "number",
      value: String(Number(match[0].replace(/,/g, ""))),
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return facts.sort((a, b) => a.start - b.start);
}

/** Facts that appear fewer times in `after` than in `before`, by value. */
export function missingFacts(before: Fact[], after: Fact[]): Fact[] {
  const remaining = new Map<string, number>();
  for (const fact of after) remaining.set(`${fact.kind}:${fact.value}`, (remaining.get(`${fact.kind}:${fact.value}`) ?? 0) + 1);
  const missing: Fact[] = [];
  for (const fact of before) {
    const key = `${fact.kind}:${fact.value}`;
    const left = remaining.get(key) ?? 0;
    if (left > 0) remaining.set(key, left - 1);
    else missing.push(fact);
  }
  return missing;
}
