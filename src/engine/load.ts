// Reads and validates the content files. Uses the file system, so it is kept
// apart from the engine itself, which only ever receives parsed rules.

import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { z } from "zod";
import { RulesFile, TestSet, type RulesFile as RulesFileType, type TestSet as TestSetType } from "./schema";

export const CONTENT_DIR = path.join(process.cwd(), "content");

export class ContentError extends Error {
  constructor(file: string, detail: string) {
    super(`${file} is not valid:\n${detail}`);
    this.name = "ContentError";
  }
}

function parse<T>(file: string, schema: z.ZodType<T>): T {
  let data: unknown;
  try {
    data = load(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ContentError(path.basename(file), (error as Error).message);
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ContentError(path.basename(file), z.prettifyError(result.error));
  }
  return result.data;
}

export function loadRules(file = path.join(CONTENT_DIR, "rules.yaml")): RulesFileType {
  return parse(file, RulesFile);
}

/** Loads the test set and checks every expected rule ID exists. */
export function loadTestSet(
  rules: RulesFileType,
  file = path.join(CONTENT_DIR, "test-set.yaml"),
): TestSetType {
  const testSet = parse(file, TestSet);
  const ids = new Set(rules.rules.map((rule) => rule.id));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const sample of testSet.samples) {
    if (seen.has(sample.id)) problems.push(`${sample.id}: duplicate sample ID`);
    seen.add(sample.id);
    for (const id of sample.expect) {
      if (!ids.has(id)) problems.push(`${sample.id}: expects unknown rule ${id}`);
    }
  }
  if (problems.length) {
    throw new ContentError(path.basename(file), problems.map((p) => `✖ ${p}`).join("\n"));
  }
  return testSet;
}
