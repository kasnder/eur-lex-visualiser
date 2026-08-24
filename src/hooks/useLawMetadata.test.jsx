import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const api = vi.hoisted(() => ({
  fetchLawMetadata: vi.fn(),
  fetchAmendments: vi.fn(),
  fetchImplementingActs: vi.fn(),
  fetchTransposition: vi.fn(),
  fetchLegislativeProcedure: vi.fn(),
  fetchLawCitedBy: vi.fn(),
}));

vi.mock("../utils/formexApi.js", () => api);

import { useLawMetadata } from "./useLawMetadata.js";

let container;
let root;
let latest;

function Probe({ celex }) {
  latest = useLawMetadata(celex);
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  latest = null;
  vi.clearAllMocks();
  api.fetchLawMetadata.mockResolvedValue(null);
  api.fetchAmendments.mockResolvedValue({ amendments: [] });
  api.fetchImplementingActs.mockResolvedValue({ acts: [] });
  api.fetchLegislativeProcedure.mockResolvedValue({
    celex: null,
    reference: null,
    procedureUrl: null,
    documents: [],
  });
  api.fetchLawCitedBy.mockResolvedValue(null);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(celex) {
  await act(async () => {
    root.render(<Probe celex={celex} />);
  });
  await vi.waitFor(() => expect(latest?.transpositionLoaded).toBe(true));
}

describe("useLawMetadata transposition", () => {
  it("fetches directives and preserves a successful empty payload", async () => {
    const empty = { celex: "32019L0633", applicable: true, measures: [], truncated: false };
    api.fetchTransposition.mockResolvedValue(empty);

    await render("32019L0633");

    expect(api.fetchTransposition).toHaveBeenCalledOnce();
    expect(api.fetchTransposition).toHaveBeenCalledWith("32019L0633");
    expect(latest.transposition).toEqual(empty);
  });

  it("does not fetch non-directives", async () => {
    await render("32016R0679");

    expect(api.fetchTransposition).not.toHaveBeenCalled();
    expect(latest.transposition).toBeNull();
  });

  it("keeps a failed directive request unavailable instead of treating it as empty", async () => {
    api.fetchTransposition.mockRejectedValue(new Error("CELLAR unavailable"));

    await render("32022L2555");

    expect(api.fetchTransposition).toHaveBeenCalledOnce();
    expect(latest.transposition).toBeNull();
  });
});
