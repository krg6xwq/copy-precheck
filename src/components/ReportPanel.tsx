"use client";

import { useState, type RefObject } from "react";
import type { Finding, Report } from "@/engine";
import {
  CONTEXT_LABELS,
  findingKey,
  SEVERITIES,
  SEVERITY_HINTS,
  SEVERITY_LABELS,
  type Decision,
} from "@/lib/labels";
import { reportToMarkdown } from "@/lib/markdown";
import { AiStatus } from "./AiStatus";
import type { Result } from "./Checker";
import { FindingCard } from "./FindingCard";
import { HighlightedCopy } from "./HighlightedCopy";
import styles from "./checker.module.css";

interface Props {
  result: Result | null;
  decisions: Record<string, Decision>;
  onDecision: (finding: Finding, decision: Decision | undefined) => void;
  onOverride: (finding: Finding, reason: string) => void;
  onUndoOverride: (finding: Finding) => void;
  pending: boolean;
  stale: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  rulesVersion: string;
  ruleCount: number;
}

function EmptyState({ ruleCount, rulesVersion }: { ruleCount: number; rulesVersion: string }) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.cardTitle}>Results appear here</h2>
      <p className={styles.intro}>
        {ruleCount} rules, checked in three steps. Rules version {rulesVersion}.
      </p>
      <ol className={styles.steps}>
        <li>
          <strong>Personal data.</strong> NRIC, phone numbers, emails, card and account numbers. If any are found, the
          copy isn&apos;t sent to the AI until they&apos;re replaced or a reviewer overrides the match.
        </li>
        <li>
          <strong>Rule checks.</strong> Banned phrases, required disclosures, wording, money and date formats. Same
          copy, same result, every time.
        </li>
        <li>
          <strong>AI suggestions.</strong> Judgment calls code can&apos;t make, such as implied promises or jargon.
          Always suggestions, and every one must quote words that are really in the copy.
        </li>
      </ol>
    </div>
  );
}

function summaryText(open: Finding[]): { text: string; tone: "blocker" | "needs-fix" | "suggestion" | "ok" } {
  const count = (severity: string) => open.filter((finding) => finding.severity === severity).length;
  const blockers = count("blocker");
  const fixes = count("needs-fix");
  const suggestions = count("suggestion");
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (blockers) return { text: `${plural(blockers, "blocker", "blockers")} to fix before compliance review.`, tone: "blocker" };
  if (fixes) return { text: `No blockers. ${plural(fixes, "item needs", "items need")} fixing.`, tone: "needs-fix" };
  if (suggestions)
    return { text: `No blockers or required fixes. ${plural(suggestions, "suggestion", "suggestions")} to consider.`, tone: "suggestion" };
  return { text: "No problems found by these checks. A person still reviews the copy.", tone: "ok" };
}

function Export({ report, decisions, checkedAt }: { report: Report; decisions: Record<string, Decision>; checkedAt: Date }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  function download() {
    const blob = new Blob([reportToMarkdown(report, decisions, checkedAt)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `copy-precheck-${checkedAt.toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportToMarkdown(report, decisions, checkedAt));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  }

  return (
    <div className={styles.exportActions}>
      <button type="button" className={styles.secondaryButton} onClick={copy}>
        {copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy as Markdown"}
      </button>
      <button type="button" className={styles.secondaryButton} onClick={download}>
        Download report
      </button>
    </div>
  );
}

export function ReportPanel(props: Props) {
  const { result, decisions, pending, stale, headingRef } = props;
  const [activeKey, setActiveKey] = useState<string | null>(null);

  if (!result) {
    return (
      <section className={`${styles.card} ${styles.reportCard}`} aria-label="Results">
        <EmptyState ruleCount={props.ruleCount} rulesVersion={props.rulesVersion} />
      </section>
    );
  }

  const { report } = result;
  const open = report.findings.filter((finding) => !finding.override);
  const outstanding = open.filter((finding) => decisions[findingKey(finding)] !== "dismissed");
  const dismissed = open.length - outstanding.length;
  const overridden = report.findings.filter((finding) => finding.override);
  const summary = summaryText(outstanding);
  const highlighted = outstanding.filter((finding) => finding.match);

  const card = (finding: Finding) => (
    <FindingCard
      key={findingKey(finding)}
      finding={finding}
      decision={decisions[findingKey(finding)]}
      onDecision={(decision) => props.onDecision(finding, decision)}
      onOverride={(reason) => props.onOverride(finding, reason)}
      onUndoOverride={() => props.onUndoOverride(finding)}
      pending={pending}
      active={activeKey === findingKey(finding)}
      onActivate={(on) => setActiveKey(on ? findingKey(finding) : null)}
    />
  );

  return (
    <section className={`${styles.card} ${styles.reportCard}`} aria-labelledby="results-heading" aria-busy={pending}>
      <div className={styles.reportHeader}>
        <div>
          <h2 id="results-heading" className={styles.cardTitle} tabIndex={-1} ref={headingRef}>
            Results
          </h2>
          <p className={styles.meta}>
            {report.context ? CONTEXT_LABELS[report.context] : "Context not specified"} · Rules v{report.rulesVersion}
          </p>
        </div>
        <Export report={report} decisions={decisions} checkedAt={result.checkedAt} />
      </div>

      {stale && (
        <p className={styles.staleNotice} role="note">
          The copy or settings have changed since this check. Check again to update the results.
        </p>
      )}

      <div className={`${styles.summary} ${styles[`tone-${summary.tone}`]}`}>
        <p className={styles.summaryText}>{summary.text}</p>
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
        {dismissed > 0 && <p className={styles.dismissedNote}>{dismissed} dismissed by the reviewer.</p>}
      </div>

      <AiStatus report={report} />

      <HighlightedCopy text={report.text} findings={highlighted} activeKey={activeKey} />

      {SEVERITIES.map((severity) => {
        const group = open.filter((finding) => finding.severity === severity);
        if (group.length === 0) return null;
        return (
          <section key={severity} className={styles.group} aria-labelledby={`group-${severity}`}>
            <h3 id={`group-${severity}`} className={`${styles.groupTitle} ${styles[`groupTitle-${severity}`]}`}>
              {SEVERITY_LABELS[severity].many} ({group.length})
              <span className={styles.groupHint}>{SEVERITY_HINTS[severity]}</span>
            </h3>
            <ul className={styles.findings}>{group.map(card)}</ul>
          </section>
        );
      })}

      {overridden.length > 0 && (
        <section className={styles.group} aria-labelledby="group-overridden">
          <h3 id="group-overridden" className={styles.groupTitle}>
            Overridden personal-data matches ({overridden.length})
            <span className={styles.groupHint}>Released by a reviewer. Recorded in the report.</span>
          </h3>
          <ul className={styles.findings}>{overridden.map(card)}</ul>
        </section>
      )}
    </section>
  );
}
