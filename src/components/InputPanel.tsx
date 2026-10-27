"use client";

import { useId, useState, type Ref } from "react";
import type { Context } from "@/engine";
import type { Sample } from "@/app/content";
import { CONTEXT_LABELS } from "@/lib/labels";
import styles from "./checker.module.css";

interface Props {
  samples: Sample[];
  text: string;
  onTextChange: (text: string) => void;
  context: Context | "";
  onContextChange: (context: Context | "") => void;
  useAi: boolean;
  onUseAiChange: (useAi: boolean) => void;
  aiAvailable: boolean;
  maxLength: number;
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
  /** Present when there are results to go back to: closes the form without checking. */
  onCancel?: () => void;
  copyRef?: Ref<HTMLTextAreaElement>;
}

const truncate = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

export function InputPanel({ copyRef, onCancel, ...props }: Props) {
  const { samples, text, context, useAi, aiAvailable, maxLength, pending, error } = props;
  const [sampleId, setSampleId] = useState("");
  const ids = { sample: useId(), context: useId(), copy: useId(), count: useId(), ai: useId(), aiHint: useId() };
  const remaining = maxLength - text.length;

  function loadSample(id: string) {
    setSampleId(id);
    const sample = samples.find((s) => s.id === id);
    if (!sample) return;
    props.onTextChange(sample.text);
    props.onContextChange(sample.context);
  }

  return (
    <section className={`${styles.card} ${styles.inputCard}`} aria-labelledby="check-heading">
      <h1 id="check-heading" className={styles.cardTitle}>
        Check copy
      </h1>
      <p className={styles.intro}>
        Checks UI copy against Tembusu Bank&apos;s writing rules before it goes to compliance review.
      </p>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) props.onSubmit();
        }}
      >
        <div className={styles.fieldGroup}>
          <div className={styles.field}>
            <label htmlFor={ids.copy} className={styles.label}>
              Copy
            </label>
            <textarea
              ref={copyRef}
              id={ids.copy}
              className={styles.textarea}
              rows={6}
              maxLength={maxLength}
              value={text}
              aria-describedby={ids.count}
              placeholder="e.g. Earn 2.5% p.a. interest on your Tembusu Growth Account. T&Cs apply."
              onChange={(event) => {
                setSampleId("");
                props.onTextChange(event.target.value);
              }}
            />
            <p id={ids.count} className={`${styles.hint} ${remaining < 100 ? styles.hintWarn : ""}`}>
              {text.length.toLocaleString("en-SG")} / {maxLength.toLocaleString("en-SG")} characters
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor={ids.sample} className={styles.label}>
              Try a sample <span className={styles.optional}>(optional)</span>
            </label>
            <select
              id={ids.sample}
              className={styles.select}
              value={sampleId}
              onChange={(event) => loadSample(event.target.value)}
            >
              <option value="">Choose from the test set…</option>
              {Object.entries(CONTEXT_LABELS).map(([value, label]) => {
                const group = samples.filter((sample) => sample.context === value);
                if (!group.length) return null;
                return (
                  <optgroup key={value} label={label}>
                    {group.map((sample) => (
                      <option key={sample.id} value={sample.id}>
                        {truncate(sample.text, 60)}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor={ids.context} className={styles.label}>
            Where does this copy appear?
          </label>
          <select
            id={ids.context}
            className={styles.select}
            value={context}
            onChange={(event) => props.onContextChange(event.target.value as Context | "")}
          >
            <option value="">Not specified (every rule runs)</option>
            {Object.entries(CONTEXT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.notice} role="note">
          <strong>Never paste real customer data.</strong> Use placeholders such as{" "}
          <code>{"{name}"}</code>, <code>{"{nric}"}</code> or <code>{"{phone}"}</code>.
        </div>

        <div className={styles.checkboxRow}>
          <input
            id={ids.ai}
            type="checkbox"
            className={styles.checkbox}
            checked={aiAvailable && useAi}
            disabled={!aiAvailable}
            aria-describedby={ids.aiHint}
            onChange={(event) => props.onUseAiChange(event.target.checked)}
          />
          <div>
            <label htmlFor={ids.ai} className={styles.checkboxLabel}>
              Include AI checks
            </label>
            <p id={ids.aiHint} className={styles.hint}>
              {aiAvailable
                ? "Sent to Claude only after the personal-data check passes. AI findings are suggestions."
                : "AI checks aren't set up on this server. The rule checks still run."}
            </p>
          </div>
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button type="submit" className={styles.primaryButton} disabled={pending || !text.trim()}>
          {pending ? (
            <>
              <span className={styles.spinner} aria-hidden="true" /> Checking…
            </>
          ) : (
            "Check copy"
          )}
        </button>
        {onCancel && (
          <button type="button" className={styles.textButton} onClick={onCancel} disabled={pending}>
            Cancel and keep the current results
          </button>
        )}
      </form>
    </section>
  );
}
