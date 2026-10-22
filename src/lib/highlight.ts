// Splits copy into pieces so findings can be highlighted where they occur.
// Findings can overlap (a rule and an AI note on the same words), so each
// piece lists every finding that covers it.

import type { Finding, Severity } from "@/engine";

export interface Segment {
  text: string;
  start: number;
  /** Findings covering this piece of text, in report order. */
  findings: Finding[];
  /** The most serious severity among them, used for the highlight colour. */
  severity?: Severity;
}

const RANK: Record<Severity, number> = { blocker: 0, "needs-fix": 1, suggestion: 2 };

export function segmentCopy(text: string, findings: Finding[]): Segment[] {
  const located = findings.filter((finding) => finding.match && finding.match.end > finding.match.start);
  const cuts = new Set<number>([0, text.length]);
  for (const finding of located) {
    cuts.add(Math.max(0, Math.min(text.length, finding.match!.start)));
    cuts.add(Math.max(0, Math.min(text.length, finding.match!.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const covering = located.filter((finding) => finding.match!.start <= start && finding.match!.end >= end);
    const severity = covering.reduce<Severity | undefined>(
      (best, finding) => (!best || RANK[finding.severity] < RANK[best] ? finding.severity : best),
      undefined,
    );
    segments.push({ text: text.slice(start, end), start, findings: covering, ...(severity ? { severity } : {}) });
  }
  return segments;
}
