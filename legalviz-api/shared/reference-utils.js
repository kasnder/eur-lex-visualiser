const { ClientError } = require('./api-utils');

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

function validateCelex(celex) {
  return /^\d{5}[A-Z]\d{4}(?:\([0-9]+\))?$/.test(celex);
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

function buildEurlexSearchFallbackUrl(reference, lang, toSearchLang, EURLEX_BASE) {
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

function buildEurlexOjFallbackUrl(oj, lang, toSearchLang, EURLEX_BASE) {
  const langCode = toSearchLang(lang).toUpperCase();
  if (!oj?.ojColl || !oj?.ojYear || !oj?.ojNo) return null;
  return `${EURLEX_BASE}/legal-content/${langCode}/TXT/?uri=OJ:${oj.ojColl}:${oj.ojYear}:${oj.ojNo}:TOC`;
}

function createReferenceResolver({
  EURLEX_BASE,
  RESOLUTION_CACHE_MS,
  TIMEOUT_MS,
  cacheGet,
  cacheSet,
  resolutionCache,
  toSearchLang,
}) {
  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);
      return response;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
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
            url: buildEurlexSearchFallbackUrl(reference, lang, toSearchLang, EURLEX_BASE),
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
        url: buildEurlexSearchFallbackUrl(reference, lang, toSearchLang, EURLEX_BASE),
      },
    };
    cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
    return payload;
  }

  async function resolveOfficialJournalViaCellar(oj, lang = 'ENG') {
    if (!oj?.ojYear || !oj?.ojNo) {
      throw new ClientError('Official Journal reference requires ojYear and ojNo', 400, 'invalid_oj_reference');
    }

    const cacheKey = JSON.stringify({ type: 'oj-resolve', oj, lang });
    const cached = cacheGet(resolutionCache, cacheKey);
    if (cached) return cached;

    const actTypes = ['directive', 'regulation', 'decision'];
    const tried = [];
    const resolvedMatches = [];

    for (const actType of actTypes) {
      const reference = parseStructuredReference({
        actType,
        year: oj.ojYear,
        number: oj.ojNo,
        ojColl: oj.ojColl,
        ojYear: oj.ojYear,
        ojNo: oj.ojNo,
        raw: `${actType} ${oj.ojYear}/${oj.ojNo}`,
      });

      const resolution = await resolveReferenceViaCellar(reference, lang);
      tried.push({
        actType,
        reference,
        resolved: resolution.resolved,
        attempted: resolution.tried,
      });

      if (resolution.resolved?.celex) {
        resolvedMatches.push({
          actType,
          reference,
          resolved: resolution.resolved,
        });
      }
    }

    let payload;
    if (resolvedMatches.length === 1) {
      payload = {
        resolved: resolvedMatches[0].resolved,
        tried,
        fallback: null,
      };
    } else if (resolvedMatches.length > 1) {
      payload = {
        resolved: null,
        tried,
        fallback: {
          type: 'ambiguous-oj-reference',
          url: buildEurlexOjFallbackUrl(oj, lang, toSearchLang, EURLEX_BASE),
        },
        error: {
          code: 'ambiguous_oj_reference',
          message: 'Official Journal reference matched multiple act types',
        },
      };
    } else {
      payload = {
        resolved: null,
        tried,
        fallback: {
          type: 'open-source-url',
          url: buildEurlexOjFallbackUrl(oj, lang, toSearchLang, EURLEX_BASE),
        },
      };
    }

    cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
    return payload;
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

    if (parsed.type === 'oj') {
      const resolution = await resolveOfficialJournalViaCellar(parsed.oj, lang);
      const payload = {
        sourceUrl: parsed.url.toString(),
        parsed: {
          type: parsed.type,
          oj: parsed.oj,
        },
        resolved: resolution.resolved,
        tried: resolution.tried,
        fallback: resolution.fallback || {
          type: 'open-source-url',
          url: parsed.url.toString(),
        },
        ...(resolution.error ? { error: resolution.error } : {}),
      };
      cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
      return payload;
    }

    const payload = {
      sourceUrl: parsed.url.toString(),
      parsed: {
        type: parsed.type,
      },
      resolved: null,
      fallback: {
        type: 'open-source-url',
        url: parsed.url.toString(),
      },
    };
    cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
    return payload;
  }

  return {
    resolveEurlexUrl,
    resolveOfficialJournalViaCellar,
    resolveReferenceViaCellar,
    runSparqlQuery,
  };
}

module.exports = {
  buildEliCandidates,
  createReferenceResolver,
  extractCelexFromText,
  parseEurlexUrl,
  parseReferenceText,
  parseStructuredReference,
  validateCelex,
};
