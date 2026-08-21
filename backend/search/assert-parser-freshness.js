"use strict";

const fs = require("node:fs");
const Database = require("better-sqlite3");

const { getCurrentParserVersion, isFresh, normalizeParserStamp } = require("./parser-stamp");
const { streamStats } = require("./json-stream-stats");

function parseArgs(argv) {
  const options = {};
  const flags = new Map([
    ["--search-cache", "searchCachePath"],
    ["--citation-graph", "citationGraphPath"],
    ["--definitions", "definitionsPath"],
    ["--fulltext-sqlite", "fulltextSqlitePath"],
    ["--data-sqlite", "dataSqlitePath"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = flags.get(argv[index]);
    if (!key) throw new Error(`Unknown argument: ${argv[index]}`);
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${argv[index - 1]}`);
    options[key] = value;
  }
  return options;
}

function parseStoredStamp(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readSqliteMetadata(filePath) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return new Map(database.prepare("SELECT key, value FROM fulltext_metadata").all()
      .map((row) => [row.key, row.value]));
  } finally {
    database.close();
  }
}

function readDataMetadata(filePath) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return new Map(database.prepare("SELECT key, value FROM metadata").all()
      .map((row) => [row.key, row.value]));
  } finally {
    database.close();
  }
}

function staleFinding(asset, stamp, current, detail = null) {
  if (isFresh(stamp, current)) return null;
  return {
    asset,
    stamp: normalizeParserStamp(stamp),
    current,
    detail,
  };
}

async function checkJsonAsset(filePath, asset, current) {
  if (!fs.existsSync(filePath)) return staleFinding(asset, undefined, current, "missing");
  try {
    const stats = await streamStats(filePath, {
      captureTopLevel: ["parserVersion"],
      stopWhenCaptured: true,
    });
    return staleFinding(asset, stats.topLevel?.parserVersion, current);
  } catch (error) {
    return staleFinding(asset, undefined, current, error.message);
  }
}

function checkFulltextSqlite(filePath, asset, current) {
  if (!fs.existsSync(filePath)) return staleFinding(asset, undefined, current, "missing");
  try {
    const metadata = readSqliteMetadata(filePath);
    return staleFinding(asset, parseStoredStamp(metadata.get("parser_version")), current);
  } catch (error) {
    return staleFinding(asset, undefined, current, error.message);
  }
}

function checkDataSqlite(filePath, current) {
  if (!fs.existsSync(filePath)) return [staleFinding("data.sqlite", undefined, current, "missing")];
  try {
    const metadata = readDataMetadata(filePath);
    const findings = [
      staleFinding("data.sqlite search", parseStoredStamp(metadata.get("search_parser_version")), current),
    ];
    if ([...metadata.keys()].some((key) => key.startsWith("citation_graph_"))) {
      findings.push(staleFinding(
        "data.sqlite citation graph",
        parseStoredStamp(metadata.get("citation_graph_parser_version")),
        current
      ));
    }
    if (metadata.has("definitions_parser_version") || metadata.get("definitions_available") === "1") {
      findings.push(staleFinding(
        "data.sqlite definitions",
        parseStoredStamp(metadata.get("definitions_parser_version")),
        current
      ));
    }
    return findings.filter(Boolean);
  } catch (error) {
    return [staleFinding("data.sqlite", undefined, current, error.message)];
  }
}

async function assertParserFreshness({
  searchCachePath,
  citationGraphPath,
  definitionsPath,
  fulltextSqlitePath,
  dataSqlitePath,
  currentVersion,
} = {}) {
  if (!Number.isSafeInteger(currentVersion)) throw new Error("currentVersion must be a parser version number");
  const findings = [];
  const jsonAssets = [
    [searchCachePath, "search-cache", false],
    [citationGraphPath, "citation-graph", false],
    [definitionsPath, "definitions", true],
  ];
  for (const [filePath, asset, optional] of jsonAssets) {
    if (!filePath || (optional && !fs.existsSync(filePath))) continue;
    const finding = await checkJsonAsset(filePath, asset, currentVersion);
    if (finding) findings.push(finding);
  }
  if (fulltextSqlitePath) {
    const finding = checkFulltextSqlite(fulltextSqlitePath, "fulltext", currentVersion);
    if (finding) findings.push(finding);
  }
  if (dataSqlitePath) findings.push(...checkDataSqlite(dataSqlitePath, currentVersion));
  return { currentVersion, findings, fresh: findings.length === 0 };
}

function formatFinding(finding) {
  const stamp = finding.stamp.length ? finding.stamp.join(",") : "absent";
  return `parser drift: ${finding.asset} has ${stamp}; expected ${finding.current}${finding.detail ? ` (${finding.detail})` : ""}`;
}

function allowParserDrift(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const currentVersion = await getCurrentParserVersion();
  const result = await assertParserFreshness({ ...options, currentVersion });
  if (!result.findings.length) {
    console.log(`Parser freshness OK at v${currentVersion}.`);
    return 0;
  }
  for (const finding of result.findings) console.error(formatFinding(finding));
  if (allowParserDrift(env.ALLOW_PARSER_DRIFT)) {
    const summary = result.findings.map(formatFinding).join("\n");
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    console.warn("ALLOW_PARSER_DRIFT is set; continuing despite parser drift.");
    return 0;
  }
  return 1;
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(`[parser-freshness] fatal: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  allowParserDrift,
  assertParserFreshness,
  formatFinding,
  main,
  parseArgs,
  parseStoredStamp,
  readDataMetadata,
  readSqliteMetadata,
};
