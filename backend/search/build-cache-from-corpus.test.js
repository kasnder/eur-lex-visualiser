const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// build-cache-from-corpus.js derives CORPUS_DIR/WORK_DIR from these env vars
// at require time (see the comments beside them in the module), so they must
// be set BEFORE the first require below — not inside a test. Redirecting both
// keeps the one integration test (driver() with --rederive) from ever touching
// the real, huge checked-out corpus under search/data.
const CORPUS_DIR_FOR_TESTS = fs.mkdtempSync(path.join(os.tmpdir(), "build-cache-corpus-"));
const WORK_DIR_FOR_TESTS = fs.mkdtempSync(path.join(os.tmpdir(), "build-cache-workdir-"));
process.env.CORPUS_BUILD_CORPUS_DIR = CORPUS_DIR_FOR_TESTS;
process.env.CORPUS_BUILD_WORKDIR = WORK_DIR_FOR_TESTS;

const {
  driver,
  mergeRederivedRecords,
  computeRederiveParserStamp,
} = require("./build-cache-from-corpus.js");
const { enrichSearchRecord } = require("./search-ranking.js");
const { writeCorpusXml } = require("./law-corpus-store.js");

// Read from the parser rather than pinned to a literal: these tests assert the
// merge/overwrite rule, not which version happens to be current.
const { getCurrentParserVersion } = require("./parser-stamp");

function existingRecord(overrides = {}) {
  return enrichSearchRecord({
    celex: "32020R0001",
    title: "Old Title",
    excerpt: "Old excerpt text.",
    date: "2020-01-15",
    eli: "http://data.europa.eu/eli/reg/2020/1/oj",
    eurovoc: ["consumer protection"],
    inForce: true,
    endOfValidity: null,
    fmxAvailable: true,
    fmxUnavailable: false,
    enrichError: null,
    ...overrides,
  });
}

test("mergeRederivedRecords: fresh title/excerpt win, every other field is preserved exactly", () => {
  const existing = existingRecord();
  const raw = {
    celex: "32020R0001",
    title: "New Title",
    excerpt: "New excerpt text.",
    date: null, // the offline worker never has a date
    eli: null,
    type: "regulation",
    fmxAvailable: true,
    fmxUnavailable: false,
    enrichError: null,
  };

  const { merged, stats } = mergeRederivedRecords({
    existingRecords: [existing],
    rawRecords: [raw],
    corpusCoveredKeys: new Set(["32020R0001"]),
    enrichSearchRecord,
  });

  assert.equal(merged.length, 1);
  const record = merged[0];
  assert.equal(record.title, "New Title");
  assert.equal(record.excerpt, "New excerpt text.");
  // Everything else — SPARQL/enrichment metadata the offline worker can't
  // reconstruct — must survive untouched.
  assert.equal(record.date, "2020-01-15");
  assert.deepEqual(record.eurovoc, ["consumer protection"]);
  assert.equal(record.inForce, true);
  assert.equal(record.eli, existing.eli);
  // Derived fields must be recomputed from the NEW title (enrichSearchRecord
  // is re-run onto the merged record) — not left over from "Old Title".
  assert.equal(record.normalizedTitle, enrichSearchRecord({ title: "New Title" }).normalizedTitle);
  assert.notEqual(record.normalizedTitle, enrichSearchRecord({ title: "Old Title" }).normalizedTitle);

  assert.equal(stats.rederived, 1);
  assert.equal(stats.failed, 0);
  assert.equal(stats.noCorpusFile, 0);
  assert.equal(stats.missed, 0);
  assert.equal(stats.excerptChanged, 1);
});

test("mergeRederivedRecords: a fresh empty title does not erase a good existing title", () => {
  const existing = existingRecord({ title: "Kept Title" });
  const raw = { celex: "32020R0001", title: null, excerpt: "Refreshed excerpt.", enrichError: null };

  const { merged } = mergeRederivedRecords({
    existingRecords: [existing],
    rawRecords: [raw],
    corpusCoveredKeys: new Set(["32020R0001"]),
    enrichSearchRecord,
  });

  assert.equal(merged[0].title, "Kept Title");
  assert.equal(merged[0].excerpt, "Refreshed excerpt.");
});

