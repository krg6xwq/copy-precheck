import { afterEach, describe, expect, it } from "vitest";
import { checkCopy, CONTEXTS } from "../src/engine";
import { loadRules } from "../src/engine/load";
import { allowAiCheck, resetRateLimit } from "../src/app/rate-limit";
import { segmentCopy } from "../src/lib/highlight";
import { CONTEXT_LABELS } from "../src/lib/labels";
import { reportToMarkdown } from "../src/lib/markdown";

const rules = loadRules();
const T01 = "Grow your money with guaranteed returns of 3.2% interest. Act now!";

describe("segmentCopy", () => {
  it("rebuilds the exact copy from its pieces", () => {
    const report = checkCopy(T01, rules);
    expect(segmentCopy(T01, report.findings).map((segment) => segment.text).join("")).toBe(T01);
  });

  it("highlights flagged words with the most serious severity covering them", () => {
    const report = checkCopy(T01, rules);
    const flagged = segmentCopy(T01, report.findings).filter((segment) => segment.findings.length);
    expect(flagged.find((segment) => segment.text === "guaranteed returns")?.severity).toBe("blocker");
    expect(flagged.find((segment) => segment.text === "Act now")?.severity).toBe("needs-fix");
  });

  it("draws a long sentence as underline only, so flagged words inside it stand out", () => {
    const text =
      "To make sure your first monthly contribution is processed on time, please login to the Tembusu app and set up a GIRO arrangement before 05/11/2026, otherwise your application will be cancelled.";
    const report = checkCopy(text, rules);
    const segments = segmentCopy(text, report.findings);
    const login = segments.find((segment) => segment.text === "login to")!;
    expect(login.findings.map((finding) => finding.ruleId)).toEqual(["PL-001", "TM-001"]);
    expect(login.wide).toBeUndefined();
    expect(segments[0].findings.map((finding) => finding.ruleId)).toEqual(["PL-001"]);
    expect(segments[0].wide).toBe(true);
  });

  it("handles copy with nothing flagged", () => {
    expect(segmentCopy("Log in", [])).toEqual([{ text: "Log in", start: 0, findings: [] }]);
  });
});

describe("reportToMarkdown", () => {
  it("includes the copy, each finding with its decision, and overrides", () => {
    const text = "Call +65 6123 4567. Act now!";
    const report = checkCopy(text, rules, {
      overrides: [{ ruleId: "PD-002", match: "+65 6123 4567", reason: "Published overseas line" }],
    });
    const bp002 = report.findings.find((finding) => finding.ruleId === "BP-002")!;
    const markdown = reportToMarkdown(
      report,
      { [`BP-002:${bp002.match!.start}:${bp002.match!.end}`]: "accepted" },
      new Date("2026-10-22T08:00:00Z"),
    );
    expect(markdown).toContain("> Call +65 6123 4567. Act now!");
    expect(markdown).toContain("**BP-002 Scam-like urgency** (Rule check) — “Act now”");
    expect(markdown).toContain("Decision: Accepted");
    expect(markdown).toContain("## Overridden personal-data matches (1)");
    expect(markdown).toContain("Overridden: Published overseas line");
    expect(markdown).toContain("Checked: 2026-10-22 08:00 UTC");
  });

  it("escapes characters that would break the Markdown", () => {
    const markdown = reportToMarkdown(checkCopy("Use *bold* | pipes", rules), {}, new Date());
    expect(markdown).toContain("> Use \\*bold\\* \\| pipes");
  });
});

describe("labels", () => {
  it("has a label for every context", () => {
    expect(Object.keys(CONTEXT_LABELS).sort()).toEqual([...CONTEXTS].sort());
  });
});

describe("AI rate limit", () => {
  afterEach(resetRateLimit);

  it("allows a visitor up to the limit, then pauses them", () => {
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) expect(allowAiCheck("a", now)).toBe(true);
    expect(allowAiCheck("a", now)).toBe(false);
    expect(allowAiCheck("b", now)).toBe(true);
  });

  it("lets a visitor check again once the window has passed", () => {
    for (let i = 0; i < 30; i++) allowAiCheck("a", 0);
    expect(allowAiCheck("a", 11 * 60 * 1000)).toBe(true);
  });
});
