import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";

const searchFulltext = vi.fn();
const searchLaws = vi.fn(() => Promise.resolve({ results: [] }));
vi.mock("../utils/formexApi.js", async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    searchFulltext: (...args) => searchFulltext(...args),
    searchLaws: (...args) => searchLaws(...args),
  };
});

const { SearchBox } = await import("./TopBar.jsx");
const { I18nProvider } = await import("../i18n/I18nProvider.jsx");

let container;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  searchFulltext.mockReset();
  searchLaws.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

function renderSearchBox(onNavigate = vi.fn()) {
  root = createRoot(container);
  act(() => {
    root.render(createElement(
      MemoryRouter,
      null,
      createElement(
        I18nProvider,
        null,
        createElement(SearchBox, {
          lists: { articles: [], recitals: [], annexes: [] },
          onNavigate,
          onSearchOpen: () => Promise.resolve({ articles: [], recitals: [], annexes: [] }),
          triggerVariant: "hero",
          searchModes: ["laws", "fulltext"],
        }),
      ),
    ));
  });
  return onNavigate;
}

function typeInto(input, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function openFulltextMode() {
  const heroInput = container.querySelector("input");
  typeInto(heroInput, "zz");
  const tab = Array.from(document.body.querySelectorAll('[role="tab"]'))
    .find((element) => element.textContent === "Law texts");
  act(() => tab.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return document.body.querySelector('[role="dialog"] input');
}

describe("SearchBox — full-text mode", () => {
  it("debounces and renders backend highlight ranges without query-string matching", async () => {
    searchFulltext.mockResolvedValue({
      results: [{
        celex: "32016R0679",
        title: "General Data Protection Regulation",
        unitType: "article",
        number: "5",
        heading: "Principles relating to processing",
        snippet: "Processing of personal data shall be lawful.",
        highlightRanges: [{ start: 14, end: 27 }],
      }],
    });
    renderSearchBox();
    const input = openFulltextMode();
    typeInto(input, "personal data");

    expect(searchFulltext).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(searchFulltext).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(searchFulltext).toHaveBeenCalledWith("personal data", expect.objectContaining({
      limit: 12,
      signal: expect.any(AbortSignal),
    }));
    expect(document.body.textContent).toContain("Art. 5");
    expect(document.body.textContent).toContain("General Data Protection Regulation");
    expect(document.body.querySelector("mark")?.textContent).toBe("personal data");

    act(() => document.body.querySelector('button[title="Clear search"]').click());
    expect(document.body.textContent).toContain("Type a word or phrase to search inside English articles and recitals");
    expect(document.body.textContent).not.toContain('No matching English law text found for "personal data"');
  });

  it("shows an explicit unavailable state for a missing full-text index", async () => {
    searchFulltext.mockRejectedValue({
      status: 503,
      code: "fulltext_index_unavailable",
      message: "Full-text index is not available",
    });
    renderSearchBox();
    const input = openFulltextMode();
    typeInto(input, "data");
    await act(async () => vi.advanceTimersByTimeAsync(300));

    expect(document.body.textContent).toContain("Full-text search is temporarily unavailable on this deployment.");
  });

  it("aborts an in-flight request when leaving full-text mode", async () => {
    let requestOptions;
    searchFulltext.mockImplementation((_query, options) => {
      requestOptions = options;
      return new Promise(() => {});
    });
    renderSearchBox();
    const input = openFulltextMode();
    typeInto(input, "data");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(requestOptions?.signal?.aborted).toBe(false);

    const lawsTab = Array.from(document.body.querySelectorAll('[role="tab"]'))
      .find((element) => element.textContent === "Find laws");
    act(() => lawsTab.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(requestOptions.signal.aborted).toBe(true);
  });

  it("aborts and ignores the previous request as soon as the query changes", async () => {
    let resolveFirst;
    let firstOptions;
    searchFulltext.mockImplementationOnce((_query, options) => {
      firstOptions = options;
      return new Promise((resolve) => { resolveFirst = resolve; });
    });
    renderSearchBox();
    const input = openFulltextMode();
    typeInto(input, "first query");
    await act(async () => vi.advanceTimersByTimeAsync(300));

    typeInto(input, "second query");
    expect(firstOptions.signal.aborted).toBe(true);
    await act(async () => {
      resolveFirst({ results: [{
        celex: "32016R0679",
        title: "Stale result",
        unitType: "article",
        number: "1",
        snippet: "first query",
        highlightRanges: [],
      }] });
      await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain("Stale result");
  });

  it("adds a stable full-text result identity to the navigation payload", async () => {
    searchFulltext.mockResolvedValue({
      results: [{
        celex: "32016R0679",
        title: "GDPR",
        unitType: "recital",
        number: "14",
        snippet: "Personal data.",
        highlightRanges: [{ start: 0, end: 8 }],
      }],
    });
    const onNavigate = renderSearchBox();
    const input = openFulltextMode();
    typeInto(input, "personal");
    await act(async () => vi.advanceTimersByTimeAsync(300));

    act(() => document.body.querySelector('[data-result-index="0"]').click());
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      search_kind: "fulltext",
      id: "32016R0679:recital:14:0",
    }));
  });
});