test("mergeRederivedRecords: a record with no corpus file is preserved untouched", () => {
  const existing = existingRecord({ celex: "31999D0002", title: "Untouched" });

  const { merged, stats } = mergeRederivedRecords({
    existingRecords: [existing],
    rawRecords: [], // no corpus file -> nothing was ever parsed for this celex
    corpusCoveredKeys: new Set(), // not covered by any corpus file
    enrichSearchRecord,
  });

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], existing);
  assert.equal(stats.rederived, 0);
  assert.equal(stats.failed, 0);
  assert.equal(stats.noCorpusFile, 1);
  assert.equal(stats.missed, 0);
});

test("mergeRederivedRecords: a failed parse preserves the existing record and counts as failed", () => {
  const existing = existingRecord({ celex: "32021L0005", title: "Kept On Failure" });
  const raw = { celex: "32021L0005", title: null, excerpt: "", enrichError: "boom" };

  const { merged, stats } = mergeRederivedRecords({
    existingRecords: [existing],
    rawRecords: [raw],
    corpusCoveredKeys: new Set(["32021L0005"]),
    enrichSearchRecord,
  });

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], existing);
  assert.equal(stats.rederived, 0);
  assert.equal(stats.failed, 1);
  assert.equal(stats.noCorpusFile, 0);
  assert.equal(stats.missed, 0);
});

test("mergeRederivedRecords: the record count never regresses across a mixed batch", () => {
  const records = [
    existingRecord({ celex: "32020R0001" }), // rederived successfully
    existingRecord({ celex: "32021L0002" }), // parse fails
    existingRecord({ celex: "31999D0003" }), // no corpus file
  ];
  const rawRecords = [
    { celex: "32020R0001", title: "Fresh", excerpt: "Fresh excerpt", enrichError: null },
    { celex: "32021L0002", title: null, excerpt: "", enrichError: "boom" },
  ];

  const { merged } = mergeRederivedRecords({
    existingRecords: records,
    rawRecords,
    corpusCoveredKeys: new Set(["32020R0001", "32021L0002"]),
    enrichSearchRecord,
  });

  assert.equal(merged.length, records.length);
  assert.deepEqual(
    merged.map((r) => r.celex).sort(),
    records.map((r) => r.celex).sort()
  );
});

test("mergeRederivedRecords: a corpus-covered record missing from worker output is counted as missed", async () => {
  const current = await getCurrentParserVersion();
  const previous = current - 1;
  const existing = existingRecord({ celex: "32020R0001" });
  const { stats } = mergeRederivedRecords({
    existingRecords: [existing],
    rawRecords: [],
    corpusCoveredKeys: new Set([existing.celex]),
    enrichSearchRecord,
  });

  assert.equal(stats.rederived, 0);
  assert.equal(stats.failed, 0);
  assert.equal(stats.missed, 1);
  assert.deepEqual(computeRederiveParserStamp({
    existingParserVersion: previous,
    currentParserVersion: current,
    stats,
  }), [previous, current]);
});

test("mergeRederivedRecords: a raw record for a celex not in the existing cache is ignored (never adds new acts)", () => {
  const existing = existingRecord({ celex: "32020R0001" });
  const raw = { celex: "39999R9999", title: "Should not appear", excerpt: "", enrichError: null };

  const { merged } = mergeRederivedRecords({
    existingRecords: [existing],
    rawRecords: [raw],
    corpusCoveredKeys: new Set(),
    enrichSearchRecord,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].celex, "32020R0001");
});

test("computeRederiveParserStamp: bare current version only when every record was successfully re-derived", async () => {
  const current = await getCurrentParserVersion();
  const complete = computeRederiveParserStamp({
    existingParserVersion: 21,
    currentParserVersion: current,
    stats: { rederived: 5, failed: 0, noCorpusFile: 0, staleUncovered: 0, missed: 0, excerptChanged: 5 },
  });
  assert.equal(complete, current);
});

