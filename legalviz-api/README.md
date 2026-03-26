# EUR-Lex FMX API

Node.js API for:
- fetching and caching FMX/Formex files by CELEX or official reference
- resolving EUR-Lex references through Cellar SPARQL
- searching a local metadata index of primary EU acts

## Current API surface
- `GET /health`
- `GET /api/laws`
- `GET /api/laws/:celex?lang=ENG`
- `GET /api/laws/:celex/info?lang=ENG`
- `GET /api/laws/:celex/metadata`
- `GET /api/laws/:celex/amendments`
- `GET /api/laws/:celex/implementing`
- `GET /api/laws/by-reference?actType=directive&year=2018&number=1972&lang=ENG`
- `GET /api/resolve-reference?...`
- `GET /api/resolve-url?url=https://eur-lex.europa.eu/...&lang=ENG`
- `GET /api/search?q=...&limit=10`

`/api/search` now searches a local metadata cache of primary regulations/directives/decisions instead of scanning cached FMX filenames.

## Search

Search is intentionally narrow and conservative:
- primary acts only
- regulations, directives, decisions
- local metadata cache
- lexical ranking only

Each result returns:
- `celex`
- `title`
- `type`
- `date`
- `eli`
- `fmxAvailable`
- `matchReason`

Examples:

```bash
curl "http://localhost:3000/api/search?q=32016R0679"
curl "http://localhost:3000/api/search?q=regulation%202016/679"
curl "http://localhost:3000/api/search?q=digital%20markets%20act&limit=5"
```

If the search cache has not been built yet, `/api/search` returns `503` with `code=search_cache_unavailable`.

## Search Cache Build

The search cache is built manually and loaded at server startup.

Build it:

```bash
npm run build:search-cache
```

Useful options:

```bash
npm run build:search-cache -- --concurrency 6
npm run build:search-cache -- --resume --concurrency 6
npm run build:search-cache -- --fromYear 2026 --toYear 2010 --limit 200
```

Builder behavior:
- harvests primary `reg|dir|dec` `/eli/.../oj` acts from the official Publications Office SPARQL endpoint
- enriches titles from FMX/Formex where available
- records FMX availability
- writes the cache atomically
- persists resumable build state

Default files:
- search cache: [search/data/search-cache.json](/Users/konrad/Documents/legalviz.eu/legalviz-api/search/data/search-cache.json)
- build state: [search/data/search-build-state.json](/Users/konrad/Documents/legalviz.eu/legalviz-api/search/data/search-build-state.json)

Important: restart the API server after rebuilding the cache, because the cache is loaded on startup.

## Project Layout

```text
legalviz-api/
├─ package.json
├─ server.js
├─ README.md
├─ routes/
│  └─ api-routes.js
├─ search/
│  ├─ search-build.js
│  ├─ search-index.js
│  ├─ search-ranking.js
│  ├─ search-route.js
│  ├─ search-regression.test.js
│  └─ search-route.test.js
└─ shared/
   ├─ api-utils.js
   ├─ fmx-service.js
   ├─ rate-limit.js
   ├─ reference-utils.js
   └─ reference-utils.test.js
```

## Local Development

```bash
cd legalviz-api
npm install
npm start
```

Quick checks:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/laws
curl http://localhost:3000/api/laws/32016R0679?lang=ENG
curl "http://localhost:3000/api/search?q=gdpr"
curl "http://localhost:3000/api/resolve-reference?actType=directive&year=2018&number=1972&lang=ENG"
curl "http://localhost:3000/api/resolve-url?url=https%3A%2F%2Feur-lex.europa.eu%2Feli%2Freg%2F2016%2F679%2Foj&lang=ENG"
```

## Tests

Run all current tests:

```bash
npm test
```

Search-only tests:

```bash
npm run test:search
```

Current test coverage includes:
- search regression ranking checks
- search route behavior
- CELEX/reference parsing helpers

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Port for the API server. |
| `FMX_DIR` | Directory for cached FMX/XML/ZIP downloads. Defaults to `legalviz-api/fmx-downloads`. |
| `RATE_LIMIT_MAX` | Per-IP request cap for the 15-minute window. |
| `STORAGE_LIMIT_MB` | Max size of the FMX download cache before eviction starts. |
| `SEARCH_CACHE_PATH` | Optional override for the search cache JSON path. |

## Notes

- FMX fetching and search are separate concerns. Search does not download FMX files.
- `/api/search` prefers primary acts and deprioritizes implementing/delegated/corrigendum material.
- Search quality is strongest for CELEX, `type + year/number`, and well-titled flagship laws.
- The builder is resumable, but a partially enriched cache is still only best-effort for relevance.

## License

MIT
