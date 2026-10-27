"use client";

// The AI checks' status, in three places: a short label in the results
// header, a banner only when something needs the reviewer's attention
// (paused for personal data, or unavailable), and a details line for
// merged and discarded AI findings.

import type { Report } from "@/engine";
import styles from "./checker.module.css";

const DEFAULT_NOT_RUN = "No AI model used for this check";

/** For the meta line: "AI: claude-sonnet-5-5", "AI off", "AI paused"… */
export function AiMeta({ report }: { report: Report }) {
  const { ai } = report;
  switch (ai.status) {
    case "done":
      return (
        <>
          AI: <span className={styles.aiModel}>{ai.model}</span>
        </>
      );
    case "blocked":
    case "unavailable":
      return <>AI {ai.status === "blocked" ? "paused" : "unavailable"}</>;
    default:
      // Not run: either no key on this server, or paused by the rate limit (which gives a reason).
      return <>{ai.reason && ai.reason !== DEFAULT_NOT_RUN ? "AI paused" : "AI not set up"}</>;
  }
}

/** Shown at the top of the results only when the AI checks didn't run as expected. */
export function AiBanner({ report }: { report: Report }) {
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
  if (ai.status === "not-run" && ai.reason && ai.reason !== DEFAULT_NOT_RUN) {
    return (
      <div className={`${styles.aiStatus} ${styles.aiWarning}`} role="note">
        <strong>AI checks paused.</strong> {ai.reason}
      </div>
    );
  }
  return null;
}

/** Quiet details for the summary: AI notes merged into rule findings, and findings discarded. */
export function AiDetails({ report }: { report: Report }) {
  const { ai } = report;
  if (ai.status !== "done" || (ai.merged === 0 && ai.rejected.length === 0)) return null;
  return (
    <div className={styles.aiDetails}>
      {ai.merged > 0 && (
        <p>
          {ai.merged} AI {ai.merged === 1 ? "note" : "notes"} matched a rule finding and {ai.merged === 1 ? "was" : "were"} added
          to it.
        </p>
      )}
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
