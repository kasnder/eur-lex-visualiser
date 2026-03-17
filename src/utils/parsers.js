// ---------------- Parser (best-effort for OJ & consolidated) ----------------
import { detectLanguage, getLangConfig, buildMeansRegex } from "./languages.js";
import { isFmxDocument, parseFmxToCombined } from "./fmxParser.js";

export function parseSingleXHTMLToCombined(xhtmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtmlText, "text/html");

  // Detect document language and load matching patterns
  const langCode = detectLanguage(doc);
  const lang = getLangConfig(langCode);
  const meansRegex = buildMeansRegex(lang);

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
  let title = "";

  // Helper to format title (cut after language-specific preposition and Title Case)
  const formatTitle = (t) => {
    if (!t) return "";
    // Cut after language-specific preposition (e.g. "of" for EN, "z dnia" for PL)
    let short = t.split(lang.titleSplit)[0];

    // Convert to Title Case logic
    // 1. Lowercase everything
    // 2. Capitalize first letter of each word
    // 3. Fix specific acronyms like (EU), (EC), (UE), (WE)
    return short.toLowerCase()
      .replace(/(?:^|\s)\S/g, (a) => a.toUpperCase())
      .replace(/\b(Eu|Ec|Eec|Euratom|Ue|We)\b/gi, (match) => match.toUpperCase());
  };

  // Extract title (first occurrence of title classes)
  const titleEl = doc.querySelector(".oj-doc-ti, .doc-ti, .title-doc-first");
  let mainTitle = "";
  if (titleEl) {
    mainTitle = formatTitle(titleEl.textContent.replace(/\s+/g, " ").trim());
  }

  // Look for short title in parentheses (e.g. "Artificial Intelligence Act")
  let shortTitle = "";
  const docTitles = doc.querySelectorAll(".oj-doc-ti, .doc-ti");
  for (const el of docTitles) {
    const txt = el.textContent.trim();
    // Match pattern like "... (Artificial Intelligence Act)" at end of string
    const match = txt.match(/\(([^)]+)\)$/);
    if (match) {
      const candidate = match[1].trim();
      // Heuristic: Short titles are usually Capitalized Words, not "Text with EEA relevance"
      if (
        !lang.eea.test(candidate) &&
        !candidate.match(/^\d{4}\/\d+$/) && // not just a number
        candidate.length > 3 &&
        candidate.length < 100
      ) {
        // Found a likely short title -> prioritize it
        shortTitle = candidate;
        break;
      }
    }
  }

  // Combine titles if both exist and are different
  if (shortTitle && mainTitle && !mainTitle.includes(shortTitle)) {
    title = `${shortTitle} — ${mainTitle}`;
  } else {
    title = shortTitle || mainTitle;
  }

  let currentDivNum, currentDivTitle;

  const norm = (s = "") => s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  let currentChapter = { number: "", title: "" };
  let currentSection = { number: "", title: "" };
  let pendingHeader = null; // "chapter" | "section" | null

  const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!(el instanceof Element)) continue;

    // "Division headings"
    if (
      el.tagName === "P" &&
      (el.classList.contains("title-division-1") || el.classList.contains("oj-ti-section-1"))
    ) {
      const txt = norm(getText(el));

      if (lang.chapter.test(txt)) {
        currentChapter = { number: txt, title: "" };
        currentSection = { number: "", title: "" }; // reset section when a new chapter starts
        pendingHeader = "chapter";
      } else if (lang.section.test(txt)) {
        currentSection = { number: txt, title: "" };
        pendingHeader = "section";
      } else {
        // If neither keyword appears, treat as a chapter-level number
        currentChapter = { number: txt, title: "" };
        currentSection = { number: "", title: "" };
        pendingHeader = "chapter";
      }
    }

    if (
      el.tagName === "P" &&
      (el.classList.contains("title-division-2") || el.classList.contains("oj-ti-section-2"))
    ) {
      const txt = norm(getText(el));
      if (pendingHeader === "chapter") currentChapter.title = txt;
      else if (pendingHeader === "section") currentSection.title = txt;
      pendingHeader = null;
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
      const n = getText(el).match(lang.article);
      const article_number = n ? n[1] : getText(el);
      const titleBlock = container ? container.querySelector("div.eli-title p.oj-sti-art") : null;
      const article_title = titleBlock ? getText(titleBlock) : "";
      articles.push({
        article_number,
        article_title,
        division: {
          chapter: { number: currentChapter.number, title: currentChapter.title },
          section: currentSection.number ? { number: currentSection.number, title: currentSection.title } : null,
        },
        article_html: innerHTML(container || el.parentElement),
      });
      continue;
    }

    // Articles — consolidated style
    if (el.tagName === "DIV" && el.classList.contains("eli-subdivision")) {
      const numP = el.querySelector("p.title-article-norm");
      if (numP) {
        const m = numP.textContent.match(lang.article);
        const article_number = m ? m[1] : numP.textContent.trim();
        const titleP = el.querySelector("p.stitle-article-norm");
        const article_title = titleP ? getText(titleP) : "";
        articles.push({
          article_number,
          article_title,
          division: {
            chapter: { number: currentChapter.number, title: currentChapter.title },
            section: currentSection.number ? { number: currentSection.number, title: currentSection.title } : null,
          },
          article_html: innerHTML(el),
        });
      }
    }

    // Annexes — detect heading and capture full block HTML
    if (el.tagName === "P") {
      const t = getText(el);
      const looksLikeAnnex =
        lang.annex.test(t) ||
        el.classList.contains("oj-ti-annex") ||
        el.classList.contains("oj-ti-annex-1") ||
        el.classList.contains("title-annex-norm");
      if (looksLikeAnnex) {
        // Title
        let title = t;
        let titleP = el.parentElement?.querySelector("div.eli-title p, p.oj-ti-annex-2, p.stitle-annex-norm");

        // Extended logic: check next sibling for subtitle (common in some layouts like oj-doc-ti)
        if (!titleP) {
          const next = el.nextElementSibling;
          if (next && next.tagName === "P" && (next.classList.contains("oj-doc-ti") || next.classList.contains("oj-normal"))) {
            titleP = next;
          }
        }

        if (titleP) title = `${t} — ${getText(titleP)}`;

        // Container: nearest subdivision, else the parent block
        let container = el.parentElement;
        while (container && !(container.tagName === "DIV" && container.classList.contains("eli-subdivision"))) {
          container = container.parentElement;
        }
        const root = container || el.parentElement || el;

        // Clone and clean up (remove duplicate header, highlight subtitle)
        const markId = "ax-" + Math.random().toString(36).slice(2);
        el.setAttribute("data-ax-id", markId);
        if (titleP) titleP.setAttribute("data-ax-sub", markId);

        const clone = root.cloneNode(true);

        el.removeAttribute("data-ax-id");
        if (titleP) titleP.removeAttribute("data-ax-sub");

        const headerNode = clone.querySelector(`[data-ax-id="${markId}"]`);
        if (headerNode) headerNode.remove();

        const subNode = clone.querySelector(`[data-ax-sub="${markId}"]`);
        if (subNode) {
          subNode.classList.add("oj-sti-art");
          subNode.removeAttribute("data-ax-sub");
        }

        const annex_html = innerHTML(clone);

        // Id/number if present
        const m = t.match(lang.annexCapture);
        const annex_id = (m && (m[1] || "").trim()) || title;
        annexes.push({ annex_id, annex_title: title, annex_html });
      }
    }
  }

  // Extract definitions from the "Definitions" article
  const definitions = [];
  const definitionsArticle = articles.find(a =>
    a.article_title && lang.definition.test(a.article_title)
  );

  if (definitionsArticle) {
    // Parse the definitions article HTML to extract terms
    const defDoc = parser.parseFromString(definitionsArticle.article_html, "text/html");
    const tables = defDoc.querySelectorAll("table");

    for (const table of tables) {
      const cells = table.querySelectorAll("td");
      if (cells.length >= 2) {
        const textCell = cells[1];
        const text = getText(textCell);

        // Match pattern: 'term' means … (language-specific quotes and verb)
        const termMatch = text.match(meansRegex);
        if (termMatch) {
          const term = termMatch[1].trim();
          // Definition is everything after the matched prefix
          const definition = text.replace(termMatch[0], '').trim();
          definitions.push({ term, definition });
        }
      }
    }
  }

  // Sorts
  const asNum = (s) => (s == null ? NaN : parseInt(String(s).replace(/\D+/g, ""), 10));
  recitals.sort((a, b) => (asNum(a.recital_number) || 0) - (asNum(b.recital_number) || 0));

  // Extract cross-references from article text
  const crossReferences = extractCrossReferencesFromArticles(articles);

  return { title, articles, recitals, annexes, definitions, langCode, crossReferences };
}

