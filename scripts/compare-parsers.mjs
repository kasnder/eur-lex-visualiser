/**
 * Compare the output of the existing XHTML parser (on gdpr.xml)
 * vs the new FMX parser (on the Formex XML file).
 *
 * Run:  node scripts/compare-parsers.mjs
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

// Set up DOM globals so the parsers work in Node
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.Element = dom.window.Element;
globalThis.document = dom.window.document;

const { parseSingleXHTMLToCombined } = await import("../src/utils/parsers.js");
const { parseFmxToCombined } = await import("../src/utils/fmxParser.js");

const xhtmlFile = path.resolve("public/data/gdpr.xml");
const fmxFile = path.resolve("L_2016119EN.01000101.xml.txt");

const xhtmlText = fs.readFileSync(xhtmlFile, "utf-8");
const fmxText = fs.readFileSync(fmxFile, "utf-8");

console.log("Parsing XHTML (gdpr.xml)...");
const xhtmlResult = parseSingleXHTMLToCombined(xhtmlText);

console.log("Parsing FMX (L_2016119EN.01000101.xml.txt)...");
const fmxResult = parseFmxToCombined(fmxText);

console.log("\n=== COMPARISON ===\n");

// Title
console.log(`Title (XHTML): ${xhtmlResult.title}`);
console.log(`Title (FMX):   ${fmxResult.title}`);

// Articles
console.log(`\nArticles (XHTML): ${xhtmlResult.articles.length}`);
console.log(`Articles (FMX):   ${fmxResult.articles.length}`);

// Compare article numbers
const xhtmlArtNums = xhtmlResult.articles.map(a => a.article_number);
const fmxArtNums = fmxResult.articles.map(a => a.article_number);
const missingInFmx = xhtmlArtNums.filter(n => !fmxArtNums.includes(n));
const extraInFmx = fmxArtNums.filter(n => !xhtmlArtNums.includes(n));
if (missingInFmx.length) console.log(`  Missing in FMX: ${missingInFmx.join(", ")}`);
if (extraInFmx.length) console.log(`  Extra in FMX: ${extraInFmx.join(", ")}`);

// Compare article titles
let titleMismatches = 0;
for (const xa of xhtmlResult.articles) {
  const fa = fmxResult.articles.find(a => a.article_number === xa.article_number);
  if (fa && xa.article_title !== fa.article_title) {
    titleMismatches++;
    if (titleMismatches <= 5) {
      console.log(`  Art ${xa.article_number} title mismatch:`);
      console.log(`    XHTML: "${xa.article_title}"`);
      console.log(`    FMX:   "${fa.article_title}"`);
    }
  }
}
if (titleMismatches > 5) console.log(`  ... and ${titleMismatches - 5} more title mismatches`);
console.log(`  Title matches: ${xhtmlResult.articles.length - titleMismatches}/${xhtmlResult.articles.length}`);

// Compare divisions (chapters/sections)
let divMatches = 0;
for (const xa of xhtmlResult.articles) {
  const fa = fmxResult.articles.find(a => a.article_number === xa.article_number);
  if (fa && xa.division?.chapter?.number && fa.division?.chapter?.number) {
    if (xa.division.chapter.title === fa.division.chapter.title) divMatches++;
  }
}
console.log(`  Division matches: ${divMatches}/${xhtmlResult.articles.length}`);

// Recitals
console.log(`\nRecitals (XHTML): ${xhtmlResult.recitals.length}`);
console.log(`Recitals (FMX):   ${fmxResult.recitals.length}`);

// Compare first few recital texts
let recitalMatches = 0;
for (const xr of xhtmlResult.recitals) {
  const fr = fmxResult.recitals.find(r => r.recital_number === xr.recital_number);
  if (fr) {
    // Compare text (normalize whitespace)
    const xt = xr.recital_text.replace(/\s+/g, " ").trim().slice(0, 100);
    const ft = fr.recital_text.replace(/\s+/g, " ").trim().slice(0, 100);
    if (xt === ft) recitalMatches++;
  }
}
console.log(`  Text matches (first 100 chars): ${recitalMatches}/${xhtmlResult.recitals.length}`);

// Definitions
console.log(`\nDefinitions (XHTML): ${xhtmlResult.definitions.length}`);
console.log(`Definitions (FMX):   ${fmxResult.definitions.length}`);
for (const xd of xhtmlResult.definitions) {
  const fd = fmxResult.definitions.find(d => d.term === xd.term);
  if (!fd) console.log(`  Missing in FMX: "${xd.term}"`);
}
for (const fd of fmxResult.definitions) {
  const xd = xhtmlResult.definitions.find(d => d.term === fd.term);
  if (!xd) console.log(`  Extra in FMX: "${fd.term}"`);
}

// Cross-references (FMX only feature — but now also in XHTML)
const xhtmlCrossRefCount = Object.keys(xhtmlResult.crossReferences || {}).length;
const fmxCrossRefCount = Object.keys(fmxResult.crossReferences || {}).length;
console.log(`\nCross-references:`);
console.log(`  XHTML articles with refs: ${xhtmlCrossRefCount}`);
console.log(`  FMX articles with refs:   ${fmxCrossRefCount}`);

// Show a few cross-ref examples from FMX
const fmxCrossRefEntries = Object.entries(fmxResult.crossReferences || {}).filter(([k]) => !k.startsWith("recital_"));
if (fmxCrossRefEntries.length > 0) {
  console.log(`\n  Sample cross-references (FMX):`);
  for (const [art, refs] of fmxCrossRefEntries.slice(0, 5)) {
    const artRefs = refs.filter(r => r.type === "article").map(r => `Art.${r.target}${r.paragraph ? `(${r.paragraph})` : ""}`);
    console.log(`    Article ${art} → ${artRefs.join(", ")}`);
  }
}

console.log("\n=== DONE ===");
