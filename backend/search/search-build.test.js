const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  attachEurovocTopics,
  buildYearQuery,
  extractTitleFromEurlexHtml,
  harvestPrimaryActs,
  normalizeYearQueryActTypes,
  reEnrichCurrentCache,
  requestWithRetry,
} = require("./search-build");
const { writeCorpusXml } = require("./law-corpus-store");
const { getCurrentParserVersion } = require("./parser-stamp");

// Read from the parser rather than pinned to a literal: these tests assert the
// merge/overwrite *rule*, not which version happens to be current, and a
// routine PARSER_VERSION bump should not turn them red.

const SAMPLE_FMX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ACT>
  <BIB.INSTANCE><LG.DOC>EN</LG.DOC></BIB.INSTANCE>
  <TITLE><TI><P>Regulation on Widget Automation</P></TI></TITLE>
  <PREAMBLE>
    <GR.CONSID>
      <CONSID><NP><NO.P>(1)</NO.P><TXT>Automated decision-making systems require a harmonised legal framework.</TXT></NP></CONSID>
    </GR.CONSID>
  </PREAMBLE>
  <ENACTING.TERMS>
    <ARTICLE IDENTIFIER="001">
      <TI.ART>Article 1</TI.ART>
      <STI.ART>Subject matter</STI.ART>
      <ALINEA><P>This Regulation lays down harmonised rules on automated decision-making systems.</P></ALINEA>
    </ARTICLE>
  </ENACTING.TERMS>
