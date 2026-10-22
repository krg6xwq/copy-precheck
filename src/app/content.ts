// Server-side access to the content files, loaded once per server instance.
// Never import this from a client component: it reads files.

import { loadRules, loadTestSet } from "@/engine/load";
import type { Context, RulesFile } from "@/engine";

export interface Sample {
  id: string;
  context: Context;
  text: string;
}

let cached: { rules: RulesFile; samples: Sample[] } | undefined;

export function getContent() {
  if (!cached) {
    const rules = loadRules();
    const samples = loadTestSet(rules).samples.map(({ id, context, text }) => ({ id, context, text }));
    cached = { rules, samples };
  }
  return cached;
}
