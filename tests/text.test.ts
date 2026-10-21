import { describe, expect, it } from "vitest";
import { countWords, normaliseForPhrases, passesLuhn, splitSentences } from "../src/engine/text";

describe("normaliseForPhrases", () => {
  it("straightens quotes, turns hyphens into spaces and lower-cases", () => {
    expect(normaliseForPhrases("Can’t lose Zero-Risk")).toBe("can't lose zero risk");
  });

  it("never changes the length, so positions still match the original", () => {
    for (const text of ["“Quoted” — text", "Risk‑free", "ÀÉÎ can’t", "emoji 🙂 here"]) {
      expect(normaliseForPhrases(text)).toHaveLength(text.length);
    }
  });
});

describe("passesLuhn", () => {
  it("accepts a valid test card number", () => expect(passesLuhn("4111 1111 1111 1111")).toBe(true));
  it("rejects a near miss", () => expect(passesLuhn("4111 1111 1111 1112")).toBe(false));
});

describe("splitSentences", () => {
  const texts = (input: string) => splitSentences(input).map((sentence) => sentence.text);

  it("splits on full stops, question marks and exclamation marks", () => {
    expect(texts("One. Two? Three!")).toEqual(["One.", "Two?", "Three!"]);
  });

  it("keeps 'p.a.' inside a sentence when a lower-case word follows", () => {
    expect(texts("Earn 2.5% p.a. interest today. T&Cs apply.")).toEqual([
      "Earn 2.5% p.a. interest today.",
      "T&Cs apply.",
    ]);
  });

  it("ends the sentence at 'p.a.' when a capital follows", () => {
    expect(texts("Earn 2.5% p.a. T&Cs apply.")).toEqual(["Earn 2.5% p.a.", "T&Cs apply."]);
  });

  it("doesn't split decimals, amounts, domains or times", () => {
    expect(texts("Pay S$1,000.00 to help@tembusu.example by 3.30pm today.")).toHaveLength(1);
  });

  it("keeps text with no full stop as one sentence", () => {
    expect(texts("Invest now")).toEqual(["Invest now"]);
  });
});

describe("countWords", () => {
  it("ignores punctuation on its own", () => expect(countWords("Hello — there , friend")).toBe(3));
});
