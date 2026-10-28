"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { Finding, Report } from "@/engine";
import { decidable, MAX_ROUNDS, needsReason, NUDGE_AFTER_ROUNDS, ROUND_LIMIT_MESSAGE, type CarriedDecision } from "@/engine/revise/review";
import {
  CONTEXT_LABELS,
  findingDomId,
  findingKey,
  SEVERITIES,
  SEVERITY_HINTS,
  SEVERITY_LABELS,
  type Decision,
} from "@/lib/labels";
import { downloadReport } from "@/lib/download";
import type { MarkdownExtras, RoundSummary } from "@/lib/markdown";
import { AiBanner, AiDetails, AiMeta } from "./AiStatus";
import type { Result } from "./Checker";
import { FindingCard } from "./FindingCard";
import { HighlightedCopy } from "./HighlightedCopy";
import styles from "./checker.module.css";

interface Props {
  result: Result;
  decisions: Record<string, Decision>;
  onDecision: (finding: Finding, decision: Decision | undefined) => void;
  comments: Record<string, string>;
  onComment: (finding: Finding, comment: string) => void;
  carried: Record<string, CarriedDecision>;
  onDismissSuggestions: () => void;
  round: number;
  /** AI drafts approved so far, for the hard stop (hand edits don't count). */
  draftsUsed: number;
  history: RoundSummary[];
  aiAvailable: boolean;
  hasDraft: boolean;
  draftError: string | null;
  onDraft: () => void;
  onShowDraft: () => void;
  onOverride: (finding: Finding, reason: string) => void;
  onUndoOverride: (finding: Finding) => void;
  pending: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

function summaryText(open: Finding[], rounds: number): { text: string; tone: "blocker" | "needs-fix" | "suggestion" | "ok" } {
  const count = (severity: string) => open.filter((finding) => finding.severity === severity).length;
  const blockers = count("blocker");
  const fixes = count("needs-fix");
  const suggestions = count("suggestion");
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (blockers) return { text: `${plural(blockers, "blocker", "blockers")} to fix before compliance review.`, tone: "blocker" };
  if (fixes) return { text: `No blockers. ${plural(fixes, "item needs", "items need")} fixing.`, tone: "needs-fix" };
  if (suggestions)
    return { text: `No blockers or required fixes. ${plural(suggestions, "suggestion", "suggestions")} to consider.`, tone: "suggestion" };
  const after = rounds ? ` after ${plural(rounds, "round", "rounds")} of revision` : "";
  return { text: `No problems found by these checks${after}. A person still reviews the copy.`, tone: "ok" };
}

function Export({
  report,
  decisions,
  checkedAt,
  extras,
  primary,
}: {
  report: Report;
  decisions: Record<string, Decision>;
  checkedAt: Date;
  extras: MarkdownExtras;
  /** Copy text is the main button when there's nothing to draft: the next step is taking the copy away. */
  primary: boolean;
}) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const download = () => downloadReport(report, decisions, checkedAt, extras);

