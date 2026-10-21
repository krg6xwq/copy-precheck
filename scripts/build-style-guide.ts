// npm run guide — rebuilds content/style-guide.md from rules.yaml and the
// hand-written intro. Run it after any change to either file.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONTENT_DIR, loadRules } from "../src/engine/load";
import { renderStyleGuide } from "../src/guide/render";

const rules = loadRules();
const intro = readFileSync(path.join(CONTENT_DIR, "style-guide-intro.md"), "utf8");
const output = path.join(CONTENT_DIR, "style-guide.md");

writeFileSync(output, renderStyleGuide(intro, rules));
console.log(`Wrote content/style-guide.md (${rules.rules.length} rules, rules.yaml v${rules.version})`);
