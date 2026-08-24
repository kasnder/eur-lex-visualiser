import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createElement } from "react";

import { MetadataPanel } from "./MetadataPanel.jsx";
import en from "../i18n/locales/en.json";

// Resolve dotted keys against the real English catalog and interpolate {vars},
// mirroring I18nProvider's `t` so the labels under test match production.
function t(key, vars = {}) {
  const message = String(key)
    .split(".")
    .reduce((value, part) => (value && typeof value === "object" ? value[part] : undefined), en);
  if (typeof message !== "string") return key;
  return message.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

const citedBy = {
  citingLaws: {
    total: 12,
    laws: [
      { celex: "32022R1925", title: "Regulation (Digital Markets Act)", provisions: 5 },
      { celex: "32022R2065", title: "Regulation (Digital Services Act)", provisions: 3 },
    ],
  },
  totals: { provisions: 8, judgments: 4 },
  footnote: "Coverage is partial.",
};

const externalLawOverview = [
  { key: "k1", ref: { celex: "32000L0031" }, label: "E-Commerce Directive", count: 2 },
];

const amendments = [{ celex: "32016R0679R(01)", date: "2018-05-04", type: "corrigendum" }];
const implementing = [{ celex: "32021R1234", date: "2021-07-01", type: "regulation" }];
const procedure = {
  reference: "2012/0011(COD)",
  procedureUrl: "https://eur-lex.europa.eu/procedure/EN/2012_11",
  documents: [
    {
      celex: "52012PC0011",
      stage: "proposal",
      institution: "European Commission",
      date: "2012-03-09",
      title: "Commission proposal",
      url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52012PC0011",
    },
    {
      celex: "32016R0679",
      stage: "final",
      institution: "European Parliament and Council",
      date: "2016-05-04",
      title: "Regulation (EU) 2016/679",
      url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679",
    },
  ],
};

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function render(props) {
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(MetadataPanel, {
        amendments,
        implementing,
        externalLawOverview,
        currentLang: "EN",
        centreLabel: "GDPR",
        locale: "en",
        onOpenExternalLaw: () => {},
        onOpenCitedLaw: () => {},
        isExternalReferencePending: () => false,
        t,
        ...props,
      })
    );
  });
}

function tabs() {
  return Array.from(container.querySelectorAll('[role="tab"]'));
}

function activeTab() {
  return tabs().find((tab) => tab.getAttribute("aria-selected") === "true");
}

describe("MetadataPanel tabs", () => {
  it("defaults to the Cited by tab when citedBy is present", () => {
    render({ citedBy });
    const labels = tabs().map((tab) => tab.textContent);
    expect(labels[0]).toContain("Cited by");
    expect(labels.some((l) => l.includes("Cites"))).toBe(true);
    expect(labels.some((l) => l.includes("Amendments"))).toBe(true);
    expect(tabs().every((tab) => tab.classList.contains("items-baseline"))).toBe(true);
    expect(activeTab().textContent).toContain("Cited by");
    // The active panel lists the citing laws + totals footer.
    expect(container.textContent).toContain("Digital Markets Act");
    expect(container.textContent).toContain("8 provisions");
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
    expect(container.querySelector("svg").textContent).toContain("GDPR");
    expect(container.textContent).toContain("And 10 more not shown.");
  });

  it("omits the Cited by tab and defaults to Cites when citedBy is null", () => {
    render({ citedBy: null });
    const labels = tabs().map((tab) => tab.textContent);
    expect(labels.some((l) => l.includes("Cited by"))).toBe(false);
    expect(labels).toHaveLength(4);
    expect(activeTab().textContent).toContain("Cites");
    expect(container.textContent).toContain("E-Commerce Directive");
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });

  it("switches to the Amendments tab and humanises the row", () => {
    render({ citedBy });
    const amendmentsTab = tabs().find((tab) => tab.textContent.includes("Amendments"));
    act(() => amendmentsTab.click());
    expect(activeTab().textContent).toContain("Amendments");
    // Humanised label (Corrigendum) with the CELEX demoted to a trailing chip.
    expect(container.textContent).toContain("Corrigendum");
    expect(container.textContent).toContain("32016R0679R(01)");
    // The cited-by laws are no longer visible once the tab changes.
    expect(container.textContent).not.toContain("Digital Markets Act");
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });

  it("always shows Procedure and uses an ellipsis while it is loading", () => {
    render({ citedBy: null, procedureLoaded: false });
    const procedureTab = tabs().find((tab) => tab.textContent.includes("Procedure"));
    expect(procedureTab).not.toBeUndefined();
    expect(procedureTab.textContent).toContain("…");

    act(() => procedureTab.click());
    expect(container.textContent).toContain("Loading procedure information…");
  });

  it("renders populated procedure rows and the procedure footer link", () => {
    render({ procedure, procedureLoaded: true });
    const procedureTab = tabs().find((tab) => tab.textContent.includes("Procedure"));
    expect(procedureTab.textContent).toContain("2");
    act(() => procedureTab.click());

    expect(container.textContent).toContain("Commission proposal");
    expect(container.textContent).toContain("Proposal");
    expect(container.textContent).toContain("European Commission");
    expect(container.textContent).toContain("52012PC0011");
    expect(container.textContent).toContain("2012/0011(COD)");
    expect(Array.from(container.querySelectorAll('a[target="_blank"]')).map((link) => link.href)).toContain(
      procedure.procedureUrl
    );
    expect(container.querySelectorAll('a[target="_blank"]')).toHaveLength(3);
  });

  it("distinguishes confirmed empty procedure metadata from a request failure", () => {
    render({ procedure: { celex: "32016R0679", reference: null, procedureUrl: null, documents: [] }, procedureLoaded: true });
    const procedureTab = tabs().find((tab) => tab.textContent.includes("Procedure"));
    expect(procedureTab.textContent).toContain("0");
    act(() => procedureTab.click());
    expect(container.textContent).toContain("No legislative procedure information is available for this act.");
    expect(container.textContent).not.toContain("could not be loaded");

    act(() => root.unmount());
    container.innerHTML = "";
    render({ procedure: null, procedureLoaded: true, procedureError: true });
    const failedProcedureTab = tabs().find((tab) => tab.textContent.includes("Procedure"));
    act(() => failedProcedureTab.click());
    expect(container.textContent).toContain("Procedure information could not be loaded right now.");
    expect(container.textContent).not.toContain("No legislative procedure information is available");
  });

  it("keeps the existing default and extends keyboard navigation through Procedure", () => {
    render({ citedBy: null, procedureLoaded: true });
    expect(activeTab().textContent).toContain("Cites");
    const citesTab = activeTab();
    act(() => citesTab.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(activeTab().textContent).toContain("Cites");
    act(() => citesTab.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(activeTab().textContent).toContain("Procedure");
    act(() => activeTab().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(activeTab().textContent).toContain("Cites");
  });
});
