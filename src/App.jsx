import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// =============================================================
// DATA / PROCESSING LAYER
// =============================================================

// ---------------- Config: hard‑coded local laws ----------------
// Replace the paths with files you serve from /public or your static folder.
const LAWS = [
  { label: "AI Act (EU 2024/1689)", value: "/data/ai_act.html.xhtml" },
  { label: "GDPR (EU 2016/679) – Unconsolidated", value: "/data/gdpr_unconsolidated_with_recitals.xml" },
];

// ---------------- Minimal UI primitives ----------------
const Button = ({ className = "", variant = "default", ...props }) => (
  <button
    className={
      `inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm transition ` +
      (variant === "outline"
        ? "border border-gray-300 bg-white hover:bg-gray-50"
        : variant === "ghost"
        ? "bg-transparent hover:bg-gray-100"
        : "bg-black text-white hover:bg-gray-900") +
      " " +
      className
    }
    {...props}
  />
);

// ---------------- Fetch helper ----------------
const fetchText = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return await res.text();
};

// ---------------- Parser (best‑effort for OJ & consolidated) ----------------
function parseSingleXHTMLToCombined(xhtmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtmlText, "text/html");

  const getText = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const innerHTML = (el) =>
    el
      ? Array.from(el.childNodes)
          .map((n) => (n.nodeType === Node.ELEMENT_NODE ? n.outerHTML : n.textContent))
          .join("")
      : "";

  const articles = [];
  const recitals = [];
  const annexes = [];
  let currentDivNum, currentDivTitle;

  const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!(el instanceof Element)) continue;

    // Division headings
    if (el.tagName === "P" && (el.classList.contains("title-division-1") || el.classList.contains("oj-ti-section-1"))) {
      currentDivNum = getText(el);
    }
    if (el.tagName === "P" && (el.classList.contains("title-division-2") || el.classList.contains("oj-ti-section-2"))) {
      currentDivTitle = getText(el);
    }

    // Recitals (OJ typical layout: DIV.eli-subdivision#rct_*)
    if (el.tagName === "DIV" && el.classList.contains("eli-subdivision") && (el.id || "").startsWith("rct_")) {
      const tds = el.querySelectorAll("table td");
      if (tds.length >= 2) {
        const m = (tds[0].textContent || "").match(/\(?\s*(\d+)\s*\)?/);
        const recital_number = m ? m[1] : (tds[0].textContent || "").trim();
        const textCell = tds[1];
        recitals.push({
          recital_number,
          recital_text: getText(textCell),
          recital_html: innerHTML(textCell),
        });
      } else {
        // Fallback: take the whole block
        const num = el.querySelector(".recital-number, .oj-recital-num, strong");
        const recital_number = (num && getText(num).replace(/\D+/g, "")) || `${recitals.length + 1}`;
        recitals.push({ recital_number, recital_text: getText(el), recital_html: innerHTML(el) });
      }
      continue;
    }

    // Articles — OJ style
    if (el.tagName === "P" && el.classList.contains("oj-ti-art")) {
      let container = el.parentElement;
      while (container && !(container.tagName === "DIV" && container.classList.contains("eli-subdivision"))) {
        container = container.parentElement;
      }
      const n = getText(el).match(/Article\s+(\d+)/i);
      const article_number = n ? n[1] : getText(el);
      const titleBlock = container ? container.querySelector("div.eli-title p.oj-sti-art") : null;
      const article_title = titleBlock ? getText(titleBlock) : "";
      articles.push({
        article_number,
        article_title,
        division: { number: currentDivNum, title: currentDivTitle },
        article_html: innerHTML(container || el.parentElement),
      });
      continue;
    }

    // Articles — consolidated style
    if (el.tagName === "DIV" && el.classList.contains("eli-subdivision")) {
      const numP = el.querySelector("p.title-article-norm");
      if (numP) {
        const m = numP.textContent.match(/Article\s+(\d+)/i);
        const article_number = m ? m[1] : numP.textContent.trim();
        const titleP = el.querySelector("p.stitle-article-norm");
        const article_title = titleP ? getText(titleP) : "";
        articles.push({
          article_number,
          article_title,
          division: { number: currentDivNum, title: currentDivTitle },
          article_html: innerHTML(el),
        });
      }
    }

    // Annexes — detect heading and capture full block HTML
    if (el.tagName === "P") {
      const t = getText(el);
      const looksLikeAnnex =
        /^ANNEX(\s+[IVXLC]+|\s+\d+)?/i.test(t) ||
        el.classList.contains("oj-ti-annex") ||
        el.classList.contains("oj-ti-annex-1") ||
        el.classList.contains("title-annex-norm");
      if (looksLikeAnnex) {
        // Title
        let title = t;
        const titleP = el.parentElement?.querySelector("div.eli-title p, p.oj-ti-annex-2, p.stitle-annex-norm");
        if (titleP) title = `${t} — ${getText(titleP)}`;
        // Container: nearest subdivision, else the parent block
        let container = el.parentElement;
        while (container && !(container.tagName === "DIV" && container.classList.contains("eli-subdivision"))) {
          container = container.parentElement;
        }
        const annex_html = innerHTML(container || el.parentElement || el);
        // Id/number if present
        const m = t.match(/^ANNEX\s*([IVXLC]+|\d+)?/i);
        const annex_id = (m && (m[1] || "").trim()) || title;
        annexes.push({ annex_id, annex_title: title, annex_html });
      }
    }
  }

  // Sorts
  const asNum = (s) => (s == null ? NaN : parseInt(String(s).replace(/\D+/g, ""), 10));
  recitals.sort((a, b) => (asNum(a.recital_number) || 0) - (asNum(b.recital_number) || 0));
  return { articles, recitals, annexes };
}

