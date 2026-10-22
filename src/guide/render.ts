// Renders the style guide from the hand-written intro and the rules file
// (decisions.md D18). Pure function, so a test can check that the committed
// style-guide.md is never out of date with rules.yaml.

import type { Category, Context, Layer, Rule, RulesFile, Severity } from "../engine/schema";

/** Order and wording of the sections writers see. */
const SECTIONS: [Category, string, string][] = [
  ["personal-data", "Personal data", "Never put real customer or staff details in copy, mock-ups or test data."],
  ["banned-phrase", "Promises and pressure", "Don't promise outcomes, deny risk, or rush customers."],
  ["disclosure", "Disclosures", "Some claims always need extra information next to them."],
  ["terminology", "Wording and product names", "Use the same words every time, and product names exactly as listed."],
  ["format", "Money and dates", "Write amounts and dates so there's only one way to read them."],
  ["plain-language", "Plain language", "Short sentences, everyday words, and a clear next step."],
];

const SEVERITY: Record<Severity, string> = { blocker: "Blocker", "needs-fix": "Needs fix", suggestion: "Suggestion" };

const CHECKED_BY: Record<Layer, string> = {
  guard: "Code, before anything is sent to AI",
  rule: "Code",
  ai: "AI (always a suggestion)",
};

const CONTEXT: Record<Context, string> = {
  button: "buttons",
  error: "error messages",
  confirmation: "confirmations",
  "promo-banner": "promo banners",
  "rate-card": "rate cards",
  "help-text": "help text",
  notification: "notifications",
  "email-snippet": "emails",
};

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const code = (text: string) => "`" + text + "`";
const anchor = (rule: Rule) =>
  `${rule.id}-${rule.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");

function details(rule: Rule): string[] {
  const check = rule.check;
  switch (check.type) {
    case "phrases":
      return [
        `**Flagged phrases:** ${check.phrases.map(code).join(", ")}. ` +
          "Spelling variants such as curly apostrophes and hyphens are caught too.",
      ];
    case "replace":
      return [
        "| Instead of | Write |",
        "|---|---|",
        ...Object.entries(check.replace).map(([wrong, preferred]) => `| ${wrong} | ${preferred} |`),
      ];
    case "names":
      return [`**Official names:** ${check.names.join(", ")}.`];
    case "max-words":
      return [`**Limit:** ${check.limit} words per sentence.`];
    case "pattern":
      return check.allow?.length ? [`**Allowed:** ${check.allow.map(code).join(", ")}.`] : [];
    default:
      return [];
  }
}

/** How a code rule and the AI rule that backs it up work together (D19). */
function related(rule: Rule, all: Rule[]): string[] {
  const link = (r: Rule) => `[${r.id} ${r.name}](#${anchor(r)})`;
  const lines: string[] = [];
  const extended = all.filter((r) => rule.extends?.includes(r.id));
  if (extended.length) {
    lines.push(
      `**Works with:** ${extended.map(link).join(", ")}. This rule catches rewordings ` +
        `${extended.length === 1 ? "that check misses" : "those checks miss"}. ` +
        "If both flag the same words, only the code rule's finding is shown.",
    );
  }
  const backedBy = all.filter((r) => r.extends?.includes(rule.id));
  if (backedBy.length) {
    lines.push(`**Backed up by:** ${backedBy.map(link).join(", ")}, which catches rewordings this check misses.`);
  }
  return lines;
}

function rulePage(rule: Rule, all: Rule[]): string {
  const meta = [`**${SEVERITY[rule.severity]}**`, `Checked by: ${CHECKED_BY[rule.layer]}`];
  if (rule.contexts?.length) {
    meta.push(`Applies to: ${rule.contexts.map((context) => CONTEXT[context]).join(", ")}`);
  }
  // Blocks of extra detail, separated by blank lines.
  const blocks = [details(rule), ...related(rule, all).map((line) => [line])].filter((block) => block.length);
  const extra = blocks.flatMap((block, i) => (i === 0 ? block : ["", ...block]));
  return [
    `### ${rule.name} <a id="${anchor(rule)}"></a>`,
    "",
    `${code(rule.id)} · ${meta.join(" · ")}`,
    "",
    clean(rule.why),
    "",
    `**What to do:** ${clean(rule.fix)}`,
    "",
    ...(extra.length ? [...extra, ""] : []),
    "| | Example |",
    "|---|---|",
    `| Don't | ${clean(rule.examples.bad)} |`,
    `| Do | ${clean(rule.examples.good)} |`,
    "",
  ].join("\n");
}

export function renderStyleGuide(intro: string, rulesFile: RulesFile): string {
  const covered = new Set(SECTIONS.map(([category]) => category));
  const missing = rulesFile.rules.filter((rule) => !covered.has(rule.category));
  if (missing.length) {
    // A rule must never silently disappear from the guide.
    throw new Error(`No guide section for: ${missing.map((r) => `${r.id} (${r.category})`).join(", ")}`);
  }

  // Rules in the order their sections appear, so the table matches the page.
  const rules = SECTIONS.flatMap(([category]) => rulesFile.rules.filter((rule) => rule.category === category));

  const lines = [
    intro.trim(),
    "",
    "---",
    "",
    `*The sections below are generated from \`rules.yaml\` (version ${rulesFile.version}). ` +
      "Edit that file, not this page.*",
    "",
    "## All rules at a glance",
    "",
    "| ID | Rule | Severity | Checked by |",
    "|---|---|---|---|",
    ...rules.map(
      (rule) => `| ${rule.id} | [${rule.name}](#${anchor(rule)}) | ${SEVERITY[rule.severity]} | ${CHECKED_BY[rule.layer]} |`,
    ),
    "",
  ];

  for (const [category, title, blurb] of SECTIONS) {
    const inSection = rules.filter((rule) => rule.category === category);
    if (inSection.length) lines.push(`## ${title}`, "", blurb, "", ...inSection.map((rule) => rulePage(rule, rules)));
  }

  // Placeholders, collected from every rule's fix and good example.
  const placeholders = new Map<string, Set<string>>();
  for (const rule of rules) {
    for (const [, name] of `${rule.fix} ${rule.examples.good}`.matchAll(/\{(\w+)\}/g)) {
      if (!placeholders.has(name)) placeholders.set(name, new Set());
      placeholders.get(name)!.add(rule.id);
    }
  }
  lines.push(
    "## Placeholders",
    "",
    "Placeholders are filled in by the product when the screen is shown. Use them instead of " +
      "real or hard-coded details. Each is listed with the rules that mention it.",
    "",
    "| Placeholder | Used in |",
    "|---|---|",
    ...[...placeholders].map(([name, ids]) => `| ${code(`{${name}}`)} | ${[...ids].join(", ")} |`),
    "",
  );

  return lines.join("\n");
}
