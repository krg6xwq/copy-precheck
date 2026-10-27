"use client";

// The draft view (spec: screens and states, step 3). Shows what changed and
// why, anything code flagged, and questions only the reviewer can answer.
// Approve stays disabled until every flag is kept or undone and every
// question is answered.

import { useId, useRef, useState, type RefObject } from "react";
import type { DiffPart, Region } from "@/engine/revise/diff";
import type { Draft, Flag, NeedsInput } from "@/engine/revise/types";
import { changeSource, MAX_ROUNDS, unfixedLabels } from "@/engine/revise/review";
import { SEVERITIES, SEVERITY_LABELS } from "@/lib/labels";
import styles from "./checker.module.css";

interface Props {
  draft: Draft;
  round: number;
  kept: string[];
  pending: boolean;
  error: string | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onKeep: (flag: Flag, keep: boolean) => void;
  onUndo: (flag: Flag) => void;
  onAnswer: (question: NeedsInput, answer: string) => void;
  onEdit: (text: string) => void;
  onApprove: () => void;
  onDiscard: () => void;
  onBack: () => void;
}

const FLAG_LABELS: Record<Flag["kind"], string> = {
  "changed-fact": "Changed fact",
  "unrequested-change": "Unrequested change",
  "dismissed-changed": "Dismissed words changed",
  "too-long": "Too long",
  "personal-data": "Personal data",
};

function approvalReasons(draft: Draft, kept: string[]): string[] {
  const open = draft.flags.filter((flag) => flag.resolution === "edit-only" || !kept.includes(flag.id));
  const reasons: string[] = [];
  if (open.length) reasons.push(`${open.length} ${open.length === 1 ? "flag" : "flags"} to resolve`);
  if (draft.needsInput.length) {
    reasons.push(`${draft.needsInput.length} ${draft.needsInput.length === 1 ? "question" : "questions"} to answer`);
  }
  return reasons;
}

function Question({ question, pending, onAnswer }: { question: NeedsInput; pending: boolean; onAnswer: (answer: string) => void }) {
  const name = useId();
  const [choice, setChoice] = useState(question.options[0] ?? "");
  const [other, setOther] = useState("");
  const answer = choice === "__other" ? other.trim() : choice;
  return (
    <li className={styles.question}>
      <fieldset>
        <legend className={styles.questionText}>
          {question.question} <span className={styles.questionQuote}>“{question.quote}”</span>
        </legend>
        <div className={styles.options}>
          {question.options.map((option) => (
            <label key={option} className={styles.option}>
              <input type="radio" name={name} value={option} checked={choice === option} onChange={() => setChoice(option)} />
              {option}
            </label>
          ))}
          <label className={styles.option}>
            <input type="radio" name={name} value="__other" checked={choice === "__other"} onChange={() => setChoice("__other")} />
            Something else
          </label>
          {choice === "__other" && (
            <input
              type="text"
              className={styles.input}
              aria-label="Your answer"
              maxLength={150}
              value={other}
              onChange={(event) => setOther(event.target.value)}
              autoFocus
            />
          )}
        </div>
      </fieldset>
      <button type="button" className={styles.primaryButtonSmall} disabled={pending || !answer} onClick={() => onAnswer(answer)}>
        Use this answer
      </button>
    </li>
  );
}

