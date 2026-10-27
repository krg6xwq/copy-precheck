# Copy pre-check

Checks UI copy for **Tembusu Bank**, a fictional bank, before it goes to compliance review. It flags personal data, style-guide breaks, risky phrasing and missing disclosures, and produces a report for a person to review. It never approves anything. When the reviewer asks, it drafts a revision from their decisions, and code checks that draft before they see it.

> **Never paste real customer data.** Use placeholders such as `{name}`, `{nric}`, `{phone}` or `{email}`. Everything in this repo is invented.

## How it works

Copy is checked in three layers, in this order:

1. **Personal-data guard (code).** NRIC/FIN, phone numbers, email addresses, card numbers and account numbers. Any hit stops the copy from being sent to the AI until it's replaced with a placeholder. A reviewer can override a wrong match, with a written reason.
2. **Rule checks (code).** Banned phrases, scam-like urgency, terminology, product names, S$ amounts, unambiguous dates, required disclosures and sentence length. The same copy always gets the same result.
3. **AI judgment (Claude).** Only for what code can't catch: implied promises, alarming error messages, unexplained acronyms and jargon. Always shown as suggestions. Every AI finding must quote words that are really in the copy, or it's dropped. If the AI repeats a code finding, it's merged into it. If the AI is unavailable, the code findings still stand.

### The review and rewrite loop

1. The reviewer accepts or dismisses every finding, adding a note if they like. Dismissing a blocker or needs-fix finding needs a reason.
2. The AI drafts a revision of the whole copy from those decisions: it fixes what was accepted, leaves dismissed words alone, and asks instead of guessing (for example, whether 05/11/2026 means May or November).
3. Code checks the draft: facts kept, every change backed by an accepted finding, dismissed words untouched, nothing accepted left unfixed, length, and a full re-check. New personal data blocks approval.
4. The reviewer answers any questions (code puts the answer in), keeps, undoes or edits anything flagged, and approves.
5. The approved draft is checked again as the next round, with dismissals carried over. Repeat until you're happy with the copy (after three revisions the page mentions it; ten is the most for one check). The downloaded report records every round.

All rules live in one file, [`content/rules.yaml`](content/rules.yaml). The checker reads it, and the [style guide](content/style-guide.md) is generated from it, so the two can never disagree.

## Quick start

Needs [Node.js](https://nodejs.org) 22 or later.

```bash
npm install
npm test                 # run the test set and all other tests
npm run check -- "Earn 2.5% interest. Act now!" --context promo-banner
```

To run the AI checks too, copy `.env.example` to `.env.local`, add an Anthropic API key (create a project-only key with a spend limit), and add `--ai`:

```bash
npm run check -- "Watch your savings grow without lifting a finger." --context promo-banner --ai
```

`.env.local` is ignored by git. Never commit a real key.

## Commands

| Command | What it does |
|---|---|
| `npm run check -- "copy" [options]` | Checks one piece of copy. Add `--help` for options. Exits with 1 if there's an open blocker. |
| `npm test` | Runs every sample in the test set, plus the engine and validation tests. |
| `npm run guide` | Rebuilds `content/style-guide.md` from `rules.yaml`. Run it after changing a rule. |
| `npm run typecheck` | Checks the TypeScript. |
| `npm run dev` | Starts the web page at http://localhost:3000. Reads the API key from `.env.local`. |

`check` options:

- `--context`, `-c`: where the copy appears (`button`, `error`, `confirmation`, `promo-banner`, `rate-card`, `help-text`, `notification`, `email-snippet`). Some rules only apply in certain places; without a context, every rule runs.
- `--override`, `-o`: release one personal-data match you've checked isn't personal data, e.g. `--override "PD-002|+65 6123 4567|Published overseas line"`. Name the exact text: any other match from the same rule stays blocked. Repeat the option for more than one.
- `--ai`: also run the AI checks with Claude. Needs `ANTHROPIC_API_KEY`. Each check costs well under a cent.
- `--verbose`, `-v`: also list every rule and whether it ran.
- `--json`: print the full report as JSON.

## Web page

Paste copy (or pick a sample from the test set), choose where it appears, and check it. The page shows the copy with flagged words highlighted, then each finding grouped by severity, with why it matters and what to do. Reviewers can accept or dismiss each finding, override a personal-data match with a reason (the AI checks then run), and download the review as Markdown. Once every finding is decided, "Draft a revision" starts the review and rewrite loop above.

The check runs on the server, so the API key never reaches the browser. Copy is capped at 1,500 characters, and AI checks have a best-effort rate limit; the real cost cap is the spend limit on the key.

## Changing a rule

1. Edit [`content/rules.yaml`](content/rules.yaml). The field reference is at the top of the file.
2. Add or update a sample in [`content/test-set.yaml`](content/test-set.yaml), including a near-miss that should *not* be flagged.
3. Run `npm run guide`, then `npm test`.

If the rules file has a mistake, such as a misspelled severity, a missing field or a broken pattern, the checker stops with a message saying where, rather than skipping the rule.

## Project layout

```
content/          Rules, test set and style guide (edit these, not code, to change rules)
src/engine/       The checker: loading, validation and the three layers (AI layer in src/engine/ai/,
                  review and rewrite loop in src/engine/revise/)
src/models/       Connection to Claude (swap this to use a different model)
src/cli/          The `npm run check` command
src/guide/        Generates the style guide from the rules
src/app/          Web page (Next.js)
scripts/          `npm run guide`
tests/            Automated tests
```

## Notes

- Tembusu Bank is fictional. The rules are loosely modelled on common banking practice. They are **not** real MAS, legal or compliance requirements.
- Built with help from Claude (Anthropic), which drafted rules, tests and code for review.
