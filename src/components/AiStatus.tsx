"use client";

import type { Report } from "@/engine";
import styles from "./checker.module.css";

export function AiStatus({ report }: { report: Report }) {
  const { ai } = report;

  if (ai.status === "blocked") {
    return (
      <div className={`${styles.aiStatus} ${styles.aiBlocked}`} role="note">
        <strong>AI checks paused: personal data found.</strong> Replace it with a placeholder, or override a match
        you&apos;ve checked isn&apos;t personal data. Nothing has been sent to the AI.
      </div>
    );
  }
  if (ai.status === "unavailable") {
    return (
      <div className={`${styles.aiStatus} ${styles.aiWarning}`} role="note">
        <strong>AI checks unavailable.</strong> {ai.reason}. The rule check findings below still apply.
      </div>
    );
  }
  if (ai.status === "not-run") {
    return (
      <div className={styles.aiStatus} role="note">
        <strong>AI checks off.</strong> {ai.reason && ai.reason !== "No AI model used for this check" ? ai.reason : "Only the rule checks ran."}
      </div>
    );
  }

  return (
    <div className={`${styles.aiStatus} ${styles.aiDone}`} role="note">
      <p>
        <strong>AI checks done</strong> <span className={styles.aiModel}>{ai.model}</span>
        {ai.merged > 0 && (
          <>
            {" "}· {ai.merged} AI {ai.merged === 1 ? "note" : "notes"} matched a rule finding and{" "}
            {ai.merged === 1 ? "was" : "were"} added to it
          </>
        )}
      </p>
      {ai.rejected.length > 0 && (
        <details className={styles.rejected}>
          <summary>
            {ai.rejected.length} AI {ai.rejected.length === 1 ? "finding was" : "findings were"} discarded because{" "}
            {ai.rejected.length === 1 ? "it" : "they"} failed validation
          </summary>
          <ul>
            {ai.rejected.map((item, index) => (
              <li key={index}>
                {item.ruleId} {item.quote && <>“{item.quote}”</>}: {item.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
