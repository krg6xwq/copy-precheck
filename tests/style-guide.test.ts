import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_DIR, loadRules } from "../src/engine/load";
import { renderStyleGuide } from "../src/guide/render";

const rules = loadRules();
const intro = readFileSync(path.join(CONTENT_DIR, "style-guide-intro.md"), "utf8");

describe("style guide", () => {
  it("is up to date with rules.yaml (run `npm run guide` if this fails)", () => {
    const committed = readFileSync(path.join(CONTENT_DIR, "style-guide.md"), "utf8");
    expect(committed).toBe(renderStyleGuide(intro, rules));
  });

  it("has a page for every rule", () => {
    const guide = renderStyleGuide(intro, rules);
    for (const rule of rules.rules) expect(guide).toContain("`" + rule.id + "`");
  });
});
