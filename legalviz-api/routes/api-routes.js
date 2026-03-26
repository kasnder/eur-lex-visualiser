const fs = require("fs");

const { ClientError } = require("../shared/api-utils");
const { createSearchHandler } = require("../search/search-route");

function registerApiRoutes(app, deps) {
  const {
    CELEX_NAMES,
    EURLEX_BASE,
    FMX_DIR,
    RATE_LIMIT_MAX,
    RESOLUTION_CACHE_MS,
    cacheGet,
    cacheSet,
    findDownloadUrls,
    findFmx4Uri,
    parseReferenceText,
    parseStructuredReference,
    prepareLawPayload,
    rateLimitMiddleware,
    resolutionCache,
    resolveEurlexUrl,
    resolveReferenceViaCellar,
    runSparqlQuery,
    safeErrorResponse,
    searchIndex,
    sendLawResponse,
    validateCelex,
    validateLang
  } = deps;

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/laws', rateLimitMiddleware, (req, res) => {
    try {
      const files = fs.readdirSync(FMX_DIR);
      const laws = files.filter((filename) => filename.endsWith('.xml') || filename.endsWith('.zip'));
      res.json({ laws });
    } catch (err) {
      safeErrorResponse(res, err, 'Failed to list cached laws');
    }
  });

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

  app.get('/api/laws/:celex/metadata', rateLimitMiddleware, async (req, res) => {
    try {
      const { celex } = req.params;

      if (!validateCelex(celex)) {
        return res.status(400).json({ error: 'Invalid CELEX format' });
      }

      const cacheKey = `metadata:${celex}`;
      const cached = cacheGet(resolutionCache, cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const celexUri = `http://publications.europa.eu/resource/celex/${celex}`;
      const query = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT
  ?dateEntryIntoForce ?dateEndOfValidity ?inForce
  ?eli ?dateSignature ?dateDocument ?eea
WHERE {
  ?work owl:sameAs <${celexUri}> .
  OPTIONAL { ?work cdm:resource_legal_date_entry-into-force ?dateEntryIntoForce }
  OPTIONAL { ?work cdm:resource_legal_date_end-of-validity ?dateEndOfValidity }
  OPTIONAL { ?work cdm:resource_legal_in-force ?inForce }
  OPTIONAL { ?work cdm:resource_legal_eli ?eli }
  OPTIONAL { ?work cdm:resource_legal_date_signature ?dateSignature }
  OPTIONAL { ?work cdm:work_date_document ?dateDocument }
  OPTIONAL { ?work cdm:resource_legal_eea ?eea }
}
LIMIT 10`;

      const data = await runSparqlQuery(query);
      const bindings = data.results?.bindings || [];
      const entryDates = [...new Set(bindings.map((binding) => binding.dateEntryIntoForce?.value).filter(Boolean))].sort();
      const firstBinding = bindings[0] || {};

      const payload = {
        celex,
        entryIntoForce: entryDates,
        endOfValidity: firstBinding.dateEndOfValidity?.value || null,
        inForce: firstBinding.inForce?.value === 'true',
        eli: firstBinding.eli?.value || null,
        dateSignature: firstBinding.dateSignature?.value || null,
        dateDocument: firstBinding.dateDocument?.value || null,
        eea: firstBinding.eea?.value === 'true',
      };

      cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
      res.json(payload);
    } catch (err) {
      safeErrorResponse(res, err, 'Failed to fetch law metadata');
    }
  });

  app.get('/api/laws/:celex/amendments', rateLimitMiddleware, async (req, res) => {
    try {
      const { celex } = req.params;

      if (!validateCelex(celex)) {
        return res.status(400).json({ error: 'Invalid CELEX format' });
      }

      const cacheKey = `amendments:${celex}`;
      const cached = cacheGet(resolutionCache, cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const celexUri = `http://publications.europa.eu/resource/celex/${celex}`;
      const query = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT DISTINCT ?type ?sourceCelex ?date WHERE {
  ?work owl:sameAs <${celexUri}> .
  ?ax owl:annotatedTarget ?work ;
      owl:annotatedProperty ?p ;
      owl:annotatedSource ?sourceWork .
  FILTER(?p IN (cdm:resource_legal_amends_resource_legal, cdm:resource_legal_corrects_resource_legal))
  BIND(IF(?p = cdm:resource_legal_corrects_resource_legal, "corrigendum", "amendment") AS ?type)
  ?sourceWork owl:sameAs ?sourceCelex .
  FILTER(STRSTARTS(STR(?sourceCelex), "http://publications.europa.eu/resource/celex/"))
  OPTIONAL { ?sourceWork cdm:work_date_document ?date }
}
ORDER BY ?date
LIMIT 50`;

      const data = await runSparqlQuery(query);
      const amendments = (data.results?.bindings || []).map((binding) => {
        const rawCelex = binding.sourceCelex?.value?.split('/').pop() || null;
        const amendingCelex = rawCelex ? decodeURIComponent(rawCelex) : null;
        return {
          celex: amendingCelex,
          date: binding.date?.value || null,
          type: binding.type?.value || 'amendment'
        };
      }).filter((amendment) => amendment.celex);

      const payload = { celex, amendments };
      cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
      res.json(payload);
    } catch (err) {
      safeErrorResponse(res, err, 'Failed to fetch amendment history');
    }
  });

  app.get('/api/laws/:celex/implementing', rateLimitMiddleware, async (req, res) => {
    try {
      const { celex } = req.params;

      if (!validateCelex(celex)) {
        return res.status(400).json({ error: 'Invalid CELEX format' });
      }

      const cacheKey = `implementing:${celex}`;
      const cached = cacheGet(resolutionCache, cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const celexUri = `http://publications.europa.eu/resource/celex/${celex}`;
      const query = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT DISTINCT ?actCelex ?date ?title WHERE {
  ?work owl:sameAs <${celexUri}> .
  ?ax owl:annotatedTarget ?work ;
      owl:annotatedProperty cdm:resource_legal_based_on_resource_legal ;
      owl:annotatedSource ?actWork .
  ?actWork owl:sameAs ?actCelex .
  FILTER(STRSTARTS(STR(?actCelex), "http://publications.europa.eu/resource/celex/"))
  OPTIONAL { ?actWork cdm:work_date_document ?date }
  OPTIONAL {
    ?actWork cdm:resource_legal_title ?titleExpr .
    FILTER(LANG(?titleExpr) = "en")
    BIND(STR(?titleExpr) AS ?title)
  }
}
ORDER BY ?date
LIMIT 100`;

      const data = await runSparqlQuery(query);
      const acts = (data.results?.bindings || []).map((binding) => {
        const rawCelex = binding.actCelex?.value?.split('/').pop() || null;
        const actCelex = rawCelex ? decodeURIComponent(rawCelex) : null;
        return {
          celex: actCelex,
          date: binding.date?.value || null,
          title: binding.title?.value || null,
        };
      }).filter((act) => act.celex);

      const payload = { celex, acts };
      cacheSet(resolutionCache, cacheKey, payload, RESOLUTION_CACHE_MS);
      res.json(payload);
    } catch (err) {
      safeErrorResponse(res, err, 'Failed to fetch implementing acts');
    }
  });

  app.get('/api/search', rateLimitMiddleware, createSearchHandler(searchIndex));

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
        'GET /api/search?q=keyword&limit=10': 'Search cached primary-law metadata',
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
      }
    });
  });
}

module.exports = {
  registerApiRoutes
};
