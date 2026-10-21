// Schemas for rules.yaml and test-set.yaml.
//
// The rules file is edited by people, so mistakes are expected: a misspelled
// severity, a missing `why`, a broken regex. Every one of those must stop the
// checker with a clear message, never silently skip a rule.

import { z } from "zod";

export const CONTEXTS = [
  "button",
  "error",
  "confirmation",
  "promo-banner",
  "rate-card",
  "help-text",
  "notification",
  "email-snippet",
] as const;

export const CATEGORIES = [
  "personal-data",
  "banned-phrase",
  "terminology",
  "format",
  "disclosure",
  "plain-language",
] as const;

export const LAYERS = ["guard", "rule", "ai"] as const;
export const SEVERITIES = ["blocker", "needs-fix", "suggestion"] as const;

export type Context = (typeof CONTEXTS)[number];
export type Category = (typeof CATEGORIES)[number];
export type Layer = (typeof LAYERS)[number];
export type Severity = (typeof SEVERITIES)[number];

/** Regex flags people may set. `g` is added by the engine itself. */
const flags = z
  .string()
  .regex(/^[imsu]*$/, "Only the flags i, m, s and u are allowed")
  .optional();

/** A string that must compile as a JavaScript regular expression. */
const regex = z.string().min(1).superRefine((source, ctx) => {
  try {
    new RegExp(source, "u");
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: `Not a valid regular expression: ${(error as Error).message}`,
    });
  }
});

const nonEmptyStrings = z.array(z.string().min(1)).min(1);

const PatternCheck = z.strictObject({
  type: z.literal("pattern"),
  pattern: regex,
  flags,
  validator: z.literal("luhn").optional(),
  allow: z.array(z.string().min(1)).nullish(),
});

const PhrasesCheck = z.strictObject({
  type: z.literal("phrases"),
  phrases: nonEmptyStrings,
});

const ReplaceCheck = z.strictObject({
  type: z.literal("replace"),
  replace: z
    .record(z.string().min(1), z.string().min(1))
    .refine((map) => Object.keys(map).length > 0, "Needs at least one entry"),
});

const NamesCheck = z.strictObject({
  type: z.literal("names"),
  names: nonEmptyStrings,
});

const ConditionalCheck = z.strictObject({
  type: z.literal("conditional"),
  when: regex,
  require: z.array(regex).min(1),
  flags,
});

const MaxWordsCheck = z.strictObject({
  type: z.literal("max-words"),
  limit: z.number().int().positive(),
});

const AiCheck = z.strictObject({
  type: z.literal("ai"),
  guidance: z.string().min(1),
});

export const Check = z.discriminatedUnion("type", [
  PatternCheck,
  PhrasesCheck,
  ReplaceCheck,
  NamesCheck,
  ConditionalCheck,
  MaxWordsCheck,
  AiCheck,
]);

export const Rule = z
  .strictObject({
    id: z.string().regex(/^[A-Z]{2}-\d{3}$/, "IDs look like PD-001"),
    name: z.string().min(1),
    category: z.enum(CATEGORIES),
    layer: z.enum(LAYERS),
    severity: z.enum(SEVERITIES),
    contexts: z.array(z.enum(CONTEXTS)).min(1).optional(),
    check: Check,
    why: z.string().min(1),
    fix: z.string().min(1),
    examples: z.strictObject({
      bad: z.string().min(1),
      good: z.string().min(1),
    }),
  })
  .superRefine((rule, ctx) => {
    const isAi = rule.layer === "ai";
    if (rule.layer === "guard" && rule.severity !== "blocker") {
      ctx.addIssue({
        code: "custom",
        path: ["severity"],
        message: "Guard rules must be `blocker`: a guard hit always stops the AI step",
      });
    }
    if (rule.layer === "guard" && rule.contexts) {
      ctx.addIssue({
        code: "custom",
        path: ["contexts"],
        message: "Guard rules run in every context, so they can't list `contexts`",
      });
    }
    if (isAi !== (rule.check.type === "ai")) {
      ctx.addIssue({
        code: "custom",
        path: ["check", "type"],
        message: "AI-layer rules use check type `ai`, and only they do",
      });
    }
    if (isAi !== rule.id.startsWith("AI-")) {
      ctx.addIssue({
        code: "custom",
        path: ["id"],
        message: "AI-layer rules use the AI- prefix, and only they do",
      });
    }
    if (isAi && rule.severity !== "suggestion") {
      ctx.addIssue({
        code: "custom",
        path: ["severity"],
        message: "AI findings are always suggestions",
      });
    }
  });

export const RulesFile = z
  .strictObject({
    version: z.union([z.number(), z.string()]).transform(String),
    bank: z.string().min(1),
    rules: z.array(Rule).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.rules.forEach((rule, index) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", index, "id"],
          message: `Duplicate rule ID ${rule.id}`,
        });
      }
      seen.add(rule.id);
    });
  });

export const Sample = z.strictObject({
  id: z.string().regex(/^T\d{2,}$/, "Sample IDs look like T01"),
  context: z.enum(CONTEXTS),
  text: z.string().min(1),
  expect: z.array(z.string()),
  notes: z.string().optional(),
});

export const TestSet = z.strictObject({
  samples: z.array(Sample).min(1),
});

export type Check = z.infer<typeof Check>;
export type Rule = z.infer<typeof Rule>;
export type RulesFile = z.infer<typeof RulesFile>;
export type Sample = z.infer<typeof Sample>;
export type TestSet = z.infer<typeof TestSet>;
