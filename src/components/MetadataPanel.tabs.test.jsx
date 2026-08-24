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
const transposition = {
  applicable: true,
  truncated: false,
  measures: [
    {
      celex: "72019L0633POL_202006400",
      sgId: "202006400",
      country: "POL",
      title: "Ustawa o zmianie ustawy",
      notificationDate: "2020-08-11",
      nationalId: "2018/640",
      nationalLink: "https://example.pl/national",
      eli: "https://eli.example.pl/measure",
    },
    {
      celex: "72019L0633FRA_202006401",
      sgId: "202006401",
      country: "FRA",
      title: "Loi de transposition",
      notificationDate: "2020-08-12",
      nationalId: "2020-641",
      nationalLink: null,
      eli: "https://eli.example.fr/measure",
    },
    {
      celex: "72019L0633DEU_202006402",
      sgId: "202006402",
      country: "DEU",
      title: null,
      notificationDate: null,
      nationalId: null,
      nationalLink: "javascript:alert(1)",
      eli: null,
    },
  ],
};

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

  it("places National measures between Implementing acts and Amendments", () => {
    render({ citedBy: null, transposition });
    const labels = tabs().map((tab) => tab.textContent);
    expect(labels).toHaveLength(5);
    expect(labels[1]).toContain("Implementing acts");
    expect(labels[2]).toContain("National measures");
    expect(labels[2]).toContain("3");
    expect(labels[3]).toContain("Amendments");
  });

  it("formats national rows and follows national, ELI, then EUR-Lex link priority", () => {
    render({ citedBy: null, transposition });
    const nationalTab = tabs().find((tab) => tab.textContent.includes("National measures"));
    act(() => nationalTab.click());

    expect(container.textContent).toContain("🇵🇱");
    expect(container.textContent).toContain("Ustawa o zmianie ustawy");
    expect(container.textContent).toContain("11 Aug 2020 · 2018/640");
    expect(container.textContent).toContain("National measure");
    const links = Array.from(container.querySelectorAll('a[target="_blank"]'));
    expect(links[0].getAttribute("href")).toBe("https://example.pl/national");
    expect(links[1].getAttribute("href")).toBe("https://eli.example.fr/measure");
    expect(links[2].getAttribute("href")).toContain("72019L0633DEU_202006402");
    expect(links.every((link) => link.getAttribute("rel") === "noopener noreferrer")).toBe(true);
  });

  it("shows the honest empty state and truncation notice", () => {
    render({
      citedBy: null,
      transposition: { applicable: true, measures: [], truncated: true },
    });
    const nationalTab = tabs().find((tab) => tab.textContent.includes("National measures"));
    act(() => nationalTab.click());

    expect(container.textContent).toContain("Member State notifications may be incomplete.");
    expect(container.textContent).toContain("Only the latest 200 measures are shown.");
  });

  it("shows eight national rows initially and expands with Show all", () => {
    const measures = Array.from({ length: 9 }, (_, index) => ({
      celex: `72019L0633POL_20200640${index}`,
      sgId: `20200640${index}`,
      country: "POL",
      title: `Measure ${index + 1}`,
    }));
    render({ citedBy: null, transposition: { applicable: true, measures, truncated: false } });
    const nationalTab = tabs().find((tab) => tab.textContent.includes("National measures"));
    act(() => nationalTab.click());

    expect(container.textContent).toContain("Measure 8");
    expect(container.textContent).not.toContain("Measure 9");
    const showAll = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Show all (9)"));
    act(() => showAll.click());
    expect(container.textContent).toContain("Measure 9");
  });

  it("keeps arrow-key navigation working with the inserted tab", () => {
    render({ citedBy: null, transposition });
    expect(activeTab().textContent).toContain("Cites");

    act(() => activeTab().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(activeTab().textContent).toContain("Implementing acts");
    act(() => activeTab().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(activeTab().textContent).toContain("National measures");
    act(() => activeTab().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(activeTab().textContent).toContain("Amendments");
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
