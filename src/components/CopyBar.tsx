"use client";

// The check form, collapsed after a check so the results get the full width.
// Shows what was checked, and opens the form again to edit the copy.

import type { CheckedInput } from "./Checker";
import { CONTEXT_LABELS } from "@/lib/labels";
import styles from "./checker.module.css";

interface Props {
  input: CheckedInput;
  pending: boolean;
  onEdit: () => void;
}

export function CopyBar({ input, pending, onEdit }: Props) {
  const preview = input.text.replace(/\s+/g, " ").trim();
  return (
    <section className={`${styles.card} ${styles.copyBar}`} aria-labelledby="copy-bar-heading">
      {/* The page's main heading, kept when the form is collapsed. */}
      <h1 id="copy-bar-heading" className="visually-hidden">
        Check copy
      </h1>
      <div className={styles.copyBarText}>
        <p className={styles.label}>Copy checked</p>
        <p className={styles.copyBarQuote} title={preview}>
          “{preview}”
        </p>
        <p className={styles.meta}>
          {input.text.length.toLocaleString("en-SG")} characters ·{" "}
          {input.context ? CONTEXT_LABELS[input.context] : "Context not specified"}
        </p>
      </div>
      {pending ? (
        <p className={styles.copyBarPending}>
          <span className={`${styles.spinner} ${styles.spinnerOnLight}`} aria-hidden="true" /> Checking…
        </p>
      ) : (
        <button type="button" className={styles.secondaryButton} onClick={onEdit}>
          Edit copy
        </button>
      )}
    </section>
  );
}
