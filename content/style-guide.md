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

1. **Personal data.** If the copy contains anything that looks like personal data, it stops here until that's replaced with a placeholder. A reviewer can override a wrong match, with a written reason.
2. **Rules checked by code.** Fixed rules such as banned phrases, currency format and required disclosures. The same copy always gets the same result.
3. **Rules checked by AI.** Judgment calls, such as implied promises or jargon. These are always suggestions for a person to accept or dismiss.

Every finding has a severity:

- **Blocker:** must be fixed before compliance review.
- **Needs fix:** fix before review unless there's a good reason not to.
- **Suggestion:** the reviewer decides.

The tool flags problems. It never rewrites or approves copy.

## Changing a rule

The rules live in `rules.yaml`, and the rule pages below are generated from it, so the guide and the tool always agree. To change a rule: edit `rules.yaml`, add or update a sample in `test-set.yaml`, then regenerate this guide. Don't edit the rule pages by hand.

---

*The sections below are generated from `rules.yaml` (version 0.4). Edit that file, not this page.*

## All rules at a glance

| ID | Rule | Severity | Checked by |
|---|---|---|---|
| PD-001 | [NRIC or FIN number](#pd-001-nric-or-fin-number) | Blocker | Code, before anything is sent to AI |
| PD-002 | [Singapore phone number](#pd-002-singapore-phone-number) | Blocker | Code, before anything is sent to AI |
| PD-003 | [Personal email address](#pd-003-personal-email-address) | Blocker | Code, before anything is sent to AI |
| PD-004 | [Card number](#pd-004-card-number) | Blocker | Code, before anything is sent to AI |
| PD-005 | [Bank account number](#pd-005-bank-account-number) | Blocker | Code, before anything is sent to AI |
| BP-001 | [Promised returns or no risk](#bp-001-promised-returns-or-no-risk) | Blocker | Code |
| BP-002 | [Scam-like urgency](#bp-002-scam-like-urgency) | Needs fix | Code |
| AI-001 | [Implied promise](#ai-001-implied-promise) | Suggestion | AI (always a suggestion) |
| DC-001 | [Interest rate disclosure](#dc-001-interest-rate-disclosure) | Needs fix | Code |
| DC-002 | [Investment risk warning](#dc-002-investment-risk-warning) | Needs fix | Code |
| TM-001 | [Preferred wording](#tm-001-preferred-wording) | Suggestion | Code |
| TM-002 | [Product names](#tm-002-product-names) | Needs fix | Code |
| FM-001 | [Currency must be S$](#fm-001-currency-must-be-s) | Needs fix | Code |
| FM-002 | [Unambiguous dates](#fm-002-unambiguous-dates) | Suggestion | Code |
| PL-001 | [Long sentence](#pl-001-long-sentence) | Suggestion | Code |
| AI-002 | [Error message blames or alarms](#ai-002-error-message-blames-or-alarms) | Suggestion | AI (always a suggestion) |
| AI-003 | [Unexplained acronym](#ai-003-unexplained-acronym) | Suggestion | AI (always a suggestion) |
| AI-004 | [Jargon](#ai-004-jargon) | Suggestion | AI (always a suggestion) |

## Personal data

Never put real customer or staff details in copy, mock-ups or test data.

### NRIC or FIN number <a id="pd-001-nric-or-fin-number"></a>

`PD-001` · **Blocker** · Checked by: Code, before anything is sent to AI

Identity numbers must never appear in design files, test copy or AI prompts, even as examples. Real-looking numbers get copied into screenshots and tools.

**What to do:** Replace with the placeholder {nric}.

| | Example |
|---|---|
| Don't | Your NRIC S1234567D has been verified. |
| Do | Your NRIC {nric} has been verified. |

### Singapore phone number <a id="pd-002-singapore-phone-number"></a>

`PD-002` · **Blocker** · Checked by: Code, before anything is sent to AI

Mobile and landline numbers can identify a person. Banks also publish landline hotlines (6xxx xxxx, or +65 for overseas callers), but the guard can't tell a bank's number from a personal one by its pattern, and it doesn't judge from wording like "contact us at". So every number is flagged except 1800 numbers (which don't match) and those in `allow`.

**What to do:** Replace a personal number with {phone}. For the bank's own number, use {hotline}, so it is filled in from one central setting.

| | Example |
|---|---|
| Don't | We'll SMS you at +65 9123 4567. |
| Do | We'll SMS you at {phone}. |

### Personal email address <a id="pd-003-personal-email-address"></a>

`PD-003` · **Blocker** · Checked by: Code, before anything is sent to AI

Email addresses identify a person. That includes staff addresses at the bank's own domain, such as a relationship manager's.

**What to do:** Replace with {email}. Only the bank's published addresses (listed in `allow`) can stay.

**Allowed:** `help@tembusu.example`.

| | Example |
|---|---|
| Don't | Receipt sent to jane.tan@example.com. |
| Do | Receipt sent to {email}. |

### Card number <a id="pd-004-card-number"></a>

`PD-004` · **Blocker** · Checked by: Code, before anything is sent to AI

Full card numbers are among the most sensitive data a bank holds. The checksum test cuts false alarms from other long numbers.

**What to do:** Replace with {card}, or show only the last 4 digits.

| | Example |
|---|---|
| Don't | Card 4111 1111 1111 1111 is blocked. |
| Do | Card ending {card_last4} is blocked. |

### Bank account number <a id="pd-005-bank-account-number"></a>

`PD-005` · **Blocker** · Checked by: Code, before anything is sent to AI

An account number identifies a customer and is needed to move money, so it must never reach design files or AI prompts. Matching only the bank's own format keeps false alarms low; the other guard rules and the reviewer override cover the rest.

**What to do:** Replace with {account}.

| | Example |
|---|---|
| Don't | S$500 has been sent to account 123-456789-001. |
| Do | S$500 has been sent to account {account}. |

## Promises and pressure

Don't promise outcomes, deny risk, or rush customers.

### Promised returns or no risk <a id="bp-001-promised-returns-or-no-risk"></a>

`BP-001` · **Blocker** · Checked by: Code

Copy must never promise investment outcomes or deny risk. This is one of the most common reasons copy is sent back by compliance.

**What to do:** Describe what the product does and point to the risks and terms.

**Flagged phrases:** `guaranteed returns`, `guaranteed profit`, `guaranteed income`, `risk-free`, `risk free`, `no risk`, `zero risk`, `0 risk`, `can't lose`, `cant lose`, `cannot lose`. Spelling variants such as curly apostrophes and hyphens are caught too.

| | Example |
|---|---|
| Don't | Enjoy guaranteed returns with zero risk. |
| Do | Earn returns that may go up or down. Investments involve risk. |

### Scam-like urgency <a id="bp-002-scam-like-urgency"></a>

`BP-002` · **Needs fix** · Checked by: Code

These phrases mirror common phishing messages. Customers are taught to distrust them, so genuine bank copy should never sound like a scam.

**What to do:** State the facts calmly and tell customers where to check in the app.

**Flagged phrases:** `act now`, `urgent action required`, `your account will be suspended`, `last chance`, `click the link below`, `verify your account immediately`. Spelling variants such as curly apostrophes and hyphens are caught too.

| | Example |
|---|---|
| Don't | Urgent action required: click the link below. |
| Do | Please review your account details in the Tembusu app. |

### Implied promise <a id="ai-001-implied-promise"></a>

`AI-001` · **Suggestion** · Checked by: AI (always a suggestion)

The phrase list can't catch every way of implying a promise.

**What to do:** State what the product does, not what the customer is sure to get.

| | Example |
|---|---|
| Don't | Watch your savings grow without lifting a finger. |
| Do | Set up a monthly transfer to your savings account. |

## Disclosures

Some claims always need extra information next to them.

### Interest rate disclosure <a id="dc-001-interest-rate-disclosure"></a>

`DC-001` · **Needs fix** · Checked by: Code

An interest rate without "p.a." and a pointer to the terms can mislead customers about what they will actually earn.

**What to do:** Add "p.a." after the rate and "T&Cs apply" (or a link to terms).

| | Example |
|---|---|
| Don't | Earn 2.5% interest on your savings. |
| Do | Earn 2.5% p.a. interest on your savings. T&Cs apply. |

### Investment risk warning <a id="dc-002-investment-risk-warning"></a>

`DC-002` · **Needs fix** · Checked by: Code · Applies to: promo banners, rate cards, emails, notifications

Copy that promotes an investment without saying its value can fall leaves customers expecting only gains. A short warning next to the offer is the minimum.

**What to do:** Add a short risk warning in the same message, e.g. "Investments involve risk. The value may go down as well as up."

| | Example |
|---|---|
| Don't | Invest in the Tembusu Global Equity Fund from S$100 a month. |
| Do | Invest in the Tembusu Global Equity Fund from S$100 a month. Investments involve risk. |

## Wording and product names

Use the same words every time, and product names exactly as listed.

### Preferred wording <a id="tm-001-preferred-wording"></a>

`TM-001` · **Suggestion** · Checked by: Code

Consistent wording makes the product feel trustworthy and predictable.

**What to do:** Use the preferred wording.

| Instead of | Write |
|---|---|
| login to | log in to |
| log-in | log in |
| PIN number | PIN |
| e-mail | email |

| | Example |
|---|---|
| Don't | Login to view your PIN number. |
| Do | Log in to view your PIN. |

### Product names <a id="tm-002-product-names"></a>

`TM-002` · **Needs fix** · Checked by: Code

Product names appear in terms, statements and adverts. Copy that changes their casing looks careless, and customers may not be sure it refers to the same product.

**What to do:** Use the product's official name exactly as listed.

**Official names:** Tembusu Growth Account, Tembusu Everyday Account, Tembusu Rewards Card, Tembusu Global Equity Fund.

| | Example |
|---|---|
| Don't | Open a Tembusu growth account today. |
| Do | Open a Tembusu Growth Account today. |

## Money and dates

Write amounts and dates so there's only one way to read them.

### Currency must be S$ <a id="fm-001-currency-must-be-s"></a>

`FM-001` · **Needs fix** · Checked by: Code

A bare $ is ambiguous for customers who also hold foreign-currency accounts. US$ and other prefixed amounts are not flagged.

**What to do:** Write Singapore dollars as S$, e.g. S$1,000.00.

| | Example |
|---|---|
| Don't | Transfer $500 now. |
| Do | Transfer S$500 now. |

### Unambiguous dates <a id="fm-002-unambiguous-dates"></a>

`FM-002` · **Suggestion** · Checked by: Code

05/11/2026 reads as May or November depending on the reader.

**What to do:** Write the month as a word, e.g. 5 Nov 2026.

| | Example |
|---|---|
| Don't | Payment due 05/11/2026. |
| Do | Payment due 5 Nov 2026. |

## Plain language

Short sentences, everyday words, and a clear next step.

### Long sentence <a id="pl-001-long-sentence"></a>

`PL-001` · **Suggestion** · Checked by: Code

Banking copy is often read under stress or by older customers. Long sentences hide the one thing they need to know.

**What to do:** Split it, and lead with what the customer needs to do.

**Limit:** 25 words per sentence.

| | Example |
|---|---|
| Don't | To make sure that your transfer is processed on the same day, please submit your instructions before 3pm on a business day, otherwise it will be processed the next business day. |
| Do | Submit before 3pm on a business day for same-day transfers. Later transfers go out the next business day. |

### Error message blames or alarms <a id="ai-002-error-message-blames-or-alarms"></a>

`AI-002` · **Suggestion** · Checked by: AI (always a suggestion)

Customers who feel blamed or panicked make mistakes or call the hotline. Calm, specific copy gets them back on track.

**What to do:** Say what happened neutrally, then what to do next.

| | Example |
|---|---|
| Don't | You entered the wrong OTP. Your account may be locked. |
| Do | That code didn't match. Check your latest SMS and try again. |

### Unexplained acronym <a id="ai-003-unexplained-acronym"></a>

`AI-003` · **Suggestion** · Checked by: AI (always a suggestion)

Banks use internal shorthand that customers never learned. An unfamiliar acronym makes customers unsure what will happen, so they hesitate, guess, or call the hotline.

**What to do:** Use plain words, or spell the acronym out the first time.

| | Example |
|---|---|
| Don't | Your SOA for October is ready. |
| Do | Your October statement is ready. |

### Jargon <a id="ai-004-jargon"></a>

`AI-004` · **Suggestion** · Checked by: AI (always a suggestion)

Many customers read banking copy under stress or in a second language. Everyday words get them to the right action faster than precise industry terms.

**What to do:** Swap the term for everyday words, keeping the meaning exact.

| | Example |
|---|---|
| Don't | Your remittance will be credited on the value date. |
| Do | The money will reach the account on {date}. |

## Placeholders

Placeholders are filled in by the product when the screen is shown. Use them instead of real or hard-coded details. Each is listed with the rules that mention it.

| Placeholder | Used in |
|---|---|
| `{nric}` | PD-001 |
| `{phone}` | PD-002 |
| `{hotline}` | PD-002 |
| `{email}` | PD-003 |
| `{card}` | PD-004 |
| `{card_last4}` | PD-004 |
| `{account}` | PD-005 |
| `{date}` | AI-004 |
