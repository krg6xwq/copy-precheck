// Runs the AI layer on a code report. Three promises:
//   1. Nothing is sent to the model unless the guard is clear (D1).
//   2. If the model fails, the code findings still stand; the report just
//      says the AI checks are unavailable. The tool never depends on the AI.
//   3. Each issue appears once: an AI finding on the same words as a code
//      rule it `extends` is folded into the code finding (D19).

import { checkCopy, sortFindings, type CheckOptions, type Finding, type Report, type RuleRun } from "../engine";
import type { RulesFile } from "../schema";
import type { Span } from "../text";
import type { AiModel } from "./model";
import { buildPrompt } from "./prompt";
import { AiAnswerError, validateAnswer, type AcceptedAiFinding } from "./response";

export interface AiOptions {
  /** How long to wait for the model before giving up. Default 20 seconds. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class AiTimeoutError extends Error {}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** Calls the model, giving up after `timeoutMs` even if it ignores the signal. */
export async function askWithTimeout(
  model: AiModel,
  prompt: Parameters<AiModel["respond"]>[0],
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([model.respond(prompt, controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function failureReason(error: unknown, timeoutMs: number): string {
  if (error instanceof AiTimeoutError) return `The AI didn't answer within ${Math.round(timeoutMs / 1000)} seconds`;
  if (error instanceof AiAnswerError) return error.message;
  return "The AI service couldn't be reached";
}

/** Folds AI findings into code findings where they repeat them (D19). */
function merge(report: Report, accepted: AcceptedAiFinding[]) {
  const findings: Finding[] = report.findings.map((finding) => ({ ...finding }));
  let merged = 0;
  const mergedInto = new Map<string, string>();

  for (const ai of accepted) {
    const target = findings.find(
      (finding) =>
        finding.layer === "rule" &&
        finding.match &&
        ai.rule.extends?.includes(finding.ruleId) &&
        overlaps(finding.match, ai.span),
    );
    if (target) {
      target.aiAgreement = [...(target.aiAgreement ?? []), { ruleId: ai.rule.id, explanation: ai.explanation }];
      mergedInto.set(ai.rule.id, target.ruleId);
      merged++;
      continue;
    }
    findings.push({
      ruleId: ai.rule.id,
      ruleName: ai.rule.name,
      category: ai.rule.category,
      layer: "ai",
      severity: ai.rule.severity,
      match: ai.span,
      detail: ai.explanation,
      why: ai.rule.why.replace(/\s+/g, " ").trim(),
      fix: ai.rule.fix.replace(/\s+/g, " ").trim(),
      ...(ai.suggestion ? { suggestion: ai.suggestion } : {}),
    });
  }
  return { findings: sortFindings(findings), merged, mergedInto };
}

/** Replaces the AI rules' entries in `runs`. */
function withAiRuns(runs: RuleRun[], aiRuns: RuleRun[]): RuleRun[] {
  return [...runs.filter((run) => run.layer !== "ai"), ...aiRuns];
}

export async function runAiChecks(
  report: Report,
  rulesFile: RulesFile,
  model: AiModel,
  options: AiOptions = {},
): Promise<Report> {
  // 1. The guard decides. Copy with open personal-data findings is never sent.
  if (!report.aiAllowed) return report;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const aiRules = rulesFile.rules.filter((rule) => rule.layer === "ai");
  const applies = (rule: (typeof aiRules)[number]) =>
    !report.context || !rule.contexts || rule.contexts.includes(report.context);
  const applicable = aiRules.filter(applies);
  const skipped: RuleRun[] = aiRules
    .filter((rule) => !applies(rule))
    .map((rule) => ({ ruleId: rule.id, layer: "ai", status: "not-applicable", reason: `Not checked in ${report.context}` }));

  if (applicable.length === 0) {
    return {
      ...report,
      runs: withAiRuns(report.runs, skipped),
      ai: { status: "done", model: model.name, reason: "No AI rules apply here", rejected: [], merged: 0 },
    };
  }

  const prompt = buildPrompt({
    bank: rulesFile.bank,
    text: report.text,
    context: report.context,
    rules: applicable,
    codeFindings: report.findings,
  });

  let accepted: AcceptedAiFinding[];
  let rejected: Report["ai"]["rejected"];
  try {
    const raw = await askWithTimeout(model, prompt, timeoutMs);
    ({ accepted, rejected } = validateAnswer(raw, report.text, applicable));
  } catch (error) {
    // 2. A failed AI step never hides or changes the code findings.
    const reason = failureReason(error, timeoutMs);
    return {
      ...report,
      runs: withAiRuns(report.runs, [
        ...applicable.map((rule): RuleRun => ({ ruleId: rule.id, layer: "ai", status: "ai-unavailable", reason })),
        ...skipped,
      ]),
      ai: { status: "unavailable", model: model.name, reason, rejected: [], merged: 0 },
    };
  }

  // 3. One issue, one finding.
  const { findings, merged, mergedInto } = merge(report, accepted);
  const flagged = new Set(accepted.map((finding) => finding.rule.id));
  const aiRuns = applicable.map((rule): RuleRun => {
    if (!flagged.has(rule.id)) return { ruleId: rule.id, layer: "ai", status: "passed" };
    const into = mergedInto.get(rule.id);
    const standalone = findings.some((finding) => finding.ruleId === rule.id);
    return {
      ruleId: rule.id,
      layer: "ai",
      status: "flagged",
      ...(into && !standalone ? { reason: `Same words as ${into}, so shown there` } : {}),
    };
  });

  return {
    ...report,
    findings,
    runs: withAiRuns(report.runs, [...aiRuns, ...skipped]),
    ai: { status: "done", model: model.name, rejected, merged },
  };
}

/** Code layers, then the AI layer if a model is given and the guard is clear. */
export async function checkCopyWithAi(
  text: string,
  rulesFile: RulesFile,
  model: AiModel | undefined,
  options: CheckOptions & AiOptions = {},
): Promise<Report> {
  const report = checkCopy(text, rulesFile, options);
  return model ? runAiChecks(report, rulesFile, model, options) : report;
}
