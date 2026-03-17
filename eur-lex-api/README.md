# EUR‑Lex FMX API

A minimal **Node.js** REST API that serves the FMX (Formex 4) files you downloaded for EU regulations. The API is ready to be deployed on **Railway** (or any other Node hosting platform).

## Features
- **Health check**: `GET /health`
- **List all available FMX files**: `GET /api/laws`
- **Fetch a specific law by CELEX ID** (e.g. `32016R0679` for GDPR): `GET /api/laws/:celex`
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
```
You should receive JSON listings or the raw FMX file (XML or ZIP) with proper `Content‑Type`.

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
