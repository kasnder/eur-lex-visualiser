import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSecondaryLawDocument } from "./useSecondaryLawDocument.js";

const {
  mockFetchParsedLaw,
  mockFetchRecitalTitles,
  mockParseLawPayloadToCombined,
} = vi.hoisted(() => ({
  mockFetchParsedLaw: vi.fn(),
  mockFetchRecitalTitles: vi.fn(),
  mockParseLawPayloadToCombined: vi.fn(),
}));

vi.mock("../../utils/formexApi.js", async () => {
  const actual = await vi.importActual("../../utils/formexApi.js");
  return {
    ...actual,
    fetchParsedLaw: mockFetchParsedLaw,
    fetchRecitalTitles: mockFetchRecitalTitles,
  };
});

vi.mock("../../utils/parsers.js", () => ({
  parseLawPayloadToCombined: mockParseLawPayloadToCombined,
}));

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useSecondaryLawDocument", () => {
  let container;
  let root;
  let latestValue;

  function Probe(props) {
    latestValue = useSecondaryLawDocument(props);
    return null;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latestValue = null;
    mockFetchParsedLaw.mockReset();
    mockFetchRecitalTitles.mockReset().mockResolvedValue({ titles: {} });
    mockParseLawPayloadToCombined.mockReset().mockImplementation((value) => value);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not show an as-adopted fallback in a current-version secondary column", async () => {
    mockFetchParsedLaw.mockResolvedValue({
      title: "Regulation 2013/575",
      articles: [{ article_number: "1" }],
      recitals: [],
      annexes: [],
      definitions: [],
      versionUnavailable: true,
    });

    await act(async () => {
      root.render(<Probe celex="32013R0575" secondaryLang="DE" t={(key) => key} version="current" />);
      await flushEffects();
    });

    expect(mockFetchParsedLaw).toHaveBeenCalledWith(
      "32013R0575",
      "DE",
      { version: "current" },
    );
    expect(latestValue.data.articles).toEqual([]);
    expect(latestValue.loadError).toMatchObject({
      title: "lawViewer.structuredVersionUnavailable",
      message: "lawViewer.lawContentUnavailable",
      tone: "notice",
    });
    expect(mockFetchRecitalTitles).not.toHaveBeenCalled();
  });
});