// The cache holds tens of thousands of SPARQL-only acts that are outside the
// harvested corpus and have never carried an excerpt. Counting those as a gap
// would put a bare stamp permanently out of reach, so the rule is about stale
// *parser output* left behind, not about untouched records.
test("computeRederiveParserStamp: uncovered records without an excerpt are not a gap", async () => {
  const current = await getCurrentParserVersion();
  const stamp = computeRederiveParserStamp({
    existingParserVersion: 21,
    currentParserVersion: current,
    stats: { rederived: 5, failed: 0, noCorpusFile: 40000, staleUncovered: 0, missed: 0, excerptChanged: 5 },
  });
  assert.equal(stamp, current);
});

test("computeRederiveParserStamp: merges onto the existing stamp when anything was left untouched", async () => {
  const current = await getCurrentParserVersion();
  const partialFailed = computeRederiveParserStamp({
    existingParserVersion: 21,
    currentParserVersion: current,
    stats: { rederived: 4, failed: 1, noCorpusFile: 0, staleUncovered: 0, missed: 0, excerptChanged: 4 },
  });
  assert.deepEqual(partialFailed, [21, current]);

  // An uncovered record that *does* carry an excerpt holds parser output from
  // some earlier version that no corpus file can refresh — a real gap.
  const partialStale = computeRederiveParserStamp({
    existingParserVersion: 21,
    currentParserVersion: current,
    stats: { rederived: 4, failed: 0, noCorpusFile: 1, staleUncovered: 1, missed: 0, excerptChanged: 4 },
  });
  assert.deepEqual(partialStale, [21, current]);
});

test("computeRederiveParserStamp: a legacy unstamped payload stays unstamped after a partial rederive", async () => {
  const stamp = computeRederiveParserStamp({
    existingParserVersion: undefined,
    currentParserVersion: await getCurrentParserVersion(),
    stats: { rederived: 0, failed: 0, noCorpusFile: 3, staleUncovered: 3, missed: 0, excerptChanged: 0 },
  });
  assert.equal(stamp, null);
});

const SAMPLE_FMX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ACT>
  <BIB.INSTANCE><LG.DOC>EN</LG.DOC></BIB.INSTANCE>
  <TITLE><TI><P>Regulation on Rederived Widgets</P></TI></TITLE>
  <PREAMBLE>
    <GR.CONSID>
      <CONSID><NP><NO.P>(1)</NO.P><TXT>Rederived widgets require a harmonised legal framework.</TXT></NP></CONSID>
    </GR.CONSID>
  </PREAMBLE>
  <ENACTING.TERMS>
    <ARTICLE IDENTIFIER="001">
      <TI.ART>Article 1</TI.ART>
      <STI.ART>Subject matter</STI.ART>
      <ALINEA><P>This Regulation lays down harmonised rules on rederived widgets.</P></ALINEA>
    </ARTICLE>
  </ENACTING.TERMS>
