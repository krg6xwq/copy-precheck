// The server action's own safeguards, which hold even if the page is bypassed.

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Map() }));

const COPY = "Your tembusu growth account earns 3.5% interest.";
const base = { text: COPY, overrides: [], aiFindings: [], decisions: [], step: { kind: "draft" as const } };

describe("drafting rounds", () => {
  beforeAll(() => {
    // No key: a draft request that passes the round check ends at "AI isn't set up", without calling a model.
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("refuses a draft after the 10th revision, even if the page is bypassed", async () => {
    const { reviseAction } = await import("../src/app/actions");
    const result = await reviseAction({ ...base, round: 11 });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("revised this copy 10 times") });
  });

  it("allows the 10th round", async () => {
    const { reviseAction } = await import("../src/app/actions");
    const result = await reviseAction({ ...base, round: 10 });
    expect(result).toEqual({ ok: true, result: { status: "unavailable", reason: "AI isn't set up on this server" } });
  });
});