</ACT>`;

// A record whose title is already present and which is not a primary act (no
// `eli`): under the default options (onlyMissingTitles / primaryActsOnly both
// true) it is never eligible for re-enrichment, so these tests never touch
// the network and only exercise the stamping decision itself.
function skippedRecord(celex) {
  return { celex, title: "The GDPR" };
}

test("reEnrichCurrentCache merges onto an existing stamp for a default (partial) run", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "search-reenrich-stamp-"));
  const cachePath = path.join(dir, "search-cache.json");
  fs.writeFileSync(cachePath, JSON.stringify({
    generatedAt: "2026-01-01T00:00:00.000Z",
    parserVersion: 21,
    records: [skippedRecord("32016R0679")],
  }));

  await reEnrichCurrentCache({ cachePath, eurovoc: false, inForce: false });
  const written = fs.readFileSync(cachePath, "utf8");
  // Default options only re-enrich records missing a title among primary
  // acts, so this run touches nothing here — it must MERGE onto the
  // existing "21" stamp, not overwrite it with a bare "22" that would
  // falsely claim every record was re-derived by the current parser.
  assert.deepEqual(JSON.parse(written).parserVersion, [21, await getCurrentParserVersion()]);
  assert.ok(written.indexOf('"parserVersion"') < written.indexOf('"records"'));
});

test("reEnrichCurrentCache leaves a legacy unstamped payload unstamped after a partial run", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "search-reenrich-stamp-legacy-"));
  const cachePath = path.join(dir, "search-cache.json");
  fs.writeFileSync(cachePath, JSON.stringify({
    generatedAt: "2026-01-01T00:00:00.000Z",
    records: [skippedRecord("32016R0679")],
  }));

  await reEnrichCurrentCache({ cachePath, eurovoc: false, inForce: false });
  const written = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  // mergeParserStamp deliberately preserves an absent stamp rather than
  // turning it into a falsely-fresh singleton (see parser-stamp.js).
  assert.equal(written.parserVersion, null);
});

test("reEnrichCurrentCache writes a bare current version only for a complete re-derive", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "search-reenrich-stamp-complete-"));
  const corpusDir = path.join(dir, "corpus");
  const cachePath = path.join(dir, "search-cache.json");
  const celex = "32024R0001";
  fs.writeFileSync(cachePath, JSON.stringify({
    generatedAt: "2026-01-01T00:00:00.000Z",
    parserVersion: 21,
    records: [{ celex, title: "Old Title" }],
  }));
  await writeCorpusXml(corpusDir, celex, SAMPLE_FMX_XML);

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("network access is not allowed when the corpus is warm");
  };
  try {
    // onlyMissingTitles: false and primaryActsOnly: false make every record
    // eligible; no maxRecords cap; the corpus is warm so extraction succeeds
    // for every record without falling back to its previous excerpt. Only
    // under these conditions is the run a genuine complete re-derive that
    // may claim the bare current version for the whole payload.
    await reEnrichCurrentCache({
      cachePath,
      corpusDir,
      onlyMissingTitles: false,
      primaryActsOnly: false,
      htmlFallback: false,
      eurovoc: false,
      inForce: false,
    });
  } finally {
    global.fetch = originalFetch;
  }

  const written = fs.readFileSync(cachePath, "utf8");
  assert.equal(JSON.parse(written).parserVersion, await getCurrentParserVersion());
  assert.ok(written.indexOf('"parserVersion"') < written.indexOf('"records"'));
});

// EuroVoc runs as the last step of the build so a finished cache is complete
// (a CELEX-keyed pass bolted on afterwards strands records silently). But
// topics are a nice-to-have riding on a multi-hour harvest, so the contract is
// best-effort: never throw away a build over them.
test("attachEurovocTopics skips enrichment when opted out", async () => {
  const records = [{ celex: "32016R0679" }];
  const logs = [];

  await attachEurovocTopics(records, { eurovoc: false }, (m) => logs.push(m));

  assert.equal(records[0].eurovoc, undefined);
  assert.match(logs.join(" "), /skipped/);
});

test("attachEurovocTopics swallows a SPARQL failure rather than failing the build", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eurovoc-build-fail-"));
  const records = [{ celex: "32016R0679" }];
  const logs = [];

  // Must resolve, not reject — a thrown error here would discard a multi-hour
  // harvest over metadata the cache can ship without.
  await attachEurovocTopics(
    records,
    {
      eurovocJournalPath: path.join(dir, "eurovoc.json"),
      eurovocRunQueryFn: async () => { throw new Error("Cellar is down"); },
    },
    (m) => logs.push(m),
  );

  assert.match(logs.join(" "), /EuroVoc enrichment failed/);
  assert.match(logs.join(" "), /Cellar is down/);
  assert.equal(records[0].eurovoc, undefined);
});

test("attachEurovocTopics is a no-op when every record already has topics", async () => {
  const records = [{ celex: "32016R0679", eurovoc: ["data protection"] }];
  const logs = [];

  await attachEurovocTopics(records, {}, (m) => logs.push(m));

  assert.deepEqual(records[0].eurovoc, ["data protection"]);
});

test("extractTitleFromEurlexHtml prefers WT.z_docTitle metadata", () => {
  const html = `
    <html>
      <head>
        <meta name="WT.z_docTitle" content="Directive (EU) 2015/2366 on payment services in the internal market" />
      </head>
      <body>
        <p id="title">Ignored fallback title</p>
      </body>
    </html>
  `;

  assert.equal(
    extractTitleFromEurlexHtml(html),
    "Directive (EU) 2015/2366 on payment services in the internal market"
  );
});

test("extractTitleFromEurlexHtml falls back to the title element in the page body", () => {
  const html = `
    <html>
      <body>
        <p id="title">
          Directive (EU) 2015/2366 of the European Parliament and of the Council
          on payment services in the internal market
        </p>
      </body>
    </html>
  `;

  assert.equal(
    extractTitleFromEurlexHtml(html),
    "Directive (EU) 2015/2366 of the European Parliament and of the Council on payment services in the internal market"
  );
});

test("buildYearQuery can target only directives and regulations", () => {
  const query = buildYearQuery({ year: 2001, limit: 200, offset: 0, actTypes: ["regulation", "directive"] });
  assert.match(query, /\^32001\[RL\]/);
  assert.match(query, /\/eli\/\(reg\|dir\)\/\[0-9\]\+\/\[0-9\]\+\/oj\$/);
  assert.doesNotMatch(query, /\[RLD\]/);
  assert.doesNotMatch(query, /dec/);
});

test("buildYearQuery does not couple the ELI year to the CELEX year", () => {
  // ECB decisions are adopted (CELEX-dated) one year but ELI-numbered under the
  // following year's OJ (e.g. 32014D0055 -> /eli/dec/2015/425/oj). The harvest
  // for the CELEX year must still accept these, so the ELI filter is year-agnostic.
  const query = buildYearQuery({ year: 2014, limit: 200, offset: 0 });
  assert.match(query, /\^32014\[RLD\]/);
  assert.match(query, /\/eli\/\(reg\|dir\|dec\)\/\[0-9\]\+\/\[0-9\]\+\/oj\$/);
  assert.doesNotMatch(query, /\/eli\/\([^)]+\)\/2014\//);
});

test("normalizeYearQueryActTypes drops unknown values and deduplicates", () => {
  assert.deepEqual(
    normalizeYearQueryActTypes(["directive", "decision", "directive", "weird"]),
    ["directive", "decision"]
  );
});

test("harvestPrimaryActs paginates based on raw SPARQL bindings", async () => {
  const pages = [
    {
      results: {
        bindings: [
          { celex: { value: "32001D0006(01)" }, eli: { value: "http://data.europa.eu/eli/dec/2001/566/oj" } },
          { celex: { value: "32001D0011" }, eli: { value: "http://data.europa.eu/eli/dec/2001/912/oj" } },
        ],
      },
    },
    {
      results: {
        bindings: [
          { celex: { value: "32001R0045" }, eli: { value: "http://data.europa.eu/eli/reg/2001/45/oj" } },
        ],
      },
    },
  ];
  let calls = 0;
  const records = await harvestPrimaryActs({
    fromYear: 2001,
    toYear: 2001,
    limit: 2,
    runSparqlImpl: async () => pages[calls++] || { results: { bindings: [] } },
  });
  assert.equal(calls, 2);
  assert.deepEqual(records.map((record) => record.celex), ["32001D0006(01)", "32001D0011", "32001R0045"]);
});

test("requestWithRetry does not sleep after its final failed attempt", async () => {
  const originalFetch = global.fetch;
  let sleeps = 0;
  global.fetch = async () => ({
    ok: false,
    status: 503,
    headers: { get: () => null },
  });

  try {
    await assert.rejects(
      requestWithRetry("https://example.test/unavailable", {
        maxAttempts: 1,
        sleepImpl: async () => { sleeps += 1; },
      }),
      /Exhausted 1 attempts/
    );
    assert.equal(sleeps, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
