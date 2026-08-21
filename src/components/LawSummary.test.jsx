import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const fetchLawSummary = vi.fn();

vi.mock("../utils/formexApi.js", () => ({
  fetchLawSummary: (...args) => fetchLawSummary(...args),
}));

const { LawSummary } = await import("./LawSummary.jsx");
const { I18nProvider } = await import("../i18n/I18nProvider.jsx");

const SUMMARY = {
  summary: {
    purpose: { text: "Sets uniform prudential requirements.", citations: [] },
    scope: { text: "Applies to institutions.", citations: ["1"] },
    keyPoints: [],
    structure: "Ten parts.",
  },
  cacheVersion: 1,
};

let container;
let root;

async function render(props = {}) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          I18nProvider,
          null,
          createElement(LawSummary, { celex: "32013R0575", ...props })
        )
      )
    );
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  fetchLawSummary.mockReset();
  fetchLawSummary.mockResolvedValue(SUMMARY);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("LawSummary", () => {
  it("says the overview is only of the law as adopted when a version is being read", async () => {
    // `/summary` has no version dimension — it is generated from the act as
    // adopted and served unchanged. Reading the CRR as amended, that is an
    // overview of 521 articles sitting above 786, so it has to say so.
    await render({ version: "current" });

    expect(container.textContent).toContain("As adopted");
    expect(container.textContent).toContain("does not reflect later amendments");
  });

  it("says nothing about versions when the as-adopted text is what is being read", async () => {
    // Labelling an as-adopted overview "as adopted" above the as-adopted text
    // is noise: the caveat only earns its place when the two diverge.
    await render();

    expect(container.textContent).not.toContain("As adopted");
    expect(container.textContent).not.toContain("does not reflect later amendments");
  });
});
