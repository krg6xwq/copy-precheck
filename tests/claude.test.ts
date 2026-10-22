// Configuration of the Claude connection. No network: real-model behaviour is
// measured by the evaluation, not by unit tests.

import { describe, expect, it } from "vitest";
import { claudeFromEnv, DEFAULT_EFFORT, DEFAULT_MODEL } from "../src/models/claude";

describe("claudeFromEnv", () => {
  it("returns nothing without a key, so only the code checks run", () => {
    expect(claudeFromEnv({})).toBeUndefined();
    expect(claudeFromEnv({ ANTHROPIC_API_KEY: "  " })).toBeUndefined();
  });

  it("uses the default model and effort", () => {
    expect(claudeFromEnv({ ANTHROPIC_API_KEY: "test-key" })?.name).toBe(
      `${DEFAULT_MODEL} (effort: ${DEFAULT_EFFORT})`,
    );
  });

  it("lets the model and effort be changed without code changes", () => {
    const model = claudeFromEnv({ ANTHROPIC_API_KEY: "test-key", AI_MODEL: "claude-haiku-5-5", AI_EFFORT: "medium" });
    expect(model?.name).toBe("claude-haiku-5-5 (effort: medium)");
  });

  it("rejects an unknown effort level", () => {
    expect(() => claudeFromEnv({ ANTHROPIC_API_KEY: "test-key", AI_EFFORT: "extreme" })).toThrow("AI_EFFORT");
  });

  it("never puts the key in the model's name, which appears in reports", () => {
    expect(claudeFromEnv({ ANTHROPIC_API_KEY: "secret-123" })?.name).not.toContain("secret-123");
  });
});
