"use strict";

// Regression for issue #200: jsdom pins every CSS-selector-queried XML
// document to its window forever — @asamuzakjp/dom-selector gives each queried
// document its own Finder, the Finder registers listeners on the shared window,
// and for XML documents every selector call stores the document on that Finder.
// A long-lived process therefore retains ~1 MB of DOM tree per parsed act and
// parse throughput decays with process age (the fulltext builder's collapse).
// fmx-parser-node.js counters by closing and replacing its shim window every N
// parses, only while no parse is in flight. These tests pin the mechanism: the
// window must actually be swapped on schedule, output must be byte-identical
// across swaps, and concurrent parses crossing a swap boundary must all agree.
//
// Each node --test file runs in its own process, so forcing the interval down
// via environment here cannot leak into other suites.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

process.env.FMX_DOM_SHIM_RECYCLE = "5";

const { parseFmxXml } = require("./fmx-parser-node.js");
const { wrapForParsing } = require("../search/search-build.js");

const FIXTURE = path.join(__dirname, "__fixtures__", "corpus", "fmx-v4-2009-32009L0004.xml.gz");
const xmlText = wrapForParsing(zlib.gunzipSync(fs.readFileSync(FIXTURE)).toString("utf8"));

// Generated EUR-Lex search links embed a Date.now() qid (url.mjs), so parses
// are only comparable with that stamp normalised away.
const canonicalize = (parsed) => JSON.stringify(parsed).replace(/qid=\d+/g, "qid=N");

test("shim window is replaced on schedule and parse output survives swaps unchanged", async () => {
  await parseFmxXml(xmlText); // first call installs the initial window
  let currentWindow = global.DOMParser;
  const expected = canonicalize(await parseFmxXml(xmlText));

  // 12 more parses at interval 5 must cross at least two replacement points.
  let swaps = 0;
  for (let i = 0; i < 12; i += 1) {
    const parsed = await parseFmxXml(xmlText);
    assert.equal(canonicalize(parsed), expected, "parse output changed across a shim-window swap");
    if (global.DOMParser !== currentWindow) {
      swaps += 1;
      currentWindow = global.DOMParser;
    }
  }
  assert.ok(swaps >= 2, `expected >=2 shim-window swaps over 14 parses at interval 5, saw ${swaps}`);
});

test("concurrent parses across a recycle boundary all succeed with identical output", async () => {
  const results = await Promise.all(Array.from({ length: 24 }, () => parseFmxXml(xmlText)));
  const expected = canonicalize(results[0]);
  for (const [index, result] of results.entries()) {
    assert.equal(canonicalize(result), expected, `concurrent parse ${index} diverged`);
  }
});
