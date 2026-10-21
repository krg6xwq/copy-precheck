// Every sample in content/test-set.yaml becomes a test of the code rules.
// AI expectations are checked from Day 3, once the AI layer exists.

import { describe, expect, it } from "vitest";
import { checkCopy, flaggedRuleIds } from "../src/engine";
import { loadRules, loadTestSet } from "../src/engine/load";

const rules = loadRules();
const { samples } = loadTestSet(rules);
const aiRuleIds = new Set(rules.rules.filter((rule) => rule.layer === "ai").map((rule) => rule.id));

describe("test set: code rules", () => {
  it.each(samples.map((sample) => [`${sample.id} (${sample.context})`, sample] as const))(
    "%s",
    (_, sample) => {
      const report = checkCopy(sample.text, rules, { context: sample.context });
      const expected = sample.expect.filter((id) => !aiRuleIds.has(id)).sort();
      expect(flaggedRuleIds(report)).toEqual(expected);
    },
  );
});

describe("test set: consistency", () => {
  it("only expects AI findings on copy the guard clears (decisions.md D15)", () => {
    const wrong = samples
      .filter((sample) => sample.expect.some((id) => aiRuleIds.has(id)))
      .filter((sample) => !checkCopy(sample.text, rules, { context: sample.context }).aiAllowed)
      .map((sample) => sample.id);
    expect(wrong).toEqual([]);
  });

  it("has at least one sample that should trigger each rule", () => {
    const expected = new Set(samples.flatMap((sample) => sample.expect));
    const untested = rules.rules.map((rule) => rule.id).filter((id) => !expected.has(id));
    expect(untested).toEqual([]);
  });
});
