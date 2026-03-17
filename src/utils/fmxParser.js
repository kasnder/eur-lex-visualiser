/**
 * Parser for EU Formex (FMX) XML format.
 *
 * Formex is the XML schema used by the EU Publications Office for the
 * Official Journal.  This parser extracts articles, recitals, definitions,
 * chapter/section hierarchy **and cross-references** from FMX documents,
 * returning the same shape consumed by the rest of the app plus a
 * `crossReferences` map.
 *
 * Cross-references are extracted in two ways:
 *  1. Structural: <REF.DOC.OJ> tags → external OJ references
 *  2. Textual:    "Article N", "paragraph N", "point (x)" patterns in prose
 */

import { getLangConfig, buildMeansRegex } from "./languages.js";

// ---------------------------------------------------------------------------
// FMX → HTML conversion helpers
// ---------------------------------------------------------------------------

/** Recursively collect all text from an Element (ignoring tags). */
function allText(el) {
  if (!el) return "";
  let out = "";
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
    else if (n.nodeType === Node.ELEMENT_NODE) {
      // Preserve FMX quote marks as actual characters
      if (n.tagName === "QUOT.START") { out += "\u2018"; continue; }
      if (n.tagName === "QUOT.END") { out += "\u2019"; continue; }
      out += allText(n);
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Convert an FMX XML element tree into displayable HTML.
 *
 * Handles: P, TXT, LIST/ITEM/NP/NO.P, PARAG/NO.PARAG, ALINEA,
 *          NOTE/FOOTNOTE, HT (highlight), QUOT.START/QUOT.END,
 *          REF.DOC.OJ, DATE, and nested structures.
 */
function fmxToHtml(el) {
  if (!el) return "";
  if (el.nodeType === Node.TEXT_NODE) return escapeHtml(el.textContent);

  const tag = el.tagName;

  // Quote markers → actual quote characters
  if (tag === "QUOT.START") return "\u2018";
  if (tag === "QUOT.END") return "\u2019";

  // Highlighting
  if (tag === "HT") {
    const type = el.getAttribute("TYPE");
    if (type === "UC") return `<span class="uppercase">${childrenHtml(el)}</span>`;
    if (type === "BOLD") return `<strong>${childrenHtml(el)}</strong>`;
    if (type === "ITALIC") return `<em>${childrenHtml(el)}</em>`;
    if (type === "SUB") return `<sub>${childrenHtml(el)}</sub>`;
    if (type === "SUP") return `<sup>${childrenHtml(el)}</sup>`;
    return childrenHtml(el);
  }

  // Date
  if (tag === "DATE") return childrenHtml(el);

  // External OJ reference
  if (tag === "REF.DOC.OJ") return `<span class="oj-ref">${childrenHtml(el)}</span>`;

  // Footnotes
  if (tag === "NOTE") {
    return `<aside class="fmx-footnote">${childrenHtml(el)}</aside>`;
  }

  // Paragraph number
  if (tag === "NO.PARAG" || tag === "NO.P") {
    return `<span class="fmx-num">${childrenHtml(el)}</span>`;
  }

  // Numbered paragraph (e.g. NP = numbered point)
  if (tag === "NP") {
    return `<tr class="fmx-np"><td class="fmx-np-num">${fmxToHtml(el.querySelector("NO\\.P"))}</td><td>${childrenHtmlExcept(el, "NO.P")}</td></tr>`;
  }

  // Lists
  if (tag === "LIST") {
    return `<table class="fmx-list">${childrenHtml(el)}</table>`;
  }

  // List item
  if (tag === "ITEM") return childrenHtml(el);

  // Paragraph — render inline like the old XHTML format: "1.   Text here"
  if (tag === "PARAG") {
    const noP = el.querySelector("NO\\.PARAG");
    const num = noP ? allText(noP) : "";
    const body = childrenHtmlExcept(el, "NO.PARAG");
    if (num) {
      const numPrefix = `${escapeHtml(num)}\u00a0\u00a0\u00a0`;
      // If body starts with <p>, inject number inside the first <p>
      const injected = body.replace(/^(\s*<p[^>]*>)/, `$1${numPrefix}`);
      if (injected !== body) {
        return injected;
      }
      // Plain text body — wrap in a paragraph with the number
      return `<p class="oj-normal">${numPrefix}${body}</p>`;
    }
    return body;
  }

  // ALINEA — unnumbered paragraph block, render children directly
  if (tag === "ALINEA") return childrenHtml(el);

  // P — plain paragraph
  if (tag === "P") return `<p>${childrenHtml(el)}</p>`;

  // TXT — inline text wrapper
  if (tag === "TXT") return childrenHtml(el);

  // TI.ART — handled outside (rendered as h2 heading by viewer), skip
  if (tag === "TI.ART") return "";

  // STI.ART — article subtitle, render as heading
  if (tag === "STI.ART") return `<p class="oj-sti-art">${childrenHtml(el)}</p>`;

  // Default: just recurse
  return childrenHtml(el);
}

function childrenHtml(el) {
  let out = "";
  for (const c of el.childNodes) out += fmxToHtml(c);
  return out;
}

function childrenHtmlExcept(el, skipTag) {
  let out = "";
  for (const c of el.childNodes) {
    if (c.nodeType === Node.ELEMENT_NODE && c.tagName === skipTag) continue;
    out += fmxToHtml(c);
  }
  return out;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Cross-reference extraction
// ---------------------------------------------------------------------------

/**
 * Regex that captures internal cross-references in EU legislation text.
 *
 * Matches patterns like:
 *   "Article 6"
 *   "Article 6(1)"
 *   "Article 6(1)(a)"
 *   "Articles 12 to 22"
 *   "Article 23(1)"
 *   "paragraph 1"
 *   "point (a)"
 *   "Directive 95/46/EC"
 *   "Regulation (EU) 2016/679"
 */
const ARTICLE_REF_RE =
  /Articles?\s+(\d+[a-z]?\b)(?:\((\d+)\))?(?:\(([a-z])\))?(?:\s+(?:to|and)\s+(\d+[a-z]?\b))?/gi;

const DIRECTIVE_REF_RE =
  /(?:Directive|Regulation|Decision)\s+(?:\([A-Z]+\)\s+)?(?:No\s+)?(\d{2,4}\/\d+(?:\/[A-Z]+)?)/gi;

const RECITAL_REF_RE = /[Rr]ecitals?\s+(?:\()?(\d+)(?:\))?(?:\s+(?:to|and)\s+(?:\()?(\d+)(?:\))?)?/gi;

/**
 * Extract cross-references from a text string.
 * Returns an array of { type, target, raw } objects.
 */
function extractCrossRefsFromText(text) {
  const refs = [];
  let m;

  ARTICLE_REF_RE.lastIndex = 0;
  while ((m = ARTICLE_REF_RE.exec(text)) !== null) {
    const artNum = m[1];
    const para = m[2] || null;
    const point = m[3] || null;
    const rangeTo = m[4] || null;

    if (rangeTo) {
      // "Articles 12 to 22" — expand range
      const from = parseInt(artNum, 10);
      const to = parseInt(rangeTo, 10);
      for (let i = from; i <= to; i++) {
        refs.push({ type: "article", target: String(i), paragraph: null, point: null, raw: m[0] });
      }
    } else {
      refs.push({ type: "article", target: artNum, paragraph: para, point, raw: m[0] });
    }
  }

  RECITAL_REF_RE.lastIndex = 0;
  while ((m = RECITAL_REF_RE.exec(text)) !== null) {
    const from = parseInt(m[1], 10);
    const to = m[2] ? parseInt(m[2], 10) : from;
    for (let i = from; i <= to; i++) {
      refs.push({ type: "recital", target: String(i), raw: m[0] });
    }
  }

  DIRECTIVE_REF_RE.lastIndex = 0;
  while ((m = DIRECTIVE_REF_RE.exec(text)) !== null) {
    refs.push({ type: "external", target: m[1], raw: m[0] });
  }

  return refs;
}

/**
 * Inject clickable cross-reference links into HTML.
 *
 * Wraps "Article N" occurrences with <a> tags that navigate within the viewer.
 */
function injectCrossRefLinks(html) {
  // Only link Article references (internal navigation)
  return html.replace(
    /\b(Articles?\s+(\d+[a-z]?\b)(?:\((\d+)\))?(?:\(([a-z])\))?)/gi,
    (match, full, artNum) => {
      return `<a class="cross-ref" data-ref-article="${artNum}" href="#article-${artNum}" title="Go to Article ${artNum}">${full}</a>`;
    }
  );
}

// ---------------------------------------------------------------------------
// Main FMX parser
// ---------------------------------------------------------------------------

/**
 * Detect whether text looks like Formex XML.
 */
export function isFmxDocument(text) {
  return text.includes("<ACT") && text.includes("formex") && text.includes("<ENACTING.TERMS");
}

/**
 * Parse a Formex (FMX) XML document into the app's combined data structure,
 * with additional cross-reference data.
 *
 * @param {string} xmlText  Raw XML string
 * @returns {{ title, articles, recitals, annexes, definitions, langCode, crossReferences }}
 */
export function parseFmxToCombined(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("FMX XML parse error: " + parseError.textContent.slice(0, 200));
  }

  const root = doc.documentElement; // <ACT>

  // --- Language ---
  const lgDoc = root.querySelector("BIB\\.INSTANCE > LG\\.DOC");
  const langCode = lgDoc ? lgDoc.textContent.trim().toUpperCase() : "EN";
  const lang = getLangConfig(langCode);
  const meansRegex = buildMeansRegex(lang);

  // --- Title ---
  // FMX <TI> contains multiple <P> elements; join them with spaces
  const titleEl = root.querySelector("TITLE > TI");
  let titleParts = [];
  if (titleEl) {
    for (const p of titleEl.querySelectorAll("P")) {
      const t = allText(p).trim();
      if (t) titleParts.push(t);
    }
  }
  const titleText = titleParts.join(" ");

  // Extract short title from parentheses (e.g. "General Data Protection Regulation")
  let shortTitle = "";
  for (const part of titleParts) {
    const m = part.match(/\(([^)]{5,80})\)/);
    if (m && !/text with eea relevance/i.test(m[1])) {
      shortTitle = m[1];
      break;
    }
  }

  // Format main title: cut after "of the European Parliament" or "of <date>"
  let mainTitle = titleText.split(/\s+of the European Parliament/i)[0].trim();
  if (mainTitle === titleText) mainTitle = titleText.split(/\s+of\s+\d/i)[0].trim();
  mainTitle = mainTitle.toLowerCase()
    .replace(/(?:^|\s)\S/g, a => a.toUpperCase())
    .replace(/\b(Eu|Ec|Eec|Euratom)\b/gi, m => m.toUpperCase());

  const title = shortTitle && mainTitle && !mainTitle.includes(shortTitle)
    ? `${shortTitle} — ${mainTitle}`
    : shortTitle || mainTitle;

  // --- Recitals ---
  const recitals = [];
  for (const consid of root.querySelectorAll("GR\\.CONSID > CONSID")) {
    const noP = consid.querySelector("NP > NO\\.P");
    const num = noP ? allText(noP).replace(/[()]/g, "").trim() : String(recitals.length + 1);
    const txtEl = consid.querySelector("NP > TXT") || consid.querySelector("NP");
    const recitalText = txtEl ? allText(txtEl) : "";
    const recitalHtmlRaw = txtEl ? fmxToHtml(txtEl) : "";
    recitals.push({
      recital_number: num,
      recital_text: recitalText,
      recital_html: injectCrossRefLinks(recitalHtmlRaw),
    });
  }

  // --- Articles with chapter/section tracking ---
  const articles = [];
  const crossReferences = {};  // articleNumber → [refs]

  function walkDivisions(divisionEl, chapter, section) {
    for (const child of divisionEl.children) {
      if (child.tagName === "TITLE") {
        const ti = child.querySelector("TI");
        const sti = child.querySelector("STI");
        const tiText = ti ? allText(ti) : "";
        const stiText = sti ? allText(sti) : "";

        if (lang.chapter.test(tiText)) {
          chapter = { number: tiText, title: stiText };
          section = { number: "", title: "" };
        } else if (lang.section.test(tiText)) {
          section = { number: tiText, title: stiText };
        }
      }

      if (child.tagName === "ARTICLE") {
        const idAttr = child.getAttribute("IDENTIFIER") || "";
        const tiArt = child.querySelector("TI\\.ART");
        const stiArt = child.querySelector("STI\\.ART");

        const artLabel = tiArt ? allText(tiArt) : "";
        const m = artLabel.match(lang.article);
        const article_number = m ? m[1] : idAttr.replace(/^0+/, "") || String(articles.length + 1);
        const article_title = stiArt ? allText(stiArt) : "";

        // Build HTML from article body (skip TI.ART, keep STI.ART as subtitle)
        let bodyHtml = "";
        for (const c of child.children) {
          if (c.tagName === "TI.ART") continue;
          bodyHtml += fmxToHtml(c);
        }
        bodyHtml = injectCrossRefLinks(bodyHtml);

        articles.push({
          article_number,
          article_title,
          division: {
            chapter: { number: chapter.number, title: chapter.title },
            section: section.number ? { number: section.number, title: section.title } : null,
          },
          article_html: bodyHtml,
        });

        // Extract cross-references from the article's full text
        const fullText = allText(child);
        const refs = extractCrossRefsFromText(fullText);
        // Deduplicate and exclude self-references
        const seen = new Set();
        const uniqueRefs = refs.filter(r => {
          if (r.type === "article" && r.target === article_number) return false;
          const key = `${r.type}:${r.target}:${r.paragraph || ""}:${r.point || ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (uniqueRefs.length > 0) {
          crossReferences[article_number] = uniqueRefs;
        }
      }

      // Nested divisions (sections within chapters)
      if (child.tagName === "DIVISION") {
        walkDivisions(child, { ...chapter }, { ...section });
      }
    }
  }

  const enactingTerms = root.querySelector("ENACTING\\.TERMS");
  if (enactingTerms) {
    walkDivisions(enactingTerms, { number: "", title: "" }, { number: "", title: "" });
  }

  // --- Definitions ---
  const definitions = [];
  const defArticle = articles.find(a => a.article_title && lang.definition.test(a.article_title));
  if (defArticle) {
    // Re-parse from the raw XML to get structured items
    const artEl = root.querySelector(`ARTICLE[IDENTIFIER="${defArticle.article_number.padStart(3, "0")}"]`);
    if (artEl) {
      for (const item of artEl.querySelectorAll("ITEM")) {
        const txtEl = item.querySelector("TXT");
        if (!txtEl) continue;
        const text = allText(txtEl);
        const termMatch = text.match(meansRegex);
        if (termMatch) {
          const term = termMatch[1].trim();
          const definition = text.replace(termMatch[0], "").trim();
          definitions.push({ term, definition });
        }
      }
    }
  }

  // --- Sort recitals ---
  recitals.sort((a, b) => (parseInt(a.recital_number) || 0) - (parseInt(b.recital_number) || 0));

  // --- Also extract cross-references from recitals ---
  for (const r of recitals) {
    const refs = extractCrossRefsFromText(r.recital_text);
    if (refs.length > 0) {
      const key = `recital_${r.recital_number}`;
      crossReferences[key] = refs.filter(ref => {
        // Deduplicate
        return true;
      });
    }
  }

  return { title, articles, recitals, annexes: [], definitions, langCode, crossReferences };
}