/**
 * Extract cross-references between articles by scanning article HTML for
 * "Article N" patterns.  Returns { articleNumber: [{ type, target, ... }] }.
 */
function extractCrossReferencesFromArticles(articles) {
  const ARTICLE_REF_RE = /Articles?\s+(\d+[a-z]?)(?:\((\d+)\))?(?:\(([a-z])\))?(?:\s+(?:to|and)\s+(\d+[a-z]?))?/gi;

  const crossReferences = {};
  for (const art of articles) {
    const text = (art.article_html || "").replace(/<[^>]+>/g, " ");
    const refs = [];
    const seen = new Set();
    let m;
    ARTICLE_REF_RE.lastIndex = 0;
    while ((m = ARTICLE_REF_RE.exec(text)) !== null) {
      const artNum = m[1];
      const para = m[2] || null;
      const point = m[3] || null;
      const rangeTo = m[4] || null;

      if (rangeTo) {
        const from = parseInt(artNum, 10);
        const to = parseInt(rangeTo, 10);
        for (let i = from; i <= to; i++) {
          const t = String(i);
          if (t === art.article_number) continue;
          const key = `article:${t}`;
          if (seen.has(key)) continue;
          seen.add(key);
          refs.push({ type: "article", target: t, paragraph: null, point: null, raw: m[0] });
        }
      } else {
        if (artNum === art.article_number) continue;
        const key = `article:${artNum}:${para || ""}:${point || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({ type: "article", target: artNum, paragraph: para, point, raw: m[0] });
      }
    }
    if (refs.length > 0) crossReferences[art.article_number] = refs;
  }
  return crossReferences;
}

export function parseAnyToCombined(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && (Array.isArray(obj.articles) || Array.isArray(obj.recitals) || Array.isArray(obj.annexes))) {
      return {
        title: obj.title || "",
        articles: obj.articles || [],
        recitals: obj.recitals || [],
        annexes: obj.annexes || [],
        definitions: obj.definitions || [],
        langCode: obj.langCode || "EN"
      };
    }
  } catch {
    /* not JSON */
  }

  // Detect Formex XML format and use specialised parser
  if (isFmxDocument(text)) {
    return parseFmxToCombined(text);
  }

  return parseSingleXHTMLToCombined(text);
}

