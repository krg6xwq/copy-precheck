"use client";

// Holds the page's state: the copy being checked, the latest report, the
// reviewer's decisions and comments, and the review and rewrite loop (the
// current round, the draft, and earlier rounds). All checking and drafting
// happens on the server (checkAction, reviseAction).

import { useRef, useState, useTransition } from "react";
import type { Context, Finding, Override, Report } from "@/engine";
import { checkAction, reviseAction, type ReviseInput } from "@/app/actions";
import type { Sample } from "@/app/content";
import { carryDecisions, changeSource, decidable, MAX_ROUNDS, unfixedLabels, type CarriedDecision } from "@/engine/revise/review";
import type { Draft, Flag, NeedsInput } from "@/engine/revise/types";
import { findingKey, SEVERITY_LABELS, type Decision } from "@/lib/labels";
import type { RoundSummary } from "@/lib/markdown";
import { DraftPanel } from "./DraftPanel";
import { InputPanel } from "./InputPanel";
import { ReportPanel } from "./ReportPanel";
import styles from "./checker.module.css";

export interface CheckedInput {
  text: string;
  context: Context | "";
  useAi: boolean;
}

export interface Result {
  report: Report;
  input: CheckedInput;
  overrides: Override[];
  checkedAt: Date;
}

interface Props {
  samples: Sample[];
  rulesVersion: string;
  ruleCount: number;
  aiAvailable: boolean;
  maxLength: number;
}

/** What the next check should do with the reviewer's work so far. */
type CheckMode = "new" | "same-copy" | "next-round";

function announce(report: Report): string {
  const open = report.findings.filter((finding) => !finding.override);
  if (open.length === 0) return "Check complete. No problems found.";
  const parts = (["blocker", "needs-fix", "suggestion"] as const)
    .map((severity) => ({ severity, count: open.filter((finding) => finding.severity === severity).length }))
    .filter(({ count }) => count > 0)
    .map(({ severity, count }) => `${count} ${count === 1 ? SEVERITY_LABELS[severity].one : SEVERITY_LABELS[severity].many}`);
  return `Check complete. ${parts.join(", ")}.`;
}

/** Every decision made in earlier rounds, oldest first, for carrying into the next. */
interface PastDecision {
  finding: Finding;
  decision: Decision;
  comment?: string;
  round: number;
}

