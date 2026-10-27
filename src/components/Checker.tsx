"use client";

// Holds the page's state: the copy being checked, the latest report, the
// reviewer's decisions and comments, and the review and rewrite loop (the
// current round, the draft, and earlier rounds). All checking and drafting
// happens on the server (checkAction, reviseAction).

import { useEffect, useRef, useState, useTransition } from "react";
import type { Context, Finding, Override, Report } from "@/engine";
import { checkAction, reviseAction, type ReviseInput } from "@/app/actions";
import type { Sample } from "@/app/content";
import { carryDecisions, changeSource, decidable, unfixedLabels, type CarriedDecision } from "@/engine/revise/review";
import type { Draft, Flag, NeedsInput } from "@/engine/revise/types";
import { changedRegions, diffWords } from "@/engine/revise/diff";
import { CONTEXT_LABELS, findingKey, SEVERITY_LABELS, type Decision } from "@/lib/labels";
import { downloadReport } from "@/lib/download";
import type { RoundSummary } from "@/lib/markdown";
import { CopyBar } from "./CopyBar";
import { DraftPanel, type AnsweredQuestion, type UndoneFlag } from "./DraftPanel";
import { HowItChecks, InputPanel } from "./InputPanel";
import { ReportPanel } from "./ReportPanel";
import styles from "./checker.module.css";

