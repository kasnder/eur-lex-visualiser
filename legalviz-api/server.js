const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { SearchIndex, DEFAULT_SEARCH_CACHE_PATH } = require('./search/search-index');
const { registerApiRoutes } = require('./routes/api-routes');
const { createFmxService } = require('./shared/fmx-service');
const { createRateLimitMiddleware } = require('./shared/rate-limit');
const {
  createReferenceResolver,
  parseReferenceText,
  parseStructuredReference,
  validateCelex,
} = require('./shared/reference-utils');
const {
  cacheGet,
  cacheSet,
  safeErrorResponse,
  toSearchLang,
  validateLang
} = require('./shared/api-utils');

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

const resolutionCache = new Map(); // key -> { expiresAt, value }
const RESOLUTION_CACHE_MS = 24 * 60 * 60 * 1000;
const searchIndex = new SearchIndex(process.env.SEARCH_CACHE_PATH || DEFAULT_SEARCH_CACHE_PATH);
const rateLimitMiddleware = createRateLimitMiddleware({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX
});

// Middleware
app.use(cors());
app.use(express.json());

// Ensure download directory exists
if (!fs.existsSync(FMX_DIR)) {
  fs.mkdirSync(FMX_DIR, { recursive: true });
}

searchIndex.loadFromDisk();
const { findDownloadUrls, findFmx4Uri, prepareLawPayload, sendLawResponse } = createFmxService({
  CELLAR_BASE,
  FMX_DIR,
  STORAGE_LIMIT_MB,
  TIMEOUT_MS,
});

const { resolveEurlexUrl, resolveReferenceViaCellar, runSparqlQuery } = createReferenceResolver({
  EURLEX_BASE,
  RESOLUTION_CACHE_MS,
  TIMEOUT_MS,
  cacheGet,
  cacheSet,
  resolutionCache,
  toSearchLang,
});

// CELEX to friendly name mapping
const CELEX_NAMES = {
  '32016R0679': 'GDPR',
  '32024R1689': 'AIA',
  '32022R1925': 'DMA',
  '32022R2065': 'DSA',
  '32022R0868': 'DGA',
  '32023R2854': 'DA'
};

registerApiRoutes(app, {
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
});

app.listen(PORT, () => {
  console.log(`EUR-Lex FMX API running on port ${PORT}`);
  console.log(`Cache directory: ${FMX_DIR}`);
  console.log(`Rate limit: ${RATE_LIMIT_MAX} req/15min per IP`);
  console.log(`Storage limit: ${STORAGE_LIMIT_MB} MB`);
  console.log(`Search cache: ${searchIndex.getStatus().ready ? 'loaded' : 'not loaded'} (${searchIndex.cachePath})`);
});
