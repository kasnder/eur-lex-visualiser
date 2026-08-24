import { describe, expect, it } from "vitest";
import { diffWords } from "./wordDiff.js";

function changedText(segments) {
  return segments.filter((segment) => segment.changed).map((segment) => segment.text.trim()).join(" ");
}

function unchangedText(segments) {
  return segments.filter((segment) => !segment.changed).map((segment) => segment.text.trim()).join(" ");
}

describe("diffWords", () => {
  it("marks nothing changed for identical texts", () => {
    const segments = diffWords(
      "a risk of disruption in the financial system",
      "a risk of disruption in the financial system"
    );
    expect(segments.some((segment) => segment.changed)).toBe(false);
    expect(unchangedText(segments)).toBe("a risk of disruption in the financial system");
  });

  it("flags only the words that differ", () => {
    const segments = diffWords(
      "serious negative consequences for the internal market and the real economy",
      "serious negative consequences for the financial system and the real economy"
    );
    expect(changedText(segments)).toBe("financial system");
    expect(unchangedText(segments)).toContain("serious negative consequences for the");
    expect(unchangedText(segments)).toContain("and the real economy");
  });

  it("ignores case and trailing punctuation when matching words", () => {
    const segments = diffWords(
      "the stability of or confidence in the financial system;",
      "The stability of or confidence in the financial system."
    );
    expect(segments.some((segment) => segment.changed)).toBe(false);
  });

  it("treats inserted words as changed", () => {
    const segments = diffWords(
      "a risk of disruption in the financial system",
      "a serious risk of disruption in the financial system"
    );
    expect(changedText(segments)).toBe("serious");
  });

  it("treats every word as changed against an empty base", () => {
    const segments = diffWords("", "the risk of a participant");
    expect(changedText(segments)).toBe("the risk of a participant");
  });

  it("merges adjacent changed words into one segment", () => {
    const segments = diffWords(
      "consequences for the internal market",
      "consequences for the real economy"
    );
    const changed = segments.filter((segment) => segment.changed);
    expect(changed).toHaveLength(1);
    expect(changed[0].text).toBe("real economy");
  });

  it("never marks whitespace as changed", () => {
    const segments = diffWords("alpha beta", "alpha gamma delta");
    for (const segment of segments) {
      if (!/\S/.test(segment.text)) expect(segment.changed).toBe(false);
    }
  });
});