export function Checker({ samples, rulesVersion, ruleCount, aiAvailable, maxLength }: Props) {
  const [text, setText] = useState("");
  const [context, setContext] = useState<Context | "">("");
  const [useAi, setUseAi] = useState(aiAvailable);
  const [result, setResult] = useState<Result | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [carried, setCarried] = useState<Record<string, CarriedDecision>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const draftHeading = useRef<HTMLHeadingElement>(null);

  // The review and rewrite loop.
  const [round, setRound] = useState(1);
  const [history, setHistory] = useState<RoundSummary[]>([]);
  const [past, setPast] = useState<PastDecision[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [kept, setKept] = useState<string[]>([]);
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([]);
  const [showDraft, setShowDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const focus = (ref: React.RefObject<HTMLHeadingElement | null>) => requestAnimationFrame(() => ref.current?.focus());

  function run(input: CheckedInput, overrides: Override[], mode: CheckMode, nextPast: PastDecision[] = past) {
    setError(null);
    startTransition(async () => {
      let response;
      try {
        response = await checkAction({
          text: input.text,
          context: input.context || undefined,
          overrides,
          useAi: input.useAi,
        });
      } catch {
        setError("Couldn't reach the server. Refresh the page and try again.");
        return;
      }
      if (!response.ok) {
        setError(response.error);
        return;
      }
      const report = response.report;
      if (mode === "new") {
        setDecisions({});
        setComments({});
        setCarried({});
        setRound(1);
        setHistory([]);
        setPast([]);
        clearDraft();
      } else if (mode === "next-round") {
        // Dismissals come back already dismissed, with their reason; accepted words still there are marked.
        const carry = carryDecisions(nextPast, report);
        const nextDecisions: Record<string, Decision> = {};
        const nextComments: Record<string, string> = {};
        for (const [key, item] of Object.entries(carry)) {
          if (item.decision) nextDecisions[key] = item.decision;
          if (item.decision && item.comment) nextComments[key] = item.comment;
        }
        setDecisions(nextDecisions);
        setComments(nextComments);
        setCarried(carry);
      }
      setResult({ report, input, overrides, checkedAt: new Date() });
      setStatus(announce(report));
      focus(resultsHeading);
    });
  }

  const stale =
    result !== null &&
    (result.input.text !== text.trim() || result.input.context !== context || result.input.useAi !== useAi);

  function setDecision(finding: Finding, decision: Decision | undefined) {
    setDecisions((current) => {
      const next = { ...current };
      if (decision) next[findingKey(finding)] = decision;
      else delete next[findingKey(finding)];
      return next;
    });
  }

  function setComment(finding: Finding, comment: string) {
    setComments((current) => ({ ...current, [findingKey(finding)]: comment }));
  }

  function dismissSuggestions() {
    if (!result) return;
    setDecisions((current) => {
      const next = { ...current };
      for (const finding of decidable(result.report)) {
        if (finding.severity === "suggestion" && !next[findingKey(finding)]) next[findingKey(finding)] = "dismissed";
      }
      return next;
    });
  }

  // Overrides re-run the same copy that produced the report, even if the
  // text box has been edited since.
  function override(finding: Finding, reason: string) {
    if (!result || !finding.match) return;
    const next = [...result.overrides, { ruleId: finding.ruleId, match: finding.match.text, reason }];
    run(result.input, next, "same-copy");
  }

  function undoOverride(finding: Finding) {
    if (!result || !finding.match) return;
    const next = result.overrides.filter((o) => !(o.ruleId === finding.ruleId && o.match === finding.match!.text));
    run(result.input, next, "same-copy");
  }

  // ---- Drafting ----

  function clearDraft() {
    setDraft(null);
    setKept([]);
    setAnswers([]);
    setShowDraft(false);
    setDraftError(null);
  }

  /** What every revision request carries: the checked copy, its AI findings, and the decisions. */
  function reviseBase(): Omit<ReviseInput, "step" | "draft"> | null {
    if (!result) return null;
    const { report } = result;
    return {
      text: report.text,
      context: report.context,
      overrides: result.overrides,
      round: Math.min(round, MAX_ROUNDS),
      aiFindings: report.findings
        .filter((f) => f.layer === "ai" && f.match)
        .map((f) => ({ ruleId: f.ruleId, start: f.match!.start, end: f.match!.end, detail: f.detail, suggestion: f.suggestion })),
      decisions: decidable(report)
        .filter((f) => decisions[findingKey(f)])
        .map((f) => ({
          key: findingKey(f),
          decision: decisions[findingKey(f)],
          ...(comments[findingKey(f)]?.trim() ? { comment: comments[findingKey(f)].trim() } : {}),
        })),
    };
  }

  function revise(step: ReviseInput["step"], onDraft?: (next: Draft) => void) {
    const base = reviseBase();
    if (!base) return;
    setDraftError(null);
    startTransition(async () => {
      let response;
      try {
        response = await reviseAction({
          ...base,
          step,
          ...(draft && step.kind !== "draft"
            ? { draft: { text: draft.text, changes: draft.changes, needsInput: draft.needsInput, model: draft.model } }
            : {}),
        });
      } catch {
        setDraftError("couldn't reach the server. Refresh the page and try again");
        return;
      }
      if (!response.ok) {
        setDraftError(response.error.replace(/\.$/, ""));
        return;
      }
      if (response.result.status === "unavailable") {
        setDraftError(response.result.reason.replace(/\.$/, ""));
        return;
      }
      const next = response.result.draft;
      // Kept flags that no longer exist are dropped; the rest stay kept.
      setKept((current) => current.filter((id) => next.flags.some((flag) => flag.id === id)));
      setDraft(next);
      setShowDraft(true);
      onDraft?.(next);
      if (step.kind === "draft") {
        setStatus(`Draft ready. ${next.flags.length} flagged, ${next.needsInput.length} questions.`);
        focus(draftHeading);
      } else {
        setStatus(`Draft updated. ${next.flags.length} flagged, ${next.needsInput.length} questions.`);
      }
    });
  }

  function answer(question: NeedsInput, value: string) {
    revise({ kind: "answer", questionId: question.id, answer: value }, () =>
      setAnswers((current) => [...current, { question: question.question, answer: value }]),
    );
  }

  function keep(flag: Flag, on: boolean) {
    setKept((current) => (on ? [...new Set([...current, flag.id])] : current.filter((id) => id !== flag.id)));
  }

  function approve() {
    if (!result || !draft) return;
    const { report } = result;
    const findings = decidable(report);
    const roundDecisions: PastDecision[] = findings
      .filter((f) => decisions[findingKey(f)])
      .map((f) => ({ finding: f, decision: decisions[findingKey(f)], comment: comments[findingKey(f)]?.trim() || undefined, round }));
    const summary: RoundSummary = {
      round,
      text: report.text,
      items: roundDecisions.map((d) => ({
        ruleId: d.finding.ruleId,
        ruleName: d.finding.ruleName,
        words: d.finding.match?.text,
        decision: d.decision,
        comment: d.comment,
      })),
      changes: draft.changes.map((change) => ({
        who: changeSource(draft, change, "Reviewer's"),
        before: change.before,
        after: change.after,
      })),
      unfixed: unfixedLabels(draft),
      kept: draft.flags.filter((flag) => kept.includes(flag.id)).map((flag) => flag.message),
      answers,
      model: draft.model,
      approvedAt: new Date(),
    };
    const nextPast = [...past, ...roundDecisions];
    const nextText = draft.text;
    // Overrides only carry over while their words are still in the copy.
    const nextOverrides = result.overrides.filter((o) => nextText.includes(o.match));
    setHistory((current) => [...current, summary]);
    setPast(nextPast);
    setRound((current) => current + 1);
    setText(nextText);
    clearDraft();
    run({ text: nextText, context: result.input.context, useAi: result.input.useAi }, nextOverrides, "next-round", nextPast);
  }

  const draftVisible = draft !== null && showDraft;

  return (
    <div className={styles.layout}>
      <InputPanel
        samples={samples}
        text={text}
        onTextChange={setText}
        context={context}
        onContextChange={setContext}
        useAi={useAi}
        onUseAiChange={setUseAi}
        aiAvailable={aiAvailable}
        maxLength={maxLength}
        pending={isPending}
        error={error}
        onSubmit={() => run({ text: text.trim(), context, useAi }, [], "new")}
      />
      {draftVisible ? (
        <DraftPanel
          key={draft.text}
          draft={draft}
          round={Math.min(round, MAX_ROUNDS)}
          kept={kept}
          pending={isPending}
          error={draftError}
          headingRef={draftHeading}
          onKeep={keep}
          onUndo={(flag) => revise({ kind: "undo", flagId: flag.id })}
          onAnswer={answer}
          onEdit={(value) => revise({ kind: "edit", text: value })}
          onApprove={approve}
          onDiscard={() => {
            clearDraft();
            focus(resultsHeading);
          }}
          onBack={() => {
            setShowDraft(false);
            focus(resultsHeading);
          }}
        />
      ) : (
        <ReportPanel
          result={result}
          decisions={decisions}
          onDecision={setDecision}
          comments={comments}
          onComment={setComment}
          carried={carried}
          onDismissSuggestions={dismissSuggestions}
          round={round}
          history={history}
          aiAvailable={aiAvailable}
          hasDraft={draft !== null}
          draftError={draftError}
          onDraft={() => revise({ kind: "draft" })}
          onShowDraft={() => {
            setShowDraft(true);
            focus(draftHeading);
          }}
          onOverride={override}
          onUndoOverride={undoOverride}
          pending={isPending}
          stale={stale}
          headingRef={resultsHeading}
          rulesVersion={rulesVersion}
          ruleCount={ruleCount}
        />
      )}
      <p className="visually-hidden" role="status" aria-live="polite">
        {isPending ? "Working…" : status}
      </p>
    </div>
  );
}
