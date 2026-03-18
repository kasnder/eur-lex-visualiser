const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

// FMX files directory - adjust if needed
const FMX_DIR = process.env.FMX_DIR || path.join(__dirname, 'fmx-downloads');
const CELLAR_BASE = 'https://publications.europa.eu/resource';
const EURLEX_BASE = 'https://eur-lex.europa.eu';
const TIMEOUT_MS = 30_000;

// === Rate Limiting ===
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 100; // requests per window
const STORAGE_LIMIT_MB = parseInt(process.env.STORAGE_LIMIT_MB) || 500; // max cache size

const ipRequests = new Map(); // ip -> { count, resetAt }
const resolutionCache = new Map(); // key -> { expiresAt, value }
const RESOLUTION_CACHE_MS = 24 * 60 * 60 * 1000;

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

function rateLimitMiddleware(req, res, next) {
  const ip = getIp(req);
  const now = Date.now();
  
  let record = ipRequests.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    ipRequests.set(ip, record);
  }
  
  record.count++;
  
  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  next();
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRequests) {
    if (now > record.resetAt) ipRequests.delete(ip);
  }
}, 5 * 60 * 1000);

// === Storage Management ===

function getCacheSizeMB() {
  try {
    const files = fs.readdirSync(FMX_DIR).filter(f => f.endsWith('.xml') || f.endsWith('.zip'));
    let totalBytes = 0;
    for (const f of files) {
      totalBytes += fs.statSync(path.join(FMX_DIR, f)).size;
    }
    return totalBytes / (1024 * 1024);
  } catch {
    return 0;
  }
}

