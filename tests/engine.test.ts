import { describe, expect, it } from "vitest";
import { checkCopy, flaggedRuleIds, OverrideError, type Report } from "../src/engine";
import { loadRules } from "../src/engine/load";

const rules = loadRules();
const statusOf = (report: Report, ruleId: string) => report.runs.find((run) => run.ruleId === ruleId)?.status;

describe("rules that must run, not just stay quiet (decisions.md D16)", () => {
  it("checks compliant rate copy and passes it (T05)", () => {
    const report = checkCopy("Earn 2.5% p.a. interest on your Tembusu Growth Account. T&Cs apply.", rules, {
      context: "rate-card",
    });
    expect(statusOf(report, "DC-001")).toBe("passed");
  });

  it("accepts 'T&Cs Apply' with a capital A (T34)", () => {
    const report = checkCopy("Earn 1.8% p.a. interest on your Tembusu Everyday Account. T&Cs Apply.", rules);
    expect(statusOf(report, "DC-001")).toBe("passed");
  });

  it("checks an investment promo that has its warning (T21)", () => {
    const report = checkCopy(
      "Start investing in the Tembusu Global Equity Fund from S$100 a month. Investments involve risk.",
      rules,
      { context: "promo-banner" },
    );
    expect(statusOf(report, "DC-002")).toBe("passed");
  });

  it("skips DC-002 on buttons, and says why (T22)", () => {
    const run = checkCopy("Invest now", rules, { context: "button" }).runs.find((r) => r.ruleId === "DC-002");
    expect(run?.status).toBe("not-applicable");
    expect(run?.reason).toContain("button");
  });

  it("runs DC-002 when no context is given (decisions.md D11)", () => {
    expect(flaggedRuleIds(checkCopy("Invest from S$100.", rules))).toContain("DC-002");
  });
});

describe("guard", () => {
  const withPhone = "For overseas enquiries, call +65 6123 4567.";

  it("blocks the AI layer when personal data is found", () => {
    const report = checkCopy(withPhone, rules);
    expect(report.aiAllowed).toBe(false);
    expect(report.guard.open).toBe(1);
    expect(report.runs.filter((run) => run.layer === "ai").every((run) => run.status === "ai-blocked")).toBe(true);
  });

  it("lets a reviewer override a guard finding with a reason", () => {
    const report = checkCopy(withPhone, rules, { overrides: { "PD-002": "Published overseas line" } });
    expect(report.aiAllowed).toBe(true);
    expect(report.guard).toEqual({ open: 0, overridden: 1 });
    expect(report.findings[0].override).toEqual({ reason: "Published overseas line" });
    expect(flaggedRuleIds(report)).toEqual([]);
  });

  it("refuses an override without a reason", () => {
    expect(() => checkCopy(withPhone, rules, { overrides: { "PD-002": "  " } })).toThrow(OverrideError);
  });

  it("refuses to override a rule outside the guard", () => {
    expect(() => checkCopy("Act now!", rules, { overrides: { "BP-002": "It's fine" } })).toThrow(OverrideError);
  });

  it("warns about an override that wasn't needed", () => {
    const report = checkCopy("Log in", rules, { overrides: { "PD-002": "Just in case" } });
    expect(report.warnings).toHaveLength(1);
  });

  it("allows only the exact published email address", () => {
    expect(flaggedRuleIds(checkCopy("Email help@tembusu.example.", rules))).toEqual([]);
    expect(flaggedRuleIds(checkCopy("Email xhelp@tembusu.example.", rules))).toEqual(["PD-003"]);
  });

  it("ignores long numbers that fail the card checksum", () => {
    expect(flaggedRuleIds(checkCopy("Ref 4111 1111 1111 1112", rules))).toEqual([]);
  });
});

describe("findings", () => {
  it("reports one finding when two phrases match the same words (decisions.md D10)", () => {
    const report = checkCopy("A risk-free plan.", rules);
    const bp001 = report.findings.filter((finding) => finding.ruleId === "BP-001");
    expect(bp001).toHaveLength(1);
    expect(bp001[0].match?.text).toBe("risk-free");
  });

  it("points at the writer's own words, curly apostrophe included", () => {
    const report = checkCopy("With Tembusu, you can’t lose.", rules);
    expect(report.findings[0].match?.text).toBe("can’t lose");
  });

  it("puts blockers first", () => {
    const report = checkCopy("Login to get guaranteed returns.", rules);
    expect(report.findings.map((finding) => finding.severity)).toEqual(["blocker", "suggestion"]);
  });

  it("gives the preferred wording for terminology", () => {
    const report = checkCopy("Open a Tembusu growth account.", rules);
    expect(report.findings[0].detail).toBe('Write "Tembusu Growth Account"');
  });

  it("finds product names across a line break", () => {
    expect(flaggedRuleIds(checkCopy("Open a Tembusu\ngrowth account.", rules))).toEqual(["TM-002"]);
    expect(flaggedRuleIds(checkCopy("Open a Tembusu\nGrowth Account.", rules))).toEqual([]);
  });
});

describe("every rule's own examples", () => {
  const codeRules = rules.rules.filter((rule) => rule.layer !== "ai");

  it.each(codeRules.map((rule) => [rule.id, rule] as const))("%s: bad example triggers only this rule", (_, rule) => {
    expect(flaggedRuleIds(checkCopy(rule.examples.bad, rules))).toEqual([rule.id]);
  });

  it.each(rules.rules.map((rule) => [rule.id, rule] as const))("%s: good example is clean", (_, rule) => {
    expect(flaggedRuleIds(checkCopy(rule.examples.good, rules))).toEqual([]);
  });
});
