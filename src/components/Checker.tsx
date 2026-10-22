"use client";

// Holds the page's state: the copy being checked, the latest report, and the
// reviewer's decisions. All checking happens on the server (checkAction).

import { useRef, useState, useTransition } from "react";
import type { Context, Finding, Override, Report } from "@/engine";
import { checkAction } from "@/app/actions";
import type { Sample } from "@/app/content";
import { findingKey, SEVERITY_LABELS, type Decision } from "@/lib/labels";
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

function announce(report: Report): string {
  const open = report.findings.filter((finding) => !finding.override);
  if (open.length === 0) return "Check complete. No problems found.";
  const parts = (["blocker", "needs-fix", "suggestion"] as const)
    .map((severity) => ({ severity, count: open.filter((finding) => finding.severity === severity).length }))
    .filter(({ count }) => count > 0)
    .map(({ severity, count }) => `${count} ${count === 1 ? SEVERITY_LABELS[severity].one : SEVERITY_LABELS[severity].many}`);
  return `Check complete. ${parts.join(", ")}.`;
}

export function Checker({ samples, rulesVersion, ruleCount, aiAvailable, maxLength }: Props) {
  const [text, setText] = useState("");
  const [context, setContext] = useState<Context | "">("");
  const [useAi, setUseAi] = useState(aiAvailable);
  const [result, setResult] = useState<Result | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  function run(input: CheckedInput, overrides: Override[]) {
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
      const sameCopy = result?.input.text === input.text && result?.input.context === input.context;
      if (!sameCopy) setDecisions({});
      setResult({ report: response.report, input, overrides, checkedAt: new Date() });
      setStatus(announce(response.report));
      requestAnimationFrame(() => resultsHeading.current?.focus());
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

  // Overrides re-run the same copy that produced the report, even if the
  // text box has been edited since.
  function override(finding: Finding, reason: string) {
    if (!result || !finding.match) return;
    const next = [...result.overrides, { ruleId: finding.ruleId, match: finding.match.text, reason }];
    run(result.input, next);
  }

  function undoOverride(finding: Finding) {
    if (!result || !finding.match) return;
    const next = result.overrides.filter((o) => !(o.ruleId === finding.ruleId && o.match === finding.match!.text));
    run(result.input, next);
  }

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
        onSubmit={() => run({ text: text.trim(), context, useAi }, [])}
      />
      <ReportPanel
        result={result}
        decisions={decisions}
        onDecision={setDecision}
        onOverride={override}
        onUndoOverride={undoOverride}
        pending={isPending}
        stale={stale}
        headingRef={resultsHeading}
        rulesVersion={rulesVersion}
        ruleCount={ruleCount}
      />
      <p className="visually-hidden" role="status" aria-live="polite">
        {isPending ? "Checking…" : status}
      </p>
    </div>
  );
}
