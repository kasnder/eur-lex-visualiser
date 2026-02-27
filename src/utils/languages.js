/**
 * Language-specific patterns for parsing EUR-Lex legal documents.
 *
 * EUR-Lex publishes legislation in all 24 official EU languages with identical
 * HTML structure (same CSS classes) — only the text content changes.
 * This module provides per-language keyword patterns and a detector that reads
 * the language code embedded in every EUR-Lex HTML page.
 */

// ---------------------------------------------------------------------------
// Per-language configurations
// ---------------------------------------------------------------------------

const EN = {
  code: "EN",
  article: /Article\s+(\d+[a-z]*)/i,
  chapter: /^\s*CHAPTER\b/i,
  section: /^\s*SECTION\b/i,
  annex: /^ANNEX(\s+[IVXLC]+|\s+\d+)?/i,
  annexCapture: /^ANNEX\s*([IVXLC]+|\d+)?/i,
  definition: /definitions?/i,
  // 'term' means …
  //  EUR-Lex EN uses Unicode curly single quotes U+2018 / U+2019
  // Raw chars (no brackets) — buildMeansRegex wraps them in [...]
  quoteChars: "\u2018\u2019'\"",
  meansVerb: "means",
  titleSplit: /\s+of\s+/i,
  eea: /text with eea relevance/i,
  stopWords: [
    // Basic English stop words
    "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at", "by", "for", "with",
    "about", "against", "between", "into", "through", "during", "before", "after", "above", "below",
    "to", "from", "up", "down", "in", "out", "on", "off", "over", "under", "again", "further", "once",
    "here", "there", "where", "why", "how", "all", "any", "both", "each", "few", "more", "most",
    "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "can", "will", "just", "should", "now", "also", "therefore", "upon", "within", "without",
    // EU legal structure terms
    "union", "member", "states", "commission", "article", "paragraph", "eu", "european",
    "regulation", "regulations", "directive", "directives", "decision", "decisions",
    "law", "act", "provisions", "measures",
    "shall", "may", "whereas", "pursuant", "accordance", "hereof", "thereof",
    // Common legal verbs/procedural language
    "apply", "applicable", "applied", "applies", "provide", "provided", "provides", "providing",
    "ensure", "ensures", "ensuring", "establish", "establishing", "regard", "regarding",
    "refer", "referred", "include", "including", "included", "follow", "following", "follows",
    "make", "made", "take", "taken", "taking", "set", "given", "lay", "laying",
    // Generic filler terms
    "relevant", "appropriate", "necessary", "competent", "concerned", "particular",
    "respect", "account", "case", "cases", "order", "view", "way", "ways", "manner",
    "point", "points", "subject", "meaning", "need", "needs", "effect", "effects",
    // Additional boilerplate/transition words
    "however", "furthermore", "especially", "certain", "inter", "alia",
  ],
};

const PL = {
  code: "PL",
  article: /Artyku[\u0142l]\s+(\d+[a-z]*)/i,
  chapter: /^\s*ROZDZIA[\u0141L]\b/i,
  section: /^\s*(?:SEKCJA|ODDZIA[\u0141L])\b/i,
  annex: /^ZA[\u0141L][\u0104A]CZNIK(\s+[IVXLC]+|\s+\d+)?/i,
  annexCapture: /^ZA[\u0141L][\u0104A]CZNIK\s*([IVXLC]+|\d+)?/i,
  definition: /definicj/i,
  // „term" oznacza …
  //  Polish EUR-Lex uses „ (U+201E) and " (U+201D)
  // Raw chars (no brackets) — buildMeansRegex wraps them in [...]
  quoteChars: "\u201E\u201A\u00AB\u201C'\"\u2018\u201D\u201F\u00BB\u2019",
  meansVerb: "oznacz[a\u0105]\\S*",
  titleSplit: /\s+z dnia\s+/i,
  eea: /tekst maj\u0105cy znaczenie dla eog/i,
  stopWords: [
    // Basic Polish function words
    "i", "w", "na", "do", "z", "o", "za", "od", "po", "ze", "we", "nie", "si\u0119",
    "jest", "to", "co", "jak", "lub", "oraz", "tym", "jej", "ich", "jego", "tej",
    "tego", "ten", "ta", "te", "kt\u00F3ry", "kt\u00F3ra", "kt\u00F3re", "kt\u00F3rych",
    "kt\u00F3rego", "kt\u00F3rej", "jako", "by\u0107", "mo\u017Ce", "mog\u0105",
    "b\u0119dzie", "zosta\u0142", "zosta\u0142a", "by\u0142", "by\u0142a", "przez",
    "przy", "dla", "bez", "nad", "pod", "przed", "mi\u0119dzy", "tak", "tylko",
    "jednak", "r\u00F3wnie\u017C", "tak\u017Ce", "wi\u0119c", "gdy", "je\u015Bli",
    "je\u017Celi", "celu", "zgodnie", "przypadku", "spos\u00F3b", "zakresie",
    // EU legal structure terms (Polish)
    "artyku\u0142", "ust\u0119p", "punkt", "motyw", "za\u0142\u0105cznik",
    "rozporz\u0105dzenie", "dyrektywa", "decyzja",
    "komisja", "pa\u0144stwa", "cz\u0142onkowskie", "unia", "europejska",
    "stosuje", "stosowania", "zapewnia", "ustanawia", "odniesienie",
    "niniejszego", "niniejszej", "niniejszym",
  ],
};

// ---------------------------------------------------------------------------
// Language registry — add new languages here
// ---------------------------------------------------------------------------

const LANGUAGES = { EN, PL };

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect the document language from EUR-Lex metadata.
 *
 * Looks for (in order):
 *  1. <meta name="WT.z_usr_lan" content="XX">
 *  2. <p class="oj-hd-lg">XX</p>
 *
 * Returns the two-letter language code (e.g. "EN", "PL") or "EN" as fallback.
 */
export function detectLanguage(doc) {
  // 1. Meta tag
  const meta = doc.querySelector('meta[name="WT.z_usr_lan"]');
  if (meta) {
    const code = (meta.getAttribute("content") || "").trim().toUpperCase();
    if (code) return code;
  }

  // 2. OJ header language cell
  const lgEl = doc.querySelector("p.oj-hd-lg");
  if (lgEl) {
    const code = (lgEl.textContent || "").trim().toUpperCase();
    if (code) return code;
  }

  return "EN"; // default
}

/**
 * Return the language configuration for a given code.
 * Falls back to EN for unsupported languages.
 */
export function getLangConfig(code) {
  return LANGUAGES[code] || LANGUAGES.EN;
}

/**
 * Build the "means" regex for definition extraction from the language config.
 *
 * Matches:  „term" oznacza …  /  'term' means …
 * Capture group 1 = the term text (without quotes).
 */
export function buildMeansRegex(lang) {
  const q = lang.quoteChars; // raw chars, no brackets
  return new RegExp(`^[${q}]([^${q}]+)[${q}]\\s+${lang.meansVerb}\\s+`, "i");
}

/**
 * Return the combined stop-words set for a language.
 * Includes both English baseline terms and language-specific ones.
 */
export function getStopWords(langCode) {
  const lang = LANGUAGES[langCode];
  if (!lang || langCode === "EN") {
    return new Set(EN.stopWords);
  }
  // Merge English + target language
  return new Set([...EN.stopWords, ...lang.stopWords]);
}
