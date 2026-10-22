"use client";

import type { Finding } from "@/engine";
import { segmentCopy } from "@/lib/highlight";
import { findingKey } from "@/lib/labels";
import styles from "./checker.module.css";

interface Props {
  text: string;
  findings: Finding[];
  activeKey: string | null;
  onSelect: (finding: Finding) => void;
}

const matchLength = (finding: Finding) => (finding.match ? finding.match.end - finding.match.start : Infinity);

export function HighlightedCopy({ text, findings, activeKey, onSelect }: Props) {
  const segments = segmentCopy(text, findings);
  return (
    <figure className={styles.copyPreview}>
      <figcaption className={styles.label}>Copy checked</figcaption>
      <p className={styles.copyText}>
        {segments.map((segment) => {
          if (!segment.severity) return <span key={segment.start}>{segment.text}</span>;
          const names = segment.findings.map((finding) => `${finding.ruleId} ${finding.ruleName}`).join(", ");
          const active = activeKey !== null && segment.findings.some((finding) => findingKey(finding) === activeKey);
          // Jump to the most serious finding (the one the colour shows). Among those, the one with the
          // shortest match is the most specific, so words inside a flagged sentence go to their own rule.
          const target = segment.findings
            .filter((finding) => finding.severity === segment.severity)
            .reduce((best, finding) => (matchLength(finding) < matchLength(best) ? finding : best));
          // The mark itself is the control. A <button> can't wrap across lines like text, so a long
          // highlight inside one would break the paragraph's layout.
          return (
            <mark
              key={segment.start}
              role="button"
              tabIndex={0}
              className={[
                styles.mark,
                styles[`mark-${segment.severity}`],
                segment.wide ? styles.markWide : "",
                active ? styles.markActive : "",
              ].join(" ")}
              title={names}
              aria-label={`${segment.text}: go to ${names}`}
              onClick={() => onSelect(target)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelect(target);
              }}
            >
              {segment.text}
            </mark>
          );
        })}
      </p>
    </figure>
  );
}