/** The flag's original words in full, with the changed parts marked. */
function FlagQuote({ quote }: { quote: NonNullable<Flag["quote"]> }) {
  const parts: { text: string; marked: boolean }[] = [];
  let cursor = 0;
  for (const mark of [...quote.marks].sort((a, b) => a.start - b.start)) {
    if (mark.start > cursor) parts.push({ text: quote.text.slice(cursor, mark.start), marked: false });
    parts.push({ text: quote.text.slice(Math.max(mark.start, cursor), mark.end), marked: true });
    cursor = Math.max(cursor, mark.end);
  }
  if (cursor < quote.text.length) parts.push({ text: quote.text.slice(cursor), marked: false });
  return (
    <blockquote className={styles.quote}>
      “
      {parts.map((part, index) =>
        part.marked ? (
          <mark key={index} className={styles.markChanged}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
      ”
    </blockquote>
  );
}

interface FlagCardProps {
  flag: Flag;
  kept: boolean;
  pending: boolean;
  onKeep: (keep: boolean) => void;
  onUndo: () => void;
  onEdit: () => void;
  onActivate: (on: boolean) => void;
  onLocate: () => void;
}

function FlagCard({ flag, kept, pending, onKeep, onUndo, onEdit, onActivate, onLocate }: FlagCardProps) {
  return (
    <li
      className={`${styles.flag} ${kept ? styles.flagKept : ""}`}
      onMouseEnter={() => onActivate(true)}
      onMouseLeave={() => onActivate(false)}
      onFocus={() => onActivate(true)}
      onBlur={() => onActivate(false)}
    >
      <p className={styles.flagTitle}>
        <span className={styles.flagKind}>{FLAG_LABELS[flag.kind]}</span>
        {kept && <span className={styles.flagKeptTag}>Kept</span>}
      </p>
      <p className={styles.detail}>{flag.message}</p>
      {flag.quote && <FlagQuote quote={flag.quote} />}
      <div className={styles.buttonRow}>
        {flag.region && (
          <button type="button" className={styles.textButton} onClick={onLocate}>
            Show in draft
          </button>
        )}
        {flag.resolution === "keep-or-undo" &&
          (kept ? (
            <button type="button" className={styles.textButton} onClick={() => onKeep(false)} disabled={pending}>
              Don&apos;t keep
            </button>
          ) : (
            <button type="button" className={styles.secondaryButton} onClick={() => onKeep(true)} disabled={pending}>
              Keep this change
            </button>
          ))}
        {flag.region && !kept && (
          <button type="button" className={styles.secondaryButton} onClick={onUndo} disabled={pending}>
            Undo it
          </button>
        )}
        <button type="button" className={styles.textButton} onClick={onEdit} disabled={pending}>
          Edit the draft
        </button>
      </div>
    </li>
  );
}

/** Which diff parts fall inside a flag's region, for highlighting the spot in the draft. */
function partsIn(diff: DiffPart[], region: Region | undefined): Set<number> {
  const hit = new Set<number>();
  if (!region) return hit;
  let orig = 0;
  let draft = 0;
  diff.forEach((part, index) => {
    const length = part.text.length;
    if (part.type === "added") {
      if (draft < region.draftEnd && region.draftStart < draft + length) hit.add(index);
      draft += length;
      return;
    }
    if (orig < region.origEnd && region.origStart < orig + length && part.type === "removed") hit.add(index);
    orig += length;
    if (part.type === "same") draft += length;
  });
  return hit;
}

export function DraftPanel(props: Props) {
  const { draft, round, kept, pending, error, headingRef } = props;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.text);
  const editId = useId();
  const [activeFlag, setActiveFlag] = useState<string | null>(null);
  const active = partsIn(draft.diff, draft.flags.find((flag) => flag.id === activeFlag)?.region);
  const diffBox = useRef<HTMLParagraphElement>(null);
  function locate(flag: Flag) {
    setActiveFlag(flag.id);
    requestAnimationFrame(() => {
      const first = diffBox.current?.querySelector("[data-active]");
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Centred, so the sticky header doesn't cover it.
      first?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    });
  }
  const reasons = approvalReasons(draft, kept);
  const unfixed = unfixedLabels(draft);
  const unfixedNote = unfixed.length
    ? `${unfixed.length} accepted ${unfixed.length === 1 ? "finding wasn't" : "findings weren't"} fixed in this draft.`
    : "";
  const after = draft.recheck.findings.filter((finding) => !finding.override);
  const approveHint = editing
    ? "Check or cancel your edit first."
    : reasons.length
      ? `Approve is available once: ${reasons.join(", ")}.`
      : "Approving makes this the copy and checks it again.";
  const approveButton = (describedBy: string) => (
    <button
      type="button"
      className={styles.primaryButtonSmall}
      disabled={pending || reasons.length > 0 || editing}
      aria-describedby={describedBy}
      onClick={props.onApprove}
    >
      Approve draft
    </button>
  );
  const startEditing = () => {
    setEditText(draft.text);
    setEditing(true);
  };

  return (
    <section className={`${styles.card} ${styles.reportCard}`} aria-labelledby="draft-heading" aria-busy={pending}>
      <div className={styles.stickyHeader}>
        <div className={styles.reportHeader}>
          <div>
            <h2 id="draft-heading" className={styles.cardTitle} tabIndex={-1} ref={headingRef}>
              Draft revision
            </h2>
            <p className={styles.meta}>
              Round {round} of {MAX_ROUNDS}
              {draft.model ? ` · Drafted by ${draft.model}` : ""} · Checked by code
            </p>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.buttonRow}>
              {approveButton("approve-reasons")}
              <button type="button" className={styles.secondaryButton} onClick={props.onBack}>
                Back to findings
              </button>
            </div>
            <p id="approve-reasons" className={styles.headerHint}>
              {approveHint}
            </p>
          </div>
        </div>
      </div>

      <div className={`${styles.summary} ${reasons.length || unfixed.length ? styles["tone-needs-fix"] : styles["tone-ok"]}`}>
        <p className={styles.summaryText}>
          {reasons.length
            ? `Before approving: ${reasons.join(", ")}.${unfixedNote ? ` ${unfixedNote}` : ""}`
            : unfixedNote
              ? `Ready to approve, but ${unfixedNote.charAt(0).toLowerCase()}${unfixedNote.slice(1)}`
              : "Ready to approve. Nothing was flagged."}
        </p>
        <p className={styles.dismissedNote}>
          Every change was checked: facts kept, each change backed by a finding you accepted, dismissed words untouched.
        </p>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {editing ? (
        <div className={styles.copyPreview}>
          <label htmlFor={editId} className={styles.label}>
            Edit the draft
          </label>
          <textarea
            id={editId}
            className={styles.textarea}
            rows={8}
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            autoFocus
          />
          <p className={styles.hint}>Your edits are recorded as yours, then the whole draft is checked again.</p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primaryButtonSmall}
              disabled={pending || !editText.trim()}
              onClick={() => {
                props.onEdit(editText);
                setEditing(false);
              }}
            >
              Check my edit
            </button>
            <button type="button" className={styles.textButton} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <figure className={styles.copyPreview}>
          <figcaption className={styles.label}>Before and after</figcaption>
          <p className={styles.copyText} ref={diffBox}>
            {draft.diff.map((part, index) => {
              const on = active.has(index);
              const marker = on ? { "data-active": "" } : {};
              return part.type === "same" ? (
                <span key={index}>{part.text}</span>
              ) : part.type === "removed" ? (
                <del key={index} {...marker} className={`${styles.diffRemoved} ${on ? styles.diffActive : ""}`}>
                  {part.text}
                </del>
              ) : (
                <ins key={index} {...marker} className={`${styles.diffAdded} ${on ? styles.diffActive : ""}`}>
                  {part.text}
                </ins>
              );
            })}
          </p>
          <p className={styles.hint}>
            <span className={styles.legendRemoved}>Struck through</span>: removed ·{" "}
            <span className={styles.legendAdded}>Highlighted</span>: added
          </p>
        </figure>
      )}

      {draft.flags.length > 0 && (
        <section className={styles.group} aria-labelledby="flags-heading">
          <h3 id="flags-heading" className={`${styles.groupTitle} ${styles["groupTitle-needs-fix"]}`}>
            Flags ({draft.flags.length})
            <span className={styles.groupHint}>Code found these. Keep, undo or edit each one.</span>
          </h3>
          <ul className={styles.findings}>
            {draft.flags.map((flag) => (
              <FlagCard
                key={flag.id}
                flag={flag}
                kept={kept.includes(flag.id)}
                pending={pending}
                onKeep={(keep) => props.onKeep(flag, keep)}
                onUndo={() => props.onUndo(flag)}
                onEdit={startEditing}
                onActivate={(on) => setActiveFlag(on ? flag.id : null)}
                onLocate={() => locate(flag)}
              />
            ))}
          </ul>
        </section>
      )}

      {unfixed.length > 0 && (
        <section className={styles.group} aria-labelledby="unfixed-heading">
          <h3 id="unfixed-heading" className={`${styles.groupTitle} ${styles["groupTitle-needs-fix"]}`}>
            Not fixed in this draft ({unfixed.length})
            <span className={styles.groupHint}>You accepted these, but the draft left them as they were.</span>
          </h3>
          <ul className={styles.historyItems}>
            {unfixed.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <p className={styles.hint}>Edit the draft to fix them, discard it and draft again, or approve and they&apos;ll be found again next round.</p>
        </section>
      )}

      {draft.needsInput.length > 0 && (
        <section className={styles.group} aria-labelledby="questions-heading">
          <h3 id="questions-heading" className={styles.groupTitle}>
            Needs your input ({draft.needsInput.length})
            <span className={styles.groupHint}>The AI didn&apos;t guess these. Your answer goes straight into the draft.</span>
          </h3>
          <ul className={styles.findings}>
            {draft.needsInput.map((question) => (
              <Question
                key={question.id}
                question={question}
                pending={pending}
                onAnswer={(answer) => props.onAnswer(question, answer)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className={styles.group} aria-labelledby="changes-heading">
        <h3 id="changes-heading" className={styles.groupTitle}>
          Changes ({draft.changes.length})
          <span className={styles.groupHint}>Each one linked to the finding it fixes.</span>
        </h3>
        <ul className={styles.changes}>
          {draft.changes.map((change, index) => {
            const item = draft.accepted.find((a) => a.ref === change.ref);
            return (
              <li key={index} className={styles.change}>
                <p className={styles.changeWho}>{changeSource(draft, change)}</p>
                <p className={styles.changeText}>
                  {change.before.trim() && <del className={styles.diffRemoved}>{change.before.trim()}</del>}
                  {change.before.trim() && change.after.trim() && " → "}
                  {change.after.trim() && <ins className={styles.diffAdded}>{change.after.trim()}</ins>}
                </p>
                {change.by === "ai" && change.note && <p className={styles.hint}>{change.note}</p>}
                {item?.comment && <p className={styles.hint}>Your note: {item.comment}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <div className={styles.afterCheck}>
        <p className={styles.label}>After this revision</p>
        <ul className={styles.counts} aria-label="Findings in the draft by severity">
          {SEVERITIES.map((severity) => {
            const n = after.filter((finding) => finding.severity === severity).length;
            return (
              <li key={severity} className={`${styles.count} ${n > 0 ? styles[`count-${severity}`] : styles.countZero}`}>
                <span className={styles.countNumber}>{n}</span> {n === 1 ? SEVERITY_LABELS[severity].one : SEVERITY_LABELS[severity].many}
              </li>
            );
          })}
        </ul>
        <p className={styles.hint}>
          From the rule checks, including findings you dismissed. The AI checks run again when you approve.
        </p>
      </div>

      <div className={styles.draftActions}>
        {/* Phone widths only: the header isn't sticky there. */}
        <span className={styles.mobileOnly}>{approveButton("approve-reasons")}</span>
        {!editing && (
          <button type="button" className={styles.secondaryButton} onClick={startEditing} disabled={pending}>
            Edit draft
          </button>
        )}
        <button type="button" className={styles.textButton} onClick={props.onDiscard} disabled={pending}>
          Discard draft
        </button>
        <p className={`${styles.hint} ${styles.mobileOnly}`}>{approveHint}</p>
      </div>
    </section>
  );
}
