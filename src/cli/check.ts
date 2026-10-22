// npm run check -- "Your copy here" [options]
//
// Checks one piece of copy and prints a report. Exit code 1 means there is
// at least one open blocker, so the command can also be used in scripts.

import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkCopyWithAi, CONTEXTS, OverrideError, type Context, type Finding, type Override, type Report } from "../engine";
import { ContentError, loadRules } from "../engine/load";
import { claudeFromEnv } from "../models/claude";

const HELP = `Check UI copy against the Tembusu Bank rules.

Usage:
  npm run check -- "Your copy here" [options]
  echo "Your copy here" | npm run check -- [options]

Options:
  -c, --context <name>       Where the copy appears: ${CONTEXTS.join(", ")}
  -o, --override <ID|text|reason>
                             Release one personal-data match you've checked
                             isn't personal data. Name the exact text; other
                             matches stay blocked. Repeat for more, e.g.
                             --override "PD-002|+65 6123 4567|Published overseas line"
  -f, --file <path>          Read the copy from a file
      --ai                   Also run the AI checks (needs ANTHROPIC_API_KEY,
                             e.g. in .env.local; each check costs a little)
  -v, --verbose              Also list every rule and whether it ran
      --json                 Print the full report as JSON
  -h, --help                 Show this help

Never paste real customer data. Use placeholders such as {name} or {phone}.`;

const LABEL = { blocker: "BLOCKERS", "needs-fix": "NEEDS FIX", suggestion: "SUGGESTIONS" } as const;

function fail(message: string): never {
  console.error(`${message}\n\nRun with --help for usage.`);
  process.exit(2);
}

function parseOverrides(values: string[]): Override[] {
  return values.map((value) => {
    const parts = value.split("|");
    if (parts.length !== 3 || parts.some((part) => !part.trim())) {
      fail(`Overrides look like ID|text|reason, e.g. "PD-002|+65 6123 4567|Published overseas line". Got: ${value}`);
    }
    const [ruleId, match, reason] = parts.map((part) => part.trim());
    return { ruleId: ruleId.toUpperCase(), match, reason };
  });
}

function readCopy(positionals: string[], file: string | undefined): string {
  if (file) return readFileSync(file, "utf8").trim();
  if (positionals.length) return positionals.join(" ").trim();
  if (!process.stdin.isTTY) return readFileSync(0, "utf8").trim();
  fail("No copy given.");
}

function formatFinding(finding: Finding): string {
  const lines = [`  ${finding.ruleId}  ${finding.ruleName}${finding.layer === "guard" ? "  [personal data]" : ""}`];
  if (finding.match) lines.push(`      "${finding.match.text}"`);
  if (finding.detail) lines.push(`      ${finding.layer === "ai" ? "AI: " : ""}${finding.detail}`);
  if (finding.suggestion) lines.push(`      Suggested wording: ${finding.suggestion}`);
  for (const agreement of finding.aiAgreement ?? []) {
    lines.push(`      ${agreement.ruleId} (AI) agrees: ${agreement.explanation}`);
  }
  if (finding.override) lines.push(`      Overridden: ${finding.override.reason}`);
  lines.push(`      Why: ${finding.why}`, `      Fix: ${finding.fix}`);
  return lines.join("\n");
}

function formatReport(report: Report, verbose: boolean): string {
  const out = [`Copy:    "${report.text}"`, `Context: ${report.context ?? "not given (every rule runs)"}`, ""];

  const open = report.findings.filter((finding) => !finding.override);
  if (open.length === 0) out.push("No problems found by the code checks.", "");
  for (const severity of ["blocker", "needs-fix", "suggestion"] as const) {
    const group = open.filter((finding) => finding.severity === severity);
    if (group.length) out.push(`${LABEL[severity]} (${group.length})`, ...group.map(formatFinding), "");
  }

  const overridden = report.findings.filter((finding) => finding.override);
  if (overridden.length) out.push(`OVERRIDDEN (${overridden.length})`, ...overridden.map(formatFinding), "");

  out.push(
    {
      "not-run": "AI checks: not run. Add --ai to run them.",
      blocked: "AI checks: not run. Replace the personal data with placeholders, or override a finding you've checked.",
      done: `AI checks: done (${report.ai.model}).`,
      unavailable: `AI checks: unavailable. ${report.ai.reason}. The code findings above still apply.`,
    }[report.ai.status],
  );

  const count = (status: string) => report.runs.filter((run) => run.status === status).length;
  out.push(
    `Rules: ${count("flagged") + count("passed")} checked, ${count("not-applicable")} not applicable, ` +
      `${report.runs.filter((run) => run.layer === "ai").length} AI. Rules file v${report.rulesVersion}.`,
  );

  if (verbose) {
    out.push("", "Every rule:");
    for (const run of report.runs) {
      out.push(`  ${run.ruleId.padEnd(7)} ${run.status.padEnd(15)}${run.reason ?? ""}`);
    }
  }
  for (const warning of report.warnings) out.push(`Warning: ${warning}`);
  return out.join("\n");
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        context: { type: "string", short: "c" },
        override: { type: "string", short: "o", multiple: true },
        file: { type: "string", short: "f" },
        verbose: { type: "boolean", short: "v" },
        ai: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    fail((error as Error).message);
  }
  const { values, positionals } = args;
  if (values.help) {
    console.log(HELP);
    return;
  }

  const context = values.context as Context | undefined;
  if (context && !CONTEXTS.includes(context)) fail(`Unknown context "${context}". Use one of: ${CONTEXTS.join(", ")}`);

  const text = readCopy(positionals, values.file);
  const overrides = parseOverrides(values.override ?? []);

  // The API key lives in .env.local, which git ignores. Never commit it.
  if (values.ai && existsSync(".env.local")) process.loadEnvFile(".env.local");
  let model;
  try {
    model = values.ai ? claudeFromEnv() : undefined;
  } catch (error) {
    fail((error as Error).message);
  }
  if (values.ai && !model) fail("--ai needs ANTHROPIC_API_KEY. Put it in .env.local (see .env.example).");

  let report: Report;
  try {
    report = await checkCopyWithAi(text, loadRules(), model, { context, overrides });
  } catch (error) {
    if (error instanceof ContentError || error instanceof OverrideError) fail(error.message);
    throw error;
  }

  console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report, Boolean(values.verbose)));
  const openBlockers = report.findings.some((finding) => finding.severity === "blocker" && !finding.override);
  process.exitCode = openBlockers ? 1 : 0;
}

void main();
