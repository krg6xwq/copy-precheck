# Copy pre-check

Checks UI copy for **Tembusu Bank**, a fictional bank, before it goes to compliance review. It flags personal data, style-guide breaks, risky phrasing and missing disclosures, and produces a report for a person to review. It never rewrites or approves anything itself.

> **Never paste real customer data.** Use placeholders such as `{name}`, `{nric}`, `{phone}` or `{email}`. Everything in this repo is invented.

## How it works

Copy is checked in three layers, in this order:

1. **Personal-data guard (code).** NRIC/FIN, phone numbers, email addresses, card numbers and account numbers. Any hit stops the copy from being sent to the AI until it's replaced with a placeholder. A reviewer can override a wrong match, with a written reason.
2. **Rule checks (code).** Banned phrases, scam-like urgency, terminology, product names, S$ amounts, unambiguous dates, required disclosures and sentence length. The same copy always gets the same result.
3. **AI judgment.** Only for what code can't catch: implied promises, alarming error messages, unexplained acronyms and jargon. Always shown as suggestions. *(Coming next.)*

All rules live in one file, [`content/rules.yaml`](content/rules.yaml). The checker reads it, and the [style guide](content/style-guide.md) is generated from it, so the two can never disagree.

## Quick start

Needs [Node.js](https://nodejs.org) 22 or later.

```bash
npm install
npm test                 # run the test set and all other tests
npm run check -- "Earn 2.5% interest. Act now!" --context promo-banner
```

## Commands

| Command | What it does |
|---|---|
| `npm run check -- "copy" [options]` | Checks one piece of copy. Add `--help` for options. Exits with 1 if there's an open blocker. |
| `npm test` | Runs every sample in the test set, plus the engine and validation tests. |
| `npm run guide` | Rebuilds `content/style-guide.md` from `rules.yaml`. Run it after changing a rule. |
| `npm run typecheck` | Checks the TypeScript. |
| `npm run dev` | Starts the web page (placeholder for now). |

`check` options:

- `--context`, `-c`: where the copy appears (`button`, `error`, `confirmation`, `promo-banner`, `rate-card`, `help-text`, `notification`, `email-snippet`). Some rules only apply in certain places; without a context, every rule runs.
- `--override`, `-o`: release one personal-data match you've checked isn't personal data, e.g. `--override "PD-002|+65 6123 4567|Published overseas line"`. Name the exact text: any other match from the same rule stays blocked. Repeat the option for more than one.
- `--verbose`, `-v`: also list every rule and whether it ran.
- `--json`: print the full report as JSON.

## Changing a rule

1. Edit [`content/rules.yaml`](content/rules.yaml). The field reference is at the top of the file.
2. Add or update a sample in [`content/test-set.yaml`](content/test-set.yaml), including a near-miss that should *not* be flagged.
3. Run `npm run guide`, then `npm test`.

If the rules file has a mistake, such as a misspelled severity, a missing field or a broken pattern, the checker stops with a message saying where, rather than skipping the rule.

## Project layout

```
content/          Rules, test set and style guide (edit these, not code, to change rules)
src/engine/       The checker: loading, validation and the three layers
src/cli/          The `npm run check` command
src/guide/        Generates the style guide from the rules
src/app/          Web page (Next.js)
scripts/          `npm run guide`
tests/            Automated tests
```

## Notes

- Tembusu Bank is fictional. The rules are loosely modelled on common banking practice. They are **not** real MAS, legal or compliance requirements.
- Built with help from Claude (Anthropic), which drafted rules, tests and code for review.
