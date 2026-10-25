"use client";

import { useId, useState } from "react";
import type { Finding } from "@/engine";
import type { CarriedDecision } from "@/engine/revise/draft";
import { findingDomId, SOURCE_LABELS, type Decision } from "@/lib/labels";
import styles from "./checker.module.css";

interface Props {
  finding: Finding;
  decision?: Decision;
  onDecision: (decision: Decision | undefined) => void;
  /** The reviewer's note (on accept) or reason (on dismiss). */
  comment: string;
  onComment: (comment: string) => void;
  /** Dismissing this finding needs a reason (blockers and needs fix). */
  reasonRequired: boolean;
  /** Set when an earlier round decided on the same words. */
  carried?: CarriedDecision;
  onOverride: (reason: string) => void;
  onUndoOverride: () => void;
  pending: boolean;
  active: boolean;
  onActivate: (on: boolean) => void;
}

function OverrideForm({ onSubmit, onCancel, pending }: { onSubmit: (reason: string) => void; onCancel: () => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  const id = useId();
  return (
    <form
      className={styles.overrideForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim()) onSubmit(reason.trim());
      }}
    >
      <label htmlFor={id} className={styles.label}>
        Why isn&apos;t this personal data?
      </label>
      <textarea
        id={id}
        className={styles.textarea}
        rows={2}
        maxLength={300}
        value={reason}
        placeholder="e.g. Published overseas hotline"
        onChange={(event) => setReason(event.target.value)}
        autoFocus
      />
      <p className={styles.hint}>Only this exact text is released. The reason is recorded in the report.</p>
      <div className={styles.buttonRow}>
        <button type="submit" className={styles.primaryButtonSmall} disabled={pending || !reason.trim()}>
          Override and check again
        </button>
        <button type="button" className={styles.textButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CommentField({
  decision,
  reasonRequired,
  comment,
  onComment,
}: {
  decision: Decision;
  reasonRequired: boolean;
  comment: string;
  onComment: (comment: string) => void;
}) {
  const id = useId();
  const required = decision === "dismissed" && reasonRequired;
  // Opens by itself only when a reason is required; otherwise behind a link.
  const [open, setOpen] = useState(required || comment.length > 0);
  if (!open && !required) {
    return (
      <button type="button" className={styles.textButton} onClick={() => setOpen(true)}>
        {decision === "accepted" ? "Add a note for the revision" : "Add a reason"}
      </button>
    );
  }
  const label =
    decision === "accepted" ? "Note for the revision (optional)" : required ? "Why dismiss this? (required)" : "Why dismiss this? (optional)";
  const missing = required && !comment.trim();
  return (
    <div className={styles.commentField}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <textarea
        id={id}
        className={`${styles.textarea} ${missing ? styles.textareaMissing : ""}`}
        rows={2}
        maxLength={300}
        value={comment}
        aria-invalid={missing}
        placeholder={decision === "accepted" ? "e.g. Keep it warm, this is a welcome email" : "e.g. Approved by the campaign team"}
        onChange={(event) => onComment(event.target.value)}
        autoFocus={!comment}
      />
      {required && <p className={styles.hint}>Dismissing a serious finding is recorded in the report with your reason.</p>}
    </div>
  );
}

export function FindingCard({
  finding,
  decision,
  onDecision,
  comment,
  onComment,
  reasonRequired,
  carried,
  onOverride,
  onUndoOverride,
  pending,
  active,
  onActivate,
}: Props) {
  const [overriding, setOverriding] = useState(false);
  const isGuard = finding.layer === "guard";
  const dismissed = decision === "dismissed";

  const classes = [
    styles.finding,
    styles[`finding-${finding.severity}`],
    finding.override ? styles.findingOverridden : "",
    dismissed ? styles.findingDismissed : "",
    active ? styles.findingActive : "",
  ].join(" ");

  return (
    <li
      id={findingDomId(finding)}
      tabIndex={-1}
      className={classes}
      onMouseEnter={() => onActivate(true)}
      onMouseLeave={() => onActivate(false)}
      onFocus={() => onActivate(true)}
      onBlur={() => onActivate(false)}
    >
      <div className={styles.findingHeader}>
        <span className={styles.ruleId}>{finding.ruleId}</span>
        <span className={styles.ruleName}>{finding.ruleName}</span>
        <span className={`${styles.sourceTag} ${styles[`source-${finding.layer}`]}`}>{SOURCE_LABELS[finding.layer]}</span>
      </div>

      {carried && (
        <p className={`${styles.carried} ${carried.note === "still-found" ? styles.carriedStill : ""}`}>
          {carried.note === "still-found"
            ? `Still found after the round ${carried.round} revision.`
            : `Dismissed in round ${carried.round}${carried.comment ? `: ${carried.comment}` : ""}.`}
        </p>
      )}

      {finding.match && <blockquote className={styles.quote}>“{finding.match.text}”</blockquote>}

      {finding.detail && (
        <p className={styles.detail}>
          {finding.layer === "ai" && <span className={styles.detailLabel}>AI note: </span>}
          {finding.detail}
        </p>
      )}
      {finding.suggestion && (
        <p className={styles.detail}>
          <span className={styles.detailLabel}>Suggested wording: </span>“{finding.suggestion}”
        </p>
      )}
      {finding.aiAgreement?.map((agreement) => (
        <p key={agreement.ruleId} className={styles.agreement}>
          <span className={styles.detailLabel}>{agreement.ruleId} (AI) agrees: </span>
          {agreement.explanation}
        </p>
      ))}

      <p className={styles.fix}>
        <span className={styles.detailLabel}>Fix: </span>
        {finding.fix}
      </p>
      <details className={styles.why}>
        <summary>Why this rule exists</summary>
        <p>{finding.why}</p>
      </details>

      {finding.override ? (
        <div className={styles.decisionRow}>
          <p className={styles.overrideReason}>
            <span className={styles.detailLabel}>Overridden: </span>
            {finding.override.reason}
          </p>
          <button type="button" className={styles.textButton} onClick={onUndoOverride} disabled={pending}>
            Undo override
          </button>
        </div>
      ) : isGuard ? (
        overriding ? (
          <OverrideForm
            pending={pending}
            onCancel={() => setOverriding(false)}
            onSubmit={(reason) => {
              setOverriding(false);
              onOverride(reason);
            }}
          />
        ) : (
          <div className={styles.decisionRow}>
            <button type="button" className={styles.secondaryButton} onClick={() => setOverriding(true)} disabled={pending}>
              This isn&apos;t personal data…
            </button>
          </div>
        )
      ) : (
        <div className={styles.decisionRow} role="group" aria-label={`Decision for ${finding.ruleId}`}>
          <button
            type="button"
            className={`${styles.toggleButton} ${decision === "accepted" ? styles.toggleAccepted : ""}`}
            aria-pressed={decision === "accepted"}
            onClick={() => onDecision(decision === "accepted" ? undefined : "accepted")}
          >
            {decision === "accepted" ? "Accepted" : "Accept"}
          </button>
          <button
            type="button"
            className={`${styles.toggleButton} ${dismissed ? styles.toggleDismissed : ""}`}
            aria-pressed={dismissed}
            onClick={() => onDecision(dismissed ? undefined : "dismissed")}
          >
            {dismissed ? "Dismissed" : "Dismiss"}
          </button>
          {decision && (
            <CommentField
              key={decision}
              decision={decision}
              reasonRequired={reasonRequired}
              comment={comment}
              onComment={onComment}
            />
          )}
        </div>
      )}
    </li>
  );
}