function getCacheFiles() {
  try {
    const files = fs.readdirSync(FMX_DIR)
      .filter(f => f.endsWith('.xml') || f.endsWith('.zip'))
      .map(f => {
        const stat = fs.statSync(path.join(FMX_DIR, f));
        return { filename: f, path: path.join(FMX_DIR, f), size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => a.mtime - b.mtime); // oldest first
    return files;
  } catch {
    return [];
  }
}

function evictOldestIfNeeded(requiredMB) {
  const currentMB = getCacheSizeMB();
  const limitMB = STORAGE_LIMIT_MB;
  
  if (currentMB + requiredMB <= limitMB) return { evicted: 0 };
  
  const files = getCacheFiles();
  let freedMB = 0;
  let evicted = 0;
  const targetMB = currentMB + requiredMB - limitMB;
  
  for (const file of files) {
    if (freedMB >= targetMB) break;
    fs.unlinkSync(file.path);
    freedMB += file.size / (1024 * 1024);
    evicted++;
    console.log(`[Cache] Evicted ${file.filename} (freed ${(file.size / 1024).toFixed(0)} KB)`);
  }
  
  return { evicted, freedMB: freedMB.toFixed(2) };
}

// Middleware
app.use(cors());
app.use(express.json());

// Ensure download directory exists
if (!fs.existsSync(FMX_DIR)) {
  fs.mkdirSync(FMX_DIR, { recursive: true });
}

// === Language Validation ===
const VALID_LANGS = new Set([
  'BUL', 'CES', 'DAN', 'DEU', 'ELL', 'ENG', 'EST', 'FIN', 'FRA', 'GLE',
  'HRV', 'HUN', 'ITA', 'LAV', 'LIT', 'MLT', 'NLD', 'POL', 'POR', 'RON',
  'SLK', 'SLV', 'SPA', 'SWE'
]);

function validateLang(lang) {
  const upper = (lang || 'ENG').toUpperCase();
  return VALID_LANGS.has(upper) ? upper : null;
}

function toSearchLang(lang) {
  return (lang || 'ENG').slice(0, 2).toLowerCase();
}

function cacheGet(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(cache, key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// === Safe Error Handling ===

/** Error subclass for messages that are safe to show to API clients. */
class ClientError extends Error {
  constructor(message, statusCode = 500, code = null, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Return a safe error message for the client; log the real one server-side. */
function safeErrorResponse(res, err, fallbackMessage = 'Internal server error') {
  if (err instanceof ClientError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }
  console.error(`[API] ${fallbackMessage}:`, err.message);
  return res.status(500).json({ error: fallbackMessage });
}

function parseReferenceText(text = '') {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();
  const typeMatch = lower.match(/\b(regulation|directive|decision)\b/);
  const actType = typeMatch ? typeMatch[1] : null;

  const numberPatterns = [
    /\b(?:\((?:eu|ec|eec|euratom)\)\s*)?(\d{4})\/(\d{1,4})\b/i,
    /\bno\s+(\d{1,4})\/(\d{4})\b/i,
  ];

  let year = null;
  let number = null;

  for (const pattern of numberPatterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    if (pattern === numberPatterns[0]) {
      year = match[1];
      number = match[2];
    } else {
      year = match[2];
      number = match[1];
    }
    break;
  }

  const types = actType ? [actType] : ['regulation', 'directive', 'decision'];

  return {
    raw: text,
    normalized,
    actType,
    types,
    year,
    number,
  };
}

function parseStructuredReference(input = {}) {
  const raw = String(input.raw || input.text || '').trim();
  const actType = input.actType ? String(input.actType).trim().toLowerCase() : null;
  const year = input.year ? String(input.year).trim() : null;
  const number = input.number ? String(input.number).trim() : null;
  const identifier = input.identifier ? String(input.identifier).trim() : null;
  const suffix = input.suffix ? String(input.suffix).trim().toUpperCase() : null;
  const ojColl = input.ojColl ? String(input.ojColl).trim().toUpperCase() : null;
  const ojNo = input.ojNo ? String(input.ojNo).trim() : null;
  const ojYear = input.ojYear ? String(input.ojYear).trim() : null;

  return {
    raw,
    normalized: raw || [actType, year, number].filter(Boolean).join(' '),
    actType,
    types: actType ? [actType] : ['regulation', 'directive', 'decision'],
    year,
    number,
    identifier,
    suffix,
    ojColl,
    ojNo,
    ojYear,
  };
}

function extractCelexFromText(text = '') {
  const match = String(text).match(/CELEX[:%]3A(\d{5}[A-Z]\d{4}(?:\([0-9]+\))?)/i)
    || String(text).match(/CELEX:(\d{5}[A-Z]\d{4}(?:\([0-9]+\))?)/i);
  return match ? match[1].toUpperCase() : null;
}

function parseEurlexUrl(inputUrl) {
  let url;
  try {
    url = new URL(String(inputUrl));
  } catch {
    throw new ClientError('Invalid EUR-Lex URL', 400, 'invalid_url');
  }

  if (url.hostname !== 'eur-lex.europa.eu') {
    throw new ClientError('URL must point to eur-lex.europa.eu', 400, 'invalid_url_host');
  }

  const directCelex = extractCelexFromText(url.toString());
  if (directCelex) {
    return { type: 'celex', celex: directCelex, url };
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const eliIndex = segments.indexOf('eli');
  if (eliIndex !== -1) {
    const actTypeMap = { reg: 'regulation', dir: 'directive', dec: 'decision' };
    const actType = actTypeMap[segments[eliIndex + 1]] || null;
    const year = segments[eliIndex + 2] || null;
    const number = segments[eliIndex + 3] || null;

    if (actType && /^\d{4}$/.test(year || '') && /^\d{1,4}$/.test(number || '')) {
      return {
        type: 'eli',
        reference: parseStructuredReference({ actType, year, number }),
        url,
      };
    }
  }

  const uri = url.searchParams.get('uri') || '';
  const ojMatch = uri.match(/^OJ:([A-Z])[_:](\d{4})(\d{5})/i);
  if (ojMatch) {
    return {
      type: 'oj',
      oj: {
        ojColl: ojMatch[1].toUpperCase(),
        ojYear: ojMatch[2],
        ojNo: String(parseInt(ojMatch[3], 10)),
      },
      url,
    };
  }

  return { type: 'html', url };
}

function extractCelexCandidatesFromHtml(html = '') {
  const candidates = [];
  const linkPattern = /href="([^"]*CELEX(?::|%3A)\d{5}[A-Z]\d{4}(?:\([0-9]+\))?[^"]*)"/ig;
  let match;
  while ((match = linkPattern.exec(html))) {
    const celex = extractCelexFromText(match[1]);
    if (celex) candidates.push(celex);
  }

  const textPattern = /CELEX(?::|%3A)(\d{5}[A-Z]\d{4}(?:\([0-9]+\))?)/ig;
  while ((match = textPattern.exec(html))) {
    candidates.push(match[1].toUpperCase());
  }

  return [...new Set(candidates)].filter(validateCelex);
}

async function resolveEurlexUrl(inputUrl, lang = 'ENG') {
  const parsed = parseEurlexUrl(inputUrl);
  const cacheKey = JSON.stringify({ type: 'resolve-url', inputUrl, lang });
  const cached = cacheGet(resolutionCache, cacheKey);
  if (cached) return cached;

  if (parsed.type === 'celex') {
    const payload = {
      sourceUrl: parsed.url.toString(),
      parsed: { type: parsed.type },
      resolved: {
        celex: parsed.celex,
        source: 'direct-url',
      },
      fallback: null,
    };
    cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
    return payload;
  }

  if (parsed.type === 'eli') {
    const resolution = await resolveReferenceViaCellar(parsed.reference, lang);
    const payload = {
      sourceUrl: parsed.url.toString(),
      parsed: { type: parsed.type, reference: parsed.reference },
      resolved: resolution.resolved,
      tried: resolution.tried,
      fallback: resolution.fallback,
    };
    cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
    return payload;
  }

  const response = await fetchWithTimeout(parsed.url.toString(), {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': toSearchLang(lang),
      'User-Agent': 'LegalViz Resolver/1.0 (+https://legalviz.eu)',
    },
  });

  if (!response.ok) {
    throw new ClientError(
      `EUR-Lex page returned HTTP ${response.status}`,
      response.status,
      'eurlex_fetch_failed'
    );
  }

  const html = await response.text();
  const candidates = extractCelexCandidatesFromHtml(html);
  const resolvedCelex = candidates[0] || null;
  const payload = {
    sourceUrl: parsed.url.toString(),
    parsed: {
      type: parsed.type,
      ...(parsed.oj ? { oj: parsed.oj } : {}),
      candidateCount: candidates.length,
    },
    resolved: resolvedCelex ? {
      celex: resolvedCelex,
      source: 'eurlex-html',
    } : null,
    fallback: {
      type: 'open-source-url',
      url: parsed.url.toString(),
    },
  };
  cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
  return payload;
}

function buildEurlexSearchFallbackUrl(reference, lang = 'ENG') {
  const searchLang = toSearchLang(lang);
  const searchText = reference.raw || [reference.actType, reference.year && `${reference.year}/${reference.number}`].filter(Boolean).join(' ');
  if (!searchText) return null;
  const params = new URLSearchParams({
    scope: 'EURLEX',
    text: searchText,
    lang: searchLang,
    type: 'quick',
    qid: String(Date.now()),
  });
  return `${EURLEX_BASE}/search.html?${params.toString()}`;
}

function buildEliCandidates(reference) {
  if (!reference.actType || !reference.year || !reference.number) {
    throw new ClientError(
      'Reference must include actType, year, and number',
      400,
      'invalid_reference',
      { parsed: reference }
    );
  }

  const number = String(parseInt(reference.number, 10));
  if (!/^\d+$/.test(number)) {
    throw new ClientError(
      'Reference number must be numeric',
      400,
      'invalid_reference',
      { parsed: reference }
    );
  }

  if (reference.actType === 'directive') {
    return [`http://publications.europa.eu/resource/eli/dir/${reference.year}/${number}/oj`];
  }

  if (reference.actType === 'regulation') {
    return [`http://publications.europa.eu/resource/eli/reg/${reference.year}/${number}/oj`];
  }

  if (reference.actType === 'decision') {
    const candidates = [];
    if (reference.suffix === 'JHA') {
      candidates.push(`http://publications.europa.eu/resource/eli/dec_framw/${reference.year}/${number}/oj`);
    }
    candidates.push(`http://publications.europa.eu/resource/eli/dec/${reference.year}/${number}/oj`);
    candidates.push(`http://publications.europa.eu/resource/eli/dec/${reference.year}/${number}(1)/oj`);
    return [...new Set(candidates)];
  }

  throw new ClientError(
    `Unsupported act type: ${reference.actType}`,
    400,
    'unsupported_reference_type',
    { parsed: reference }
  );
}

async function runSparqlQuery(query) {
  const url = new URL('https://publications.europa.eu/webapi/rdf/sparql');
  url.searchParams.set('query', query);
  url.searchParams.set('format', 'application/sparql-results+json');

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'LegalViz Resolver/1.0 (+https://legalviz.eu)',
    },
  });

  if (!response.ok) {
    throw new ClientError(
      `Cellar SPARQL endpoint returned HTTP ${response.status}`,
      503,
      'cellar_unavailable'
    );
  }

  return response.json();
}

async function resolveReferenceViaCellar(reference, lang = 'ENG') {
  const eliCandidates = buildEliCandidates(reference);
  const cacheKey = JSON.stringify({ type: 'cellar-resolve', reference, lang, eliCandidates });
  const cached = cacheGet(resolutionCache, cacheKey);
  if (cached) return cached;

  const results = [];
  for (const eli of eliCandidates) {
    const query = `
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT ?celex WHERE {
  ?cellar ?p <${eli}> .
  ?cellar owl:sameAs ?celex .
  FILTER(STRSTARTS(STR(?celex), "http://publications.europa.eu/resource/celex/"))
}
LIMIT 5`;
    const data = await runSparqlQuery(query);
    const celexValues = (data.results?.bindings || []).map((binding) =>
      binding.celex?.value?.split('/').pop()
    ).filter(Boolean);

    results.push({ eli, celex: celexValues });
    if (celexValues.length > 0) {
      const payload = {
        resolved: {
          celex: celexValues[0],
          eli,
          source: 'cellar-sparql',
        },
        tried: results,
        fallback: {
          type: 'eurlex-search',
          url: buildEurlexSearchFallbackUrl(reference, lang),
        },
      };
      cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
      return payload;
    }
  }

  const payload = {
    resolved: null,
    tried: results,
    fallback: {
      type: 'eurlex-search',
      url: buildEurlexSearchFallbackUrl(reference, lang),
    },
  };
  cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
  return payload;
}

function validateCelex(celex) {
  return /^\d{5}[A-Z]\d{4}(?:\([0-9]+\))?$/.test(celex);
}

async function prepareLawPayload(celex, lang) {
  console.log(`[API] Fetching ${celex} (lang: ${lang})…`);
  const { type, files } = await downloadFmx(celex, lang);

  if (files.length === 0) {
    throw new ClientError(`No FMX files found for ${celex}`, 404, 'fmx_not_found', { celex, lang });
  }

  let servePath;
  if (type === 'zip') {
    servePath = combineZipToXml(files[0].path);
  } else if (files.length > 1) {
    const combinedPath = files[0].path.replace(/\.xml$/, '.combined.xml');
    if (!fs.existsSync(combinedPath)) {
      const parts = ['<?xml version="1.0" encoding="UTF-8"?>'];
      parts.push('<COMBINED.FMX>');
      for (const f of files) {
        let xml = fs.readFileSync(f.path, 'utf8');
        xml = xml.replace(/<\?xml[^?]*\?>/, '').trim();
        parts.push(xml);
      }
      parts.push('</COMBINED.FMX>');
      fs.writeFileSync(combinedPath, parts.join('\n'), 'utf8');
      console.log(`[API] Combined ${files.length} XML files → ${path.basename(combinedPath)}`);
    }
    servePath = combinedPath;
  } else {
    servePath = files[0].path;
  }

  if (!fs.existsSync(servePath)) {
    throw new ClientError('Cached file missing', 404, 'cached_file_missing', { celex, lang });
  }

  return { type, files, servePath };
}

function sendLawResponse(res, servePath) {
  const stat = fs.statSync(servePath);

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('X-Filename', path.basename(servePath));

  const stream = fs.createReadStream(servePath);
  stream.on('error', (err) => {
    console.error(`[API] Stream error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading cached file' });
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

// === EUR-Lex Cellar Fetching Logic ===

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function getRdf(url) {
  const r = await fetchWithTimeout(url, {
    headers: { Accept: '*/*', 'Accept-Language': 'eng' }
  });
  if (r.status === 404) throw new ClientError('Law not found in EUR-Lex Cellar', 404);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function extractUris(rdf) {
  return [...rdf.matchAll(/rdf:resource="([^"]+)"/g)].map(m => m[1]);
}

async function findFmx4Uri(celex, lang = 'ENG') {
  const rdf = await getRdf(`${CELLAR_BASE}/celex/${celex}`);
  const uris = extractUris(rdf);

  // Match both old-style (JOL_) and new-style (L_YYYYNNNNN) fmx4 expression URIs
  const pattern = new RegExp(`\\/oj\\/(JOL_\\d{4}_\\d+_R_\\d+|L_\\d{9})\\.${lang}\\.fmx4$`);
  let fmx4 = uris.find(u => pattern.test(u));

  // Fallback: derive from ENG
  if (!fmx4) {
    const engPattern = /\/oj\/(JOL_\d{4}_\d+_R_\d+|L_\d{9})\.ENG\.fmx4$/;
    const engFmx4 = uris.find(u => engPattern.test(u));
    if (engFmx4) {
      fmx4 = engFmx4.replace('.ENG.fmx4', `.${lang}.fmx4`);
    }
  }

  if (!fmx4) throw new ClientError(`No Formex data available for this law in language ${lang}`, 404);
  return fmx4;
}

async function findDownloadUrls(fmx4Uri) {
  const rdf = await getRdf(fmx4Uri);
  const uris = extractUris(rdf);

  // Prefer zip
  const zip = uris.find(u => u.endsWith('.zip'));
  if (zip) return { type: 'zip', urls: [zip] };

  // Fall back to XML files
  const allXmlFiles = uris.filter(u =>
    u.match(/\.fmx4\.[^/]+\.xml$/) && !u.endsWith('.doc.xml')
  );
  const seen = new Set();
  const xmlFiles = allXmlFiles.filter(u => {
    const suffix = u.split('.fmx4.').pop();
    if (seen.has(suffix)) return false;
    seen.add(suffix);
    return true;
  });

  if (xmlFiles.length) return { type: 'xml', urls: xmlFiles };

  const docXmls = uris.filter(u => u.endsWith('.doc.xml'));
  if (docXmls.length) return { type: 'xml', urls: docXmls };

  throw new ClientError('No downloadable Formex files found for this law', 404);
}

// === ZIP → Combined XML ===

/**
 * Extract a Formex ZIP and combine its FMX files into a single
 * <COMBINED.FMX> XML document, matching the logic in
 * scripts/combine-fmx-zip.mjs.
 *
 * Returns the path to the combined XML file (cached alongside the ZIP).
 */
function combineZipToXml(zipPath) {
  const combinedPath = zipPath.replace(/\.zip$/, '.combined.xml');

  // Return cached combined file if it already exists
  if (fs.existsSync(combinedPath)) return combinedPath;

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const entryNames = entries.map(e => e.entryName);

  // Find the manifest: prefer new format (*.doc.fmx.xml), fall back to old format (*.doc.xml)
  let docEntry = entries.find(e => e.entryName.endsWith('.doc.fmx.xml'));
  const isOldFormat = !docEntry;
  if (!docEntry) {
    docEntry = entries.find(e => e.entryName.endsWith('.doc.xml'));
  }
  if (!docEntry) {
    throw new Error('No *.doc.fmx.xml manifest found in ZIP');
  }
  const manifest = docEntry.getData().toString('utf8');

  // Extract file references from manifest.
  // New format: data files end with .fmx.xml; old format: data files end with .xml (but not .doc.xml)
  const refPattern = /FILE="([^"]+)"/g;
  const physRefs = [];
  let m;
  while ((m = refPattern.exec(manifest)) !== null) {
    const ref = m[1];
    const isDataFile = isOldFormat
      ? ref.endsWith('.xml') && !ref.endsWith('.doc.xml')
      : ref.endsWith('.fmx.xml');
    if (isDataFile && ref !== docEntry.entryName && entryNames.includes(ref)) {
      physRefs.push(ref);
    }
  }

  if (physRefs.length === 0) {
    // Fallback: include all data files except the manifest
    const ext = isOldFormat ? '.xml' : '.fmx.xml';
    for (const name of entryNames) {
      if (name.endsWith(ext) && name !== docEntry.entryName && !name.endsWith('.doc.xml')) {
        physRefs.push(name);
      }
    }
  }

  // Build combined XML
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>'];
  parts.push('<COMBINED.FMX>');

  for (const ref of physRefs) {
    const entry = zip.getEntry(ref);
    let xml = entry.getData().toString('utf8');
    // Remove XML declaration from individual files
    xml = xml.replace(/<\?xml[^?]*\?>/, '').trim();
    parts.push(xml);
  }

  parts.push('</COMBINED.FMX>');

  fs.writeFileSync(combinedPath, parts.join('\n'), 'utf8');
  console.log(`[ZIP] Combined ${physRefs.length} files from ${path.basename(zipPath)} → ${path.basename(combinedPath)}`);

  return combinedPath;
}

// Prevent concurrent duplicate downloads for the same celex+lang
const inFlightDownloads = new Map(); // "celex_lang" -> Promise

async function downloadFmx(celex, lang = 'ENG') {
  const lockKey = `${celex}_${lang}`;

  // If a download for this exact celex+lang is already in progress, wait for it
  if (inFlightDownloads.has(lockKey)) {
    return inFlightDownloads.get(lockKey);
  }

  const promise = _downloadFmxImpl(celex, lang).finally(() => {
    inFlightDownloads.delete(lockKey);
  });

  inFlightDownloads.set(lockKey, promise);
  return promise;
}

async function _downloadFmxImpl(celex, lang) {
  const fmx4Uri = await findFmx4Uri(celex, lang);
  const { type, urls } = await findDownloadUrls(fmx4Uri);

  const downloaded = [];
  let totalSize = 0;

  // First pass: check cache and calculate sizes
  for (const url of urls) {
    const filename = url.split('/').pop();
    const destPath = path.join(FMX_DIR, filename);

    if (fs.existsSync(destPath)) {
      const stat = fs.statSync(destPath);
      downloaded.push({ filename, path: destPath, cached: true, size: stat.size });
    } else {
      // Fetch to get size info
      const r = await fetchWithTimeout(url, { method: 'HEAD' });
      const size = parseInt(r.headers.get('content-length')) || 0;
      totalSize += size;
      downloaded.push({ filename, path: destPath, cached: false, url, size });
    }
  }

  // Evict if needed
  const requiredMB = totalSize / (1024 * 1024);
  if (requiredMB > 0) {
    const { evicted, freedMB } = evictOldestIfNeeded(requiredMB);
    if (evicted > 0) {
      console.log(`[Cache] Evicted ${evicted} file(s), freed ${freedMB} MB`);
    }
  }

  // Second pass: download missing files
  for (const file of downloaded) {
    if (file.cached) continue;

    const r = await fetchWithTimeout(file.url);
    if (!r.ok) throw new Error(`HTTP ${r.status} downloading ${file.url}`);

    const buffer = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(file.path, buffer);
    file.size = buffer.length;
  }

  return { type, files: downloaded };
}

// CELEX to friendly name mapping
const CELEX_NAMES = {
  '32016R0679': 'GDPR',
  '32024R1689': 'AIA',
  '32022R1925': 'DMA',
  '32022R2065': 'DSA',
  '32022R0868': 'DGA',
  '32023R2854': 'DA'
};

// === API Routes ===

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// List cached laws
app.get('/api/laws', rateLimitMiddleware, (req, res) => {
  try {
    const files = fs.readdirSync(FMX_DIR);
    const laws = files.filter(f => f.endsWith('.xml') || f.endsWith('.zip'));
    res.json({ laws });
  } catch (err) {
    safeErrorResponse(res, err, 'Failed to list cached laws');
  }
});

// Resolve an official legal reference to CELEX and fetch the matching FMX
app.get('/api/laws/by-reference', rateLimitMiddleware, async (req, res) => {
  try {
    const rawLang = req.query.lang || 'ENG';
    const lang = validateLang(rawLang);
    if (!lang) {
      return res.status(400).json({ error: `Invalid language code: ${rawLang}` });
    }

    const reference = parseStructuredReference(req.query);
    if (!reference.actType || !reference.year || !reference.number) {
      return res.status(400).json({
        error: 'Provide official reference parameters: actType, year, number',
        code: 'invalid_reference',
      });
    }

    const resolution = await resolveReferenceViaCellar(reference, lang);
    if (!resolution.resolved?.celex) {
      return res.status(404).json({
        error: 'Could not resolve the official reference to a CELEX identifier',
        code: 'resolution_failed',
        details: {
          parsed: reference,
          tried: resolution.tried,
          fallback: resolution.fallback,
        },
      });
    }

    try {
      const { servePath } = await prepareLawPayload(resolution.resolved.celex, lang);
      res.setHeader('X-Resolved-CELEX', resolution.resolved.celex);
      res.setHeader('X-Resolved-ELI', resolution.resolved.eli);
      sendLawResponse(res, servePath);
    } catch (err) {
      if (err instanceof ClientError && err.statusCode === 404) {
        throw new ClientError(
          `Resolved CELEX ${resolution.resolved.celex}, but no FMX files are available`,
          404,
          'fmx_not_found',
          {
            resolved: resolution.resolved,
            parsed: reference,
            fallback: resolution.fallback,
          }
        );
      }
      throw err;
    }
  } catch (err) {
    if (!res.headersSent) {
      safeErrorResponse(res, err, 'Failed to fetch law by reference');
    }
  }
});

// Get law by CELEX (fetches on demand, caches transparently)
app.get('/api/laws/:celex', rateLimitMiddleware, async (req, res) => {
  try {
    const { celex } = req.params;
    const rawLang = req.query.lang || 'ENG';

    if (!validateCelex(celex)) {
      return res.status(400).json({ error: 'Invalid CELEX format. Expected: 32016R0679' });
    }

    const lang = validateLang(rawLang);
    if (!lang) {
      return res.status(400).json({ error: `Invalid language code: ${rawLang}` });
    }

    const { servePath } = await prepareLawPayload(celex, lang);
    sendLawResponse(res, servePath);
  } catch (err) {
    if (!res.headersSent) {
      safeErrorResponse(res, err, 'Failed to fetch law');
    }
  }
});

// Get metadata for a law (no download)
app.get('/api/laws/:celex/info', rateLimitMiddleware, async (req, res) => {
  try {
    const { celex } = req.params;
    const rawLang = req.query.lang || 'ENG';

    if (!validateCelex(celex)) {
      return res.status(400).json({ error: 'Invalid CELEX format' });
    }

    const lang = validateLang(rawLang);
    if (!lang) {
      return res.status(400).json({ error: `Invalid language code: ${rawLang}` });
    }

    const fmx4Uri = await findFmx4Uri(celex, lang);
    const { type } = await findDownloadUrls(fmx4Uri);

    res.json({
      celex,
      lang,
      name: CELEX_NAMES[celex] || null,
      type
    });
  } catch (err) {
    safeErrorResponse(res, err, 'Failed to fetch law metadata');
  }
});

// Search cached files
app.get('/api/search', rateLimitMiddleware, (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" required' });
    }
    
    const files = fs.readdirSync(FMX_DIR);
    const matches = files.filter(f => 
      (f.endsWith('.xml') || f.endsWith('.zip')) && 
      f.toLowerCase().includes(q.toLowerCase())
    );
    
    res.json({ matches });
  } catch (err) {
    safeErrorResponse(res, err, 'Search failed');
  }
});

// Resolve an official legal reference to CELEX using Cellar SPARQL
app.get('/api/resolve-reference', rateLimitMiddleware, async (req, res) => {
  try {
    const rawLang = req.query.lang || 'ENG';

    const lang = validateLang(rawLang);
    if (!lang) {
      return res.status(400).json({ error: `Invalid language code: ${rawLang}` });
    }

    let reference = null;
    if (req.query.actType || req.query.year || req.query.number || req.query.ojColl || req.query.ojNo || req.query.ojYear || req.query.raw) {
      reference = parseStructuredReference(req.query);
    } else if (req.query.text) {
      reference = parseReferenceText(String(req.query.text).trim());
    } else {
      return res.status(400).json({
        error: 'Provide FMX-style structured parameters like actType/year/number, optionally with ojColl/ojNo/ojYear',
      });
    }

    if (!reference.year || !reference.number) {
      return res.status(400).json({
        error: 'Could not parse a structured FMX legal reference',
        code: 'invalid_reference',
        parsed: reference,
      });
    }

    const resolution = await resolveReferenceViaCellar(reference, lang);
    const payload = {
      query: reference.raw || null,
      parsed: reference,
      resolved: resolution.resolved,
      tried: resolution.tried,
      fallback: resolution.fallback,
    };
    res.status(resolution.resolved ? 200 : 404).json(payload);
  } catch (err) {
    safeErrorResponse(res, err, 'Failed to resolve legal reference');
  }
});

app.get('/api/resolve-url', rateLimitMiddleware, async (req, res) => {
  try {
    const rawLang = req.query.lang || 'ENG';
    const lang = validateLang(rawLang);
    if (!lang) {
      return res.status(400).json({ error: `Invalid language code: ${rawLang}` });
    }

    const sourceUrl = String(req.query.url || '').trim();
    if (!sourceUrl) {
      return res.status(400).json({ error: 'Query parameter "url" required' });
    }

    const payload = await resolveEurlexUrl(sourceUrl, lang);
    res.status(payload.resolved ? 200 : 404).json(payload);
  } catch (err) {
    safeErrorResponse(res, err, 'Failed to resolve EUR-Lex URL');
  }
});

// Root endpoint with API docs
app.get('/', (req, res) => {
  res.json({
    name: 'EUR-Lex FMX API',
    version: '2.0.0',
    endpoints: {
      'GET /': 'This documentation',
      'GET /health': 'Health check',
      'GET /api/laws': 'List cached FMX files',
      'GET /api/laws/:celex?lang=ENG': 'Get law by CELEX (fetches & caches)',
      'GET /api/laws/:celex/info': 'Get metadata only',
      'GET /api/laws/by-reference?actType=directive&year=2018&number=1972&lang=ENG': 'Resolve an official reference and fetch the matching FMX',
      'GET /api/search?q=keyword': 'Search cached files',
      'GET /api/resolve-reference?actType=directive&year=2018&number=1972&lang=ENG': 'Resolve an FMX-derived legal reference to CELEX via Cellar SPARQL',
      'GET /api/resolve-url?url=https://eur-lex.europa.eu/...&lang=ENG': 'Resolve a full EUR-Lex URL to a canonical CELEX'
    },
    celexExamples: {
      '32016R0679': 'GDPR',
      '32024R1689': 'AI Act',
      '32022R1925': 'DMA',
      '32022R2065': 'DSA',
      '32022R0868': 'DGA',
      '32023R2854': 'Data Act'
    },
    languages: ['BUL', 'CES', 'DAN', 'DEU', 'ELL', 'ENG', 'EST', 'FIN', 'FRA', 'GLE', 'HRV', 'HUN', 'ITA', 'LAV', 'LIT', 'MLT', 'NLD', 'POL', 'POR', 'RON', 'SLK', 'SLV', 'SPA', 'SWE']
  });
});

app.listen(PORT, () => {
  console.log(`EUR-Lex FMX API running on port ${PORT}`);
  console.log(`Cache directory: ${FMX_DIR}`);
  console.log(`Rate limit: ${RATE_LIMIT_MAX} req/15min per IP`);
  console.log(`Storage limit: ${STORAGE_LIMIT_MB} MB`);
});
