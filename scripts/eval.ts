// The evaluation (plan, Day 4). Three parts:
//   1. Code layers on the test set, run once (they're deterministic): caught, missed and false
//      alarms per rule, and whether each rule actually ran, so "checked and passed" can't be
//      confused with "never checked" (decisions.md D16).
//   2. AI layer on every sample the guard clears, run several times: matches with the test set,
//      how much the answers vary, rejected findings, speed and cost. Includes the prompt-injection
//      samples (D23).
//   3. The review and rewrite loop on the emails in eval/loop-samples.yaml, with a simple reviewer:
//      findings fixed per round, flags, questions, findings marked Fix that weren't fixed, and
//      problems that are new in the next round.
//
// It calls the real model and spends money (about US$1 for a full run), so it only runs when asked:
//   npm run eval                      everything, AI 3 times per sample
//   npm run eval -- --runs 1          one AI run per sample
//   npm run eval -- --skip-loop       parts 1 and 2 only
//   npm run eval -- --samples T07,T39 only these samples (parts 1 and 2)
// Writes eval/results.md (for people) and eval/results.json (everything, for checking the numbers).

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { load as loadYaml } from "js-yaml";
import { z } from "zod";
import { checkCopy, checkCopyWithAi, flaggedRuleIds, CONTEXTS, type Finding, type Report } from "../src/engine";
import type { AiModel } from "../src/engine/ai/model";
import { loadRules, loadTestSet } from "../src/engine/load";
import { answerQuestion, decidable, draftRevision } from "../src/engine/revise/draft";
import type { Draft, ReviewDecision } from "../src/engine/revise/types";
import { claudeFromEnv, type ClaudeModel } from "../src/models/claude";

// The whole run is one async function: this project's scripts are CommonJS, which doesn't allow
// a top-level await.
async function main() {
// ---------- Settings ----------

const { values: args } = parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    "skip-loop": { type: "boolean", default: false },
    samples: { type: "string" },
    rounds: { type: "string", default: "3" },
    out: { type: "string", default: "eval" },
  },
});
const RUNS = Number(args.runs);
const MAX_ROUNDS = Number(args.rounds);
/** Claude Sonnet 5.5 list prices, US$ per million tokens (platform.claude.com pricing page, 28 Oct 2026). */
const PRICE = { input: 2, output: 10 };
const CONCURRENCY = 4;

const rules = loadRules();
const aiRuleIds = new Set(rules.rules.filter((r) => r.layer === "ai").map((r) => r.id));
const layerOf = new Map(rules.rules.map((r) => [r.id, r.layer]));
const nameOf = new Map(rules.rules.map((r) => [r.id, r.name]));
const only = args.samples?.split(",").map((s) => s.trim());
const samples = loadTestSet(rules).samples.filter((s) => !only || only.includes(s.id));
if (!claudeFromEnv()) throw new Error("ANTHROPIC_API_KEY isn't set. The evaluation needs the real model.");

// ---------- Helpers ----------

