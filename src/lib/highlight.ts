// Splits copy into pieces so findings can be highlighted where they occur.
// Findings can overlap (a rule and an AI note on the same words), so each
// piece lists every finding that covers it.
//
// A finding whose words contain another finding's (such as a long sentence
// with a flagged word inside it) is "wide". Pieces covered only by wide
// findings are drawn as an underline without a fill, so the narrower
// findings inside them still stand out.

import type { Finding, Severity } from "@/engine";

export interface Segment {
  text: string;
  start: number;
  /** Findings covering this piece of text, in report order. */
  findings: Finding[];
  /** The most serious severity among them, used for the highlight colour. */
  severity?: Severity;
  /** Set when only wide findings cover this piece, so it gets no fill. */
  wide?: true;
}

const RANK: Record<Severity, number> = { blocker: 0, "needs-fix": 1, suggestion: 2 };

const mostSerious = (findings: Finding[]) =>
  findings.reduce<Severity | undefined>(
    (best, finding) => (!best || RANK[finding.severity] < RANK[best] ? finding.severity : best),
    undefined,
  );

export function segmentCopy(text: string, findings: Finding[]): Segment[] {
  const located = findings.filter((finding) => finding.match && finding.match.end > finding.match.start);
  const cuts = new Set<number>([0, text.length]);
  for (const finding of located) {
    cuts.add(Math.max(0, Math.min(text.length, finding.match!.start)));
    cuts.add(Math.max(0, Math.min(text.length, finding.match!.end)));
  }
  const length = (finding: Finding) => finding.match!.end - finding.match!.start;
  const wide = new Set(
    located.filter((outer) =>
      located.some(
        (other) =>
          other !== outer &&
          length(other) < length(outer) &&
          other.match!.start >= outer.match!.start &&
          other.match!.end <= outer.match!.end,
      ),
    ),
  );
  const points = [...cuts].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const covering = located.filter((finding) => finding.match!.start <= start && finding.match!.end >= end);
    const severity = mostSerious(covering);
    const onlyWide = covering.length > 0 && covering.every((finding) => wide.has(finding));
    segments.push({
      text: text.slice(start, end),
      start,
      findings: covering,
      ...(severity ? { severity } : {}),
      ...(onlyWide ? { wide: true as const } : {}),
    });
  }
  return segments;
}
