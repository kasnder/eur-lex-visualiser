"use strict";

// Offline rebuild of the MiniSearch metadata cache (search-cache.json) from the
// already-downloaded local raw-law corpus (search/data/laws + laws-html).
//
// The normal builder (search-build.js) harvests via SPARQL and fetches every
// act from CELLAR/EUR-Lex. This script does the same enrichment (title +
// excerpt via the shared parsers) but purely from disk — no network at all — so
// it can extend the cache's year coverage back to the start of the corpus.
//
// Strategy:
//   - Reuse the existing 2010-2026 records verbatim (they carry a SPARQL-derived
//     precise date + eli that can't be reconstructed offline).
//   - Build pre-2010 additions from the corpus: title + excerpt from parsing the
//     gzipped source, metadata (celex/type/eli) derived deterministically. The
//     date is the precise work_date_document from the harvest-time sidecar
//     manifest (law-dates.json, written by search-build.js) when available,
//     otherwise null — the raw source on disk doesn't carry the date.
//   - Merge and dedup by CELEX (existing > FMX > HTML).
//
// FMX parsing uses jsdom, which leaks: a single process OOMs around ~500 parses.
// So parsing runs in short-lived child processes (this same file re-invoked with
// --worker), pooled `CONCURRENCY` at a time; each writes a partial JSON that the
// driver merges. `fetch` is hard-blocked in the worker so a corpus miss fails
// loudly instead of silently hitting the network.
//
// --rederive mode (issue #180): the shipped cache can carry `title`/`excerpt`
// derived by an older PARSER_VERSION with no version stamp at all. `--rederive`
// re-parses every existing record that has a corpus file, regardless of year,
// and lets the freshly derived title/excerpt win — every other field (eurovoc
// topics, in-force status, date, and the alias/normalized fields
// `enrichSearchRecord` derives from title) is preserved exactly. An act with no
// corpus file, or whose parse fails, keeps its existing record untouched, and
// the output record count can never regress. See `mergeRederivedRecords` /
// `computeRederiveParserStamp` below, which are the pure, unit-testable core of
// this mode — the driver just wires them to the worker-batch machinery above.

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");

const { readCorpusDates, normalizeCelexKey } = require("./law-corpus-dates.js");
const { listCorpusFiles: listCorpusEntries } = require("./corpus-files.js");
const { enrichRecordsWithEurovoc } = require("./eurovoc-enrich.js");
const { enrichRecordsWithInForce } = require("./in-force-enrich.js");
const { getCurrentParserVersion, mergeParserStamp } = require("./parser-stamp.js");

// Overridable so tests can point the whole build at a throwaway fixture corpus
// instead of the real (huge) checked-out corpus under search/data. Everything
// below (FMX/HTML roots, cache path, backup path) is derived from this, so one
// env var redirects the entire build.
const CORPUS_DIR = process.env.CORPUS_BUILD_CORPUS_DIR
  ? path.resolve(process.env.CORPUS_BUILD_CORPUS_DIR)
  : path.join(__dirname, "data");
const FMX_ROOT = path.join(CORPUS_DIR, "laws");
const HTML_ROOT = path.join(CORPUS_DIR, "laws-html");
const CACHE_PATH = path.join(CORPUS_DIR, "search-cache.json");
const BACKUP_PATH = path.join(CORPUS_DIR, "search-cache.json.bak");

// Stable work dir (not a fresh mkdtemp) so an interrupted run's parsed partials
// survive and are reused on the next run. Resume is keyed by CELEX coverage, not
// batch index, so it stays correct even if batch boundaries shift. Removed only
// after a fully successful build; override for tests/isolation.
//
// --rederive uses a *separate*, parser-version-keyed work dir (see driver()
// below): a work dir seeded by parser v21 must never be treated as coverage for
// a v22 rederive run, since its parsed title/excerpt would be stale by
// definition. Keying by version means an old rederive work dir is simply
// ignored (and safe to leave on disk, or delete by hand) once the parser moves
// on; the default (non-rederive) mode is unaffected and keeps this exact path.
const WORK_DIR = process.env.CORPUS_BUILD_WORKDIR || path.join(os.tmpdir(), "corpus-build-work");

