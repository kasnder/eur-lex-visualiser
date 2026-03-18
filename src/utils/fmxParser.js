/**
 * Parser for EU Formex (FMX) XML format.
 *
 * Formex is the XML schema used by the EU Publications Office for the
 * Official Journal.  This parser extracts articles, recitals, definitions,
 * chapter/section hierarchy **and cross-references** from FMX documents,
 * returning the same shape consumed by the rest of the app plus a
 * `crossReferences` map.
 *
 * Cross-references are extracted in three ways:
 *  1. Structural: <REF.DOC.OJ> elements → external OJ references (language-independent)
 *  2. Textual:    Language-specific "Article N" / "Artikel N" etc. patterns in prose
 *  3. Textual:    Recital reference patterns in each language
 */

import { getLangConfig, buildMeansRegex, buildFallbackDefRegex } from "./languages.js";

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

  // External OJ reference — render as a styled span with OJ citation text
  if (tag === "REF.DOC.OJ" || tag === "REF.DOC") {
    const coll = el.getAttribute("COLL") || "";
    const no = el.getAttribute("NO.OJ") || "";
    const date = el.getAttribute("DATE.PUB") || "";
    const page = el.getAttribute("PAGE.FIRST") || "";
    // Build EUR-Lex OJ link if we have enough data
    if (coll && no && date) {
      const year = date.slice(0, 4);
      return `<span class="oj-ref" data-oj-coll="${escapeHtml(coll)}" data-oj-no="${escapeHtml(no)}" data-oj-year="${escapeHtml(year)}" data-oj-page="${escapeHtml(page)}">${childrenHtml(el)}</span>`;
    }
    return `<span class="oj-ref">${childrenHtml(el)}</span>`;
  }

  // FT — formatted text (e.g. numbers with spaces)
  if (tag === "FT") return childrenHtml(el);

  // QUOT.S — quoted block
  if (tag === "QUOT.S") return childrenHtml(el);

  // GR.SEQ — grouped sequence (used in annexes)
  // NP children may appear without a LIST wrapper; group them into tables
  if (tag === "GR.SEQ") {
    let html = "";
    let npBuffer = "";
    for (const c of el.childNodes) {
      if (c.nodeType === Node.ELEMENT_NODE && c.tagName === "NP") {
        npBuffer += fmxToHtml(c);
      } else {
        if (npBuffer) { html += `<table class="fmx-list">${npBuffer}</table>`; npBuffer = ""; }
        html += fmxToHtml(c);
      }
    }
    if (npBuffer) html += `<table class="fmx-list">${npBuffer}</table>`;
    return `<div class="fmx-gr-seq">${html}</div>`;
  }

  // TITLE within body content — render as heading (use allText to avoid nested <p>)
  if (tag === "TITLE") {
    const ti = el.querySelector("TI");
    const sti = el.querySelector("STI");
    const tiText = ti ? escapeHtml(allText(ti)) : "";
    const stiText = sti ? escapeHtml(allText(sti)) : "";
    return (tiText ? `<p class="oj-ti-section"><strong>${tiText}</strong></p>` : "")
         + (stiText ? `<p class="oj-sti-art">${stiText}</p>` : "");
  }

  // STI — subtitle (within TITLE blocks)
  if (tag === "STI") return `<p class="oj-sti-art">${escapeHtml(allText(el))}</p>`;

  // CONTENTS — annex body content
  if (tag === "CONTENTS") return childrenHtml(el);

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

  // STI.ART — article subtitle, render as heading (use allText to avoid nested <p>)
  if (tag === "STI.ART") return `<p class="oj-sti-art">${escapeHtml(allText(el))}</p>`;

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
 * Build a regex that matches article references in prose for a given language.
 * E.g. "Article 6(1)(a)" in EN, "Artikel 6 Absatz 1" in DE.
 *
 * Returns a RegExp with groups: (full, artNum, paragraph?, point?, rangeTo?)
 */
