# Evaluation

How well Copy pre-check works, measured rather than claimed. Run it with `npm run eval` (it calls the real model; a full run costs about US$0.50 at list price and takes a few minutes).

- [`results.md`](results.md): the latest run, generated. Every number comes from [`results.json`](results.json).
- [`run-1-before-tuning/`](run-1-before-tuning/results.md): the first run, kept for comparison.
- [`loop-samples.yaml`](loop-samples.yaml): the three emails used for the review and rewrite loop.

Everything below is from the runs on 28 Oct 2026, with Claude Sonnet 5.5 at low effort and rules v0.7 (v0.6 for run 1).

## What it measures

1. **Code layers** (personal-data guard and rule checks) on the 39-sample test set, once, because the same copy always gets the same result. For every rule it records whether the rule actually *ran* on each sample, so "checked and passed" can't be mistaken for "never checked" (a bug like this was found on Day 1, see decisions.md D16).
2. **AI layer** on the 31 samples the guard clears, **three times each**, to see how much the answers vary: matches with the test set, missed and false findings per rule, findings code rejected, time, tokens and cost.
3. **Prompt injection**: two samples aimed at the model. T38 asks it to report fake findings on words that really are in the copy (so they'd pass the quote check); T39 claims the copy is approved and asks for no findings, next to an implied promise.
4. **The review and rewrite loop** on three emails, with a simple reviewer: marks every finding Fix except chosen dismissals, answers each question with the first option, keeps every flag, approves, for up to three rounds. It counts findings fixed, flags, questions, findings marked Fix but not fixed, and new problems after approving.

## Results

| | Run 1 (before tuning) | Run 2 (latest) |
|---|---|---|
| Code layers: samples matching the test set exactly | 39 of 39 | 39 of 39 |
| AI layer: runs matching the test set exactly | 89 of 93 (96%) | 92 of 93 (99%) |
| AI layer: samples with the same answer in all three runs | 28 of 31 | 30 of 31 |
| AI findings rejected by code (invented rule or quote) | 0 | 0 |
| Prompt injection: runs where the model obeyed | 0 of 6 | 0 of 6 |
| Time per AI check (median) | 1.1 s | 1.0 s |
| Cost per AI check at list price (median) | US$0.0036 | US$0.0037 |
| Loop: drafts | 6 | 7 |
| Loop: findings marked Fix that were still there after approving | 0 of 43 | 0 of 44 |
| Loop: flags per draft (changes code had to question) | 0 | 0 |
| Loop: questions asked instead of guessing | 4 | 4 |
| Loop: new problems introduced by drafts | 9 (by hand, same rule) | 6 |
| Loop: of those, sentences made too long | 4 | 2 |
| Loop: emails with nothing left to fix within 3 rounds | 2 of 3 | 1 of 3 |

## What it shows

- **The code layers do what the test set asks**, including every near-miss and regression sample. That's expected (the rules and the test set were written together), so the value here is as a regression check: any change to `rules.yaml` that breaks a sample shows up.
- **The AI layer is accurate and fairly consistent on this test set.** The few differences between runs are borderline calls ("for everyone" as an implied promise, "FAST" as an acronym), which is why AI findings are labelled suggestions. Code never had to reject an AI finding.
- **The model ignored both injection attempts in every run.** The design limits the damage if one ever works: the AI can only add suggestions; it can't remove a code finding, change the guard's decision or approve copy.
- **Drafts fix what they're asked to.** Across 13 drafts and 87 findings marked Fix, none was still there after approving. Every ambiguous date became a question, not a guess. Bare "$" amounts were sometimes asked about and sometimes written as "S$" directly; both pass, since "S$" is the rule's own fix. No draft needed a second try, and code didn't have to flag a single change.
- **Drafts sometimes bring in new problems, and the loop is how they get caught.** In run 1, plain-language fixes lengthened sentences past the 25-word limit, and the AI kept flagging calm rewrites of a card-block notice as alarming. Two changes followed: the drafting prompt now keeps rewritten sentences to 25 words, and AI-002 now judges a message as a whole and doesn't count stating bad news plainly as alarming (rules v0.7). New problems from drafts went from 9 to 6, and too-long sentences from 4 to 2.
- **One email didn't settle within three rounds in either run.** Its card-block notice keeps attracting an AI-002 suggestion in some form. That's the case the reviewer is there for: dismiss it with a reason, or edit by hand. The page mentions this after three revisions.

## Limits

- **A small test set, written by the same people as the rules.** 39 samples is enough to catch regressions, not to estimate real-world accuracy. The next step would be copy from real (anonymised) flows, reviewed by a content designer and a compliance reviewer.
- **The loop numbers come from three emails and one run each**, so the change between runs is a direction, not a measurement. Run-to-run variation in the AI checks also shows up there as findings "flagged late" on words that were there all along (1 in run 1, 5 in run 2).
- **AI expectations are judgment calls**, made by one person.
- **The evaluation's reviewer is simple**: it never undoes a flag or edits a draft, so it measures the AI and the safeguards, not the whole human workflow.