// Everything strictly older than this comes from the corpus; this year and
// newer is reused from the existing cache as-is.
const REUSE_FROM_YEAR = 2010;

// Batch sizes chosen from measured RSS growth: FMX (jsdom, ~1.5GB at 300 parses)
// stays well under the ~500-parse OOM cliff; HTML leaks less.
// Env-overridable so a batch that OOMs on a cluster of unusually large docs can
// be retried with smaller batches (the parser's per-doc memory isn't fully
// released between files, so a few large docs in one batch can exceed the heap).
const FMX_BATCH = Number(process.env.CORPUS_BUILD_FMX_BATCH) || 300;
const HTML_BATCH = Number(process.env.CORPUS_BUILD_HTML_BATCH) || 500;
const CONCURRENCY = Number(process.env.CORPUS_BUILD_CONCURRENCY) || 3;
const WORKER_HEAP_MB = 4096;

const ELI_SEGMENT = { regulation: "reg", directive: "dir", decision: "dec" };

// ---------------------------------------------------------------------------
// Worker: parse a batch of corpus files into raw (pre-enrichment) records.
// ---------------------------------------------------------------------------

async function runWorker(variant, batchPath, outPath) {
  // Zero-network guarantee: any accidental fetch (e.g. a corpus miss falling
  // back to the network) throws instead of silently scraping EUR-Lex.
  global.fetch = () => {
    throw new Error("NETWORK BLOCKED (offline corpus build)");
  };

  const {
    buildExcerptFromCombined,
    extractOfficialTitleAndExcerpt,
    extractTitleFromEurlexHtml,
  } = require("./search-build.js");
  const { parseEurlexHtmlToCombined } = require("../shared/eurlex-html-parser.js");

  const batch = JSON.parse(fs.readFileSync(batchPath, "utf8"));
  const records = [];

  for (const { celex, file } of batch) {
    let title = null;
    let excerpt = "";
    let ok = false;
    try {
      if (variant === "fmx") {
        // Corpus-first title+excerpt: reads laws/<year>/<celex>.xml.gz from disk,
        // uses the regex title extractor (combined.title is unreliable for FMX).
        const res = await extractOfficialTitleAndExcerpt(celex, {
          corpusDir: CORPUS_DIR,
          useCorpus: true,
        });
        title = res.title || null;
        excerpt = res.excerpt || "";
        ok = true;
      } else {
        const raw = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
        const combined = await parseEurlexHtmlToCombined(raw, "ENG");
        title = combined.title || extractTitleFromEurlexHtml(raw) || null;
        excerpt = buildExcerptFromCombined(combined) || "";
        ok = true;
      }
    } catch (error) {
      records.push({
        celex,
        title: null,
        date: null,
        eli: buildPrimaryEli(celex),
        type: inferType(celex),
        fmxAvailable: false,
        fmxUnavailable: variant === "html",
        enrichError: String(error.message || error).slice(0, 300),
        excerpt: "",
      });
      continue;
    }

    records.push({
      celex,
      title,
      date: null,
      eli: buildPrimaryEli(celex),
      type: inferType(celex),
      fmxAvailable: variant === "fmx" && ok,
      fmxUnavailable: variant === "html",
      enrichError: null,
      excerpt,
    });
  }

  // Atomic write: a SIGKILL (e.g. OS memory pressure) mid-write must not leave a
  // truncated partial that a resume would read as valid coverage.
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records));
  fs.renameSync(tmp, outPath);
}

// All CELEX ids covered by partials already written to the work dir — the resume
// key. Corrupt/half-written partials are ignored (those celexes get redone).
function loadParsedCelexes(workDir) {
  const parsed = new Set();
  if (!fs.existsSync(workDir)) return parsed;
  for (const f of fs.readdirSync(workDir)) {
    if (!/-out-.*\.json$/.test(f)) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(workDir, f), "utf8"));
      for (const rec of arr) {
        const key = normCelex(rec.celex);
        if (key) parsed.add(key);
      }
    } catch { /* ignore corrupt partial */ }
  }
  return parsed;
}