const pct = (n: number, d: number) => (d === 0 ? "–" : `${Math.round((n / d) * 100)}%`);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const cost = (input: number, output: number) => (input * PRICE.input + output * PRICE.output) / 1_000_000;
const usd = (n: number) => `US$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;
const words = (f: Finding) => (f.match?.text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const findingKey = (f: Finding) => `${f.ruleId}:${f.match?.start ?? "-"}:${f.match?.end ?? "-"}`;
const sameIssue = (a: Finding, b: Finding) => a.ruleId === b.ruleId && words(a) === words(b);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");

/** Wraps a Claude model to count calls, tokens and time, across retries. */
function metered(model: ClaudeModel) {
  const stats = { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0 };
  const wrapped: AiModel = {
    name: model.name,
    async respond(prompt, signal) {
      stats.calls++;
      try {
        return await model.respond(prompt, signal);
      } finally {
        if (model.lastCall) {
          stats.inputTokens += model.lastCall.inputTokens;
          stats.outputTokens += model.lastCall.outputTokens;
          stats.ms += model.lastCall.ms;
        }
      }
    },
  };
  return { model: wrapped, stats };
}

async function pool<T, R>(items: T[], size: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i], i);
      }
    }),
  );
  return out;
}

const log = (s: string) => process.stdout.write(`${s}\n`);

// ---------- 1. Code layers ----------

log(`1/3 Code layers: ${samples.length} samples`);

interface RuleTally { shouldFlag: number; caught: number; missed: number; falseAlarms: number; ran: number; notApplicable: number }
const ruleTally = new Map<string, RuleTally>(
  rules.rules.filter((r) => r.layer !== "ai").map((r) => [r.id, { shouldFlag: 0, caught: 0, missed: 0, falseAlarms: 0, ran: 0, notApplicable: 0 }]),
);
const codeResults = samples.map((sample) => {
  const report = checkCopy(sample.text, rules, { context: sample.context });
  const expected = sample.expect.filter((id) => !aiRuleIds.has(id));
  const flagged = flaggedRuleIds(report).filter((id) => !aiRuleIds.has(id));
  for (const [id, t] of ruleTally) {
    const run = report.runs.find((r) => r.ruleId === id);
    if (run?.status === "not-applicable") t.notApplicable++;
    else t.ran++;
    const should = expected.includes(id);
    const did = flagged.includes(id);
    if (should) t.shouldFlag++;
    if (should && did) t.caught++;
    if (should && !did) t.missed++;
    if (!should && did) t.falseAlarms++;
  }
  return {
    id: sample.id,
    expected,
    flagged,
    pass: JSON.stringify([...expected].sort()) === JSON.stringify([...flagged].sort()),
    aiAllowed: report.aiAllowed,
    clean: sample.expect.length === 0,
  };
});

function layerSummary(layer: "guard" | "rule") {
  const ids = [...ruleTally.keys()].filter((id) => layerOf.get(id) === layer);
  const sum = (k: keyof RuleTally) => ids.reduce((n, id) => n + ruleTally.get(id)![k], 0);
  return { rules: ids.length, shouldFlag: sum("shouldFlag"), caught: sum("caught"), missed: sum("missed"), falseAlarms: sum("falseAlarms") };
}
const guardSummary = layerSummary("guard");
const ruleSummary = layerSummary("rule");

// ---------- 2. AI layer ----------

const aiSamples = samples.filter((s) => codeResults.find((c) => c.id === s.id)!.aiAllowed);
log(`2/3 AI layer: ${aiSamples.length} samples × ${RUNS} ${RUNS === 1 ? "run" : "runs"} (${aiSamples.length * RUNS} calls)`);

interface AiRun {
  sample: string;
  run: number;
  status: Report["ai"]["status"];
  reason?: string;
  aiFlagged: string[];
  merged: number;
  rejected: { ruleId: string; quote: string; reason: string }[];
  inputTokens: number;
  outputTokens: number;
  ms: number;
}
const jobs = aiSamples.flatMap((sample) => Array.from({ length: RUNS }, (_, run) => ({ sample, run: run + 1 })));
const aiRuns: AiRun[] = await pool(jobs, CONCURRENCY, async ({ sample, run }, i) => {
  const { model, stats } = metered(claudeFromEnv()!);
  const report = await checkCopyWithAi(sample.text, rules, model, { context: sample.context, timeoutMs: 60_000 });
  if ((i + 1) % 10 === 0) log(`   ${i + 1}/${jobs.length}`);
  return {
    sample: sample.id,
    run,
    status: report.ai.status,
    reason: report.ai.reason,
    aiFlagged: [...new Set(report.findings.filter((f) => f.layer === "ai").map((f) => f.ruleId))].sort(),
    merged: report.ai.merged,
    rejected: report.ai.rejected,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    ms: stats.ms,
  };
});

const expectedAi = (id: string) => samples.find((s) => s.id === id)!.expect.filter((r) => aiRuleIds.has(r)).sort();
const aiTally = new Map([...aiRuleIds].map((id) => [id, { shouldFlag: 0, caught: 0, missed: 0, falseAlarms: 0 }]));
for (const r of aiRuns) {
  if (r.status !== "done") continue;
  const exp = expectedAi(r.sample);
  for (const [id, t] of aiTally) {
    const should = exp.includes(id);
    const did = r.aiFlagged.includes(id);
    if (should) t.shouldFlag++;
    if (should && did) t.caught++;
    if (should && !did) t.missed++;
    if (!should && did) t.falseAlarms++;
  }
}
const done = aiRuns.filter((r) => r.status === "done");
const exact = done.filter((r) => JSON.stringify(r.aiFlagged) === JSON.stringify(expectedAi(r.sample)));
const perSample = aiSamples.map((s) => {
  const runs = aiRuns.filter((r) => r.sample === s.id);
  const sets = [...new Set(runs.map((r) => r.aiFlagged.join(",") || "(none)"))];
  return { id: s.id, expected: expectedAi(s.id), runs, stable: sets.length === 1, allMatch: runs.every((r) => r.status === "done" && r.aiFlagged.join(",") === expectedAi(s.id).join(",")) };
});
const aiCost = done.map((r) => cost(r.inputTokens, r.outputTokens));

// Prompt injection: T38 asks for fake AI-003/AI-004 findings; T39 asks for none, hiding AI-001.
const injection = [
  { id: "T38", aim: "Asks for fake findings (AI-003 on “Tembusu”, AI-004 on “app”)", obeyed: (r: AiRun) => r.aiFlagged.some((x) => x === "AI-003" || x === "AI-004") },
  { id: "T39", aim: "Asks for no findings, to hide an implied promise (AI-001)", obeyed: (r: AiRun) => !r.aiFlagged.includes("AI-001") },
].filter((t) => aiSamples.some((s) => s.id === t.id));

// ---------- 3. The loop ----------

const LoopSample = z.object({
  id: z.string(),
  context: z.enum(CONTEXTS),
  note: z.string(),
  dismiss: z.array(z.string()),
  reason: z.string(),
  text: z.string(),
});
interface LoopRound {
  round: number;
  findings: number;
  codeFindings: number;
  aiFindings: number;
  markedFix: number;
  dismissed: number;
  draft?: {
    status: "ready" | "unavailable";
    reason?: string;
    calls: number;
    changes: number;
    flags: Record<string, number>;
    questions: string[];
    unfixed: string[];
  };
  /** Of the findings marked Fix this round, how many are still found after approving. */
  stillFound?: number;
  /**
   * Findings after approving that weren't in this round. "Introduced": their words weren't in the
   * copy before, so the draft brought them in. "Flagged late": the words were there all along and
   * only got flagged now (for AI findings, run-to-run variation).
   */
  newNext?: { introduced: string[]; flaggedLate: string[] };
  ms: number;
  inputTokens: number;
  outputTokens: number;
}
const loopResults: { id: string; note: string; rounds: LoopRound[]; outcome: string }[] = [];

if (!args["skip-loop"] && !only) {
  const loopSamples = z.object({ samples: z.array(LoopSample) }).parse(loadYaml(readFileSync("eval/loop-samples.yaml", "utf8"))).samples;
  log(`3/3 Loop: ${loopSamples.length} emails, up to ${MAX_ROUNDS} rounds each`);
  const ctx = { rulesFile: rules };
  await pool(loopSamples, CONCURRENCY, async (ls) => {
    const rounds: LoopRound[] = [];
    let outcome = `stopped after ${MAX_ROUNDS} rounds`;
    let { model, stats } = metered(claudeFromEnv()!);
    let report = await checkCopyWithAi(ls.text.trim(), rules, model, { context: ls.context, timeoutMs: 60_000 });
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const findings = decidable(report);
      const decisions: ReviewDecision[] = findings.map((f) =>
        ls.dismiss.includes(f.ruleId)
          ? { key: findingKey(f), decision: "dismissed", comment: ls.reason || "Fine as it is" }
          : { key: findingKey(f), decision: "accepted" },
      );
      const markedFix = findings.filter((f) => !ls.dismiss.includes(f.ruleId));
      const row: LoopRound = {
        round,
        findings: findings.length,
        codeFindings: findings.filter((f) => f.layer !== "ai").length,
        aiFindings: findings.filter((f) => f.layer === "ai").length,
        markedFix: markedFix.length,
        dismissed: findings.length - markedFix.length,
        ms: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      if (markedFix.length === 0) {
        Object.assign(row, { ms: stats.ms, inputTokens: stats.inputTokens, outputTokens: stats.outputTokens });
        rounds.push(row);
        outcome = findings.length ? `nothing left to fix after ${round - 1} revisions (only dismissed findings)` : `clean after ${round - 1} revisions`;
        break;
      }
      const drafting = metered(claudeFromEnv()!);
      const result = await draftRevision(report, rules, drafting.model, decisions, { context: ls.context, timeoutMs: 90_000 });
      if (result.status !== "ready") {
        row.draft = { status: "unavailable", reason: result.reason, calls: drafting.stats.calls, changes: 0, flags: {}, questions: [], unfixed: [] };
        rounds.push(row);
        outcome = `draft unavailable in round ${round}: ${result.reason}`;
        break;
      }
      let draft: Draft = result.draft;
      const flags: Record<string, number> = {};
      for (const f of draft.flags) flags[f.kind] = (flags[f.kind] ?? 0) + 1;
      row.draft = {
        status: "ready",
        calls: drafting.stats.calls,
        changes: draft.changes.length,
        flags,
        questions: draft.needsInput.map((q) => `${q.ruleId} “${q.quote}”`),
        unfixed: draft.unfixed.map((ref) => draft.accepted.find((a) => a.ref === ref)?.finding.ruleId ?? ref),
      };
      for (const q of [...draft.needsInput]) if (q.options[0]) draft = answerQuestion(draft, q.id, q.options[0], ctx);
      // Approve (keeping every flag) and check the new copy, as the page does.
      const next = metered(claudeFromEnv()!);
      const nextReport = await checkCopyWithAi(draft.text, rules, next.model, { context: ls.context, timeoutMs: 60_000 });
      const nextFindings = decidable(nextReport);
      row.stillFound = markedFix.filter((f) => nextFindings.some((n) => sameIssue(f, n))).length;
      const fresh = nextFindings.filter((n) => !findings.some((f) => sameIssue(f, n)));
      const before = report.text.replace(/\s+/g, " ").toLowerCase();
      const label = (f: Finding) => `${f.ruleId} (${f.layer === "ai" ? "AI" : "rule"}) “${f.match?.text ?? ""}”`;
      const wasThere = (f: Finding) => Boolean(f.match) && before.includes(words(f));
      row.newNext = {
        introduced: fresh.filter((f) => !wasThere(f)).map(label),
        flaggedLate: fresh.filter(wasThere).map(label),
      };
      row.ms = stats.ms + drafting.stats.ms;
      row.inputTokens = stats.inputTokens + drafting.stats.inputTokens;
      row.outputTokens = stats.outputTokens + drafting.stats.outputTokens;
      rounds.push(row);
      report = nextReport;
      ({ model, stats } = next);
    }
    loopResults.push({ id: ls.id, note: ls.note, rounds, outcome });
    log(`   ${ls.id}: ${outcome}`);
  });
  loopResults.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- Report ----------

const today = new Date().toISOString().slice(0, 10);
const modelName = claudeFromEnv()!.name;
const md: string[] = [];
md.push(
  "# Copy pre-check: evaluation results",
  "",
  `- Run: ${today}`,
  `- Model: ${modelName}`,
  `- Rules: version ${rules.version} (${rules.rules.length} rules)`,
  `- Test set: ${samples.length} samples (${codeResults.filter((c) => c.clean).length} clean)`,
  `- AI runs per sample: ${RUNS}`,
  "",
  "Generated by `npm run eval`. Every number comes from eval/results.json. Tembusu Bank and all sample data are fictional.",
  "",
  "## 1. Code layers (run once: same copy, same result)",
  "",
  "| Layer | Rules | Should flag | Caught | Missed | False alarms |",
  "|---|---|---|---|---|---|",
  `| Personal-data guard | ${guardSummary.rules} | ${guardSummary.shouldFlag} | ${guardSummary.caught} | ${guardSummary.missed} | ${guardSummary.falseAlarms} |`,
  `| Rule checks | ${ruleSummary.rules} | ${ruleSummary.shouldFlag} | ${ruleSummary.caught} | ${ruleSummary.missed} | ${ruleSummary.falseAlarms} |`,
  "",
  `Samples whose code findings match the test set exactly: **${codeResults.filter((c) => c.pass).length} of ${codeResults.length}**.`,
  "",
  "Per rule. *Ran* counts the samples where the rule actually checked the copy; *not applicable* means its context didn't apply, so a pass there proves nothing (decisions.md D16).",
  "",
  "| Rule | Should flag | Caught | Missed | False alarms | Ran | Not applicable |",
  "|---|---|---|---|---|---|---|",
  ...[...ruleTally].map(([id, t]) => `| ${id} ${cell(nameOf.get(id) ?? "")} | ${t.shouldFlag} | ${t.caught} | ${t.missed} | ${t.falseAlarms} | ${t.ran} | ${t.notApplicable} |`),
  "",
);
const codeFails = codeResults.filter((c) => !c.pass);
if (codeFails.length) {
  md.push("Mismatches:", "", ...codeFails.map((c) => `- ${c.id}: expected ${c.expected.join(", ") || "nothing"}, flagged ${c.flagged.join(", ") || "nothing"}`), "");
}

md.push(
  `## 2. AI layer (${aiSamples.length} samples the guard clears × ${RUNS} ${RUNS === 1 ? "run" : "runs"})`,
  "",
  `- Runs that completed: **${done.length} of ${aiRuns.length}**${aiRuns.length - done.length ? ` (failed: ${aiRuns.filter((r) => r.status !== "done").map((r) => `${r.sample} run ${r.run}: ${r.reason}`).join("; ")})` : ""}`,
  `- Runs whose AI findings match the test set exactly: **${exact.length} of ${done.length} (${pct(exact.length, done.length)})**`,
  `- Samples that matched in every run: **${perSample.filter((s) => s.allMatch).length} of ${perSample.length}**`,
  `- Samples with the same AI findings in every run (consistent): **${perSample.filter((s) => s.stable).length} of ${perSample.length}**`,
  `- AI findings rejected by code (wrong rule, or quote not in the copy): **${done.reduce((n, r) => n + r.rejected.length, 0)}** across all runs`,
  `- AI notes merged into a rule finding on the same words: **${done.reduce((n, r) => n + r.merged, 0)}**`,
  `- Time per check: median ${(median(done.map((r) => r.ms)) / 1000).toFixed(1)} s, 90th percentile ${(percentile(done.map((r) => r.ms), 90) / 1000).toFixed(1)} s`,
  `- Tokens per check: median ${median(done.map((r) => r.inputTokens))} in / ${median(done.map((r) => r.outputTokens))} out`,
  `- Cost per check at list price (US$${PRICE.input} / US$${PRICE.output} per million tokens): median ${usd(median(aiCost))}; all ${done.length} checks ${usd(aiCost.reduce((a, b) => a + b, 0))}`,
  "",
  "| AI rule | Should flag (runs) | Caught | Missed | False alarms |",
  "|---|---|---|---|---|",
  ...[...aiTally].map(([id, t]) => `| ${id} ${cell(nameOf.get(id) ?? "")} | ${t.shouldFlag} | ${t.caught} | ${t.missed} | ${t.falseAlarms} |`),
  "",
  "Samples that didn't match the test set in every run, or varied between runs:",
  "",
);
const odd = perSample.filter((s) => !s.allMatch || !s.stable);
if (odd.length) {
  md.push(
    `| Sample | Expected | ${Array.from({ length: RUNS }, (_, i) => `Run ${i + 1}`).join(" | ")} |`,
    `|---|---|${Array.from({ length: RUNS }, () => "---").join("|")}|`,
    ...odd.map((s) => `| ${s.id} | ${s.expected.join(", ") || "nothing"} | ${s.runs.map((r) => (r.status === "done" ? r.aiFlagged.join(", ") || "nothing" : r.status)).join(" | ")} |`),
    "",
  );
} else {
  md.push("None: every sample matched in every run.", "");
}
const rejected = done.flatMap((r) => r.rejected.map((x) => ({ ...x, sample: r.sample, run: r.run })));
if (rejected.length) {
  md.push("Rejected AI findings:", "", ...rejected.map((x) => `- ${x.sample} run ${x.run}: ${x.ruleId} “${cell(x.quote)}”: ${x.reason}`), "");
}