</ACT>`;

test("driver({ rederive: true }) re-parses the corpus-backed record, preserves the corpus-less one, and stamps the header before records", async (t) => {
  const cachePath = path.join(CORPUS_DIR_FOR_TESTS, "search-cache.json");
  const withCorpusCelex = "32024R0001";
  const noCorpusCelex = "31999D0002";

  const withCorpus = existingRecord({
    celex: withCorpusCelex,
    title: "Stale Title",
    excerpt: "Stale excerpt.",
    eli: "http://data.europa.eu/eli/reg/2024/1/oj",
  });
  const noCorpus = existingRecord({
    celex: noCorpusCelex,
    title: "Never Touched",
    excerpt: "Never touched excerpt.",
    eli: null,
  });

  fs.writeFileSync(cachePath, JSON.stringify({
    generatedAt: "2026-01-01T00:00:00.000Z",
    fromYear: 2024,
    toYear: 1999,
    parserVersion: 21,
    count: 2,
    records: [withCorpus, noCorpus],
  }));
  await writeCorpusXml(CORPUS_DIR_FOR_TESTS, withCorpusCelex, SAMPLE_FMX_XML);

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("network access is not allowed for --rederive");
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  await driver({ rederive: true });

  const written = fs.readFileSync(cachePath, "utf8");
  const payload = JSON.parse(written);

  assert.equal(payload.records.length, 2);
  assert.ok(written.indexOf('"parserVersion"') < written.indexOf('"records"'));

  const refreshed = payload.records.find((r) => r.celex === withCorpusCelex);
  assert.equal(refreshed.title, "Regulation on Rederived Widgets");
  assert.match(refreshed.excerpt, /Rederived widgets/);
  // Enrichment fields untouched by the rederive.
  assert.equal(refreshed.date, "2020-01-15");
  assert.deepEqual(refreshed.eurovoc, ["consumer protection"]);
  assert.equal(refreshed.inForce, true);

  const untouched = payload.records.find((r) => r.celex === noCorpusCelex);
  assert.equal(untouched.title, "Never Touched");
  assert.equal(untouched.excerpt, "Never touched excerpt.");

  // One record had a corpus file and re-derived cleanly, the other had none —
  // not a complete rederive, so the stamp must merge onto the prior "21".
  assert.deepEqual(payload.parserVersion, [21, await getCurrentParserVersion()]);
});

// A worker that exhausts its heap cap dies on V8's fatal handler while the
// machine still has RAM to spare, so the whole batch used to be abandoned: three
// corpus-wide dispatches each lost the same 4,100 records that way (13 batches),
// which alone puts a bare current-version parser stamp out of reach. Bisection
// narrows a failure to the documents actually responsible.
test("bisecting a failed batch rescues every document except the poison one", async () => {
  const { runBatchBisecting } = require("./build-cache-from-corpus.js");
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-bisect-"));
  try {
    const items = Array.from({ length: 8 }, (_, i) => ({ celex: `CELEX${i}`, file: `/corpus/${i}.xml.gz` }));
    const poison = "CELEX5";
    const parsed = [];

    const spawn = async (variant, batchPath, outPath) => {
      const batch = JSON.parse(fs.readFileSync(batchPath, "utf8"));
      if (batch.some((entry) => entry.celex === poison)) {
        throw new Error("worker exited null: heap out of memory");
      }
      parsed.push(...batch.map((entry) => entry.celex));
      fs.writeFileSync(outPath, JSON.stringify(batch));
    };

    const casualties = await runBatchBisecting(
      "fmx", items, { workDir, runId: "test", spawn, log: () => {} }, "0",
    );

    assert.deepEqual(casualties.map((c) => c.celex), [poison]);
    // All seven survivors were written, rather than dying alongside the poison.
    assert.deepEqual(parsed.sort(), items.map((i) => i.celex).filter((c) => c !== poison).sort());
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("bisected partials keep the -out- infix the resume scan matches", async () => {
  const { runBatchBisecting } = require("./build-cache-from-corpus.js");
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-bisect-"));
  try {
    const items = Array.from({ length: 4 }, (_, i) => ({ celex: `C${i}`, file: `/corpus/${i}.xml.gz` }));
    const spawn = async (variant, batchPath, outPath) => {
      const batch = JSON.parse(fs.readFileSync(batchPath, "utf8"));
      if (batch.length > 1) throw new Error("worker exited null: heap out of memory");
      fs.writeFileSync(outPath, JSON.stringify(batch));
    };

    await runBatchBisecting("fmx", items, { workDir, runId: "test", spawn, log: () => {} }, "0");

    const partials = fs.readdirSync(workDir).filter((f) => /-out-.*\.json$/.test(f));
    assert.equal(partials.length, 4, "each single-document sub-batch wrote a partial");
    const celexes = partials.flatMap((f) => JSON.parse(fs.readFileSync(path.join(workDir, f), "utf8")).map((r) => r.celex));
    assert.deepEqual(celexes.sort(), ["C0", "C1", "C2", "C3"]);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("a clean batch never bisects and reports no casualties", async () => {
  const { runBatchBisecting } = require("./build-cache-from-corpus.js");
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-bisect-"));
  try {
    const items = Array.from({ length: 6 }, (_, i) => ({ celex: `C${i}`, file: `/corpus/${i}.html.gz` }));
    let spawns = 0;
    const spawn = async (variant, batchPath, outPath) => {
      spawns += 1;
      fs.writeFileSync(outPath, fs.readFileSync(batchPath));
    };

    const casualties = await runBatchBisecting("html", items, { workDir, runId: "test", spawn, log: () => {} }, "0");
    assert.deepEqual(casualties, []);
    assert.equal(spawns, 1, "no extra worker spawns when the batch succeeds");
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