// Deterministic metadata from the CELEX id (offline substitutes for SPARQL).
function inferType(celex) {
  const marker = String(celex || "")[5];
  if (marker === "R") return "regulation";
  if (marker === "L") return "directive";
  if (marker === "D") return "decision";
  return "unknown";
}

function buildPrimaryEli(celex) {
  const match = String(celex || "").match(/^3(\d{4})([RLD])0*(\d{1,4})/);
  if (!match) return null;
  const type = inferType(celex);
  const segment = ELI_SEGMENT[type];
  if (!segment) return null;
  const year = match[1];
  const number = String(Number.parseInt(match[3], 10));
  return `http://data.europa.eu/eli/${segment}/${year}/${number}/oj`;
}

// ---------------------------------------------------------------------------
// --rederive: pure merge/stamp core (no fs, no workers — easy to unit test).
// ---------------------------------------------------------------------------

// Folds freshly re-parsed worker output (`rawRecords`, the same shape
// `runWorker` writes for the normal mode) onto the existing cache. For each raw
// record whose CELEX is in the existing cache:
//   - a failed parse (rec.enrichError set) leaves the existing record untouched
//     and counts as `failed`;
//   - a successful parse overwrites ONLY `title` (when non-empty — an empty
//     fresh title is not allowed to erase a good existing one) and `excerpt`
//     (always, even to "", since a genuinely empty excerpt is itself a fresh
//     result) on a shallow copy of the existing record, then re-runs
//     `enrichSearchRecord` so the derived fields (normalizedTitle, aliases,
//     eliKind, isPrimaryAct, ...) stay consistent with the new title. Every
//     other field — eurovoc topics, in-force status, date, eli, etc. — comes
//     through the `{ ...existing }` spread untouched.
// A raw record whose CELEX isn't in the existing cache is ignored: rederive
// never adds new acts, only refreshes ones already present.
//
// `corpusCoveredKeys` is the set of existing CELEX keys that have *any* corpus
// file (FMX or HTML) — used to report both records with no corpus file and
// corpus-covered records whose worker output never came back.
function mergeRederivedRecords({ existingRecords, rawRecords, corpusCoveredKeys, enrichSearchRecord }) {
  const existingByCelex = new Map(existingRecords.map((rec) => [normCelex(rec.celex), rec]));

  const rederived = [];
  const returnedKeys = new Set();
  let rederivedCount = 0;
  let failedCount = 0;
  let excerptChangedCount = 0;

  for (const raw of rawRecords) {
    const key = normCelex(raw.celex);
    const existing = existingByCelex.get(key);
    if (!existing) continue; // not part of the existing cache; out of scope
    returnedKeys.add(key);

    if (raw.enrichError) {
      failedCount += 1;
      continue; // existing record is preserved untouched via the merge below
    }

    const next = { ...existing };
    if (raw.title) next.title = raw.title;
    next.excerpt = typeof raw.excerpt === "string" ? raw.excerpt : "";
    if (next.excerpt !== (existing.excerpt || "")) excerptChangedCount += 1;
    rederived.push(enrichSearchRecord(next));
    rederivedCount += 1;
  }

  // Rederived records win for their CELEX; every other existing record (no
  // corpus file, or a failed parse) is pushed through unchanged. Order matters
  // for `push`'s existing-wins-by-key dedup: rederived first, then existing.
  const merged = [];
  const mergedSeen = new Set();
  const push = (rec) => {
    const key = normCelex(rec.celex);
    if (!key || mergedSeen.has(key)) return;
    mergedSeen.add(key);
    merged.push(rec);
  };
  for (const rec of rederived) push(rec);
  for (const rec of existingRecords) push(rec);

  // Never drop records: rederive only refreshes fields on existing CELEX keys,
  // it never removes one. Compare against the number of *distinct, keyable*
  // existing records rather than the raw array length — a duplicate CELEX or a
  // record with no CELEX at all is collapsed by `push` in the default mode too,
  // and aborting a multi-hour pass at the write step over one malformed legacy
  // row would be a worse outcome than reporting it.
  const expected = new Set();
  let unkeyable = 0;
  for (const rec of existingRecords) {
    const key = normCelex(rec.celex);
    if (key) expected.add(key);
    else unkeyable += 1;
  }
  if (merged.length < expected.size) {
    throw new Error(
      `[corpus-build] rederive record count regressed: ${expected.size} -> ${merged.length}`
    );
  }

  // A record with no corpus file was not re-derived. Whether that matters for
  // the stamp depends on whether it carries parser output at all: a record
  // harvested from SPARQL alone has a title and no excerpt, so there is no
  // stale parse in it to misrepresent. One that *does* carry an excerpt was
  // parsed by some earlier version and is now unreachable offline — that is
  // what keeps the payload from honestly claiming a single current version.
  let noCorpusFileCount = 0;
  let staleUncoveredCount = 0;
  let missedCount = 0;
  for (const [key, rec] of existingByCelex) {
    if (corpusCoveredKeys.has(key)) {
      // A failed worker batch leaves no raw record at all. Count that gap here
      // so it cannot disappear from the parser-stamp decision.
      if (!returnedKeys.has(key)) missedCount += 1;
      continue;
    }
    noCorpusFileCount += 1;
    if (rec.excerpt) staleUncoveredCount += 1;
  }

  return {
    merged,
    stats: {
      rederived: rederivedCount,
      failed: failedCount,
      noCorpusFile: noCorpusFileCount,
      staleUncovered: staleUncoveredCount,
      missed: missedCount,
      excerptChanged: excerptChangedCount,
      unkeyable,
    },
  };
}

