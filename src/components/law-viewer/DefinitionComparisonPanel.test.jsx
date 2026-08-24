import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefinitionComparisonPanel } from "./DefinitionComparisonPanel.jsx";

let container;
let root;

const messages = {
  "definitionComparison.article": "Article {article}",
  "definitionComparison.point": "point {point}",
  "definitionComparison.current": "Current",
  "definitionComparison.sameWording": "Same wording",
  "definitionComparison.differentWording": "Different wording",
  "definitionComparison.referenceWording": "Reference wording",
  "definitionComparison.wordingChip": "Wording {letter}",
  "definitionComparison.importsChip": "Imports · {count}",
  "definitionComparison.sameWordingAlso": "Identical wording · also in {count} other {lawWord}",
  "definitionComparison.hideOtherLaws": "Hide other laws",
  "definitionComparison.selectedSource": "Selected source",
  "definitionComparison.definitionsInActs": "Definitions in these acts",
  "definitionComparison.importedByReference": "Imported by reference",
  "definitionComparison.imported": "Imported",
  "definitionComparison.otherExtracted": "Other extracted definitions",
  "definitionComparison.unclassified": "Needs review",
  "definitionComparison.importsFrom": "Imports from {source}",
  "definitionComparison.alsoReferences": "Also references {source}",
  "definitionComparison.import": "import",
  "definitionComparison.imports": "imports",
  "definitionComparison.openSource": "Open source",
  "definitionComparison.summary": "{laws} {lawWord} · {wordings} {wordingWord}",
  "definitionComparison.provenanceSummary": "{laws} {lawWord} · {wordings} {wordingWord} · {imports} {importWord}",
  "definitionComparison.empty": "Empty",
  "common.close": "Close",
  "search.law": "law",
  "search.laws": "laws",
  "search.wording": "wording",
  "search.wordings": "wordings",
};

