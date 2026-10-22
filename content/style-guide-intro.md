# Tembusu Bank — UI copy style guide

For anyone who writes or reviews customer-facing copy at Tembusu Bank: app screens, notifications, emails and promotional banners.

*Tembusu Bank is fictional. These rules are loosely modelled on common banking practice. They are not real MAS, legal or compliance requirements.*

## How we write

- **Calm.** People read banking copy when money is at stake. Never sound urgent or alarming, and never sound like a scam message.
- **Plain.** Short sentences and everyday words. Lead with what the customer needs to do.
- **Specific.** Say what happened and what to do next.
- **Honest.** Never promise an outcome. Say when something carries risk, and point to the terms.

## Never use real data

Real-looking details get copied into screenshots, design files and tools. Use placeholders instead, even in drafts and mock-ups: `{name}`, `{nric}`, `{phone}`, `{email}`, `{card}`, `{account}`. For the bank's own phone number, use `{hotline}` so it's filled in from one central setting. The full list of placeholders used in this guide is at the end.

## How copy is checked

The copy pre-check tool checks copy before it goes to compliance review, in three steps:

1. **Personal data.** If the copy contains anything that looks like personal data, it isn't sent to the AI until that's replaced with a placeholder. The rule checks in step 2 still run. A reviewer can override a wrong match, with a written reason.
2. **Rules checked by code.** Fixed rules such as banned phrases, currency format and required disclosures. The same copy always gets the same result.
3. **Rules checked by AI.** Judgment calls, such as implied promises or jargon. These are always suggestions for a person to accept or dismiss.

Every finding has a severity:

- **Blocker:** must be fixed before compliance review.
- **Needs fix:** fix before review unless there's a good reason not to.
- **Suggestion:** the reviewer decides.

Severity and the personal-data check are separate. A blocker means the copy must be fixed before compliance review, but it doesn't stop the other checks, so you see every issue in one pass. Only personal data stops the AI checks, because once data reaches an outside model it can't be taken back.

The tool flags problems. It never rewrites or approves copy.

## Changing a rule

The rules live in `rules.yaml`, and the rule pages below are generated from it, so the guide and the tool always agree. To change a rule: edit `rules.yaml`, add or update a sample in `test-set.yaml`, then regenerate this guide. Don't edit the rule pages by hand.
