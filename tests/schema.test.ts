// The rules file is edited by hand, so the loader must reject mistakes
// loudly instead of skipping a rule.

import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { RulesFile } from "../src/engine/schema";

const original = load(readFileSync(path.join(process.cwd(), "content/rules.yaml"), "utf8")) as {
  rules: Record<string, unknown>[];
};

/** A copy of the real rules file with one rule changed. */
function withRule(id: string, change: (rule: Record<string, unknown>) => void) {
  const copy = structuredClone(original);
  const rule = copy.rules.find((r) => r.id === id);
  if (!rule) throw new Error(`No rule ${id}`);
  change(rule);
  return copy;
}

const errorsFor = (data: unknown) => {
  const result = RulesFile.safeParse(data);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("rules.yaml validation", () => {
  it("accepts the real file", () => {
    expect(errorsFor(original)).toEqual([]);
  });

  it("rejects a misspelled severity", () => {
    expect(errorsFor(withRule("BP-002", (r) => (r.severity = "needs fix")))).not.toEqual([]);
  });

  it("rejects a missing 'why'", () => {
    expect(errorsFor(withRule("FM-001", (r) => delete r.why)).length).toBeGreaterThan(0);
  });

  it("rejects a misspelled field instead of ignoring it", () => {
    expect(errorsFor(withRule("FM-001", (r) => (r.contxts = ["button"]))).length).toBeGreaterThan(0);
  });

  it("rejects a broken regular expression", () => {
    const errors = errorsFor(withRule("FM-001", (r) => ((r.check as Record<string, unknown>).pattern = "(\\$")));
    expect(errors.join(" ")).toContain("Not a valid regular expression");
  });

  it("rejects a guard rule that isn't a blocker (decisions.md D9)", () => {
    const errors = errorsFor(withRule("PD-005", (r) => (r.severity = "suggestion")));
    expect(errors.join(" ")).toContain("Guard rules must be `blocker`");
  });

  it("rejects an AI rule without the AI- prefix", () => {
    expect(errorsFor(withRule("AI-003", (r) => (r.id = "PL-002"))).join(" ")).toContain("AI- prefix");
  });

  it("rejects duplicate rule IDs", () => {
    expect(errorsFor(withRule("TM-002", (r) => (r.id = "TM-001"))).join(" ")).toContain("Duplicate rule ID");
  });

  it("rejects an unknown context", () => {
    expect(errorsFor(withRule("DC-002", (r) => (r.contexts = ["banner"]))).length).toBeGreaterThan(0);
  });
});
