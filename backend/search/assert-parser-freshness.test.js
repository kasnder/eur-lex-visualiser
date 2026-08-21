const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const Database = require("better-sqlite3");

const { assertParserFreshness } = require("./assert-parser-freshness");

function writeJson(dir, name, payload) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`);
  return file;
}

function writeMetadataDatabase(filePath, table, rows) {
  const database = new Database(filePath);
  database.exec(`CREATE TABLE ${table} (key TEXT PRIMARY KEY, value TEXT)`);
  const insert = database.prepare(`INSERT INTO ${table} (key, value) VALUES (?, ?)`);
  for (const [key, value] of Object.entries(rows)) insert.run(key, value);
  database.close();
  return filePath;
}

test("fresh JSON and fulltext assets pass, while absent definitions are allowed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-freshness-fresh-"));
  const searchCachePath = writeJson(dir, "search.json", { parserVersion: 22, records: [] });
  const citationGraphPath = writeJson(dir, "citation.json", { parserVersion: [22], edges: [] });
  const fulltextSqlitePath = writeMetadataDatabase(path.join(dir, "fulltext.sqlite"), "fulltext_metadata", {
    parser_version: "22",
  });
  const result = await assertParserFreshness({
    searchCachePath,
    citationGraphPath,
    definitionsPath: path.join(dir, "definitions.json"),
    fulltextSqlitePath,
    currentVersion: 22,
  });
  assert.equal(result.fresh, true);
  assert.deepEqual(result.findings, []);
});

test("reports a mixed-version stamp as drift, not freshness", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-freshness-mixed-"));
  const searchCachePath = writeJson(dir, "search.json", { parserVersion: "21,22", records: [] });
  const citationGraphPath = writeJson(dir, "citation.json", { parserVersion: [21, 22], edges: [] });
  const result = await assertParserFreshness({
    searchCachePath,
    citationGraphPath,
    definitionsPath: path.join(dir, "definitions.json"),
    currentVersion: 22,
  });
  assert.equal(result.fresh, false);
  assert.deepEqual(result.findings.map((finding) => finding.asset), ["search-cache", "citation-graph"]);
});

test("reports every drifted or unstamped asset", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-freshness-drift-"));
  const searchCachePath = writeJson(dir, "search.json", { records: [] });
  const citationGraphPath = writeJson(dir, "citation.json", { parserVersion: 21, edges: [] });
  const definitionsPath = writeJson(dir, "definitions.json", { parserVersion: 21, occurrences: [] });
  const fulltextSqlitePath = writeMetadataDatabase(path.join(dir, "fulltext.sqlite"), "fulltext_metadata", {
    parser_version: "null",
  });
  const result = await assertParserFreshness({
    searchCachePath,
    citationGraphPath,
    definitionsPath,
    fulltextSqlitePath,
    currentVersion: 22,
  });
  assert.deepEqual(result.findings.map((finding) => finding.asset), [
    "search-cache",
    "citation-graph",
    "definitions",
    "fulltext",
  ]);

  const args = [
    require.resolve("./assert-parser-freshness"),
    "--search-cache", searchCachePath,
    "--citation-graph", citationGraphPath,
    "--definitions", definitionsPath,
    "--fulltext-sqlite", fulltextSqlitePath,
  ];
  const failed = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(failed.status, 1);
  for (const asset of ["search-cache", "citation-graph", "definitions", "fulltext"]) {
    assert.match(failed.stderr, new RegExp(`parser drift: ${asset}`));
  }
  const allowed = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, ALLOW_PARSER_DRIFT: "true" },
  });
  assert.equal(allowed.status, 0);
});

test("checks parser stamps propagated into data.sqlite", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-freshness-data-"));
  const dataSqlitePath = writeMetadataDatabase(path.join(dir, "data.sqlite"), "metadata", {
    search_parser_version: "22",
    citation_graph_version: "2",
    citation_graph_parser_version: "21",
    definitions_available: "1",
    definitions_parser_version: "22",
  });
  const result = await assertParserFreshness({ dataSqlitePath, currentVersion: 22 });
  assert.deepEqual(result.findings.map((finding) => finding.asset), ["data.sqlite citation graph"]);
});
