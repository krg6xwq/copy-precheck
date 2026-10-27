"use client";

// The copy being reviewed, above the results. Two different jobs live here:
// - Edit copy: change the words yourself and carry on. The edit is checked as the next round,
//   so earlier rounds and dismissals are kept, and the report records the edit.
// - New check: start over with different copy. Clears everything, so it asks first when
//   there are rounds to lose, and offers the report.

import { useId, useState } from "react";
import type { Context } from "@/engine";
import { CONTEXT_LABELS } from "@/lib/labels";
import type { CheckedInput } from "./Checker";
import styles from "./checker.module.css";

interface Props {
  input: CheckedInput;
  pending: boolean;
  error: string | null;
  maxLength: number;
  /** A draft is waiting, and a hand edit would discard it. */
  hasDraft: boolean;
  /** Rounds recorded so far (AI drafts and hand edits), lost by a new check. */
  rounds: number;
  onCheckEdit: (text: string, context: Context | "") => void;
  onNewCheck: () => void;
  onDownload: () => void;
}

export function CopyBar(props: Props) {
  const { input, pending, error, maxLength } = props;
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [text, setText] = useState(input.text);
  const [context, setContext] = useState<Context | "">(input.context);
  const ids = { copy: useId(), count: useId(), context: useId(), confirm: useId() };
  const preview = input.text.replace(/\s+/g, " ").trim();
  const unchanged = text.trim() === input.text && context === input.context;

  function openEditor() {
    setText(input.text);
    setContext(input.context);
    setMode("edit");
  }

  function newCheck() {
    if (props.rounds > 0) setMode("confirm");
    else props.onNewCheck();
  }

  // The page's main heading, kept in every state.
  const heading = (
    <h1 id="copy-bar-heading" className="visually-hidden">
      Check copy
    </h1>
  );

  if (mode === "edit") {
    return (
      <section className={`${styles.card} ${styles.copyEditor}`} aria-labelledby="copy-bar-heading" aria-busy={pending}>
        {heading}
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() && !unchanged) props.onCheckEdit(text.trim(), context);
          }}
        >
          <div className={styles.field}>
            <label htmlFor={ids.copy} className={styles.label}>
              Edit the copy
            </label>
            <textarea
              id={ids.copy}
              className={styles.textarea}
              rows={8}
              maxLength={maxLength}
              value={text}
              aria-describedby={ids.count}
              onChange={(event) => setText(event.target.value)}
              autoFocus
            />
            <p id={ids.count} className={`${styles.hint} ${maxLength - text.length < 100 ? styles.hintWarn : ""}`}>
              {text.length.toLocaleString("en-SG")} / {maxLength.toLocaleString("en-SG")} characters
            </p>
          </div>
          <div className={styles.field}>
            <label htmlFor={ids.context} className={styles.label}>
              Where does this copy appear?
            </label>
            <select
              id={ids.context}
              className={styles.select}
              value={context}
              onChange={(event) => setContext(event.target.value as Context | "")}
            >
              <option value="">Not specified (every rule runs)</option>
              {Object.entries(CONTEXT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <p className={styles.hint}>
            Your edit is checked again as the next round. Earlier rounds and your dismissals are kept, and the report
            records what you changed.
          </p>
          {props.hasDraft && (
            <p className={styles.staleNotice} role="note">
              Checking your edit discards the draft that&apos;s waiting.
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.buttonRow}>
            <button type="submit" className={styles.primaryButtonSmall} disabled={pending || !text.trim() || unchanged}>
              {pending ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" /> Checking…
                </>
              ) : (
                "Check my edit"
              )}
            </button>
            <button type="button" className={styles.textButton} onClick={() => setMode("view")} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className={`${styles.card} ${styles.copyBar}`} aria-labelledby="copy-bar-heading">
      {heading}
      <div className={styles.copyBarRow}>
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
          mode === "view" && (
            <div className={styles.buttonRow}>
              <button type="button" className={styles.secondaryButton} onClick={openEditor}>
                Edit copy
              </button>
              <button type="button" className={styles.textButton} onClick={newCheck}>
                New check
              </button>
            </div>
          )
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {mode === "confirm" && (
        <div className={styles.confirm} role="group" aria-labelledby={ids.confirm}>
          <p id={ids.confirm}>
            <strong>Start a new check?</strong> This clears {props.rounds} {props.rounds === 1 ? "round" : "rounds"} and
            your decisions. Download the report first if you need it.
          </p>
          <div className={styles.buttonRow}>
            {/* Focus starts on the safe choice, so Enter can't clear the session by accident. */}
            <button type="button" className={styles.secondaryButton} onClick={props.onDownload} autoFocus>
              Download report
            </button>
            <button type="button" className={styles.secondaryButton} onClick={props.onNewCheck}>
              Clear and start over
            </button>
            <button type="button" className={styles.textButton} onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
