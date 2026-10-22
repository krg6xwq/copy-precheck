"use client";

import type { Finding } from "@/engine";
import { segmentCopy } from "@/lib/highlight";
import { findingKey } from "@/lib/labels";
import styles from "./checker.module.css";

interface Props {
  text: string;
  findings: Finding[];
  activeKey: string | null;
}

export function HighlightedCopy({ text, findings, activeKey }: Props) {
  const segments = segmentCopy(text, findings);
  return (
    <figure className={styles.copyPreview}>
      <figcaption className={styles.label}>Copy checked</figcaption>
      <p className={styles.copyText}>
        {segments.map((segment) => {
          if (!segment.severity) return <span key={segment.start}>{segment.text}</span>;
          const names = segment.findings.map((finding) => `${finding.ruleId} ${finding.ruleName}`).join(", ");
          const active = activeKey !== null && segment.findings.some((finding) => findingKey(finding) === activeKey);
          return (
            <mark
              key={segment.start}
              className={`${styles.mark} ${styles[`mark-${segment.severity}`]} ${active ? styles.markActive : ""}`}
              title={names}
            >
              {segment.text}
            </mark>
          );
        })}
      </p>
    </figure>
  );
}