  // Copies the copy itself (after approved rounds, the latest version), ready to paste back into
  // Figma or a doc. The full report is what Download report is for.
  async function copy() {
    try {
      await navigator.clipboard.writeText(report.text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied("idle"), 2500);
  }

  return (
    <div className={styles.exportActions}>
      <button type="button" className={primary ? styles.primaryButtonSmall : styles.secondaryButton} onClick={copy}>
        Copy text
      </button>
      <button type="button" className={styles.secondaryButton} onClick={download}>
        Download report
      </button>
      {/* Always rendered so screen readers announce the message when it appears. */}
      <div role="status" aria-live="polite" className={styles.toastRegion}>
        {copied !== "idle" && (
          <p className={`${styles.toast} ${copied === "failed" ? styles.toastFailed : ""}`}>
            {copied === "done" ? "Text copied." : "Couldn't copy the text. Select it in the copy box instead."}
          </p>
        )}
      </div>
    </div>
  );
}

interface FindingGroupProps {
  id: string;
  title: string;
  hint: string;
  titleClassName?: string;
  expanded: boolean;
  onToggle: () => void;
  /** A button for the whole group, such as "Dismiss remaining suggestions". */
  action?: ReactNode;
  children: ReactNode;
}

function FindingGroup({ id, title, hint, titleClassName = "", expanded, onToggle, action, children }: FindingGroupProps) {
  return (
    <section className={styles.group} aria-labelledby={`group-${id}`}>
      <div className={`${styles.groupHead} ${titleClassName}`}>
        <h3 className={styles.groupHeading}>
          <button
            type="button"
            id={`group-${id}`}
            className={styles.groupToggle}
            aria-expanded={expanded}
            aria-controls={`group-${id}-list`}
            onClick={onToggle}
          >
            <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`} aria-hidden="true" />
            {title}
          </button>
          <span className={styles.groupHint}>{hint}</span>
        </h3>
        {action}
      </div>
      <ul id={`group-${id}-list`} className={styles.findings} hidden={!expanded}>
        {children}
      </ul>
    </section>
  );
}

/** Where the reviewer is in the loop, and whether "Draft a revision" can be pressed (spec: screens and states, step 1). */
function gateState(props: Props, report: Report) {
  const { decisions, comments } = props;
  const findings = decidable(report);
  const decided = findings.filter((f) => decisions[findingKey(f)]);
  const accepted = findings.filter((f) => decisions[findingKey(f)] === "accepted");
  const undecidedSuggestions = findings.filter((f) => f.severity === "suggestion" && !decisions[findingKey(f)]);
  const missingReason = findings.filter(
    (f) => decisions[findingKey(f)] === "dismissed" && needsReason(f) && !comments[findingKey(f)]?.trim(),
  );
  // Nothing to decide and nothing to fix: the loop doesn't apply.
  const applies = findings.length > 0 || report.guard.open > 0;

  let blocker: string | null = null;
  if (props.draftsUsed >= MAX_ROUNDS) blocker = ROUND_LIMIT_MESSAGE;
  else if (!props.aiAvailable) blocker = "Drafting needs AI, which isn't set up on this server.";
  else if (report.guard.open > 0) blocker = "Replace the personal data, or override the match, first.";
  else if (decided.length < findings.length) blocker = `Decide on every finding first: ${findings.length - decided.length} left.`;
  else if (missingReason.length)
    blocker = `Give a reason for ${missingReason.length === 1 ? "the dismissed blocker or needs-fix finding" : `${missingReason.length} dismissed blocker or needs-fix findings`}.`;

  const lastRound = props.draftsUsed === MAX_ROUNDS - 1 ? " This is the last AI revision for this check." : "";
  const hint = props.hasDraft
    ? "Your draft is waiting. Discard it to draft again with new decisions."
    : (blocker ??
      `Drafts fixes for the ${accepted.length} ${accepted.length === 1 ? "finding" : "findings"} marked Fix. Code checks the draft before you see it.${lastRound}`);

  // Nothing to draft: no findings, or every one dismissed (with any reasons given). Then the
  // draft button goes, and Copy text becomes the main button.
  const nothingToDraft =
    !props.hasDraft &&
    (!applies ||
      (report.guard.open === 0 && decided.length === findings.length && accepted.length === 0 && missingReason.length === 0));
  const finalHint = nothingToDraft ? "Nothing left to fix. Copy the text or download the report." : hint;

  return { applies, nothingToDraft, findings, decided, accepted, undecidedSuggestions, blocker, hint: finalHint };
}

function DraftButton({ props, gate, describedBy }: { props: Props; gate: ReturnType<typeof gateState>; describedBy?: string }) {
  if (props.hasDraft) {
    return (
      <button type="button" className={styles.primaryButtonSmall} onClick={props.onShowDraft} aria-describedby={describedBy}>
        Back to the draft
      </button>
    );
  }
  return (
    <button
      type="button"
      className={styles.primaryButtonSmall}
      disabled={props.pending || gate.blocker !== null}
      aria-describedby={describedBy}
      onClick={props.onDraft}
    >
      Draft a revision
    </button>
  );
}

function History({ history }: { history: RoundSummary[] }) {
  if (history.length === 0) return null;
  return (
    <details className={styles.history}>
      <summary>Earlier rounds ({history.length})</summary>
      <ol className={styles.historyList}>
        {history.map((summary) => (
          <li key={summary.round}>
            <p className={styles.label}>
              Round {summary.round}
              {summary.kind === "hand" ? " · edited by hand" : ""}
            </p>
            <blockquote className={styles.quote}>{summary.text}</blockquote>
            <ul className={styles.historyItems}>
              {summary.items.map((item, index) => (
                <li key={index}>
                  {item.ruleId} {item.words ? `“${item.words}”` : item.ruleName}: {item.decision === "accepted" ? "fix" : "dismissed"}
                  {item.comment ? ` (${item.comment})` : ""}
                </li>
              ))}
            </ul>
            <p className={styles.hint}>
              {summary.changes.length} {summary.changes.length === 1 ? "change" : "changes"}{" "}
              {summary.kind === "hand" ? "made by hand" : "approved"}
              {summary.contextChange ? `, and where it appears changed to ${summary.contextChange.to}` : ""}
              {summary.kept.length ? `, ${summary.kept.length} flagged ${summary.kept.length === 1 ? "change" : "changes"} kept` : ""}
              {summary.undone?.length ? `, ${summary.undone.length} undone` : ""}.
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ReportPanel(props: Props) {
  const { result, decisions, pending, headingRef } = props;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Kept across checks, so a reviewer's layout survives re-checking and overrides.
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const toggleGroup = (id: string) =>
    setCollapsed((current) => (current.includes(id) ? current.filter((group) => group !== id) : [...current, id]));

  function jumpToFinding(finding: Finding) {
    // Open the finding's group first, so its card is on screen to scroll to.
    flushSync(() => setCollapsed((current) => current.filter((group) => group !== finding.severity)));
    const card = document.getElementById(findingDomId(finding));
    if (!card) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    // Focusing the card marks it as active, and lets keyboard users carry on from there.
    card.focus({ preventScroll: true });
  }

  const { report } = result;
  const open = report.findings.filter((finding) => !finding.override);
  const outstanding = open.filter((finding) => decisions[findingKey(finding)] !== "dismissed");
  const dismissed = open.length - outstanding.length;
  const overridden = report.findings.filter((finding) => finding.override);
  const summary = summaryText(outstanding, props.history.length);
  const highlighted = outstanding.filter((finding) => finding.match);

  const card = (finding: Finding) => (
    <FindingCard
      key={findingKey(finding)}
      finding={finding}
      decision={decisions[findingKey(finding)]}
      onDecision={(decision) => props.onDecision(finding, decision)}
      comment={props.comments[findingKey(finding)] ?? ""}
      onComment={(comment) => props.onComment(finding, comment)}
      reasonRequired={needsReason(finding)}
      carried={props.carried[findingKey(finding)]}
      onOverride={(reason) => props.onOverride(finding, reason)}
      onUndoOverride={() => props.onUndoOverride(finding)}
      pending={pending}
      active={activeKey === findingKey(finding)}
      onActivate={(on) => setActiveKey(on ? findingKey(finding) : null)}
    />
  );

  const gate = gateState(props, report);
  const progress = gate.applies && (
    <p className={styles.progress}>
      <strong>
        {gate.decided.length} of {gate.findings.length}
      </strong>{" "}
      decided · Round {props.round}
    </p>
  );

  return (
    <section className={`${styles.card} ${styles.reportCard}`} aria-labelledby="results-heading" aria-busy={pending}>
      {/* Sticky, so the next step is in reach after deciding the last finding at the bottom of the list. */}
      <div className={styles.stickyHeader}>
        <div className={styles.reportHeader}>
          <div>
            <h2 id="results-heading" className={styles.cardTitle} tabIndex={-1} ref={headingRef}>
              Results
            </h2>
            <p className={styles.meta}>
              {report.context ? CONTEXT_LABELS[report.context] : "Context not specified"} · Rules v{report.rulesVersion} ·{" "}
              <AiMeta report={report} />
            </p>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.buttonRow}>
              {!gate.nothingToDraft && <DraftButton props={props} gate={gate} describedBy="gate-reason" />}
              <Export
                report={report}
                decisions={decisions}
                checkedAt={result.checkedAt}
                extras={{ comments: props.comments, round: props.round, history: props.history }}
                primary={gate.nothingToDraft}
              />
            </div>
            <p id="gate-reason" className={styles.headerHint}>
              {gate.hint}
            </p>
          </div>
        </div>
      </div>

      {props.draftError && (
        <p className={styles.error} role="alert">
          Couldn&apos;t draft a revision: {props.draftError}.
        </p>
      )}

      <AiBanner report={report} />

      <div className={`${styles.summary} ${styles[`tone-${summary.tone}`]}`}>
        <p className={styles.summaryText}>{summary.text}</p>
        <div className={styles.summaryRow}>
          <ul className={styles.counts} aria-label="Outstanding findings by severity">
            {SEVERITIES.map((severity) => {
              const n = outstanding.filter((finding) => finding.severity === severity).length;
              return (
                <li key={severity} className={`${styles.count} ${n > 0 ? styles[`count-${severity}`] : styles.countZero}`}>
                  <span className={styles.countNumber}>{n}</span> {n === 1 ? SEVERITY_LABELS[severity].one : SEVERITY_LABELS[severity].many}
                </li>
              );
            })}
          </ul>
          {progress}
        </div>
        {dismissed > 0 && <p className={styles.dismissedNote}>{dismissed} dismissed by the reviewer.</p>}
        {props.history.length >= NUDGE_AFTER_ROUNDS && props.draftsUsed < MAX_ROUNDS && (
          <p className={styles.roundNote}>
            You&apos;ve revised this copy {props.history.length} times. Keep going if it helps, or edit it by hand if
            that&apos;s quicker. Copy text and Download report are ready whenever you are.
          </p>
        )}
        <AiDetails report={report} />
      </div>

      <HighlightedCopy text={report.text} findings={highlighted} activeKey={activeKey} onSelect={jumpToFinding} />

      {SEVERITIES.map((severity) => {
        const group = open.filter((finding) => finding.severity === severity);
        if (group.length === 0) return null;
        return (
          <FindingGroup
            key={severity}
            id={severity}
            title={`${SEVERITY_LABELS[severity].many} (${group.length})`}
            hint={SEVERITY_HINTS[severity]}
            titleClassName={styles[`groupTitle-${severity}`]}
            expanded={!collapsed.includes(severity)}
            onToggle={() => toggleGroup(severity)}
            action={
              severity === "suggestion" &&
              gate.undecidedSuggestions.length > 0 && (
                <button type="button" className={styles.textButton} onClick={props.onDismissSuggestions} disabled={pending}>
                  Dismiss remaining ({gate.undecidedSuggestions.length})
                </button>
              )
            }
          >
            {group.map(card)}
          </FindingGroup>
        );
      })}

      {overridden.length > 0 && (
        <FindingGroup
          id="overridden"
          title={`Overridden personal-data matches (${overridden.length})`}
          hint="Released by a reviewer. Recorded in the report."
          expanded={!collapsed.includes("overridden")}
          onToggle={() => toggleGroup("overridden")}
        >
          {overridden.map(card)}
        </FindingGroup>
      )}

      {!gate.nothingToDraft && (
        <div className={styles.endActions}>
          {progress}
          <DraftButton props={props} gate={gate} describedBy="gate-reason" />
          <p className={styles.hint}>{gate.hint}</p>
        </div>
      )}

      <History history={props.history} />
    </section>
  );
}