export interface CheckedInput {
  text: string;
  context: Context | "";
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
  // The start page's form. After a check, the copy is edited from the copy bar instead.
  const [text, setText] = useState("");
  const [context, setContext] = useState<Context | "">("");
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
  // Answers given in this draft, kept on screen (and in the report) after their question closes.
  const [answers, setAnswers] = useState<AnsweredQuestion[]>([]);
  // Flags the reviewer undid in this draft, kept on screen (and in the report) after they close.
  const [undone, setUndone] = useState<UndoneFlag[]>([]);
  const [showDraft, setShowDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const draftsUsed = history.filter((summary) => summary.kind !== "hand").length;
  // The header logo was clicked with rounds to lose; the copy bar asks before clearing.
  const [confirmingNew, setConfirmingNew] = useState(false);

  // Moves focus to a panel's heading and brings the panel's top into view. The heading sits in a
  // sticky header, so focusing it alone wouldn't scroll: switching from the bottom of the findings
  // to the draft would land mid-draft.
  const focus = (ref: React.RefObject<HTMLHeadingElement | null>) =>
    requestAnimationFrame(() => {
      const heading = ref.current;
      if (!heading) return;
      heading.focus({ preventScroll: true });
      const panel = heading.closest("section");
      if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: "start" });
    });

  /**
   * Checks copy. `onSuccess` records the round that led here (an approved draft or a hand edit),
   * and only runs once the check has worked, so a failed check never leaves a round recorded for
   * results that aren't on screen.
   */
  function run(
    input: CheckedInput,
    overrides: Override[],
    mode: CheckMode,
    options: { nextPast?: PastDecision[]; onSuccess?: () => void } = {},
  ) {
    setError(null);
    startTransition(async () => {
      let response;
      try {
        response = await checkAction({ text: input.text, context: input.context || undefined, overrides });
      } catch {
        setError("Couldn't reach the server. Refresh the page and try again.");
        return;
      }
      if (!response.ok) {
        setError(response.error);
        return;
      }
      const report = response.report;
      options.onSuccess?.();
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
        const carry = carryDecisions(options.nextPast ?? past, report);
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

  // Overrides re-run the same copy that produced the report.
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

  /**
   * This round's decisions, for the audit trail and for carrying into the next round. A dismissal
   * carried over unchanged keeps the round it was made in, so it still reads "Dismissed in round 1".
   */
  function roundDecisions(report: Report): PastDecision[] {
    return decidable(report)
      .filter((f) => decisions[findingKey(f)])
      .map((f) => {
        const key = findingKey(f);
        const comment = comments[key]?.trim() || undefined;
        const before = carried[key];
        const unchanged = before?.decision === decisions[key] && (before.comment?.trim() || undefined) === comment;
        return { finding: f, decision: decisions[key], comment, round: unchanged ? before.round : round };
      });
  }

  const summaryItems = (items: PastDecision[]) =>
    items.map((d) => ({
      ruleId: d.finding.ruleId,
      ruleName: d.finding.ruleName,
      words: d.finding.match?.text,
      decision: d.decision,
      comment: d.comment,
    }));

  /** Records a finished round and moves to the next. Runs only after the next check has worked. */
  function commitRound(summary: RoundSummary, nextPast: PastDecision[]) {
    setHistory((current) => [...current, summary]);
    setPast(nextPast);
    setRound((current) => current + 1);
    clearDraft();
  }

  // ---- Drafting ----

  function clearDraft() {
    setDraft(null);
    setKept([]);
    setAnswers([]);
    setUndone([]);
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
      // Which AI draft this is; hand edits don't count toward the limit.
      round: draftsUsed + 1,
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
      // A flag that's back (an edit brought the problem back) is open again, not undone.
      setUndone((current) => current.filter((item) => !next.flags.some((flag) => flag.id === item.id)));
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
      setAnswers((current) => [...current, { id: question.id, question: question.question, quote: question.quote, answer: value }]),
    );
  }

  function undo(flag: Flag) {
    if (!draft) return;
    const position = draft.flags.findIndex((f) => f.id === flag.id);
    revise({ kind: "undo", flagId: flag.id }, (next) => {
      // Only if the undo actually closed it.
      if (next.flags.some((f) => f.id === flag.id)) return;
      setUndone((current) => [
        ...current.filter((item) => item.id !== flag.id),
        { id: flag.id, kind: flag.kind, message: flag.message, quote: flag.quote, position },
      ]);
    });
  }

  function keep(flag: Flag, on: boolean) {
    setKept((current) => (on ? [...new Set([...current, flag.id])] : current.filter((id) => id !== flag.id)));
  }

  function approve() {
    if (!result || !draft) return;
    const { report } = result;
    const items = roundDecisions(report);
    const summary: RoundSummary = {
      round,
      kind: "ai",
      text: report.text,
      items: summaryItems(items),
      changes: draft.changes.map((change) => ({
        who: changeSource(draft, change, "Reviewer's"),
        before: change.before,
        after: change.after,
      })),
      unfixed: unfixedLabels(draft),
      kept: draft.flags.filter((flag) => kept.includes(flag.id)).map((flag) => flag.message),
      undone: undone.map((item) => item.message),
      answers,
      model: draft.model,
      approvedAt: new Date(),
    };
    const nextPast = [...past, ...items];
    const nextText = draft.text;
    // Overrides only carry over while their words are still in the copy.
    const nextOverrides = result.overrides.filter((o) => nextText.includes(o.match));
    run({ text: nextText, context: result.input.context }, nextOverrides, "next-round", {
      nextPast,
      onSuccess: () => commitRound(summary, nextPast),
    });
  }

  /** The reviewer edited the copy themselves: recorded as a round of its own, then checked as the next one. */
  function checkEdit(nextText: string, nextContext: Context | "") {
    if (!result) return;
    const { report } = result;
    const items = roundDecisions(report);
    const summary: RoundSummary = {
      round,
      kind: "hand",
      text: report.text,
      items: summaryItems(items),
      changes: changedRegions(diffWords(report.text, nextText)).map((region) => ({
        who: "Reviewer's edit",
        before: report.text.slice(region.origStart, region.origEnd),
        after: nextText.slice(region.draftStart, region.draftEnd),
      })),
      ...(nextContext !== result.input.context
        ? {
            contextChange: {
              from: result.input.context ? CONTEXT_LABELS[result.input.context] : "Not specified",
              to: nextContext ? CONTEXT_LABELS[nextContext] : "Not specified",
            },
          }
        : {}),
      kept: [],
      answers: [],
      approvedAt: new Date(),
    };
    const nextPast = [...past, ...items];
    const nextOverrides = result.overrides.filter((o) => nextText.includes(o.match));
    run({ text: nextText, context: nextContext }, nextOverrides, "next-round", {
      nextPast,
      onSuccess: () => commitRound(summary, nextPast),
    });
  }

  /** The header logo: start over, asking first when there are rounds to lose. */
  function requestNewCheck() {
    if (!result) return;
    if (history.length > 0) {
      setConfirmingNew(true);
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } else {
      newCheck();
    }
  }

  // The logo lives in the page layout, outside this component, so its clicks are caught here, in
  // the capture phase, before the logo's Link navigates. A ref keeps the handler current without
  // re-adding the listener on every render.
  const homeHandler = useRef(requestNewCheck);
  useEffect(() => {
    homeHandler.current = requestNewCheck;
  });
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Opening the logo in a new tab still works as a normal link.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element) || !event.target.closest("[data-home-link]")) return;
      event.preventDefault();
      event.stopPropagation();
      homeHandler.current();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  /** Back to the start page with the latest copy in the form. Everything else is cleared. */
  function newCheck() {
    setConfirmingNew(false);
    if (result) {
      setText(result.input.text);
      setContext(result.input.context);
    }
    setResult(null);
    setDecisions({});
    setComments({});
    setCarried({});
    setRound(1);
    setHistory([]);
    setPast([]);
    setError(null);
    clearDraft();
    setStatus("Started a new check.");
  }

  const markdownExtras = { comments, round, history };

  if (!result) {
    return (
      <div className={styles.startLayout}>
        <InputPanel
          samples={samples}
          text={text}
          onTextChange={setText}
          context={context}
          onContextChange={setContext}
          aiAvailable={aiAvailable}
          maxLength={maxLength}
          pending={isPending}
          error={error}
          onSubmit={() => run({ text: text.trim(), context }, [], "new")}
        />
        <HowItChecks ruleCount={ruleCount} rulesVersion={rulesVersion} />
        <p className="visually-hidden" role="status" aria-live="polite">
          {isPending ? "Working…" : status}
        </p>
      </div>
    );
  }

  const draftVisible = draft !== null && showDraft;

  return (
    <div className={styles.layoutSingle}>
      <CopyBar
        // A new check result resets the bar (closing the editor after a successful edit).
        key={result.checkedAt.getTime()}
        input={result.input}
        pending={isPending}
        error={error}
        maxLength={maxLength}
        hasDraft={draft !== null}
        rounds={history.length}
        confirming={confirmingNew}
        editable={!draftVisible}
        onCheckEdit={checkEdit}
        onNewCheck={newCheck}
        onCancelNewCheck={() => setConfirmingNew(false)}
        onDownload={() => downloadReport(result.report, decisions, result.checkedAt, markdownExtras)}
      />
      {draftVisible ? (
        <DraftPanel
          key={draft.text}
          draft={draft}
          round={round}
          kept={kept}
          answered={answers}
          undone={undone}
          pending={isPending}
          error={draftError}
          headingRef={draftHeading}
          onKeep={keep}
          onUndo={undo}
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
          draftsUsed={draftsUsed}
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
          headingRef={resultsHeading}
        />
      )}
      <p className="visually-hidden" role="status" aria-live="polite">
        {isPending ? "Working…" : status}
      </p>
    </div>
  );
}