function parseAnyToCombined(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && (Array.isArray(obj.articles) || Array.isArray(obj.recitals) || Array.isArray(obj.annexes))) {
      return { articles: obj.articles || [], recitals: obj.recitals || [], annexes: obj.annexes || [] };
    }
  } catch {
    /* not JSON */
  }
  return parseSingleXHTMLToCombined(text);
}

// =============================================================
// UI LAYER
// =============================================================

function Accordion({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t p-2"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Top navigation bar with Prev/Next groups for each kind
function TopBar({ lawPath, setLawPath, lists, selected, onPrevNext }) {
  const { articles, recitals, annexes } = lists;

  const getListAndIndex = () => {
    if (selected.kind === "article") {
      const idx = articles.findIndex(a => a.article_number === selected.id);
      return { kind: "article", index: idx, list: articles, label: "Article" };
    }
    if (selected.kind === "recital") {
      const idx = recitals.findIndex(r => r.recital_number === selected.id);
      return { kind: "recital", index: idx, list: recitals, label: "Recital" };
    }
    if (selected.kind === "annex") {
      const idx = annexes.findIndex(x => x.annex_id === selected.id);
      return { kind: "annex", index: idx, list: annexes, label: "Annex" };
    }
    return { kind: null, index: -1, list: [], label: "" };
  };

  const { kind, index, list, label } = getListAndIndex();

  return (
    <header className="sticky top-0 z-20 border-b bg-white/80 backdrop-blur">
      <div className="mx-auto w-full px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-base font-semibold">EU Law Visualiser</div>
          <span className="hidden rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 md:inline">
            Konrad Kollnig, Law &amp; Tech Lab Maastricht
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* --- Unified navigation control --- */}
          {kind && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                disabled={index <= 0}
                onClick={() => onPrevNext(kind, index - 1)}
                title={`Previous ${label.toLowerCase()}`}
              >
                ← Prev {label}
              </Button>
              <span className="text-sm text-gray-600">
                {label} {index + 1} of {list.length}
              </span>
              <Button
                variant="outline"
                disabled={index === -1 || index >= list.length - 1}
                onClick={() => onPrevNext(kind, index + 1)}
                title={`Next ${label.toLowerCase()}`}
              >
                Next {label} →
              </Button>
            </div>
          )}

          {/* --- Law selection --- */}
          <select
            value={lawPath}
            onChange={(e) => setLawPath(e.target.value)}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm"
          >
            {LAWS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}

// ---------------- App ----------------
export default function App() {
  const [lawPath, setLawPath] = useState(LAWS[0]?.value || "");
  const [data, setData] = useState({ articles: [], recitals: [], annexes: [] });
  const [selected, setSelected] = useState({ kind: "article", id: null, html: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const contentRef = useRef(null); // used to jump the page to the content block

  const loadLaw = async (path) => {
    setLoading(true);
    setError("");
    setSelected({ kind: "article", id: null, html: "" });
    try {
      const text = await fetchText(path);
      const combined = parseAnyToCombined(text);
      setData(combined);
      // Default select first available thing
      if (combined.articles?.[0]) {
        const a0 = combined.articles[0];
        setSelected({ kind: "article", id: a0.article_number, html: a0.article_html });
      } else if (combined.recitals?.[0]) {
        const r0 = combined.recitals[0];
        setSelected({ kind: "recital", id: r0.recital_number, html: r0.recital_html });
      } else if (combined.annexes?.[0]) {
        const x0 = combined.annexes[0];
        setSelected({ kind: "annex", id: x0.annex_id, html: x0.annex_html });
      }
    } catch (e) {
      setError(String(e.message || e));
      setData({ articles: [], recitals: [], annexes: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (lawPath) loadLaw(lawPath);
  }, [lawPath]);

  // Group articles by chapter for TOC
  const toc = useMemo(() => {
    const map = new Map();
    for (const a of data.articles) {
      const key = `${a?.division?.number || ""} — ${a?.division?.title || ""}`.trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    }
    return Array.from(map.entries());
  }, [data.articles]);

  // --- Selection helpers ---
  const selectArticleIdx = (idx) => {
    const a = data.articles[idx];
    if (!a) return;
    setSelected({ kind: "article", id: a.article_number, html: a.article_html });
  };
  const selectRecitalIdx = (idx) => {
    const r = data.recitals[idx];
    if (!r) return;
    setSelected({ kind: "recital", id: r.recital_number, html: r.recital_html });
  };
  const selectAnnexIdx = (idx) => {
    const x = data.annexes[idx];
    if (!x) return;
    setSelected({ kind: "annex", id: x.annex_id, html: x.annex_html });
  };

  const onPrevNext = (kind, nextIndex) => {
    if (kind === "article") return selectArticleIdx(nextIndex);
    if (kind === "recital") return selectRecitalIdx(nextIndex);
    if (kind === "annex") return selectAnnexIdx(nextIndex);
  };

  const onClickArticle = (a) => selectArticleIdx(data.articles.findIndex((x) => x.article_number === a.article_number));
  const onClickRecital = (r) => selectRecitalIdx(data.recitals.findIndex((x) => x.recital_number === r.recital_number));
  const onClickAnnex = (ax) => selectAnnexIdx(data.annexes.findIndex((x) => x.annex_id === ax.annex_id));

  // When selection changes, jump to the content display
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected.kind, selected.id]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <TopBar
        lawPath={lawPath}
        setLawPath={setLawPath}
        lists={{ articles: data.articles, recitals: data.recitals, annexes: data.annexes }}
        selected={selected}
        onPrevNext={onPrevNext}
      />

      <main className="w-full px-6 py-6">
        {/* Top grid: TOC | Annexes | Recitals */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* TOC */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-base font-semibold">Table of Contents</h2>
            <p className="mt-1 text-sm text-gray-600">Chapters and Articles.</p>
            <div className="mt-3 space-y-2">
              {toc.map(([chapter, items]) => (
                <Accordion key={chapter} title={chapter || "(Untitled)"}>
                  <ul className="space-y-1">
                    {items.map((a) => (
                      <li key={`toc-${a.article_number}`}>
                        <Button
                          variant="ghost"
                          className="w-full justify-between"
                          onClick={() => onClickArticle(a)}
                        >
                          <span className="truncate text-left">
                            Article {a.article_number}: {a.article_title}
                          </span>
                          <span className="text-xs text-gray-500">›</span>
                        </Button>
                      </li>
                    ))}   {/* ✅ closed the inner .map() */}
                  </ul>
                </Accordion>
              ))}
              {toc.length === 0 && <div className="text-sm text-gray-600">No articles detected.</div>}
            </div>
          </section>

          {/* Annexes */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-base font-semibold">Annexes</h2>
            <p className="mt-1 text-sm text-gray-600">Supplementary material.</p>
            <div className="mt-3 space-y-2">
              {data.annexes?.length ? (
                data.annexes.map((ax, i) => (
                  <Button key={`annex-${i}`} variant="outline" className="w-full justify-between" onClick={() => onClickAnnex(ax)}>
                    <span className="truncate text-left">{ax.annex_title || ax.annex_id}</span>
                    <span className="text-xs text-gray-500">›</span>
                  </Button>
                ))
              ) : (
                <div className="text-sm text-gray-600">No annexes detected.</div>
              )}
            </div>
          </section>

          {/* Recitals grid */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-base font-semibold">Recitals</h2>
            <p className="mt-1 text-sm text-gray-600">Context for interpretation.</p>
            <div className="mt-3 grid grid-cols-8 gap-2 md:grid-cols-10">
              {data.recitals?.map((r) => (
                <Button key={`rbtn-${r.recital_number}`} variant="outline" className="px-2 py-1" onClick={() => onClickRecital(r)}>
                  {r.recital_number}
                </Button>
              ))}
              {(!data.recitals || data.recitals.length === 0) && (
                <div className="col-span-full text-sm text-gray-600">No recitals.</div>
              )}
            </div>
          </section>
        </div>

        {/* Selected content viewer */}
        <section ref={contentRef} className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-2 text-sm text-gray-500">Selected: {selected.kind} {selected.id || "–"}</div>
          <div
            className="prose max-w-none prose-sm"
            dangerouslySetInnerHTML={{ __html: selected.html || "<em>Select an article, recital, or annex.</em>" }}
          />
        </section>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}
      </main>
    </div>
  );
}