function t(key, vars = {}) {
  return String(messages[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

function cardTitles() {
  return [...container.querySelectorAll(".truncate.text-xs")].map((node) => node.textContent);
}

function findToggle() {
  return [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Identical wording"));
}

function openSourceButtons() {
  return [...container.querySelectorAll("button")].filter((button) => button.textContent.includes("Open source"));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe("DefinitionComparisonPanel", () => {
  it("puts the current law first, collapses identical wordings, and expands them on demand", () => {
    const onOpenSource = vi.fn();
    act(() => {
      root.render(
        <DefinitionComparisonPanel
          term="risk"
          currentCelex="32022L2555"
          comparison={{
            term: "risk",
            lawCount: 2,
            wordingCount: 1,
            occurrences: [
              { celex: "32022L2557", sourceArticle: "3", definition: "the potential for loss", definitionHash: "same", law: { title: "CER Directive" } },
              { celex: "32022L2555", sourceArticle: "6", definition: "the potential for loss", definitionHash: "same", law: { title: "NIS 2 Directive" } },
            ],
          }}
          onOpenSource={onOpenSource}
          onClose={() => {}}
          t={t}
        />
      );
    });

    expect(container.textContent).toContain("2 laws · 1 wording");
    expect(cardTitles()).toEqual(["NIS 2 Directive"]);
    expect(container.textContent).toContain("Current");
    expect(findToggle().textContent).toContain("Identical wording · also in 1 other law");
    // A single wording with no imports needs no chips.
    expect(container.textContent).not.toContain("Wording A");

    act(() => findToggle().click());
    expect(cardTitles()).toEqual(["NIS 2 Directive", "CER Directive"]);
    expect(container.textContent).toContain("Same wording");

    const sourceButtons = openSourceButtons();
    act(() => sourceButtons[sourceButtons.length - 1].click());
    expect(onOpenSource).toHaveBeenCalledWith("32022L2557", "3", null);
  });

  it("separates imported definitions and identifies the selected source", () => {
    act(() => {
      root.render(
        <DefinitionComparisonPanel
          term="controller"
          currentCelex="32016R0679"
          selectedSource="32022R2065:3"
          comparison={{
            term: "controller",
            substantiveLawCount: 1,
            wordingCount: 1,
            importCount: 1,
            occurrences: [
              {
                occurrenceId: "authority",
                celex: "32016R0679",
                sourceArticle: "4",
                definition: "the natural or legal person which determines the purposes and means of processing",
                definitionHash: "gdpr",
                classification: "substantive",
                title: "General Data Protection Regulation",
              },
              {
                occurrenceId: "import",
                celex: "32022R2065",
                sourceArticle: "3",
                definition: "controller means controller as defined in Article 4 of Regulation (EU) 2016/679",
                definitionHash: "referral",
                classification: "imported",
                title: "Digital Services Act",
                referenceEdges: [{ targetCelex: "32016R0679", targetArticle: "4" }],
              },
            ],
          }}
          onClose={() => {}}
          t={t}
        />
      );
    });

    expect(container.textContent).toContain("1 law · 1 wording · 1 import");
    expect(container.textContent).toContain("Definitions in these acts");
    expect(container.textContent).toContain("Imported by reference");
    expect(container.textContent).toContain("Imports from 32016R0679 · Article 4");
    expect(container.textContent).toContain("Selected source");
    expect(container.querySelector('[data-definition-source="32022R2065:3"]')).toBeTruthy();
  });

  it("renders wording chips, marks the baseline, and highlights the words that differ", () => {
    act(() => {
      root.render(
        <DefinitionComparisonPanel
          term="personal data"
          currentCelex="31999L9999"
          selectedSource="32016R0679:4:2"
          comparison={{
            term: "personal data",
            substantiveLawCount: 2,
            wordingCount: 2,
            occurrences: [
              {
                occurrenceId: "gdpr",
                celex: "32016R0679",
                sourceArticle: "4",
                sourcePoint: "2",
                definition: "the natural or legal person which determines the purposes and means of processing",
                definitionHash: "gdpr",
                classification: "substantive",
                title: "GDPR",
              },
              {
                occurrenceId: "dsa",
                celex: "32022R2065",
                sourceArticle: "3",
                definition: "the natural or legal person which determines the purposes and means of a processing",
                definitionHash: "dsa",
                classification: "substantive",
                title: "DSA",
              },
            ],
          }}
          onClose={() => {}}
          t={t}
        />
      );
    });

    const chips = [...container.querySelectorAll("button")].filter((button) => button.textContent.includes("Wording "));
    expect(chips.map((chip) => chip.textContent.replace(/\s+/g, ""))).toEqual(["WordingA·1", "WordingB·1"]);

    const baselineCard = container.querySelector('[data-definition-source="32016R0679:4:2"]');
    expect(baselineCard.textContent).toContain("Selected source");
    expect(baselineCard.textContent).not.toContain("Different wording");

    const otherCard = container.querySelector('[data-definition-source="32022R2065:3"]');
    expect(otherCard.textContent).toContain("Different wording");
    const marks = [...otherCard.querySelectorAll("mark")].map((mark) => mark.textContent);
    expect(marks.join(" ")).toBe("a");
    expect(baselineCard.querySelectorAll("mark")).toHaveLength(0);
  });

  it("diffes every non-baseline wording against the selected source", () => {
    act(() => {
      root.render(
        <DefinitionComparisonPanel
          term="trader"
          currentCelex=""
          selectedSource="3200001:2"
          comparison={{
            term: "trader",
            substantiveLawCount: 3,
            wordingCount: 3,
            occurrences: [
              { celex: "3200001", sourceArticle: "2", definition: "any operator who markets products", definitionHash: "one", classification: "substantive", title: "One" },
              { celex: "3200002", sourceArticle: "2", definition: "any operator who supplies products", definitionHash: "two", classification: "substantive", title: "Two" },
              { celex: "3200003", sourceArticle: "2", definition: "any operator who markets products", definitionHash: "three", classification: "substantive", title: "Three" },
            ],
          }}
          onClose={() => {}}
          t={t}
        />
      );
    });

    const twoCard = container.querySelector('[data-definition-source="3200002:2"]');
    expect([...twoCard.querySelectorAll("mark")].map((mark) => mark.textContent).join(" ")).toBe("supplies");
    // Identical wording in a separate hash group still renders plain: the diff
    // finds no changed words.
    const threeCard = container.querySelector('[data-definition-source="3200003:2"]');
    expect(threeCard.querySelectorAll("mark")).toHaveLength(0);
    expect(threeCard.textContent).toContain("Different wording");
  });
});