function buildArticleRefRe(lang) {
  // Extract the article word part from the lang.article regex source
  // lang.article = /Word\s+(\d+[a-z]*)/i  — we want the "Word" part
  const src = lang.article.source;
  // The article word is everything before \s+(\d
  const wordPart = src.split(/\\s\+\(\\d/)[0];
  // Build reference pattern: ArticleWord[s?] NUM (PARA)? (POINT)?  [to|and NUM]?
  // For some languages (like HU), the number comes BEFORE the word: "6. cikk"
  // We detect this by checking if lang.article captures group 1 at the start
  const isNumFirst = /^\(\?:/.test(src) || /^\(\\d/.test(src) || src.startsWith("(\\d");

  if (isNumFirst) {
    // Hungarian-style: "N. cikk"  or "N cikk"
    return new RegExp(
      `(${src}(?:\\(\\d+\\))?(?:\\([a-z]\\))?)`,
      "gi"
    );
  }

  // Standard: ArticleWord N(para)(point) [to/and N]
  return new RegExp(
    `(${wordPart}s?\\s+(\\d+[a-z]?\\b)(?:\\((\\d+)\\))?(?:\\(([a-z])\\))?(?:\\s+(?:to|and)\\s+(\\d+[a-z]?\\b))?)`,
    "gi"
  );
}

/**
 * Build a regex that matches recital references in prose for a given language.
 */
function buildRecitalRefRe(lang) {
  const recitalWord = lang.recital ? lang.recital.source : "[Rr]ecitals?";
  return new RegExp(
    `${recitalWord}\\s+(?:\\()?(\\d+)(?:\\))?(?:\\s+(?:to|and)\\s+(?:\\()?(\\d+)(?:\\))?)?`,
    "g"
  );
}

/**
 * Cross-law reference patterns (language-independent — these abbreviations appear
 * consistently in EU legislation regardless of the document language).
 * Catches e.g. "Regulation (EU) 2016/679", "Directive 95/46/EC", "Decision 2013/755/EU"
 */
const EXTERNAL_LAW_RE =
  /(?:Regulation|Directive|Decision|Verordnung|Verordnung|Richtlinie|Beschluss|R\u00e8glement|Directive|D\u00e9cision|Reglamento|Directiva|Decisi\u00f3n|Regolamento|Direttiva|Decisione|Regulamento|Diretiva|Decis\u00e3o|Verordening|Richtlijn|Besluit|F\u00f6rordning|Direktiv|Beslut|Forordning|Direktiv|Asetus|Direktiivi|P\u00e4\u00e4t\u00f6s|Na\u0159\u00edzen\u00ed|Sm\u011brnice|Rozhodnut\u00ed|Nariadenie|Smernica|Rozhodnutie|Rendelet|Irányelv|Hat\u00e1rozat|Regulamentul|Directiva|Decizia|Regolamento|Naredba|Odluka|Uredba|Direktiva|Regula|Direktīva|Lēmums|Reglamentas|Direktyva|Sprendimas|Regul\u0101ci\u0101|Direktīva|Rendelet|\u039a\u03b1\u03bd\u03bf\u03bd\u03b9\u03c3\u03bc\u03cc\u03c2|\u039f\u03b4\u03b7\u03b3\u03af\u03b1|\u0391\u03c0\u03cc\u03c6\u03b1\u03c3\u03b7|Regolament|Direttiva|De\u010bizjoni|\u0420\u0435\u0433\u043b\u0430\u043c\u0435\u043d\u0442|\u0414\u0438\u0440\u0435\u043a\u0442\u0438\u0432\u0430|\u0420\u0435\u0448\u0435\u043d\u0438\u0435|Uredba|Direktiva|Odluka|Rialachán|Treoir|Cinneadh)\s+(?:\([A-Z]+\)\s+)?(?:No\.?\s+)?(\d{2,4}\/\d+(?:\/[A-Z]+)?)/gi;

/**
 * Extract cross-references from a text string, using language-specific patterns.
 * Returns an array of { type, target, paragraph, point, raw } objects.
 *
 * @param {string} text  Plain text to scan
 * @param {object} lang  Language config from getLangConfig()
 */
function extractCrossRefsFromText(text, lang) {
  const refs = [];
  const seen = new Set();

  function addRef(ref) {
    const key = `${ref.type}:${ref.target}:${ref.paragraph || ""}:${ref.point || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(ref);
    }
  }

  // Article references (language-specific word)
  const artRe = buildArticleRefRe(lang);
  artRe.lastIndex = 0;
  let m;
  while ((m = artRe.exec(text)) !== null) {
    // Group indices depend on whether num-first or word-first
    // For word-first (standard): groups are (full, artNum, para, point, rangeTo)
    // We just use the article regex to find the number
    const artMatch = lang.article.exec(m[0]);
    if (!artMatch) continue;
    const artNum = artMatch[1];
    // Try to find paragraph and point from the original match
    const paraMatch = m[0].match(/\((\d+)\)/);
    const pointMatch = m[0].match(/\(([a-z])\)/i);
    const rangeMatch = m[0].match(/\s+(?:to|and)\s+(\d+[a-z]?\b)/i);
    if (rangeMatch) {
      const from = parseInt(artNum, 10);
      const to = parseInt(rangeMatch[1], 10);
      if (!isNaN(from) && !isNaN(to) && to >= from && to - from <= 50) {
        for (let i = from; i <= to; i++) {
          addRef({ type: "article", target: String(i), paragraph: null, point: null, raw: m[0] });
        }
      } else {
        addRef({ type: "article", target: artNum, paragraph: null, point: null, raw: m[0] });
      }
    } else {
      addRef({
        type: "article",
        target: artNum,
        paragraph: paraMatch ? paraMatch[1] : null,
        point: pointMatch ? pointMatch[1] : null,
        raw: m[0],
      });
    }
  }

  // Recital references (language-specific)
  const recRe = buildRecitalRefRe(lang);
  recRe.lastIndex = 0;
  while ((m = recRe.exec(text)) !== null) {
    const from = parseInt(m[1], 10);
    const to = m[2] ? parseInt(m[2], 10) : from;
    for (let i = from; i <= to; i++) {
      addRef({ type: "recital", target: String(i), raw: m[0] });
    }
  }

  // External law references (mostly language-independent abbreviations)
  EXTERNAL_LAW_RE.lastIndex = 0;
  while ((m = EXTERNAL_LAW_RE.exec(text)) !== null) {
    addRef({ type: "external", target: m[1], raw: m[0] });
  }

  return refs;
}

/**
 * Extract structured REF.DOC.OJ cross-references directly from XML elements.
 * These are language-independent — they use XML attributes, not text patterns.
 *
 * @param {Element} el  Any XML element to search within
 * @returns {Array}  Array of { type: "oj_ref", ojColl, ojNo, ojYear, ojPage, raw }
 */
function extractOjRefsFromElement(el) {
  const refs = [];
  const seen = new Set();
  for (const refEl of el.querySelectorAll("REF\\.DOC\\.OJ")) {
    const coll = refEl.getAttribute("COLL") || "";
    const no = refEl.getAttribute("NO.OJ") || "";
    const date = refEl.getAttribute("DATE.PUB") || "";
    const page = refEl.getAttribute("PAGE.FIRST") || "";
    const raw = allText(refEl);
    if (!coll || !no) continue;
    const year = date.slice(0, 4);
    const key = `oj:${coll}:${no}:${year}:${page}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ type: "oj_ref", ojColl: coll, ojNo: no, ojYear: year, ojPage: page, raw });
    }
  }
  return refs;
}

