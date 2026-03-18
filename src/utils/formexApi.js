/**
 * Formex API client with local caching (IndexedDB).
 *
 * Fetches EU legislation in Formex XML format from api.legalviz.eu and
 * caches responses locally so repeated loads are instant.
 */

const API_BASE = "https://api.legalviz.eu";

// Cache version — bump to invalidate all cached entries
const CACHE_VERSION = 1;
const DB_NAME = "formex-cache";
const STORE_NAME = "laws";

export class FormexApiError extends Error {
  constructor(message, { status = 500, code = null, details = null, fallback = null } = {}) {
    super(message);
    this.name = "FormexApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.fallback = fallback;
  }
}

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, CACHE_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key) {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function cacheSet(key, value) {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Silently ignore cache write failures
  }
}

// ---------------------------------------------------------------------------
// API language code mapping
// ---------------------------------------------------------------------------

/**
 * Map from the 2-letter language codes used internally (EN, PL, etc.)
 * to the 3-letter codes expected by the Formex API.
 */
const LANG_MAP = {
  BG: "BUL", CS: "CES", DA: "DAN", DE: "DEU", EL: "ELL",
  EN: "ENG", ET: "EST", FI: "FIN", FR: "FRA", GA: "GLE",
  HR: "HRV", HU: "HUN", IT: "ITA", LV: "LAV", LT: "LIT",
  MT: "MLT", NL: "NLD", PL: "POL", PT: "POR", RO: "RON",
  SK: "SLK", SL: "SLV", ES: "SPA", SV: "SWE",
};

/** All available EU languages for the UI picker (2-letter code → label). */
export const EU_LANGUAGES = {
  BG: "Bulgarian", CS: "Czech", DA: "Danish", DE: "German", EL: "Greek",
  EN: "English", ET: "Estonian", FI: "Finnish", FR: "French", GA: "Irish",
  HR: "Croatian", HU: "Hungarian", IT: "Italian", LV: "Latvian", LT: "Lithuanian",
  MT: "Maltese", NL: "Dutch", PL: "Polish", PT: "Portuguese", RO: "Romanian",
  SK: "Slovak", SL: "Slovenian", ES: "Spanish", SV: "Swedish",
};

export function toApiLang(twoLetter) {
  return LANG_MAP[twoLetter?.toUpperCase()] || "ENG";
}

async function readApiError(res, fallbackMessage) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    // ignore
  }

  throw new FormexApiError(body?.error || fallbackMessage || res.statusText, {
    status: res.status,
    code: body?.code || null,
    details: body?.details || null,
    fallback: body?.details?.fallback || body?.fallback || null,
  });
}

function buildReferenceQuery(reference, lang = "EN") {
  const apiLang = toApiLang(lang);
  const params = new URLSearchParams({ lang: apiLang });

  for (const [key, value] of Object.entries(reference || {})) {
    if (value != null && value !== "") {
      params.set(key, String(value));
    }
  }

  return params.toString();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a law's Formex XML from the API, with local caching.
 *
 * @param {string} celex  CELEX identifier, e.g. "32016R0679"
 * @param {string} lang   2-letter language code, e.g. "EN"
 * @returns {Promise<string>}  Raw Formex XML text
 */
export async function fetchFormex(celex, lang = "EN") {
  const apiLang = toApiLang(lang);
  const cacheKey = `${celex}_${apiLang}`;

  // 1. Try cache first
  const cached = await cacheGet(cacheKey);
  if (cached) {
    console.log(`[FormexAPI] Cache hit: ${cacheKey}`);
    return cached;
  }

  // 2. Fetch from API
  console.log(`[FormexAPI] Fetching: ${celex} (${apiLang})`);
  const url = `${API_BASE}/api/laws/${encodeURIComponent(celex)}?lang=${apiLang}`;
  const res = await fetch(url);

  if (!res.ok) {
    await readApiError(res, `Formex API error ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";

  let xmlText;
  if (contentType.includes("application/json")) {
    // API may wrap XML in a JSON envelope
    const json = await res.json();
    xmlText = json.xml || json.content || json.data || JSON.stringify(json);
  } else {
    xmlText = await res.text();
  }

  // 3. Cache it
  await cacheSet(cacheKey, xmlText);

  return xmlText;
}

export async function resolveOfficialReference(reference, lang = "EN") {
  const query = buildReferenceQuery(reference, lang);
  const url = `${API_BASE}/api/resolve-reference?${query}`;
  const res = await fetch(url);

  if (!res.ok) {
    await readApiError(res, `Reference resolution failed (${res.status})`);
  }

  return res.json();
}

export async function resolveEurlexUrl(sourceUrl, lang = "EN") {
  const apiLang = toApiLang(lang);
  const params = new URLSearchParams({
    url: sourceUrl,
    lang: apiLang,
  });
  const url = `${API_BASE}/api/resolve-url?${params.toString()}`;
  const res = await fetch(url);

  if (!res.ok) {
    await readApiError(res, `EUR-Lex URL resolution failed (${res.status})`);
  }

  return res.json();
}

export async function fetchFormexByReference(reference, lang = "EN") {
  const query = buildReferenceQuery(reference, lang);
  const url = `${API_BASE}/api/laws/by-reference?${query}`;
  const res = await fetch(url);

  if (!res.ok) {
    await readApiError(res, `Formex reference fetch failed (${res.status})`);
  }

  return res.text();
}

/**
 * Extract a CELEX number from a EUR-Lex URL.
 * e.g. "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679"
 *   → "32016R0679"
 */
export function extractCelexFromUrl(url) {
  if (!url) return null;
  const m = url.match(/CELEX[:%]3A(\d{5}[A-Z]\d{4})/i) || url.match(/CELEX:(\d{5}[A-Z]\d{4})/i);
  return m ? m[1] : null;
}
