/**
 * Node.js-compatible wrapper for the Formex parser.
 *
 * Railway deploys the API from the `backend` subdirectory, so this module
 * must not import parser code from the frontend `src` tree. Keep the parser
 * runtime self-contained under `backend/shared/formex-parser`.
 */

let parserPromise = null;
let jsdomCtor = null; // cached JSDOM constructor, so window swaps stay synchronous
let shimDom = null; // the JSDOM whose constructors are pinned onto globalThis
let activeParses = 0;
let parsesSinceRecycle = 0;

// jsdom pins every CSS-selector-queried XML document to its window for good:
// @asamuzakjp/dom-selector gives each queried document its own Finder, the
// Finder registers event listeners on the shared window (jsdom's EventTarget
// keeps them strongly), and for XML documents every selector call goes through
// Finder.setup(), which stores the queried document on that Finder. A shared
// window therefore accumulates one retained DOM tree (~1 MB) per parsed act,
// and long-lived processes decay as GC scans the ever-growing live set — this
// is the root cause behind the fulltext builder's throughput collapse (issue
// #200). Closing and replacing the window releases everything it pinned, so
// the window is replaced every N parses instead of a fresh one being created
// per parse. Swaps happen only while no parse is in flight: the parser reads
// DOMParser/Node/NodeFilter from globals at call time, and a single parse must
// never observe two different windows; every later parse then sees the
// new globals for its whole run. Set FMX_DOM_SHIM_RECYCLE=0 to disable.
//
// The default is sized against retention, not amortisation alone: a parsed
// act's DOM tree costs roughly 500x its source bytes (~10 MB per typical
// 18-21 KB corpus act), so every parse since the last swap stays pinned.
// 25 keeps that below ~a few hundred MB against the builders' 640 MB default
// worker cap while costing one fresh JSDOM per 25 parses (<1 ms/act).
const DEFAULT_SHIM_RECYCLE_PARSES = 25;

function shimRecycleInterval() {
  const raw = Number.parseInt(process.env.FMX_DOM_SHIM_RECYCLE ?? "", 10);
  return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_SHIM_RECYCLE_PARSES;
}

async function loadJsdom() {
  if (!jsdomCtor) {
    jsdomCtor = (await import("jsdom")).JSDOM;
  }
  return jsdomCtor;
}

function installShimWindow(dom) {
  shimDom = dom;
  global.DOMParser = dom.window.DOMParser;
  global.Node = dom.window.Node;
  global.NodeFilter = dom.window.NodeFilter;
}

async function ensureDomShims() {
  if (shimDom) return;
  const JSDOM = await loadJsdom();
  // A concurrent first caller may have installed the window while we awaited.
  if (shimDom) return;
  installShimWindow(new JSDOM(""));
}

// Synchronous: called from a parse's finally block with activeParses === 0, so
// no parse can be mid-flight across the swap and every later parse sees the
// new window for its whole run.
function maybeRecycleShimWindow() {
  const interval = shimRecycleInterval();
  if (!jsdomCtor || !shimDom) return;
  if (interval === 0 || activeParses > 0 || parsesSinceRecycle < interval) return;
  parsesSinceRecycle = 0;
  const previous = shimDom;
  try {
    installShimWindow(new jsdomCtor(""));
  } catch (error) {
    console.warn(`[fmx-parser] Keeping current DOM shim window, replacement failed: ${error?.message || error}`);
    return;
  }
  try {
    previous.window.close();
  } catch {
    // A dead window still gets collected once unreferenced; closing is only
    // the prompt release of everything it pinned.
  }
}

async function loadParser() {
  if (!parserPromise) {
    parserPromise = (async () => {
      await ensureDomShims();
      return import("./formex-parser/fmxParser.mjs");
    })();
  }

  return parserPromise;
}

async function parseFmxXml(xmlText) {
  const { parseFmxToCombined } = await loadParser();
  activeParses += 1;
  try {
    return parseFmxToCombined(xmlText);
  } finally {
    activeParses -= 1;
    parsesSinceRecycle += 1;
    maybeRecycleShimWindow();
  }
}

async function isFmxDocument(text) {
  const mod = await loadParser();
  return mod.isFmxDocument(text);
}

module.exports = { parseFmxXml, isFmxDocument };
