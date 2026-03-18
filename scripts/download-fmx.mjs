#!/usr/bin/env node
/**
 * download-fmx.mjs
 * Download FMX (Formex 4) files for any EUR-Lex regulation by CELEX ID.
 *
 * Usage:
 *   node scripts/download-fmx.mjs <CELEX> [output-dir] [--lang <LANG>]
 *
 * Examples:
 *   node scripts/download-fmx.mjs 32016R0679
 *   node scripts/download-fmx.mjs 32024R1689 ./my-fmx
 *   node scripts/download-fmx.mjs 32016R0679 ./gdpr-pol --lang POL
 *
 * Supported languages (24 EU official languages):
 *   BUL  Bulgarian    CES  Czech        DAN  Danish
 *   DEU  German       ELL  Greek        ENG  English  (default)
 *   EST  Estonian     FIN  Finnish      FRA  French
 *   GLE  Irish        HRV  Croatian     HUN  Hungarian
 *   ITA  Italian      LAV  Latvian      LIT  Lithuanian
 *   MLT  Maltese      NLD  Dutch        POL  Polish
 *   POR  Portuguese   RON  Romanian     SLK  Slovak
 *   SLV  Slovenian    SPA  Spanish      SWE  Swedish
 *
 * How it works:
 *   1. Fetch Cellar RDF for the CELEX ID → find OJ fmx4 expression URI
 *   2. Fetch that fmx4 URI → find zip or individual XML manifestation URLs
 *   3. Download everything into output-dir
 */

import { mkdirSync, writeFileSync, createWriteStream } from 'fs';
import { join, basename } from 'path';
import { pipeline } from 'stream/promises';

const CELLAR_BASE = 'https://publications.europa.eu/resource';
const TIMEOUT_MS = 30_000;

function abort() { return AbortSignal.timeout(TIMEOUT_MS); }

async function getRdf(url) {
  const r = await fetch(url, {
    headers: { Accept: '*/*', 'Accept-Language': 'eng' },
    redirect: 'follow',
    signal: abort(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function extractUris(rdf) {
  return [...rdf.matchAll(/rdf:resource="([^"]+)"/g)].map(m => m[1]);
}

async function findFmx4Uri(celex, lang = 'ENG') {
  console.log(`[1] Fetching Cellar RDF for CELEX ${celex} (lang: ${lang})…`);
  const rdf = await getRdf(`${CELLAR_BASE}/celex/${celex}`);
  const uris = extractUris(rdf);

  // Match both old-style (JOL_) and new-style (L_YYYYNNNNN) fmx4 expression URIs for requested language
  const pattern = new RegExp(`\\/oj\\/(JOL_\\d{4}_\\d+_R_\\d+|L_\\d{9})\\.${lang}\\.fmx4$`);
  let fmx4 = uris.find(u => pattern.test(u));

  // If not found, try ENG as fallback and swap the language code
  if (!fmx4) {
    const engPattern = /\/oj\/(JOL_\d{4}_\d+_R_\d+|L_\d{9})\.ENG\.fmx4$/;
    const engFmx4 = uris.find(u => engPattern.test(u));
    if (engFmx4) {
      fmx4 = engFmx4.replace('.ENG.fmx4', `.${lang}.fmx4`);
      console.log(`[1] Derived ${lang} URI from ENG: ${fmx4}`);
    }
  }

  if (!fmx4) throw new Error(`No fmx4 expression URI found for lang=${lang}. Law may not have FMX available.`);
  console.log(`[1] Found fmx4 expression: ${fmx4}`);
  return fmx4;
}

async function findDownloadUrls(fmx4Uri) {
  console.log(`[2] Fetching fmx4 manifestation metadata…`);
  const rdf = await getRdf(fmx4Uri);
  const uris = extractUris(rdf);

  // Prefer zip (newer laws)
  const zip = uris.find(u => u.endsWith('.zip'));
  if (zip) {
    console.log(`[2] Found zip: ${zip}`);
    return { type: 'zip', urls: [zip] };
  }

  // Fall back to individual XML files (older laws like GDPR)
  // Deduplicate: multiple URI aliases can point to the same file — keep one per unique filename suffix
  const allXmlFiles = uris.filter(u =>
    u.match(/\.fmx4\.[^/]+\.xml$/) && !u.endsWith('.doc.xml')
  );
  const seen = new Set();
  const xmlFiles = allXmlFiles.filter(u => {
    const suffix = u.split('.fmx4.').pop();
    if (seen.has(suffix)) return false;
    seen.add(suffix);
    return true;
  });
  if (xmlFiles.length) {
    console.log(`[2] Found ${xmlFiles.length} XML file(s)`);
    return { type: 'xml', urls: xmlFiles };
  }

  // Also try .doc.xml if nothing else
  const docXmls = uris.filter(u => u.endsWith('.doc.xml'));
  if (docXmls.length) {
    console.log(`[2] Found .doc.xml fallback`);
    return { type: 'xml', urls: [...xmlFiles, ...docXmls] };
  }

  throw new Error('No downloadable FMX files found in manifestation metadata.');
}

async function download(url, destPath) {
  const r = await fetch(url, { redirect: 'follow', signal: abort() });
  if (!r.ok) throw new Error(`HTTP ${r.status} downloading ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(destPath, buf);
  return buf.length;
}

async function main() {
  const args = process.argv.slice(2);
  const langIdx = args.indexOf('--lang');
  const lang = langIdx !== -1 ? args.splice(langIdx, 2)[1].toUpperCase() : 'ENG';
  const [celex, outDir = './fmx-downloads'] = args;

  if (!celex) {
    console.error('Usage: node scripts/download-fmx.mjs <CELEX> [output-dir] [--lang <LANG>]');
    console.error('Example: node scripts/download-fmx.mjs 32016R0679 ./out --lang POL');
    console.error('Languages: BUL CES DAN DEU ELL ENG EST FIN FRA GLE HRV HUN ITA LAV LIT MLT NLD POL POR RON SLK SLV SPA SWE');
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });

  try {
    const fmx4Uri = await findFmx4Uri(celex, lang);
    const { type, urls } = await findDownloadUrls(fmx4Uri);

    console.log(`[3] Downloading ${urls.length} file(s) to ${outDir}…`);
    for (const url of urls) {
      const filename = url.split('/').pop();
      const dest = join(outDir, filename);
      process.stdout.write(`    ${filename} … `);
      const bytes = await download(url, dest);
      console.log(`${(bytes / 1024).toFixed(0)} KB`);
    }

    console.log(`\n✅ Done! Files saved to: ${outDir}`);

    if (type === 'zip') {
      console.log(`   Unzip with: unzip ${join(outDir, urls[0].split('/').pop())}`);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
