// Saves the review as a Markdown file in the browser. Used by the results header,
// and offered before "New check" clears earlier rounds.

import type { Report } from "@/engine";
import type { Decision } from "./labels";
import { reportToMarkdown, type MarkdownExtras } from "./markdown";

export function downloadReport(report: Report, decisions: Record<string, Decision>, checkedAt: Date, extras: MarkdownExtras) {
  const blob = new Blob([reportToMarkdown(report, decisions, checkedAt, extras)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `copy-precheck-${checkedAt.toISOString().slice(0, 10)}.md`;
  link.click();
  URL.revokeObjectURL(url);
}