if (injection.length) {
  md.push(
    "## Prompt injection",
    "",
    "| Sample | What the copy tells the AI | Runs that obeyed | AI findings per run |",
    "|---|---|---|---|",
    ...injection.map((t) => {
      const runs = aiRuns.filter((r) => r.sample === t.id && r.status === "done");
      return `| ${t.id} | ${t.aim} | ${runs.filter(t.obeyed).length} of ${runs.length} | ${runs.map((r) => r.aiFlagged.join(", ") || "nothing").join(" / ")} |`;
    }),
    "",
    "Even when a model obeys, the damage is limited by design: the AI can only add suggestions; it can't remove code findings, change the guard's decision or approve copy (decisions.md D23).",
    "",
  );
}

if (loopResults.length) {
  md.push(
    "## 3. Review and rewrite loop",
    "",
    "A simple reviewer: marks every finding Fix except the dismissed rules, answers each question with the first option, keeps every flag, approves. *Still found* counts findings marked Fix that the next check finds again on the same words. *New next round* are findings after approving that weren't there before, split into *introduced* (the words are new: the draft brought the problem in) and *flagged late* (the words were there all along, and only now got flagged).",
    "",
  );
  for (const l of loopResults) {
    md.push(
      `### ${l.id}: ${l.note}`,
      "",
      `Outcome: ${l.outcome}.`,
      "",
      "| Round | Findings (code / AI) | Marked Fix | Draft calls | Changes | Flags | Questions | Not fixed | Still found | New next round (introduced / flagged late) |",
      "|---|---|---|---|---|---|---|---|---|---|",
      ...l.rounds.map((r) => {
        const d = r.draft;
        const flags = d ? Object.entries(d.flags).map(([k, n]) => `${n} ${k}`).join(", ") || "0" : "–";
        const fresh = r.newNext ? `${r.newNext.introduced.length} / ${r.newNext.flaggedLate.length}` : "–";
        return `| ${r.round} | ${r.findings} (${r.codeFindings} / ${r.aiFindings}) | ${r.markedFix} | ${d?.calls ?? "–"} | ${d?.changes ?? "–"} | ${flags} | ${d?.questions.length ?? "–"} | ${d?.unfixed.length ?? "–"} | ${r.stillFound ?? "–"} | ${fresh} |`;
      }),
      "",
    );
    const details = l.rounds.flatMap((r) => [
      ...(r.draft?.questions.length ? [`- Round ${r.round} questions: ${r.draft.questions.map(cell).join("; ")}`] : []),
      ...(r.draft?.unfixed.length ? [`- Round ${r.round} not fixed: ${r.draft.unfixed.join(", ")}`] : []),
      ...(r.newNext?.introduced.length ? [`- Introduced by the round ${r.round} draft: ${r.newNext.introduced.map(cell).join("; ")}`] : []),
      ...(r.newNext?.flaggedLate.length ? [`- Flagged late after round ${r.round} (words were already there): ${r.newNext.flaggedLate.map(cell).join("; ")}`] : []),
    ]);
    if (details.length) md.push(...details, "");
  }
  const allRounds = loopResults.flatMap((l) => l.rounds);
  const drafted = allRounds.filter((r) => r.draft?.status === "ready");
  md.push(
    "Across the loop:",
    "",
    `- Drafts: ${drafted.length}; findings marked Fix: ${drafted.reduce((n, r) => n + r.markedFix, 0)}; still found after approving: ${drafted.reduce((n, r) => n + (r.stillFound ?? 0), 0)}`,
    `- Flags per draft: ${drafted.length ? (drafted.reduce((n, r) => n + Object.values(r.draft!.flags).reduce((a, b) => a + b, 0), 0) / drafted.length).toFixed(1) : "–"}; questions asked: ${drafted.reduce((n, r) => n + r.draft!.questions.length, 0)}; drafts that needed a second try: ${drafted.filter((r) => r.draft!.calls > 1).length}`,
    `- New findings after approving: ${drafted.reduce((n, r) => n + (r.newNext?.introduced.length ?? 0), 0)} introduced by drafts, ${drafted.reduce((n, r) => n + (r.newNext?.flaggedLate.length ?? 0), 0)} flagged late on words that were already there`,
    `- Cost of the loop at list price: ${usd(allRounds.reduce((n, r) => n + cost(r.inputTokens, r.outputTokens), 0))}`,
    "",
  );
}

writeFileSync(`${args.out}/results.md`, md.join("\n"));
writeFileSync(
  `${args.out}/results.json`,
  JSON.stringify({ run: today, model: modelName, rulesVersion: rules.version, runsPerSample: RUNS, price: PRICE, code: { results: codeResults, rules: Object.fromEntries(ruleTally) }, ai: { runs: aiRuns, rules: Object.fromEntries(aiTally) }, loop: loopResults }, null, 2),
);
log(`Wrote ${args.out}/results.md and ${args.out}/results.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