/**
 * Inject clickable cross-reference links into HTML.
 * Uses the language-specific article word to match references in the text.
 *
 * @param {string} html  HTML string to process
 * @param {object} lang  Language config from getLangConfig()
 */
function injectCrossRefLinks(html, lang) {
  const src = lang.article.source;
  // Detect num-first languages like Hungarian: "(\d+...)\.?\s+cikk"
  const isNumFirst = src.startsWith("(\\d");

  let injectRe;
  if (isNumFirst) {
    // For num-first languages, use the article pattern directly
    injectRe = new RegExp(`(${src})`, "gi");
  } else {
    // Extract the article word (everything before \s+(\d in the regex source)
    const wordPart = src.split(/\\s\+\(\\d/)[0];
    // Build injection regex: ArticleWord[s?] NUM (optional para)(optional point)
    injectRe = new RegExp(
      `\\b(${wordPart}s?\\s+\\d+[a-z]?\\b(?:\\(\\d+\\))?(?:\\([a-z]\\))?)`,
      "gi"
    );
  }

  // Use lang.article to extract the number from whatever was matched
  const articleRe = lang.article;
  return html.replace(injectRe, (match) => {
    const m = articleRe.exec(match);
    // Reset lastIndex in case the regex is stateful (it shouldn't be, but just in case)
    articleRe.lastIndex = 0;
    if (!m) return match;
    const artNum = m[1];
    return `<a class="cross-ref" data-ref-article="${artNum}" href="#article-${artNum}" title="Go to Article ${artNum}">${match}</a>`;
  });
}

// ---------------------------------------------------------------------------
// Main FMX parser
// ---------------------------------------------------------------------------

/**
 * Detect whether text looks like Formex XML.
 * Supports single ACT documents and combined (ACT + ANNEX) documents.
 */
export function isFmxDocument(text) {
  if (text.includes("<COMBINED.FMX")) return true;
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

  const docRoot = doc.documentElement; // <ACT> or <COMBINED.FMX>

  // For combined documents, the ACT is a child element
  const root = docRoot.tagName === "COMBINED.FMX"
    ? docRoot.querySelector("ACT") || docRoot
    : docRoot;

  // --- Language ---
  const lgDoc = root.querySelector("BIB\\.INSTANCE > LG\\.DOC");
  const langCode = lgDoc ? lgDoc.textContent.trim().toUpperCase() : "EN";
  const lang = getLangConfig(langCode);
  const meansRegex = buildMeansRegex(lang);
  const fallbackDefRegex = buildFallbackDefRegex(lang);

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
    if (m && !lang.eea.test(m[1])) {
      shortTitle = m[1];
      break;
    }
  }

  // Format main title: split at language-specific parliament institution mention
  // or fall back to the date-based split
  let mainTitle = titleText;
  if (lang.parliamentSplit) {
    const splitResult = titleText.split(lang.parliamentSplit);
    if (splitResult.length > 1) mainTitle = splitResult[0].trim();
  }
  if (mainTitle === titleText && lang.titleSplit) {
    mainTitle = titleText.split(lang.titleSplit)[0].trim();
  }
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
      recital_html: injectCrossRefLinks(recitalHtmlRaw, lang),
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
        bodyHtml = injectCrossRefLinks(bodyHtml, lang);

        articles.push({
          article_number,
          article_title,
          division: {
            chapter: { number: chapter.number, title: chapter.title },
            section: section.number ? { number: section.number, title: section.title } : null,
          },
          article_html: bodyHtml,
        });

        // Extract cross-references from the article's full text (language-aware)
        const fullText = allText(child);
        const textRefs = extractCrossRefsFromText(fullText, lang);
        // Also extract structural OJ references from the XML
        const ojRefs = extractOjRefsFromElement(child);
        const allRefs = [...textRefs, ...ojRefs];

        // Deduplicate and exclude self-references
        const seenKeys = new Set();
        const uniqueRefs = allRefs.filter(r => {
          if (r.type === "article" && r.target === article_number) return false;
          const key = `${r.type}:${r.target}:${r.paragraph || ""}:${r.point || ""}`;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
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
  // Find the definitions article by matching its title against the language-specific pattern
  const defArticle = articles.find(a => a.article_title && lang.definition.test(a.article_title));
  if (defArticle) {
    // Try multiple IDENTIFIER formats (3-digit padding is standard, but try others too)
    const artNum = defArticle.article_number;
    const candidates = [
      artNum.padStart(3, "0"),
      artNum.padStart(4, "0"),
      artNum,
    ];
    let artEl = null;
    for (const id of candidates) {
      artEl = root.querySelector(`ARTICLE[IDENTIFIER="${id}"]`);
      if (artEl) break;
    }

    if (artEl) {
      for (const item of artEl.querySelectorAll("ITEM")) {
        // The TXT might be inside NP > TXT or directly under ITEM
        const txtEl = item.querySelector("TXT") || item.querySelector("NP");
        if (!txtEl) continue;
        const text = allText(txtEl);
        if (!text) continue;

        if (lang.definitionFormat === "verb_first") {
          // Verb-first languages (GA, IT, ES, PT): meansVerb 'term' definition
          const termMatch = text.match(meansRegex);
          if (termMatch) {
            const term = termMatch[1].trim();
            const definition = text.slice(termMatch[0].length).trim();
            definitions.push({ term, definition });
          }
        } else {
          // Term-first languages: 'term' meansVerb definition
          // Try the configured meansVerb first; fall back to the quoted-term
          // pattern for languages where the verb only appears in the article
          // intro (DE, FR, CS, SK, HU, FI, ET, LV, LT, EL, NL, DA, SV …).
          let termMatch = text.match(meansRegex);
          if (termMatch) {
            const term = termMatch[1].trim();
            const definition = text.replace(termMatch[0], "").trim();
            definitions.push({ term, definition });
          } else {
            const fbMatch = text.match(fallbackDefRegex);
            if (fbMatch) {
              const term = fbMatch[1].trim();
              const definition = text.slice(fbMatch[0].length).trim();
              if (term && definition) definitions.push({ term, definition });
            }
          }
        }
      }
    }
  }

  // --- Sort recitals ---
  recitals.sort((a, b) => (parseInt(a.recital_number) || 0) - (parseInt(b.recital_number) || 0));

  // --- Also extract cross-references from recitals ---
  for (const r of recitals) {
    const textRefs = extractCrossRefsFromText(r.recital_text, lang);
    const allRefs = textRefs;
    const seenKeys = new Set();
    const uniqueRefs = allRefs.filter(ref => {
      const key = `${ref.type}:${ref.target}:${ref.paragraph || ""}:${ref.point || ""}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    if (uniqueRefs.length > 0) {
      const key = `recital_${r.recital_number}`;
      crossReferences[key] = uniqueRefs;
    }
  }

  // --- Annexes ---
  const annexes = [];
  // In combined documents, ANNEX elements are siblings of ACT
  const annexContainer = docRoot.tagName === "COMBINED.FMX" ? docRoot : root;
  for (const annexEl of annexContainer.querySelectorAll("ANNEX")) {
    const annexTi = annexEl.querySelector("TITLE > TI");
    const annexSti = annexEl.querySelector("TITLE > STI");
    const tiText = annexTi ? allText(annexTi) : "";
    const stiText = annexSti ? allText(annexSti) : "";

    // Extract annex ID (e.g. "I", "II", "III") from title using language-specific pattern
    const idMatch = tiText.match(lang.annexCapture);
    const annex_id = idMatch ? (idMatch[1] || "").trim() : tiText;

    const annex_title = stiText ? `${tiText} — ${stiText}` : tiText;

    // Build HTML from annex contents
    const contents = annexEl.querySelector("CONTENTS");
    let annex_html = "";
    if (contents) {
      annex_html = injectCrossRefLinks(fmxToHtml(contents), lang);
    }

    annexes.push({ annex_id, annex_title, annex_html });
  }

  return { title, articles, recitals, annexes, definitions, langCode, crossReferences };
}
