"use client";

import { useId, useState } from "react";
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
  aiAvailable: boolean;
  maxLength: number;
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
}

const truncate = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** The start page's second card: what happens when you check. */
export function HowItChecks({ ruleCount, rulesVersion }: { ruleCount: number; rulesVersion: string }) {
  return (
    <section className={`${styles.card} ${styles.howCard}`} aria-labelledby="how-heading">
      <h2 id="how-heading" className={styles.cardTitle}>
        How it checks
      </h2>
      <p className={styles.intro}>
        {ruleCount} rules, checked in three steps, then your review. Rules version {rulesVersion}.
      </p>
      <ol className={styles.steps}>
        <li>
          <strong>Personal data.</strong> NRIC, phone numbers, emails, card and account numbers. If any are found, the copy
          isn&apos;t sent to the AI until they&apos;re replaced or a reviewer overrides the match.
        </li>
        <li>
          <strong>Rule checks.</strong> Banned phrases, required disclosures, wording, money and date formats. Same copy,
          same result, every time.
        </li>
        <li>
          <strong>AI suggestions.</strong> Judgment calls code can&apos;t make, such as implied promises or jargon. Always
          suggestions, and every one must quote words that are really in the copy.
        </li>
        <li>
          <strong>Review and revise.</strong> Choose Fix or Dismiss for each finding, then have the AI draft a revision from your
          decisions. Code checks every draft, and you approve it. Repeat until you&apos;re happy, then copy the text or
          download the report.
        </li>
      </ol>
    </section>
  );
}

export function InputPanel(props: Props) {
  const { samples, text, context, aiAvailable, maxLength, pending, error } = props;
  const [sampleId, setSampleId] = useState("");
  const ids = { sample: useId(), context: useId(), copy: useId(), count: useId() };
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
              id={ids.copy}
              className={styles.textarea}
              rows={8}
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
          <code>{"{name}"}</code>, <code>{"{nric}"}</code> or <code>{"{phone}"}</code>.{" "}
          {aiAvailable
            ? "The copy is sent to Claude for the AI checks only after the personal-data check passes."
            : "AI checks aren't set up on this server, so only the rule checks run."}
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
      </form>
    </section>
  );
}