// A bare current-version stamp claims every *parser-derived* field in the
// payload came from that version, so it is only honest when this run left no
// stale parse behind: no failed parse, no corpus-covered record missed by this
// run, and no record still carrying an excerpt from an earlier version that no
// corpus file could refresh. Records with no corpus file and no excerpt are not
// a gap — they never held parser output in the first place, and the cache holds
// tens of thousands of them (SPARQL-only acts outside the harvested corpus), so
// counting them would make a bare stamp unreachable forever. Any real gap means
// some records still reflect whatever parser produced the existing payload, so
// the stamp must MERGE with whatever the payload already carried (mirrors the
// same bare-vs-merge decision in search-build.js's reEnrichCurrentCache).
function computeRederiveParserStamp({ existingParserVersion, currentParserVersion, stats }) {
  const isCompleteRederive = stats.failed === 0
    && (stats.staleUncovered || 0) === 0
    && (stats.missed || 0) === 0;
  return isCompleteRederive
    ? currentParserVersion
    : mergeParserStamp(existingParserVersion, currentParserVersion);
}

// ---------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------

function normCelex(celex) {
  return String(celex || "").trim().toUpperCase();
}

function listCorpusFiles(root, ext, maxYearExclusive) {
  return listCorpusEntries({ root, extension: ext, maxYearExclusive });
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function spawnWorker(variant, batchPath, outPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${WORKER_HEAP_MB}`, __filename, "--worker", variant, batchPath, outPath],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function runPool(jobs, concurrency) {
  let next = 0;
  let done = 0;
  const failed = [];
  const total = jobs.length;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      try {
        await jobs[i].run();
      } catch (error) {
        failed.push({ job: jobs[i].label, error: error.message });
        console.error(`[corpus-build] FAILED ${jobs[i].label}: ${error.message}`);
      }
      done++;
      if (done % 10 === 0 || done === total) {
        console.log(`[corpus-build] ${done}/${total} batches complete`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return failed;
}

async function driver({ noEurovoc = false, noInForce = false, rederive = false } = {}) {
  const t0 = Date.now();
  const { enrichSearchRecord } = require("./search-ranking.js");

  if (!fs.existsSync(CACHE_PATH)) throw new Error(`Existing cache not found at ${CACHE_PATH}`);
  const existing = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  const existingRecords = Array.isArray(existing.records) ? existing.records : [];
  const seen = new Set(existingRecords.map((r) => normCelex(r.celex)).filter(Boolean));
  console.log(`[corpus-build] Existing cache: ${existingRecords.length} records`);

  // --rederive gets its own, parser-version-keyed work dir (see the WORK_DIR
  // comment above): a work dir seeded by a different parser version must never
  // be read as coverage, since its parsed title/excerpt would be stale by
  // definition. Default mode is unaffected and keeps the plain WORK_DIR path.
  const currentParserVersion = rederive ? await getCurrentParserVersion() : null;
  const workDir = rederive ? `${WORK_DIR}-rederive-v${currentParserVersion}` : WORK_DIR;

  // Resume: reuse partials from a previous (possibly interrupted) run. Keyed by
  // CELEX coverage so it's correct regardless of how batches are chunked.
  fs.mkdirSync(workDir, { recursive: true });
  const alreadyParsed = loadParsedCelexes(workDir);
  if (alreadyParsed.size) {
    console.log(`[corpus-build] Resume: ${alreadyParsed.size} records already parsed in ${workDir}`);
  }

  // FMX first (preferred), then HTML only for celexes not covered by FMX.
  //   default mode: only pre-REUSE_FROM_YEAR acts NOT already in the cache.
  //   --rederive:   every year, and ONLY celexes ALREADY in the cache — it
  //                 refreshes existing records, it never adds new ones (see
  //                 mergeRederivedRecords, which silently ignores any raw
  //                 record whose CELEX isn't in the existing cache).
  const yearFloor = rederive ? undefined : REUSE_FROM_YEAR;
  const fmxAll = listCorpusFiles(FMX_ROOT, ".xml.gz", yearFloor);
  const fmxJobs = [];
  const fmxSeen = new Set();
  for (const item of fmxAll) {
    const key = normCelex(item.celex);
    if (rederive ? !seen.has(key) : seen.has(key)) continue;
    if (fmxSeen.has(key) || alreadyParsed.has(key)) continue;
    fmxSeen.add(key);
    fmxJobs.push(item);
  }

  const htmlAll = listCorpusFiles(HTML_ROOT, ".html.gz", yearFloor);
  const htmlJobs = [];
  const htmlSeen = new Set();
  for (const item of htmlAll) {
    const key = normCelex(item.celex);
    if (rederive ? !seen.has(key) : seen.has(key)) continue;
    if (fmxSeen.has(key) || htmlSeen.has(key) || alreadyParsed.has(key)) continue;
    htmlSeen.add(key);
    htmlJobs.push(item);
  }

  console.log(
    rederive
      ? `[corpus-build] Rederive: FMX=${fmxJobs.length} HTML=${htmlJobs.length} corpus files to reparse (no year floor)`
      : `[corpus-build] Pre-${REUSE_FROM_YEAR} still to build: FMX=${fmxJobs.length} HTML=${htmlJobs.length}`
  );

  // This run's partials go into the shared work dir under a unique run id so they
  // never collide with partials carried over from an earlier interrupted run.
  const runId = Date.now().toString(36);
  const jobs = [];

  const fmxBatches = chunk(fmxJobs, FMX_BATCH);
  fmxBatches.forEach((batch, idx) => {
    const batchPath = path.join(workDir, `fmx-batch-${runId}-${idx}.json`);
    const outPath = path.join(workDir, `fmx-out-${runId}-${idx}.json`);
    fs.writeFileSync(batchPath, JSON.stringify(batch));
    jobs.push({ label: `fmx#${idx}`, run: () => spawnWorker("fmx", batchPath, outPath) });
  });

  const htmlBatches = chunk(htmlJobs, HTML_BATCH);
  htmlBatches.forEach((batch, idx) => {
    const batchPath = path.join(workDir, `html-batch-${runId}-${idx}.json`);
    const outPath = path.join(workDir, `html-out-${runId}-${idx}.json`);
    fs.writeFileSync(batchPath, JSON.stringify(batch));
    jobs.push({ label: `html#${idx}`, run: () => spawnWorker("html", batchPath, outPath) });
  });

  console.log(`[corpus-build] Spawning ${jobs.length} worker batches, concurrency=${CONCURRENCY}`);
  const failed = await runPool(jobs, CONCURRENCY);

  // Collect ALL partials in the work dir (this run + any carried over from an
  // interrupted run). Dedup by CELEX happens in the merges below, so overlap
  // between partials is harmless.
  const rawRecords = [];
  for (const f of fs.readdirSync(workDir)) {
    if (!/-out-.*\.json$/.test(f)) continue;
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(workDir, f), "utf8")); }
    catch { continue; } // skip a corrupt/half-written partial
    rawRecords.push(...raw);
  }

  let merged;
  let payload;

  if (rederive) {
    // Any existing CELEX with a corpus file (FMX or HTML, any year) is
    // "covered" — used only to report how many existing records had no corpus
    // file to rederive from at all (see mergeRederivedRecords).
    const corpusCoveredKeys = new Set();
    for (const item of fmxAll) corpusCoveredKeys.add(normCelex(item.celex));
    for (const item of htmlAll) corpusCoveredKeys.add(normCelex(item.celex));

    const result = mergeRederivedRecords({ existingRecords, rawRecords, corpusCoveredKeys, enrichSearchRecord });
    merged = result.merged;
    // Same ordering as buildSearchCache: newest first, records without a date
    // (corpus acts missing from the manifest) last.
    merged.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    const parserVersion = computeRederiveParserStamp({
      existingParserVersion: existing.parserVersion,
      currentParserVersion,
      stats: result.stats,
    });

    const years = merged.map((r) => Number(r.celexYear)).filter((y) => Number.isFinite(y));
    // Field order matters: parserVersion must precede records so
    // assert-parser-freshness.js's streaming header scan finds it without
    // reading the (huge) records array first.
    payload = {
      generatedAt: new Date().toISOString(),
      fromYear: years.length ? Math.max(...years) : existing.fromYear,
      toYear: years.length ? Math.min(...years) : existing.toYear,
      parserVersion,
      count: merged.length,
      records: merged,
    };

    console.log("[corpus-build] Rederive report:");
    console.log(`  re-derived:                 ${result.stats.rederived}`);
    console.log(`  unchanged (no corpus file): ${result.stats.noCorpusFile}`);
    console.log(`    of those, with an excerpt: ${result.stats.staleUncovered}`);
    console.log(`  failed:                     ${result.stats.failed}`);
    console.log(`  missed (corpus-covered):    ${result.stats.missed}`);
    console.log(`  excerpt changed:            ${result.stats.excerptChanged}`);
    console.log(`  parserVersion stamp:        ${JSON.stringify(parserVersion)}`);
  } else {
    // Precise dates harvested from SPARQL (work_date_document), persisted by
    // search-build.js at harvest time. Overlay them onto the corpus records (the
    // offline worker has no date). A CELEX missing from the manifest keeps its
    // null date until the next harvest populates it.
    const corpusDates = readCorpusDates(CORPUS_DIR);
    let preciseDates = 0;
    const newRecords = [];
    for (const rec of rawRecords) {
      const enriched = enrichSearchRecord(rec);
      const precise = corpusDates[normalizeCelexKey(enriched.celex)];
      if (precise) {
        enriched.date = precise;
        preciseDates += 1;
      }
      newRecords.push(enriched);
    }
    console.log(`[corpus-build] Parsed ${newRecords.length} corpus records (${preciseDates} with precise SPARQL dates, ${failed.length} batches failed this run)`);

    // Merge: existing (as-is) + new, dedup by CELEX (existing wins), primary only.
    merged = [];
    const mergedSeen = new Set();
    const push = (rec) => {
      const key = normCelex(rec.celex);
      if (!key || mergedSeen.has(key)) return;
      mergedSeen.add(key);
      merged.push(rec);
    };
    for (const rec of existingRecords) push(rec);
    for (const rec of newRecords) {
      if (!rec.isPrimaryAct) continue;
      push(rec);
    }

    // Same ordering as buildSearchCache: newest first, records without a date
    // (corpus acts missing from the manifest) last.
    merged.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    const years = merged.map((r) => Number(r.celexYear)).filter((y) => Number.isFinite(y));
    payload = {
      generatedAt: new Date().toISOString(),
      fromYear: years.length ? Math.max(...years) : existing.fromYear,
      toYear: years.length ? Math.min(...years) : existing.toYear,
      count: merged.length,
      records: merged,
    };
  }

  // EuroVoc topics and in-force status are SPARQL metadata that can't be
  // reconstructed from disk. --rederive is specifically a parser-fields-only
  // pass (title/excerpt), and mergeRederivedRecords already preserves these
  // fields exactly from the existing record, so refreshing them here would
  // both add an unwanted network dependency to an otherwise-offline rederive
  // and risk drifting them from whatever a separate harvest already set. In
  // the default mode this is unchanged: the only network calls in an
  // otherwise offline build, run *here in the driver* (the workers keep their
  // hard `fetch` block), opt-out via --no-eurovoc / --no-in-force.
  //
  // It runs as part of the build rather than as a follow-up pass because a
  // CELEX-keyed sidecar bolted on afterwards strands every record it never saw,
  // silently (see eurovoc-enrich.js). Best-effort: topics never fail a build.
  if (rederive) {
    console.log("[corpus-build] EuroVoc/in-force enrichment skipped (--rederive preserves them as-is)");
  } else if (noEurovoc) {
    console.log("[corpus-build] EuroVoc enrichment skipped (--no-eurovoc)");
  } else {
    try {
      const stats = await enrichRecordsWithEurovoc(payload.records, {
        log: (message) => console.log(`[corpus-build] [eurovoc] ${message}`),
      });
      console.log(`[corpus-build] EuroVoc: ${stats.withLabels} records with topics (${stats.fromJournal} from journal, ${stats.fetched} fetched)`);
    } catch (error) {
      console.log(`[corpus-build] EuroVoc enrichment failed, cache ships without topics: ${error.message}`);
    }
  }

  if (!rederive) {
    if (noInForce) {
      console.log("[corpus-build] In-force enrichment skipped (--no-in-force)");
    } else {
      try {
        const stats = await enrichRecordsWithInForce(payload.records, {
          log: (message) => console.log(`[corpus-build] [in-force] ${message}`),
        });
        console.log(`[corpus-build] In-force: ${stats.withStatus} records with status, ${stats.inForce} in force (${stats.fromJournal} from journal, ${stats.fetched} fetched)`);
      } catch (error) {
        console.log(`[corpus-build] In-force enrichment failed, cache ships without status: ${error.message}`);
      }
    }
  }

  // Back up the old cache, then write the new one atomically.
  if (fs.existsSync(CACHE_PATH) && !fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(CACHE_PATH, BACKUP_PATH);
    console.log(`[corpus-build] Backed up existing cache -> ${BACKUP_PATH}`);
  }
  const tmpCache = `${CACHE_PATH}.tmp`;
  fs.writeFileSync(tmpCache, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tmpCache, CACHE_PATH);

  // Keep the work dir if anything failed this run, so a re-run resumes and
  // retries only the still-missing celexes; clear it only on a clean build.
  if (failed.length === 0) {
    await fsp.rm(workDir, { recursive: true, force: true });
  } else {
    console.log(`[corpus-build] Kept ${workDir} for resume (${failed.length} batches failed)`);
  }

  const withExcerpt = merged.filter((r) => r.excerpt && r.excerpt.length > 0).length;
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  console.log("[corpus-build] DONE");
  console.log(`  records:      ${payload.count}`);
  console.log(`  with excerpt: ${withExcerpt} (${((withExcerpt / payload.count) * 100).toFixed(1)}%)`);
  console.log(`  year range:   ${payload.toYear}-${payload.fromYear}`);
  console.log(`  runtime:      ${dt}s`);
  if (failed.length) console.log(`  failed batches: ${failed.length}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--worker") {
    const [, variant, batchPath, outPath] = args;
    await runWorker(variant, batchPath, outPath);
    return;
  }
  await driver({
    noEurovoc: args.includes("--no-eurovoc"),
    noInForce: args.includes("--no-in-force"),
    rederive: args.includes("--rederive"),
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildPrimaryEli,
  inferType,
  listCorpusFiles,
  driver,
  mergeRederivedRecords,
  computeRederiveParserStamp,
};
