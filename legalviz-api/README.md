# EUR‑Lex FMX API

A minimal **Node.js** REST API that serves the FMX (Formex 4) files for EU regulations.

## Features
- **Health check**: `GET /health`
- **List all available FMX files**: `GET /api/laws`
- **Fetch a specific law by CELEX ID** (e.g. `32016R0679` for GDPR): `GET /api/laws/:celex`
- **Fetch FMX by official reference**: `GET /api/laws/by-reference?actType=directive&year=2018&number=1972`
- **Resolve an FMX-derived law reference to CELEX via Cellar SPARQL**: `GET /api/resolve-reference?actType=directive&year=2018&number=1972`
- **Resolve a full EUR-Lex URL to CELEX**: `GET /api/resolve-url?url=https://eur-lex.europa.eu/...`
- **Search by keyword**: `GET /api/search?q=keyword`
- CORS enabled for easy client‑side consumption.

## Directory layout
```
 eur-lex-api/
   ├─ package.json
   ├─ server.js          # Express server
   ├─ README.md          # <‑‑ you are reading this
   └─ .gitignore
```
The FMX files live **outside** this folder – in `../eur-lex-visualiser/fmx-downloads/`. The server defaults to that location, but you can override it with the `FMX_DIR` environment variable.

## Quick local test
```bash
# From the workspace root
cd eur-lex-api
npm install          # install Express & CORS
npm start            # starts on PORT (default 3000)
```
Open a browser or use `curl`:
```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/laws
curl http://localhost:3000/api/laws/32016R0679   # GDPR (English)
curl "http://localhost:3000/api/resolve-reference?actType=directive&year=2018&number=1972&raw=Directive%20(EU)%202018/1972&lang=ENG"
curl "http://localhost:3000/api/resolve-url?url=https%3A%2F%2Feur-lex.europa.eu%2Flegal-content%2FEN%2FTXT%2FHTML%2F%3Furi%3DCELEX%253A32016R0679&lang=ENG"
curl "http://localhost:3000/api/laws/by-reference?actType=directive&year=2018&number=1972&raw=Directive%20(EU)%202018/1972&lang=ENG"
```
You should receive JSON listings or the raw FMX file (XML or ZIP) with proper `Content‑Type`.

The URL-based resolver is used by the browser extension import flow:
- the extension opens LegalViz with a `sourceUrl` query parameter
- the frontend calls `/api/resolve-url`
- the API resolves the URL to a canonical CELEX
- the frontend keeps `/import?...` as a compatibility entrypoint, then redirects to the canonical public law route

The reference-based endpoints are designed to consume the structured fields we extract from FMX cross-references, such as:
- `actType=directive|regulation|decision`
- `year=2018`
- `number=1972`
- optional `raw=Directive%20(EU)%202018/1972`
- optional `suffix=JHA`
- optional `ojColl=L&ojNo=321&ojYear=2018`

They then use the official Cellar SPARQL endpoint to resolve the corresponding CELEX identifier. The resolver responds with:
- `resolved`: the best CELEX when confidence is high
- `tried`: the ELI candidates that were attempted
- `fallback.url`: a EUR-Lex search URL to open in a separate tab if resolution fails

`/api/resolve-url` accepts a full EUR-Lex URL and tries, in order:
- direct `CELEX:` extraction when the URL already contains a CELEX identifier
- structured ELI resolution for URLs like `/eli/reg/...`, `/eli/dir/...`, or `/eli/dec/...`
- HTML-based fallback resolution for EUR-Lex text pages, including Official Journal pages that link to the underlying act CELEX

`/api/laws/by-reference` will then fetch FMX using the resolved CELEX and returns structured errors where relevant:
- `code=resolution_failed` when the official reference could not be resolved
- `code=fmx_not_found` when CELEX resolves but no Formex data is available

## Deploying to Railway
1. **Create a Railway project** and link it to this repository (or push the repo to GitHub and connect it).
2. Railway automatically detects a Node project (via `package.json`) and uses the `npm start` script.
3. Set the environment variable `FMX_DIR` to the absolute path of the FMX directory on the Railway container, e.g. `/app/eur-lex-visualiser/fmx-downloads`. If you place the files inside the same repo under `eur-lex-visualiser/fmx-downloads`, Railway will copy them, and the default relative path works out of the box.
4. Click *Deploy* – Railway will `npm install`, run `npm start`, and expose the service on a generated domain.
5. You can now call the API endpoints from anywhere.

## Example Railway environment variables
| Variable | Description |
|----------|-------------|
| `PORT`   | Port Railway assigns (you usually **do not** set this – Railway injects it). |
| `FMX_DIR`| Absolute path to the FMX folder (optional – defaults to `../eur-lex-visualiser/fmx-downloads`). |

## Extending the API
- **Language support**: The server currently maps CELEX IDs to a few filename patterns. To support all languages, enhance `celexMap` and the filename resolution logic.
- **Metadata**: Add a JSON file describing each law (title, date, publication OJ reference) and serve it via `/api/metadata`.
- **Authentication**: If you want to restrict access, plug in any Express auth middleware.

## License
MIT – feel free to adapt or extend.
