import { describe, expect, it } from "vitest";
import { diffWords } from "./wordDiff.js";

function textOfType(segments, type) {
  return segments.filter((segment) => segment.type === type).map((segment) => segment.text.trim()).filter(Boolean).join(" ");
}

function unchangedText(segments) {
  return textOfType(segments, "unchanged");
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

  it("reports both sides of a substituted phrase", () => {
    const segments = diffWords(
      "serious negative consequences for the internal market and the real economy",
      "serious negative consequences for the financial system and the real economy"
    );
    expect(textOfType(segments, "removed")).toBe("internal market");
    expect(textOfType(segments, "added")).toBe("financial system");
    expect(unchangedText(segments)).toContain("serious negative consequences for the");
    expect(unchangedText(segments)).toContain("and the real economy");
  });

  it("surfaces case and punctuation changes that create distinct backend wordings", () => {
    const segments = diffWords(
      "the stability of or confidence in the financial system;",
      "The stability of or confidence in the financial system."
    );
    expect(textOfType(segments, "removed")).toBe("the system;");
    expect(textOfType(segments, "added")).toBe("The system.");
  });

  it("treats inserted words as changed", () => {
    const segments = diffWords(
      "a risk of disruption in the financial system",
      "a serious risk of disruption in the financial system"
    );
    expect(textOfType(segments, "removed")).toBe("");
    expect(textOfType(segments, "added")).toBe("serious");
  });

  it("surfaces words removed from the reference", () => {
    const segments = diffWords("a serious risk", "a risk");
    expect(textOfType(segments, "removed")).toBe("serious");
    expect(textOfType(segments, "added")).toBe("");
    expect(unchangedText(segments)).toBe("a risk");
  });

  it("treats every word as added against an empty base", () => {
    const segments = diffWords("", "the risk of a participant");
    expect(textOfType(segments, "added")).toBe("the risk of a participant");
  });

  it("merges adjacent additions into one segment", () => {
    const segments = diffWords(
      "consequences for the internal market",
      "consequences for the real economy"
    );
    const added = segments.filter((segment) => segment.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe("real economy");
  });

  it("treats canonical Unicode quotes and dashes as equivalent", () => {
    const segments = diffWords("data‑sharing users’ rights", "data-sharing users' rights");
    expect(segments.some((segment) => segment.changed)).toBe(false);
  });

  it("keeps identical long definitions unchanged and uses an honest coarse fallback for changed ones", () => {
    const longText = Array.from({ length: 401 }, (_, index) => `word${index}`).join(" ");
    expect(diffWords(longText, longText)).toEqual([
      { text: longText, type: "unchanged", changed: false },
    ]);

    const changed = diffWords(longText, `${longText} extra`);
    expect(changed.map((segment) => segment.type)).toEqual(["removed", "added"]);
  });
});
